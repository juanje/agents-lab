import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AgentSession,
  type CompactionResult,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
  createAgentSession,
  createExtensionRuntime,
} from "@earendil-works/pi-coding-agent";
import {
  type Api,
  type AssistantMessage,
  type JsonObject,
  type Model,
  type Provider,
  type Usage,
  getCurrentSystemMessage,
  validateToolArguments,
} from "@earendil-works/pi-ai";
import { type ChangesSinceSensing, applyCounted } from "./changes.ts";
import { type RunClock, waitAtLeast } from "./clock.ts";
import { isSummaryRequest, piCompactionSettings } from "./compaction.ts";
import type { Compaction, ThinkingLevel } from "./experiment.ts";
import { failure } from "./failure.ts";
import type { Position } from "./grid.ts";
import type { ParallelismLimit } from "./parallelism.ts";
import { SCRIPT_EXHAUSTED_MESSAGE } from "./scripted-model.ts";
import type { Sensings } from "./sensings.ts";
import type { Stimuli, Stimulus } from "./stimuli.ts";
import type { AgentCall, Effector, Sensor, Start, TargetAsSensed, Tool } from "./tools.ts";
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
  /** The reasoning the provider returned with the answer, when it returned any. */
  reasoning?: string;
  /** The model that answered, in Pi's provider/id form. */
  model: string;
  /** How long the turn waited for a free slot under the parallelism limit before its call started. */
  slotWaitMs: number;
  /** How long the model took to answer, from the call's start to its answer's end. */
  latencyMs: number;
  /** When the call to the model started and when its answer ended, by performance.now(). */
  startedAtMs: number;
  endedAtMs: number;
  /** The tokens and the cost Pi reported with the answer. */
  tokens: Omit<Usage, "cost">;
  cost: Usage["cost"];
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
  /** For a sensor call that succeeded, what it returned: the text the agent received. */
  result?: string;
  /** For an effector call the tool ran, the text the agent received (FR-RECORD-01). */
  text?: string;
  /** For an effector call the tool ran, what the agent last sensed of its target before the call (FR-TOOL-04). */
  targetAsSensed?: TargetAsSensed;
  /**
   * For an effector call whose effect was checked, the effects other agents applied between its agent's last sensing
   * and that moment; null, no count, when the agent had not sensed.
   */
  changesSinceSensing?: number | null;
  /** For the same call, the agent that applied each of those effects, in the order applied; null when it had not sensed. */
  changesSinceSensingBy?: string[] | null;
}

/** The start of an effector's call, as it was applied (FR-SPACE-03, FR-RECORD-01). */
export interface EffectorStart {
  agent: string;
  tool: string;
  /** When it was applied: the moment the call started, by performance.now(). */
  atMs: number;
  /** The change it made, as the scenario describes it. */
  change: Readonly<Record<string, unknown>>;
}

/** One compaction of an agent's context, as Pi made it (FR-ADAPTER-03). */
export interface ContextCompaction {
  agent: string;
  /** Why it started: the context filled the share of the window that starts one, or it overflowed the window. */
  reason: "threshold" | "overflow";
  /**
   * "success" when it finished; "model_error" when a summary call's provider answered with an error, "timeout" when one
   * ran longer than the model turn timeout, "cut_off" when the run's end cut one short (FR-CLOCK-02).
   */
  outcome: "success" | "model_error" | "timeout" | "cut_off";
  /** When it started and ended, by performance.now(). */
  startedAtMs: number;
  endedAtMs: number;
  /** For a compaction that finished, the context's size in tokens before it, and after it, as Pi estimates them. */
  contextTokensBefore?: number;
  contextTokensAfter?: number;
  /** For a compaction that finished, the summary the agent's context holds from then on, as Pi composes it around the text the model wrote. */
  summary?: string;
  /** The tokens and the cost of the model calls it made, summed when Pi made more than one, whether or not it finished. */
  tokens: Omit<Usage, "cost">;
  cost: Usage["cost"];
}

/**
 * Where a session's model turns and tool calls go as each ends, an effector's start as it is applied, and a compaction
 * as it ends: the run's log and what the run gives.
 */
export interface Records {
  turn(turn: ModelTurn): void;
  toolCall(call: ToolCall): void;
  start(start: EffectorStart): void;
  compaction(compaction: ContextCompaction): void;
}

/** What an agent's session is given besides its tools. */
export interface SessionSettings {
  /** The scenario's system prompt, which takes the place of Pi's own. */
  systemPrompt: string;
  /** The thinking level the session uses (FR-EXPERIMENT-05). */
  thinkingLevel: ThinkingLevel;
  /** The context compaction the session uses (FR-ADAPTER-03). */
  compaction: Compaction;
  /** How long a model turn may run before it is aborted. */
  modelTurnTimeoutMs: number;
  /**
   * Aborts when the run ends before its agents are done: when its time limit passes, which cuts off the tool calls and
   * model turns still running (FR-CLOCK-02), or when it stops on an error (FR-RECORD-01).
   */
  runEnd: AbortSignal;
  /** Stops the run on an error that is not the agent's behaviour, such as a tool that throws (FR-RECORD-01). */
  stop(error: Error): void;
  /** The run's time, which a sensor is given as it reads the world (FR-WORKPLACE-05). */
  clock: RunClock;
}

/**
 * A Pi session of the lab's own: its system prompt sent exactly as given, its custom tools and no others, and no setting,
 * resource or file of the person's or of any project's (NFR-08, NFR-04). A provider's error ends the turn, since Pi does
 * not retry it: a retry would turn the provider's failure into another turn (FR-ADAPTER-02). Compaction is the one
 * given, never Pi's default, at the same share of whatever window the model has (FR-ADAPTER-03).
 */
async function isolatedSession(
  runtime: ModelRuntime,
  model: AgentModel,
  { systemPrompt, thinkingLevel, compaction }: { systemPrompt: string; thinkingLevel: ThinkingLevel; compaction: Compaction },
  customTools: ToolDefinition[],
): Promise<AgentSession> {
  const { session } = await createAgentSession({
    // Pi falls back to the person's directory (~/.pi/agent/) wherever a path is left out (NFR-08).
    agentDir: labPiDirectory(),
    modelRuntime: runtime,
    model: model.model,
    thinkingLevel,
    // The allowlist leaves out Pi's built-in tools and filters custom tools too, so it names every custom tool.
    tools: customTools.map((tool) => tool.name),
    customTools,
    resourceLoader: resources(systemPrompt),
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({
      retry: { enabled: false },
      compaction: piCompactionSettings(compaction, model.model.contextWindow),
    }),
  });
  forceSystemPrompt(session, systemPrompt);
  return session;
}

/** Opens the Pi session an agent keeps for the whole run (FR-ADAPTER-02). */
export async function openSession<State>(
  world: World<State>,
  tools: readonly Tool<State>[],
  agent: { name: string; model: AgentModel },
  runtime: ModelRuntime,
  settings: SessionSettings,
  parallelism: ParallelismLimit,
  records: Records,
  stimuli: Stimuli,
  sensings: Sensings,
  changes: ChangesSinceSensing,
): Promise<AgentSession> {
  const executed = new Map<string, Executed>();
  const customTools = tools.map((tool) => definition(world, tool, agent.name, executed, sensings, changes, records, settings));
  const session = await isolatedSession(runtime, agent.model, settings, customTools);
  // A turn's calls run one after another until SPEC decides otherwise; Pi's default runs them all at once.
  session.agent.toolExecution = "sequential";
  runTurns(session, agent.name, settings, parallelism, records, new Compactions(session, agent.name, records, settings, parallelism));
  deliverBetweenTurns(session, agent.name, stimuli);
  endAtRunEnd(session, settings.runEnd);
  recordToolCalls(session, agent.name, tools, executed, records, settings);
  return session;
}

/**
 * The compactions of an agent's context: each one Pi starts is recorded as it ends, with its outcome (FR-ADAPTER-03).
 * One that finished gives why and when it started, the context's size before and after it, the summary the context
 * holds from then on (pi-coding-agent 1.5.0, AgentSession._runAutoCompaction) and the tokens and cost of the calls that
 * wrote it. One that did not finish, since a summary call failed, ran past the model turn timeout or was cut off by
 * the run's end, gives no summary, but the tokens and cost spent; Pi leaves the context as it was.
 */
class Compactions {
  readonly session: AgentSession;
  readonly agent: string;
  readonly records: Records;
  readonly settings: SessionSettings;
  readonly parallelism: ParallelismLimit;
  #startedAtMs = 0;
  #spent: Usage | undefined;
  #unfinished: Exclude<ContextCompaction["outcome"], "success"> | undefined;

  constructor(session: AgentSession, agent: string, records: Records, settings: SessionSettings, parallelism: ParallelismLimit) {
    this.session = session;
    this.agent = agent;
    this.records = records;
    this.settings = settings;
    this.parallelism = parallelism;
    // No compaction starts once the run has ended, as no model turn does (FR-CLOCK-02); Pi would start one as the
    // activation ends.
    settings.runEnd.addEventListener("abort", () => session.setAutoCompactionEnabled(false), { once: true });
    session.subscribe((event) => {
      if (event.type === "compaction_start") {
        this.#startedAtMs = performance.now();
        this.#spent = undefined;
        this.#unfinished = undefined;
      }
      if (event.type === "compaction_end" && event.reason !== "manual") this.#ended(event.reason, event.result, event.errorMessage);
    });
  }

  /**
   * Makes a call Pi makes to write a summary: a model call, which takes a slot, is limited by the model turn timeout and
   * stops at the run's end, but no turn of the agent's. A call stopped by either aborts the whole compaction: Pi would
   * otherwise keep the empty answer as the summary.
   */
  async summarize(call: AgentSession["agent"]["streamFunction"], ...[model, context, options]: Parameters<AgentSession["agent"]["streamFunction"]>) {
    const { modelTurnTimeoutMs, runEnd } = this.settings;
    const stopAs = (outcome: "timeout" | "cut_off") => () => {
      this.#unfinished ??= outcome;
      this.session.abortCompaction();
    };
    const cutOff = stopAs("cut_off");
    if (runEnd.aborted) cutOff();
    runEnd.addEventListener("abort", cutOff, { once: true });
    const { answer, ended } = await limitedCall(call, [model, context, options], this.parallelism, modelTurnTimeoutMs, runEnd, stopAs("timeout"));
    void ended.then((message) => {
      runEnd.removeEventListener("abort", cutOff);
      this.#spent = this.#spent === undefined ? message.usage : summed(this.#spent, message.usage);
      if (message.stopReason === "error") this.#unfinished ??= "model_error";
    });
    return answer;
  }

  #ended(reason: ContextCompaction["reason"], result: CompactionResult | undefined, errorMessage: string | undefined): void {
    const { cost, ...tokens } = this.#spent ?? NO_USAGE;
    const ended = { agent: this.agent, reason, startedAtMs: this.#startedAtMs, endedAtMs: performance.now(), tokens, cost };
    if (result !== undefined && this.#unfinished === undefined) {
      if (result.estimatedTokensAfter === undefined) {
        this.settings.stop(new Error(`agent "${this.agent}"'s compaction could not be recorded: Pi gave no context size after it`));
        return;
      }
      this.records.compaction({
        ...ended,
        outcome: "success",
        contextTokensBefore: result.tokensBefore,
        contextTokensAfter: result.estimatedTokensAfter,
        summary: result.summary,
      });
      return;
    }
    if (this.#unfinished === undefined) {
      // Pi ended it unfinished for a reason no outcome fits, such as an answer that called a tool.
      this.settings.stop(new Error(`agent "${this.agent}"'s compaction did not finish, for no reason the engine recognises: ${errorMessage ?? "Pi gave none"}`));
      return;
    }
    this.records.compaction({ ...ended, outcome: this.#unfinished });
  }
}

/** No tokens and no cost: what a compaction that made no call spent. */
const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** The tokens and cost of two calls together: each count of either, summed. */
function summed(one: Usage, other: Usage): Usage {
  return { ...countsAdded(one, other), cost: countsAdded(one.cost, other.cost) } as unknown as Usage;
}

/** Each number either record gives, summed by its key; anything else, such as a flag, is left out. */
function countsAdded(one: object, other: object): Record<string, number> {
  const count = (record: object, key: string) => {
    const value = (record as Record<string, unknown>)[key];
    return typeof value === "number" ? value : undefined;
  };
  const keys = [...new Set([...Object.keys(one), ...Object.keys(other)])].filter((key) => count(one, key) !== undefined || count(other, key) !== undefined);
  return Object.fromEntries(keys.map((key) => [key, (count(one, key) ?? 0) + (count(other, key) ?? 0)]));
}

/**
 * Records each of the agent's tool calls with the arguments its model made, which Pi passes on before it coerces them,
 * its outcome, and when it started and ended. A call that ran gives its own outcome and times, invalid_arguments
 * included when the engine rejected an argument the tool does not declare. One Pi answered without running its tool is
 * recognised by why (unrunOutcome) and timed by Pi's events around it; one it cannot recognise stops the run, since a
 * guessed outcome would misread the agent.
 */
function recordToolCalls<State>(
  session: AgentSession,
  agent: string,
  tools: readonly Tool<State>[],
  executed: ReadonlyMap<string, Executed>,
  records: Records,
  { runEnd, stop }: SessionSettings,
): void {
  const made = new Map<string, { args: unknown; startedAtMs: number }>();
  session.subscribe((event) => {
    if (event.type === "tool_execution_start") made.set(event.toolCallId, { args: event.args, startedAtMs: performance.now() });
    if (event.type === "tool_execution_end") {
      const call = { tool: event.toolName, arguments: made.get(event.toolCallId)?.args };
      let ran = executed.get(event.toolCallId);
      if (ran === undefined) {
        const answer = textOf((event.result as { content?: readonly Block[] }).content ?? []);
        const offered = tools.find((tool) => tool.name === event.toolName);
        try {
          const outcome = unrunOutcome(offered, call, answer, runEnd.aborted);
          ran = { outcome, startedAtMs: made.get(event.toolCallId)?.startedAtMs ?? performance.now(), endedAtMs: performance.now() };
        } catch (error) {
          stop(failure(`agent "${agent}"'s "${event.toolName}" call could not be recorded`, error));
          return;
        }
      }
      records.toolCall({ agent, ...call, ...ran });
    }
  });
}

/** A block of a message's or a tool result's content, as far as its text goes. */
type Block = { type: string; text?: string; thinking?: string };

/** The text a message's or a tool result's content holds, its text blocks joined. */
function textOf(content: readonly Block[]): string {
  return content.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("");
}

/** The reasoning an answer's content holds, its thinking blocks' text joined, or undefined when it holds none. */
function reasoningOf(content: readonly Block[]): string | undefined {
  const thinking = content.flatMap((block) => (block.type === "thinking" ? [block.thinking ?? ""] : []));
  return thinking.length === 0 ? undefined : thinking.join("");
}

/**
 * Ends the agent's activation after a model turn that finished once the run had ended, so no model turn
 * starts after the end (FR-CLOCK-02). Pi asks `finishTurn` after every turn, its tool calls done, and an "end" there
 * stops the activation before Pi prepares another turn (pi-agent-core 1.5.0, agent-loop.js).
 */
function endAtRunEnd(session: AgentSession, runEnd: AbortSignal): void {
  const finish = session.agent.finishTurn;
  session.agent.finishTurn = async (turn, signal) => {
    const decision = await finish?.(turn, signal);
    return runEnd.aborted ? { action: "end" as const } : (decision ?? undefined);
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
  { modelTurnTimeoutMs, runEnd }: SessionSettings,
  parallelism: ParallelismLimit,
  records: Records,
  compactions: Compactions,
): void {
  const call = session.agent.streamFunction;
  session.agent.streamFunction = async (model, context, options) => {
    // Pi writes a compaction's summary through the same call (AgentSession._runDefaultCompaction): it is a model call,
    // which takes a slot and stops at the run's end, but no turn of the agent's (FR-ADAPTER-03).
    if (isSummaryRequest(context.messages)) return compactions.summarize(call, model, context, options);
    const requestedAtMs = performance.now();
    const { answer, ended, startedAtMs, timeout } = await limitedCall(call, [model, context, options], parallelism, modelTurnTimeoutMs, runEnd);
    void ended.then((message) => {
      const endedAtMs = performance.now();
      const outcome = runEnd.aborted
        ? { outcome: CUT_OFF }
        : timeout.aborted
          ? { outcome: "timeout" as const }
          : outcomeOf(message);
      const text = textOf(message.content);
      const reasoning = reasoningOf(message.content);
      const { cost, ...tokens } = message.usage;
      records.turn({
        agent,
        ...outcome,
        text,
        ...(reasoning === undefined ? {} : { reasoning }),
        model: `${message.provider}/${message.responseModel ?? message.model}`,
        slotWaitMs: startedAtMs - requestedAtMs,
        latencyMs: endedAtMs - startedAtMs,
        startedAtMs,
        endedAtMs,
        tokens,
        cost,
      });
    });
    return answer;
  };
}

/**
 * A call to the model under the run's limits (FR-ADAPTER-02, FR-CLOCK-02): it waits for a free slot under the
 * parallelism limit, and is aborted when it runs longer than the timeout, after `onTimeout` is told, or when the run
 * ends; its slot is freed as its answer ends, which `ended` gives.
 */
async function limitedCall(
  call: AgentSession["agent"]["streamFunction"],
  [model, context, options]: Parameters<AgentSession["agent"]["streamFunction"]>,
  parallelism: ParallelismLimit,
  timeoutMs: number,
  runEnd: AbortSignal,
  onTimeout: () => void = () => {},
) {
  const free = await parallelism.acquire();
  const startedAtMs = performance.now();
  const timeout = new AbortController();
  const timer = setTimeout(() => {
    onTimeout();
    timeout.abort();
  }, timeoutMs);
  const answer = await call(model, context, { ...options, signal: abortedBy(options?.signal, timeout.signal, runEnd) });
  const ended = answer.result().then((message) => {
    clearTimeout(timer);
    free();
    return message;
  });
  return { answer, ended, startedAtMs, timeout: timeout.signal };
}

/** A signal that aborts as soon as any of the call's own signal, if it has one, and the others aborts. */
function abortedBy(own: AbortSignal | undefined, ...others: AbortSignal[]): AbortSignal {
  return AbortSignal.any([...(own === undefined ? [] : [own]), ...others]);
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
  changes: ChangesSinceSensing,
  records: Records,
  { runEnd, stop, clock }: SessionSettings,
): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as ToolDefinition["parameters"],
    execute: async (id, args: Record<string, unknown>) => {
      const startedAtMs = performance.now();
      let called: CallResult;
      // An effector's start is recorded as it is applied, at the moment the call started (FR-SPACE-03).
      const started = (change: EffectorStart["change"]) => records.start({ agent, tool: tool.name, atMs: startedAtMs, change });
      try {
        // A call that comes after the run has ended is left unrun: it reads no target and applies nothing (FR-CLOCK-02).
        called = runEnd.aborted
          ? { outcome: CUT_OFF, text: CUT_OFF }
          : (undeclared(tool, args) ?? (await perform(world, tool, { agent, arguments: args }, sensings, changes, runEnd, started, clock)));
      } catch (error) {
        // A tool that throws is a defect of the scenario, not the agent's behaviour: no outcome fits it, and the run
        // stops on it rather than going on with a world it cannot trust.
        stop(failure(`agent "${agent}"'s "${tool.name}" call failed`, error));
        throw error;
      }
      const { outcome, text, takenFrom, ...perceived } = called;
      const endedAtMs = performance.now();
      const sensed = tool.kind === "sensor" && outcome === "success";
      // An effector call the tool ran is one that read its target; its record keeps the text its agent received.
      const effected = tool.kind === "effector" && perceived.targetAsSensed !== undefined;
      executed.set(id, {
        outcome,
        startedAtMs,
        endedAtMs,
        ...(sensed ? { result: text } : {}),
        ...(effected ? { text } : {}),
        ...perceived,
      });
      if (sensed) {
        sensings.record(agent, { tool: tool.name, result: text, ...(takenFrom === undefined ? {} : { takenFrom }), atMs: endedAtMs });
        changes.sensed(agent);
      }
      // A failure is marked as one: an agent told that a failure succeeded would act on a world it misreads.
      return { content: [{ type: "text", text }], details: undefined, isError: outcome !== "success" };
    },
  };
}

/**
 * The outcome of a call Pi answered without running its tool, recognised from why it did: the session does not offer
 * the tool; Pi's validation rejected the arguments, which re-validating them gives back as Pi's very answer; or the run
 * had ended, so Pi left it unrun (FR-CLOCK-02). Any other reason is not recognised, and is an error that says so.
 */
export function unrunOutcome<State>(
  offered: Tool<State> | undefined,
  call: { tool: string; arguments: unknown },
  answer: string,
  runEnded: boolean,
): string {
  if (offered === undefined) return "unknown_tool";
  if (rejection(offered, call) === answer) return "invalid_arguments";
  if (runEnded) return CUT_OFF;
  throw new Error(`Pi answered a call of "${call.tool}" without running it, for no reason the engine recognises: ${answer}`);
}

/** Pi's own rejection of a call's arguments by the tool's schema, or undefined when they pass. */
function rejection<State>(tool: Tool<State>, call: { tool: string; arguments: unknown }): string | undefined {
  try {
    validateToolArguments(
      { name: tool.name, description: tool.description, parameters: tool.parameters as never },
      { type: "toolCall", id: "", name: call.tool, arguments: call.arguments as JsonObject },
    );
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The outcome of a tool call or a model turn still running when the run's time limit passes (FR-CLOCK-02). */
export const CUT_OFF = "cut_off" as const;

/** A call the tool ran: its outcome, when it started and ended, a sensor's result and an effector's target as sensed. */
type Executed = Pick<ToolCall, "outcome" | "startedAtMs" | "endedAtMs" | "result" | "text" | "targetAsSensed" | "changesSinceSensing" | "changesSinceSensingBy">;

/**
 * What a call gives: its outcome, the text the agent receives, and for an effector's call, its target as sensed and the
 * changes since its agent last sensed, with who applied them.
 */
interface CallResult {
  outcome: string;
  text: string;
  /** For a sensor's call that declares it, where the agent sensed from; kept with the sensing, not in the call's record. */
  takenFrom?: Position;
  targetAsSensed?: TargetAsSensed;
  changesSinceSensing?: number | null;
  changesSinceSensingBy?: string[] | null;
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
 * FR-TOOL-04); an effector under way applies its start once that duration is taken (FR-SPACE-03); then a sensor reads
 * the world, or an effector's effect goes to the arbiter. A call the run's time limit cuts short reads nothing and
 * applies no effect: the run has ended, and an effect would change a world already measured (FR-CLOCK-02). For an effector's call, what the agent last sensed of its target is read as the call starts, beside
 * its outcome, and never reaches the arbiter (NFR-11).
 */
async function perform<State>(
  world: World<State>,
  tool: Tool<State>,
  call: AgentCall,
  sensings: Sensings,
  changes: ChangesSinceSensing,
  runEnd: AbortSignal,
  started: (change: EffectorStart["change"]) => void,
  clock: RunClock,
): Promise<CallResult> {
  const sensing = sensings.last(call.agent);
  const lastBy = (sensor: string) => sensings.lastBy(call.agent, sensor);
  const targetAsSensed = tool.kind === "effector" ? (sensing === undefined ? "not_sensed" : tool.readTarget(sensing, call, world.state, lastBy)) : undefined;
  const durationMs = tool.durationMs(world.state, call);
  if (tool.kind === "effector" && tool.start !== undefined && (tool.start.appliesTo?.(world.state, call) ?? true)) {
    started(start(world, tool.start, call, changes));
  }
  await waitAtLeast(durationMs, runEnd);
  const result = runEnd.aborted
    ? { outcome: CUT_OFF, text: CUT_OFF }
    : tool.kind === "sensor"
      ? sense(world, tool, call, clock.sinceStartMs())
      : effect(world, tool, call, changes);
  return targetAsSensed === undefined ? result : { ...result, targetAsSensed };
}

/**
 * Applies the start of an effector's call under way through the arbiter, as the call starts (FR-SPACE-03), and counts it
 * among the changes other agents see since they sensed; it gives the change as the scenario describes it, from the
 * state before it. A start the world refuses throws: it is the scenario's defect.
 */
function start<State>(world: World<State>, action: Start<State>, call: AgentCall, changes: ChangesSinceSensing): EffectorStart["change"] {
  const change = action.describe(world.state, call);
  const result = world.apply(action, call);
  if (!result.applied) throw new Error(`its start was refused with "${result.reason}"`);
  changes.applied(call.agent);
  return change;
}

/** Reads the world for a sensor's call, at a time since the run started, which then always succeeds. */
function sense<State>(world: World<State>, sensor: Sensor<State>, call: AgentCall, sinceStartMs: number): CallResult {
  const { state } = world;
  const text = sensor.sense(state, call.agent, call.arguments, sinceStartMs);
  return sensor.takenFrom === undefined ? { outcome: "success", text } : { outcome: "success", text, takenFrom: sensor.takenFrom(state, call.agent) };
}

/**
 * Applies an effector's call through the arbiter, against the world as it is now; its outcome is "success" or the
 * failure's reason, and the agent receives the text the effector declares for it, or the outcome itself. The changes
 * since the agent last sensed, and who applied them, are read at this moment, beside it.
 */
function effect<State>(world: World<State>, effector: Effector<State>, call: AgentCall, changes: ChangesSinceSensing): CallResult {
  const changesSinceSensing = changes.since(call.agent);
  const changesSinceSensingBy = changes.appliedBy(call.agent);
  const outcome = applyCounted(world, changes, call.agent, effector.action, { ...call, atMs: performance.now() });
  return { outcome, text: effector.texts?.[outcome] ?? outcome, changesSinceSensing, changesSinceSensingBy };
}

/** A tool a model is offered for one question: what it is called, what it is for, and what it takes. */
export interface OfferedTool {
  name: string;
  description: string;
  parameters: object;
}

/**
 * What a model answered one question with: how the call ended, the provider's message for a model error, the tool calls
 * it made, as it made them, and the call's tokens and cost.
 */
export interface OneAnswer {
  outcome: "success" | "model_error" | "timeout";
  message?: string;
  calls: { name: string; arguments: unknown }[];
  tokens: Omit<Usage, "cost">;
  cost: Usage["cost"];
}

/**
 * Asks a model one question, through Pi, in a session of its own: the system prompt as it is, the question as its one
 * message, and one tool, whose calls do nothing but end the turn. The session ends after that one model turn, so its
 * tool's result never reaches the model. It gives the calls the model made, as it made them, and the turn's tokens and
 * cost. A call that runs past the timeout is aborted, with the outcome `timeout`; one the provider answers with an
 * error has the outcome `model_error` and its message; either gives no calls. Like a run's sessions, it reads nothing of the
 * person's Pi directory (NFR-08), and Pi neither retries the call nor compacts the session.
 */
export async function askOnce(
  model: AgentModel,
  { systemPrompt, thinkingLevel, timeoutMs }: { systemPrompt: string; thinkingLevel: ThinkingLevel; timeoutMs: number },
  tool: OfferedTool,
  question: string,
): Promise<OneAnswer> {
  const runtime = await openRuntime([model.provider]);
  const answering: ToolDefinition = {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as ToolDefinition["parameters"],
    execute: async () => ({ content: [{ type: "text", text: "Received." }], details: undefined }),
  };
  const session = await isolatedSession(runtime, model, { systemPrompt, thinkingLevel, compaction: { enabled: false } }, [answering]);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  try {
    // One model turn: Pi would otherwise answer the tool's call with its result and ask the model again.
    session.agent.finishTurn = async () => ({ action: "end" as const });
    // The call is aborted once it runs past the timeout; an aborted answer carries no tool call Pi would run.
    const call = session.agent.streamFunction;
    session.agent.streamFunction = (streamed, context, options) => call(streamed, context, { ...options, signal: abortedBy(options?.signal, timeout.signal) });
    let answer: AssistantMessage | undefined;
    session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") answer = event.message;
    });
    await session.sendCustomMessage({ customType: "question", content: question, display: true }, { triggerTurn: true });
    if (answer === undefined) throw new Error("the model gave no answer to the question");
    const { cost, ...tokens } = answer.usage;
    if (timeout.signal.aborted) return { outcome: "timeout", calls: [], tokens, cost };
    if (answer.stopReason === "error") return { outcome: "model_error", message: answer.errorMessage ?? "", calls: [], tokens, cost };
    const calls = answer.content.flatMap((block) => (block.type === "toolCall" ? [{ name: block.name, arguments: block.arguments }] : []));
    return { outcome: "success", calls, tokens, cost };
  } finally {
    clearTimeout(timer);
    session.dispose();
  }
}
