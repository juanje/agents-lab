import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { type AgentModel, type ModelTurn, type Records, type ToolCall, openRuntime, openSession, wake } from "./adapter.ts";
import { ChangesSinceSensing } from "./changes.ts";
import { waitAtLeast } from "./clock.ts";
import { ParallelismLimit } from "./parallelism.ts";
import { Random } from "./random.ts";
import { Recorder } from "./recorder.ts";
import type { LoadedScenario } from "./scenario.ts";
import { Sensings } from "./sensings.ts";
import { Stimuli } from "./stimuli.ts";

/** An agent in a run: its name, the model it works with, how many activations it has, and its rhythm. */
export interface Agent {
  name: string;
  model: AgentModel;
  activations: number;
  /** Draws the agent's next waiting interval before it wakes, in milliseconds, from the agent's random source. */
  rhythm: (random: Random) => number;
}

/** What a run takes besides the scenario: the limits on its model calls. */
export interface RunSettings {
  /** The directory the run writes its log into, as a new file named with its run id (FR-RECORD-01). */
  logDirectory: string;
  /** How long a model turn may run before it is aborted. */
  modelTurnTimeoutMs: number;
  /** The maximum number of model calls running at once, across all agents. */
  parallelismLimit: number;
  /** How long the run may last, from its start; a tool call still running when it passes is cut off (FR-CLOCK-02). */
  timeLimitMs: number;
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
  const recorder = Recorder.open(settings.logDirectory);
  // Aborts when the run ends before its agents are done: its time limit passes (FR-CLOCK-02) or it stops on an error.
  const end = new AbortController();
  let stoppedOn: Error | undefined;
  // The first error stops the run at once: its log ends there, and every agent stops as at the time limit.
  const stop = (error: Error) => {
    if (stoppedOn !== undefined) return;
    stoppedOn = error;
    recorder.stop(error);
    end.abort();
  };
  try {
    const stimuli = new Stimuli(loaded.scenario.channels, (agent, stimulus) =>
      recorder.record({ type: "stimulus", agent, ...stimulus, deliveredAtMs: performance.now() }),
    );
    settings.onStart?.(stimuli);
    const result = await runAgents(loaded, agents, seed, settings, stimuli, recorder, end, stop);
    if (stoppedOn !== undefined) throw stoppedOn;
    return { runId: recorder.runId, ...result };
  } finally {
    recorder.close();
  }
}

/** Runs the agents of a run whose log is open. */
async function runAgents<State>(
  { world, scenario }: LoadedScenario<State>,
  agents: readonly Agent[],
  seed: number,
  settings: RunSettings,
  stimuli: Stimuli,
  recorder: Recorder,
  timeLimit: AbortController,
  stop: (error: Error) => void,
): Promise<Omit<RunResult, "runId">> {
  const sessionSettings = {
    systemPrompt: scenario.systemPrompt,
    modelTurnTimeoutMs: settings.modelTurnTimeoutMs,
    timeLimit: timeLimit.signal,
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
  // Every session is open before any agent starts, so opening them uses none of the time limit (FR-CLOCK-02).
  const sessions = await Promise.all(
    agents.map((agent) => openSession(world, scenario.tools, agent, runtime, sessionSettings, parallelism, records, stimuli, sensings, changes)),
  );
  const startedAtMs = performance.now();
  const timer = setTimeout(() => timeLimit.abort(), settings.timeLimitMs);
  try {
    await Promise.all(
      agents.map(async (agent, index) => {
        const session = sessions[index];
        try {
          // Each agent's rhythm has its own sequence, from the seed and the agent's name: sharing one would make an
          // agent's intervals depend on when the others' models answer, and deriving by order on which other agents run.
          await loop(session, agent, stimuli, Random.derive(seed, `rhythm of ${agent.name}`), timeLimit.signal, recorder);
        } finally {
          // Copied: disposing the session may clear what it holds.
          messages.set(agent.name, [...session.messages]);
          session.dispose();
        }
      }),
    );
  } finally {
    // A run that ends at its budget must not leave its time limit pending.
    clearTimeout(timer);
  }
  return { turns, toolCalls, messages, sensings, startedAtMs };
}

/**
 * One agent's loop: it repeats its cycle of waiting an interval from its rhythm, then an activation, which its rhythm's
 * stimulus starts and in which the agent's session runs model turns and tool calls until a turn makes no tool call. It
 * ends when the agent has used its activation budget or the run's time limit passes, even while it rests (FR-CLOCK-02).
 */
async function loop(
  session: AgentSession,
  agent: Agent,
  stimuli: Stimuli,
  random: Random,
  timeLimit: AbortSignal,
  recorder: Recorder,
): Promise<void> {
  for (let count = 0; count < agent.activations; count += 1) {
    await waitAtLeast(agent.rhythm(random), timeLimit);
    if (timeLimit.aborted) return;
    const wokeAtMs = performance.now();
    await wake(session, stimuli.wake(agent.name));
    recorder.record({ type: "activation", agent: agent.name, wokeAtMs, endedAtMs: performance.now() });
  }
}
