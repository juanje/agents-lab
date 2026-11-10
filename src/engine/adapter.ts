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
import { waitAtLeast } from "./clock.ts";
import type { ParallelismLimit } from "./parallelism.ts";
import { SCRIPT_EXHAUSTED_MESSAGE } from "./scripted-model.ts";
import type { Sensing, Sensings } from "./sensings.ts";
import type { Stimuli, Stimulus } from "./stimuli.ts";
import type { AgentCall, Effector, Sensor, TargetAsSensed, Tool } from "./tools.ts";
import type { World } from "./world.ts";

/**
 * The model an agent works with, and the provider that serves it when Pi's model runtime does not already: a scripted
 * model's, which the run registers with the runtime.
 */
export interface AgentModel {
  model: Model<Api>;
  provider?: Provider;
}

/**
 * The model a name in Pi's provider/id form names, as the lab's Pi directory knows it, served through the lab's own
 * login (D-08).
 */
export async function labModel(name: string): Promise<AgentModel> {
  const separator = name.indexOf("/");
  if (separator <= 0 || separator === name.length - 1) throw new Error(`Model name "${name}" is not in Pi's provider/id form`);
  const runtime = await openRuntime([]);
  const model = runtime.getModel(name.slice(0, separator), name.slice(separator + 1));
  if (model === undefined) throw new Error(`The lab's Pi directory knows no model "${name}"`);
  return { model };
}

/** The lab's own Pi directory (D-08). Read when a run starts, so it follows the home directory the run sees. */
function labPiDirectory(): string {
  return join(homedir(), ".agents-lab", "pi");
}

/**
 * Makes the Pi model runtime a run's sessions share: the lab's own credentials and model definitions, never the
 * person's (NFR-08), with the providers of the agents' models registered like any other.
 */
export async function openRuntime(providers: readonly (Provider | undefined)[]): Promise<ModelRuntime> {
  const directory = labPiDirectory();
  const runtime = await ModelRuntime.create({
    authPath: join(directory, "auth.json"),
    modelsPath: join(directory, "models.json"),
    modelsStorePath: join(directory, "models-store.json"),
  });
  for (const provider of providers) if (provider !== undefined) runtime.registerNativeProvider(provider);
  return runtime;
}

/** One call to an agent's model within an activation, and how it ended. */
export interface ModelTurn {
  agent: string;
  /**
   * "model_error" when the provider answered with an error, "timeout" when the turn ran too long, "script_exhausted" when
   * a scripted model had no answer left (FR-ADAPTER-01), "cut_off" when the run's time limit passed during it
   * (FR-CLOCK-02); "success" otherwise.
   */
  outcome: "success" | "model_error" | "timeout" | "script_exhausted" | "cut_off";
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
  /**
   * "success", "invalid_arguments", "unknown_tool", "cut_off" for a call the run's time limit cut short, or the reason
   * the scenario gives for a failed effect.
   */
  outcome: string;
  /** When the call started and ended, by performance.now(). */
  startedAtMs: number;
  endedAtMs: number;
  /** For an effector call the tool ran, what the agent last sensed of its target before the call (FR-TOOL-04). */
  targetAsSensed?: TargetAsSensed;
}

/** What an agent's session is given besides its tools. */
export interface SessionSettings {
  /** The scenario's system prompt, which takes the place of Pi's own. */
  systemPrompt: string;
  /** How long a model turn may run before it is aborted. */
  modelTurnTimeoutMs: number;
  /** Aborts when the run's time limit passes, which cuts off the tool calls still running (FR-CLOCK-02). */
  timeLimit: AbortSignal;
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
  sensings: Sensings,
): Promise<AgentSession> {
  const executed = new Map<string, Executed>();
  const { session } = await createAgentSession({
    // Pi falls back to the person's directory (~/.pi/agent/) wherever a path is left out (NFR-08).
    agentDir: labPiDirectory(),
    modelRuntime: runtime,
    model: agent.model.model,
    // The allowlist leaves out Pi's built-in tools and filters custom tools too, so it names every scenario tool.
    tools: tools.map((tool) => tool.name),
    customTools: tools.map((tool) => definition(world, tool, agent.name, executed, sensings, settings.timeLimit)),
    resourceLoader: resources(settings.systemPrompt),
    sessionManager: SessionManager.inMemory(),
    // Neither the person's nor any project's Pi settings reach the session. A provider's error ends the activation
    // (FR-ADAPTER-02), so Pi does not retry it: a retry would turn the provider's failure into another turn.
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
  });
  forceSystemPrompt(session, settings.systemPrompt);
  runTurns(session, agent.name, settings, parallelism, turns);
  deliverBetweenTurns(session, agent.name, stimuli);
  endAtTimeLimit(session, settings.timeLimit);
  recordToolCalls(session, agent.name, new Set(tools.map((tool) => tool.name)), executed, toolCalls);
  return session;
}

/**
 * Records each of the agent's tool calls with the arguments its model made, which Pi passes on before it coerces them,
 * its outcome, and when it started and ended. Pi answers a call to a tool the session does not offer with an error, and
 * runs an offered tool only once its arguments pass the tool's schema, so a call to an offered tool that did not run had
 * arguments the tool does not take. A call that ran gives its own outcome and times, invalid_arguments included when the
 * engine rejected an argument the tool does not declare; one that did not run is timed by Pi's events around it.
 */
function recordToolCalls(
  session: AgentSession,
  agent: string,
  offered: ReadonlySet<string>,
  executed: ReadonlyMap<string, Executed>,
  toolCalls: ToolCall[],
): void {
  const made = new Map<string, { args: unknown; startedAtMs: number }>();
  session.subscribe((event) => {
    if (event.type === "tool_execution_start") made.set(event.toolCallId, { args: event.args, startedAtMs: performance.now() });
    if (event.type === "tool_execution_end") {
      const call = made.get(event.toolCallId);
      const ran = executed.get(event.toolCallId) ?? {
        outcome: offered.has(event.toolName) ? "invalid_arguments" : "unknown_tool",
        startedAtMs: call?.startedAtMs ?? performance.now(),
        endedAtMs: performance.now(),
      };
      toolCalls.push({ agent, tool: event.toolName, arguments: call?.args, ...ran });
    }
  });
}

/**
 * Ends the agent's activation after a model turn that finished once the run's time limit had passed, so no model turn
 * starts after the end (FR-CLOCK-02). Pi asks `finishTurn` after every turn, its tool calls done, and an "end" there
 * stops the activation before Pi prepares another turn (pi-agent-core 1.5.0, agent-loop.js).
 */
function endAtTimeLimit(session: AgentSession, timeLimit: AbortSignal): void {
  const finish = session.agent.finishTurn;
  session.agent.finishTurn = async (turn, signal) => {
    const decision = await finish?.(turn, signal);
    return timeLimit.aborted ? { action: "end" as const } : (decision ?? undefined);
  };
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
 * aborted when it runs longer than the timeout or past the run's time limit, and is recorded when its answer ends. An
 * aborted answer carries no tool
 * calls Pi would run, and ends the activation.
 */
function runTurns(
  session: AgentSession,
  agent: string,
  { modelTurnTimeoutMs, timeLimit }: SessionSettings,
  parallelism: ParallelismLimit,
  turns: ModelTurn[],
): void {
  const call = session.agent.streamFunction;
  session.agent.streamFunction = async (model, context, options) => {
    const requestedAtMs = performance.now();
    const free = await parallelism.acquire();
    const startedAtMs = performance.now();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), modelTurnTimeoutMs);
    const signal = AbortSignal.any([...(options?.signal === undefined ? [] : [options.signal]), timeout.signal, timeLimit]);
    const answer = await call(model, context, { ...options, signal });
    void answer.result().then((message) => {
      const endedAtMs = performance.now();
      clearTimeout(timer);
      free();
      const outcome = timeLimit.aborted
        ? { outcome: CUT_OFF }
        : timeout.signal.aborted
          ? { outcome: "timeout" as const }
          : outcomeOf(message);
      const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      turns.push({ agent, ...outcome, text, slotWaitMs: startedAtMs - requestedAtMs, startedAtMs, endedAtMs });
    });
    return answer;
  };
}

function outcomeOf(message: AssistantMessage): Pick<ModelTurn, "outcome" | "message"> {
  if (message.stopReason !== "error") return { outcome: "success" };
  if (message.errorMessage === SCRIPT_EXHAUSTED_MESSAGE) return { outcome: "script_exhausted" };
  return { outcome: "model_error", message: message.errorMessage ?? "" };
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
 * the world. Each call it runs leaves its outcome and times under the call's id, and a sensor's call that succeeded
 * leaves what it returned as the agent's last sensing.
 */
function definition<State>(
  world: World<State>,
  tool: Tool<State>,
  agent: string,
  executed: Map<string, Executed>,
  sensings: Sensings,
  timeLimit: AbortSignal,
): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as ToolDefinition["parameters"],
    execute: async (id, args: Record<string, unknown>) => {
      const startedAtMs = performance.now();
      const { outcome, text, targetAsSensed } =
        undeclared(tool, args) ?? (await perform(world, tool, { agent, arguments: args }, sensings.last(agent), timeLimit));
      const endedAtMs = performance.now();
      executed.set(id, { outcome, startedAtMs, endedAtMs, ...(targetAsSensed === undefined ? {} : { targetAsSensed }) });
      if (tool.kind === "sensor" && outcome === "success") sensings.record(agent, { tool: tool.name, result: text, atMs: endedAtMs });
      // A failure is marked as one: an agent told that a failure succeeded would act on a world it misreads.
      return { content: [{ type: "text", text }], details: undefined, isError: outcome !== "success" };
    },
  };
}

/** The outcome of a tool call or a model turn still running when the run's time limit passes (FR-CLOCK-02). */
const CUT_OFF = "cut_off" as const;

/** A call the tool ran: its outcome, when it started and ended, and for an effector, its target as sensed. */
type Executed = Pick<ToolCall, "outcome" | "startedAtMs" | "endedAtMs" | "targetAsSensed">;

/** What a call gives: its outcome, the text the agent receives, and for an effector's call, its target as sensed. */
interface CallResult {
  outcome: string;
  text: string;
  targetAsSensed?: TargetAsSensed;
}

/**
 * Rejects a call with an argument the tool does not declare. Pi lets through whatever the tool's schema allows, and a
 * schema allows any argument unless it says otherwise; the engine checks here, so the schema the agent sees stays the
 * scenario's (FR-TOOL-02).
 */
function undeclared<State>(tool: Tool<State>, args: Record<string, unknown>): CallResult | undefined {
  const declared = Object.keys((tool.parameters as { properties?: object }).properties ?? {});
  const others = Object.keys(args).filter((name) => !declared.includes(name));
  if (others.length === 0) return undefined;
  const names = others.map((name) => `"${name}"`).join(", ");
  return { outcome: "invalid_arguments", text: `invalid_arguments: "${tool.name}" takes no argument ${names}` };
}

/**
 * Runs a call the tool takes. It lasts the duration the tool gives for the call and the state as it starts (FR-TOOL-03,
 * FR-TOOL-04); then a sensor reads the world, or an effector's effect goes to the arbiter. A call the run's time limit
 * cuts short reads and applies nothing: the run has ended, and an effect would change a world already measured
 * (FR-CLOCK-02). For an effector's call, what the agent last sensed of its target is read as the call starts, beside
 * its outcome, and never reaches the arbiter (NFR-11).
 */
async function perform<State>(
  world: World<State>,
  tool: Tool<State>,
  call: AgentCall,
  sensing: Sensing | undefined,
  timeLimit: AbortSignal,
): Promise<CallResult> {
  const targetAsSensed = tool.kind === "effector" ? (sensing === undefined ? "not_sensed" : tool.readTarget(sensing, call)) : undefined;
  await waitAtLeast(tool.durationMs(world.state, call), timeLimit);
  const result = timeLimit.aborted ? { outcome: CUT_OFF, text: CUT_OFF } : tool.kind === "sensor" ? sense(world, tool, call) : effect(world, tool, call);
  return targetAsSensed === undefined ? result : { ...result, targetAsSensed };
}

/** Reads the world for a sensor's call, which then always succeeds. */
function sense<State>(world: World<State>, sensor: Sensor<State>, call: AgentCall): CallResult {
  return { outcome: "success", text: sensor.sense(world.state, call.agent) };
}

/**
 * Applies an effector's call through the arbiter, against the world as it is now; the agent receives its outcome:
 * "success" or the failure's reason.
 */
function effect<State>(world: World<State>, effector: Effector<State>, call: AgentCall): CallResult {
  const result = world.apply(effector.action, call);
  const outcome = result.applied ? "success" : result.reason;
  return { outcome, text: outcome };
}
