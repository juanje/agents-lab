import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AgentSession,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
  createAgentSession,
  createExtensionRuntime,
} from "@earendil-works/pi-coding-agent";
import { type Api, type AssistantMessage, type Model, type Provider, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import type { ParallelismLimit } from "./parallelism.ts";
import type { Effector, Tool } from "./tools.ts";
import type { World } from "./world.ts";

/** The model an agent works with, and the provider that serves it, which the run registers with Pi's model runtime. */
export interface AgentModel {
  model: Model<Api>;
  provider: Provider;
}

/** The lab's own Pi directory (D-08). Read when a run starts, so it follows the home directory the run sees. */
function labPiDirectory(): string {
  return join(homedir(), ".agents-lab", "pi");
}

/**
 * Makes the Pi model runtime a run's sessions share: the lab's own credentials and model definitions, never the
 * person's (NFR-08), with the providers of the agents' models registered like any other.
 */
export async function openRuntime(providers: readonly Provider[]): Promise<ModelRuntime> {
  const directory = labPiDirectory();
  const runtime = await ModelRuntime.create({
    authPath: join(directory, "auth.json"),
    modelsPath: join(directory, "models.json"),
    modelsStorePath: join(directory, "models-store.json"),
  });
  for (const provider of providers) runtime.registerNativeProvider(provider);
  return runtime;
}

/** One call to an agent's model within an activation, and how it ended. */
export interface ModelTurn {
  agent: string;
  /** "model_error" when the provider answered with an error, "timeout" when the turn ran too long; "success" otherwise. */
  outcome: "success" | "model_error" | "timeout";
  /** The provider's message, for a model error. */
  message?: string;
  /** How long the turn waited for a free slot under the parallelism limit before its call started. */
  slotWaitMs: number;
  /** When the call to the model started and when its answer ended, by performance.now(). */
  startedAtMs: number;
  endedAtMs: number;
}

/** What an agent's session is given besides its tools. */
export interface SessionSettings {
  /** The scenario's system prompt, which takes the place of Pi's own. */
  systemPrompt: string;
  /** How long a model turn may run before it is aborted. */
  modelTurnTimeoutMs: number;
}

/** Opens the Pi session an agent keeps for the whole run (FR-ADAPTER-02). */
export async function openSession<State>(
  world: World<State>,
  tools: readonly Tool<State>[],
  agent: { name: string; model: AgentModel },
  runtime: ModelRuntime,
  settings: SessionSettings,
  parallelism: ParallelismLimit,
  turns: ModelTurn[],
): Promise<AgentSession> {
  const { session } = await createAgentSession({
    // Pi falls back to the person's directory (~/.pi/agent/) wherever a path is left out (NFR-08).
    agentDir: labPiDirectory(),
    modelRuntime: runtime,
    model: agent.model.model,
    // The allowlist leaves out Pi's built-in tools and filters custom tools too, so it names every scenario tool.
    tools: tools.map((tool) => tool.name),
    customTools: tools.map((tool) => definition(world, tool, agent.name)),
    resourceLoader: resources(settings.systemPrompt),
    sessionManager: SessionManager.inMemory(),
    // Neither the person's nor any project's Pi settings reach the session. A provider's error ends the activation
    // (FR-ADAPTER-02), so Pi does not retry it: a retry would turn the provider's failure into another turn.
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
  });
  forceSystemPrompt(session, settings.systemPrompt);
  runTurns(session, agent.name, settings.modelTurnTimeoutMs, parallelism, turns);
  return session;
}

/**
 * Wraps the session's call to the model, so each model turn waits for a free slot under the parallelism limit, is
 * aborted when it runs longer than the timeout, and is recorded when its answer ends. An aborted answer carries no tool
 * calls Pi would run, and ends the activation.
 */
function runTurns(session: AgentSession, agent: string, timeoutMs: number, parallelism: ParallelismLimit, turns: ModelTurn[]): void {
  const call = session.agent.streamFunction;
  session.agent.streamFunction = async (model, context, options) => {
    const requestedAtMs = performance.now();
    const free = await parallelism.acquire();
    const startedAtMs = performance.now();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signal = options?.signal === undefined ? timeout.signal : AbortSignal.any([options.signal, timeout.signal]);
    const answer = await call(model, context, { ...options, signal });
    void answer.result().then((message) => {
      const endedAtMs = performance.now();
      clearTimeout(timer);
      free();
      const outcome = timeout.signal.aborted ? { outcome: "timeout" as const } : outcomeOf(message);
      turns.push({ agent, ...outcome, slotWaitMs: startedAtMs - requestedAtMs, startedAtMs, endedAtMs });
    });
    return answer;
  };
}

function outcomeOf(message: AssistantMessage): Pick<ModelTurn, "outcome" | "message"> {
  return message.stopReason === "error"
    ? { outcome: "model_error", message: message.errorMessage ?? "" }
    : { outcome: "success" };
}

/**
 * Makes the system prompt the model receives exactly the scenario's. Pi adds sections of its own, such as the working
 * directory, to every prompt it builds; only a forced prompt is sent as it is. Pi forces one by replacing the system
 * message in the agent's context projection (AgentSession._installAgentForcedPromptProjection), and this does the same.
 */
function forceSystemPrompt(session: AgentSession, systemPrompt: string): void {
  const projected = session.agent.transformContext;
  session.agent.transformContext = async (messages, signal) => {
    const transformed = projected === undefined ? messages : await projected(messages, signal);
    const current = getCurrentSystemMessage(transformed);
    const head = {
      role: "system" as const,
      content: systemPrompt,
      ...(current?.toolsAdded === undefined ? {} : { toolsAdded: current.toolsAdded }),
      timestamp: current?.timestamp ?? Date.now(),
    };
    return [head, ...transformed.filter((message) => message.role !== "system")];
  };
}

/**
 * What the session loads besides its tools: the scenario's system prompt in place of Pi's own, and nothing else: no
 * extensions, skills, prompt templates, themes or context files such as AGENTS.md (NFR-04).
 */
function resources(systemPrompt: string): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

/** A scenario's tool as Pi runs it for one agent: the agent sees what it is for and what it takes; how it works stays in the world. */
function definition<State>(world: World<State>, tool: Tool<State>, agent: string): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as ToolDefinition["parameters"],
    execute: async (_id, args: Record<string, unknown>) => {
      const text = tool.kind === "sensor" ? tool.sense(world.state, agent) : effect(world, tool, agent, args);
      return { content: [{ type: "text", text }], details: undefined };
    },
  };
}

/** Applies an effector's call through the arbiter, and gives its outcome: "success" or the failure's reason. */
function effect<State>(world: World<State>, effector: Effector<State>, agent: string, args: Record<string, unknown>): string {
  // The agent comes last, so a call cannot act in another agent's name.
  const result = world.apply(effector.action, { ...args, agent });
  return result.applied ? "success" : result.reason;
}
