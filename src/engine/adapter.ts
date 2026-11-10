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
import type { Stimuli, Stimulus } from "./stimuli.ts";
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
  /** The text the model wrote: the agent's reflection, which acts on nothing and reaches no one (FR-TOOL-02). */
  text: string;
  /** How long the turn waited for a free slot under the parallelism limit before its call started. */
  slotWaitMs: number;
  /** When the call to the model started and when its answer ended, by performance.now(). */
  startedAtMs: number;
  endedAtMs: number;
}

/** One tool call an agent's model made, and how it ended. */
export interface ToolCall {
  agent: string;
  tool: string;
  /** The arguments exactly as the model made them, before Pi coerces them. */
  arguments: unknown;
  /** "success", "invalid_arguments", "unknown_tool", or the reason the scenario gives for a failed effect. */
  outcome: string;
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
  stimuli: Stimuli,
  toolCalls: ToolCall[],
): Promise<AgentSession> {
  const executed = new Map<string, string>();
  const { session } = await createAgentSession({
    // Pi falls back to the person's directory (~/.pi/agent/) wherever a path is left out (NFR-08).
    agentDir: labPiDirectory(),
    modelRuntime: runtime,
    model: agent.model.model,
    // The allowlist leaves out Pi's built-in tools and filters custom tools too, so it names every scenario tool.
    tools: tools.map((tool) => tool.name),
    customTools: tools.map((tool) => definition(world, tool, agent.name, executed)),
    resourceLoader: resources(settings.systemPrompt),
    sessionManager: SessionManager.inMemory(),
    // Neither the person's nor any project's Pi settings reach the session. A provider's error ends the activation
    // (FR-ADAPTER-02), so Pi does not retry it: a retry would turn the provider's failure into another turn.
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
  });
  forceSystemPrompt(session, settings.systemPrompt);
  runTurns(session, agent.name, settings.modelTurnTimeoutMs, parallelism, turns);
  deliverBetweenTurns(session, agent.name, stimuli);
  recordToolCalls(session, agent.name, new Set(tools.map((tool) => tool.name)), executed, toolCalls);
  return session;
}

/**
 * Records each of the agent's tool calls with the arguments its model made, which Pi passes on before it coerces them,
 * and its outcome. Pi answers a call to a tool the session does not offer with an error, and runs an offered tool only
 * once its arguments pass the tool's schema, so a call to an offered tool that did not run had arguments the tool does
 * not take.
 */
function recordToolCalls(
  session: AgentSession,
  agent: string,
  offered: ReadonlySet<string>,
  executed: ReadonlyMap<string, string>,
  toolCalls: ToolCall[],
): void {
  const made = new Map<string, unknown>();
  session.subscribe((event) => {
    if (event.type === "tool_execution_start") made.set(event.toolCallId, event.args);
    if (event.type === "tool_execution_end") {
      const outcome = !offered.has(event.toolName) ? "unknown_tool" : (executed.get(event.toolCallId) ?? "invalid_arguments");
      toolCalls.push({ agent, tool: event.toolName, arguments: made.get(event.toolCallId), outcome });
    }
  });
}

/**
 * Delivers the stimuli that arrived while the agent worked at its next model turn. Pi prepares each model turn after the
 * first of an activation only when the activation goes on, so a stimulus never extends one: one that arrives during the
 * activation's last turn waits for the agent to wake. Pi's own steering would not, since a steered message after a turn
 * without tool calls makes another turn (pi-agent-core 1.5.0, agent-loop.js).
 */
function deliverBetweenTurns(session: AgentSession, agent: string, stimuli: Stimuli): void {
  const prepare = session.agent.prepareNextTurnWithContext;
  session.agent.prepareNextTurnWithContext = async (turn, signal) => {
    const prepared = await prepare?.(turn, signal);
    const arrived = stimuli.take(agent).map((stimulus) => ({ role: "custom" as const, ...message(stimulus), timestamp: Date.now() }));
    return { ...prepared, messages: [...(prepared?.messages ?? []), ...arrived] };
  };
}

/**
 * Starts an activation with the stimuli the agent wakes to. Each stimulus enters the session as a message of its own,
 * which keeps its channel and source; the model reads its source, then what it says.
 */
export async function wake(session: AgentSession, [first, ...rest]: readonly Stimulus[]): Promise<void> {
  // Pi puts "nextTurn" messages right after the message that starts the run (AgentSession._prepareRun, 1.5.0).
  for (const stimulus of rest) await session.sendCustomMessage(message(stimulus), { deliverAs: "nextTurn" });
  await session.sendCustomMessage(message(first), { triggerTurn: true });
}

/** A stimulus as a message of the agent's session. */
function message(stimulus: Stimulus) {
  return { customType: "stimulus", content: `${stimulus.source}: ${stimulus.content}`, display: true, details: stimulus };
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
      const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      turns.push({ agent, ...outcome, text, slotWaitMs: startedAtMs - requestedAtMs, startedAtMs, endedAtMs });
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

/**
 * A scenario's tool as Pi runs it for one agent: the agent sees what it is for and what it takes; how it works stays in
 * the world. Each call it runs leaves its outcome under the call's id.
 */
function definition<State>(world: World<State>, tool: Tool<State>, agent: string, executed: Map<string, string>): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as ToolDefinition["parameters"],
    execute: async (id, args: Record<string, unknown>) => {
      if (tool.kind === "sensor") {
        executed.set(id, "success");
        return { content: [{ type: "text", text: tool.sense(world.state, agent) }], details: undefined };
      }
      const outcome = effect(world, tool, agent, args);
      executed.set(id, outcome);
      return { content: [{ type: "text", text: outcome }], details: undefined };
    },
  };
}

/** Applies an effector's call through the arbiter, and gives its outcome: "success" or the failure's reason. */
function effect<State>(world: World<State>, effector: Effector<State>, agent: string, args: Record<string, unknown>): string {
  // The agent comes last, so a call cannot act in another agent's name.
  const result = world.apply(effector.action, { ...args, agent });
  return result.applied ? "success" : result.reason;
}
