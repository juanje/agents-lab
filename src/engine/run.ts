import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { type AgentModel, type ModelTurn, type Records, type ToolCall, openRuntime, openSession, wake } from "./adapter.ts";
import { ChangesSinceSensing } from "./changes.ts";
import { waitAtLeast } from "./clock.ts";
import { failure } from "./failure.ts";
import { ParallelismLimit } from "./parallelism.ts";
import { Random } from "./random.ts";
import { Recorder, type RunSetup } from "./recorder.ts";
import type { LoadedScenario, Rhythm, Scenario } from "./scenario.ts";
import { Sensings } from "./sensings.ts";
import { Stimuli } from "./stimuli.ts";
import type { World } from "./world.ts";

/** An agent in a run: its name, the model it works with, and how many activations it has; its rhythm is the scenario's. */
export interface Agent {
  name: string;
  model: AgentModel;
  activations: number;
}

/** What a run takes besides the scenario: the limits on its model calls. */
export interface RunSettings {
  /** The directory the run writes its log into, as a new file named with its run id (FR-RECORD-01). */
  logDirectory: string;
  /** The run's id, when its caller must know it before the run starts or stops; a new one otherwise. */
  runId?: string;
  /** For a run of an experiment, what it runs, which its log gives first (FR-RECORD-02). */
  setup?: RunSetup;
  /** How long a model turn may run before it is aborted. */
  modelTurnTimeoutMs: number;
  /** The maximum number of model calls running at once, across all agents. */
  parallelismLimit: number;
  /** How long the run may last, from its start; a tool call still running when it passes is cut off (FR-CLOCK-02). */
  timeLimitMs: number;
  /** How long the run waits between metric samples; without it, the metrics are sampled only at the start and the end (FR-METRIC-02). */
  metricIntervalMs?: number;
  /**
   * Called with the run's stimuli before any agent wakes, so a caller can deliver stimuli while the run goes on. A seam
   * until the world's processes deliver them (FR-PROCESS-01).
   */
  onStart?: (stimuli: Stimuli) => void;
}

/**
 * What a run gives: every agent's model turns and tool calls, each in the order they ended, and what each agent's
 * session held at its end, and what each agent last sensed.
 */
export interface RunResult {
  /** The run's id, which names its log. */
  runId: string;
  turns: ModelTurn[];
  toolCalls: ToolCall[];
  messages: ReadonlyMap<string, AgentSession["messages"]>;
  /** What each agent sensed. */
  sensings: Sensings;
  /** When the agents could start, once every session was open, by performance.now(); the time limit counts from it. */
  startedAtMs: number;
}

/**
 * Runs every agent's activations in the loaded scenario's world, with the scenario's tools, stimulus channels and
 * system prompt: a run takes them only from the scenario it loaded, so it cannot mix one scenario's parts with
 * another's (FR-SCENARIO-01). Each agent runs its own loop and no agent waits for another: there are
 * no turns (NFR-01), only the arbiter ordering effects.
 */
export async function run<State>(
  loaded: LoadedScenario<State>,
  agents: readonly Agent[],
  seed: number,
  settings: RunSettings,
): Promise<RunResult> {
  // Refused before its log opens, as a scenario that fails to load is: nothing has run.
  assertScenarioAgents(loaded, agents);
  const recorder = Recorder.open(settings.logDirectory, settings.runId);
  if (settings.setup !== undefined) recorder.record({ type: "run_setup", runId: recorder.runId, ...settings.setup });
  // Aborts when the run ends before its agents are done: its time limit passes (FR-CLOCK-02) or it stops on an error.
  const runEnd = new AbortController();
  let stoppedOn: Error | undefined;
  // The first error stops the run at once: its log ends there, and every agent stops as at the time limit.
  const stop = (error: Error) => {
    if (stoppedOn !== undefined) return;
    stoppedOn = error;
    recorder.stop(error);
    runEnd.abort();
  };
  try {
    const stimuli = new Stimuli(loaded.channels, (agent, stimulus) =>
      recorder.record({ type: "stimulus", agent, ...stimulus, deliveredAtMs: performance.now() }),
    );
    settings.onStart?.(stimuli);
    const result = await runAgents(loaded, agents, seed, settings, stimuli, recorder, runEnd, stop);
    if (stoppedOn !== undefined) throw stoppedOn;
    return { runId: recorder.runId, ...result };
  } catch (error) {
    // Whatever stops the run, its log says so; the run fails with the error that stopped it first.
    stop(error instanceof Error ? error : new Error(String(error)));
    throw stoppedOn;
  } finally {
    recorder.close();
  }
}

/**
 * Refuses a run whose agents are not exactly the loaded scenario's, naming the agents missing and those not declared:
 * an agent the scenario does not declare has no system prompt from it, and a missing one would leave the world with an
 * entity no agent moves.
 */
function assertScenarioAgents<State>({ scenario, systemPrompts }: LoadedScenario<State>, agents: readonly Agent[]): void {
  const names = new Set(agents.map((agent) => agent.name));
  const missing = [...systemPrompts.keys()].filter((name) => !names.has(name));
  const undeclared = [...names].filter((name) => !systemPrompts.has(name));
  if (missing.length === 0 && undeclared.length === 0) return;
  const quoted = (list: readonly string[]) => list.map((name) => `"${name}"`).join(", ");
  const differences = [
    ...(missing.length > 0 ? [`${quoted(missing)} ${missing.length === 1 ? "is" : "are"} missing`] : []),
    ...(undeclared.length > 0 ? [`${quoted(undeclared)} ${undeclared.length === 1 ? "is" : "are"} not declared`] : []),
  ];
  throw new Error(`The run's agents are not those of scenario "${scenario.name}": ${differences.join("; ")}`);
}

/** Runs the agents of a run whose log is open. */
async function runAgents<State>(
  { world, scenario, systemPrompts, rhythms }: LoadedScenario<State>,
  agents: readonly Agent[],
  seed: number,
  settings: RunSettings,
  stimuli: Stimuli,
  recorder: Recorder,
  runEnd: AbortController,
  stop: (error: Error) => void,
): Promise<Omit<RunResult, "runId">> {
  const sessionSettings = {
    modelTurnTimeoutMs: settings.modelTurnTimeoutMs,
    runEnd: runEnd.signal,
    stop,
  };
  const runtime = await openRuntime(agents.map((agent) => agent.model.provider));
  const parallelism = new ParallelismLimit(settings.parallelismLimit);
  const turns: ModelTurn[] = [];
  const toolCalls: ToolCall[] = [];
  const records: Records = {
    turn: (turn) => {
      recorder.record({ type: "model_turn", ...turn });
      turns.push(turn);
    },
    toolCall: (call) => {
      recorder.record({ type: "tool_call", ...call });
      toolCalls.push(call);
    },
  };
  const sensings = new Sensings();
  const changes = new ChangesSinceSensing();
  const messages = new Map<string, AgentSession["messages"]>();
  // Every session is open before any agent starts, so opening them uses none of the time limit (FR-CLOCK-02). One that
  // fails to open stops the run, once the others have opened, and those are closed.
  const opening = await Promise.allSettled(
    agents.map((agent) =>
      openSession(world, scenario.tools, agent, runtime, { ...sessionSettings, systemPrompt: systemPromptOf(systemPrompts, agent.name) }, parallelism, records, stimuli, sensings, changes).catch((error: unknown) => {
        throw failure(`the session of agent "${agent.name}" failed to open`, error);
      }),
    ),
  );
  const failed = opening.find((opened) => opened.status === "rejected");
  if (failed !== undefined) {
    for (const opened of opening) if (opened.status === "fulfilled") opened.value.dispose();
    throw failed.reason;
  }
  const sessions = opening.map((opened) => (opened as PromiseFulfilledResult<AgentSession>).value);
  const startedAtMs = performance.now();
  const sample = () => sampleMetrics(world, scenario.metrics, recorder, performance.now());
  sampleMetrics(world, scenario.metrics, recorder, startedAtMs);
  const timer = setTimeout(() => runEnd.abort(), settings.timeLimitMs);
  const samplingEnd = new AbortController();
  const sampling = settings.metricIntervalMs === undefined ? Promise.resolve() : sampleEvery(settings.metricIntervalMs, sample, samplingEnd.signal);
  try {
    await Promise.all(
      agents.map(async (agent, index) => {
        const session = sessions[index];
        try {
          // Each agent's rhythm has its own sequence, from the seed and the agent's name: sharing one would make an
          // agent's intervals depend on when the others' models answer, and deriving by order on which other agents run.
          const rhythm = { draw: rhythmOf(rhythms, agent.name), random: Random.derive(seed, `rhythm of ${agent.name}`) };
          await loop(session, agent, stimuli, rhythm, runEnd.signal, recorder);
        } finally {
          // Copied: disposing the session may clear what it holds.
          messages.set(agent.name, [...session.messages]);
          session.dispose();
        }
      }),
    );
  } finally {
    // A run that ends at its budget must not leave its time limit pending, nor a sample to write once its log is closed.
    clearTimeout(timer);
    samplingEnd.abort();
    await sampling;
  }
  sample();
  return { turns, toolCalls, messages, sensings, startedAtMs };
}

/**
 * Writes one metric sample to the log: each of the scenario's metrics computed from the world's state, never by a
 * model, with the version it was computed from and when (FR-METRIC-02).
 */
function sampleMetrics<State>(world: World<State>, metrics: Scenario<State>["metrics"], recorder: Recorder, atMs: number): void {
  const values = Object.fromEntries(Object.entries(metrics).map(([name, metric]) => [name, metric(world.state)]));
  recorder.record({ type: "metric_sample", atMs, version: world.version, metrics: values });
}

/**
 * Takes a sample each time at least the interval has passed since the last one, by performance.now(), until the signal
 * aborts.
 */
async function sampleEvery(intervalMs: number, sample: () => void, signal: AbortSignal): Promise<void> {
  for (;;) {
    await waitAtLeast(intervalMs, signal);
    if (signal.aborted) return;
    sample();
  }
}

/** The rhythm the loaded scenario gives an agent. */
function rhythmOf(rhythms: ReadonlyMap<string, Rhythm>, agent: string): Rhythm {
  const rhythm = rhythms.get(agent);
  if (rhythm === undefined) throw new Error(`the scenario gives no rhythm to agent "${agent}"`);
  return rhythm;
}

/** The system prompt the loaded scenario gives an agent. */
function systemPromptOf(systemPrompts: ReadonlyMap<string, string>, agent: string): string {
  const systemPrompt = systemPrompts.get(agent);
  if (systemPrompt === undefined) throw new Error(`the scenario gives no system prompt to agent "${agent}"`);
  return systemPrompt;
}

/**
 * One agent's loop: it repeats its cycle of waiting an interval from its rhythm, then an activation, which its rhythm's
 * stimulus starts and in which the agent's session runs model turns and tool calls until a turn makes no tool call. It
 * ends when the agent has used its activation budget or the run ends first, even while it rests: its time limit passes
 * (FR-CLOCK-02) or it stops on an error (FR-RECORD-01).
 */
async function loop(
  session: AgentSession,
  agent: Agent,
  stimuli: Stimuli,
  rhythm: { draw: Rhythm; random: Random },
  runEnd: AbortSignal,
  recorder: Recorder,
): Promise<void> {
  for (let count = 0; count < agent.activations; count += 1) {
    await waitAtLeast(rhythm.draw(rhythm.random), runEnd);
    if (runEnd.aborted) return;
    const wokeAtMs = performance.now();
    await wake(session, stimuli.wake(agent.name));
    recorder.record({ type: "activation", agent: agent.name, wokeAtMs, endedAtMs: performance.now() });
  }
}
