import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { type AgentModel, type ModelTurn, type Records, type ToolCall, openRuntime, openSession, wake } from "./adapter.ts";
import { ChangesSinceSensing } from "./changes.ts";
import { runComponent } from "./components.ts";
import { RunClock, waitAtLeast } from "./clock.ts";
import type { Compaction, RateLimitRetry, ThinkingLevel } from "./experiment.ts";
import { failure } from "./failure.ts";
import { MailMedium, mailTools } from "./mail.ts";
import { ParallelismLimit } from "./parallelism.ts";
import { type ParticipantSettings, Participants } from "./participants.ts";
import { PhoneExchange, phoneTools } from "./phone.ts";
import { INVOICE_NOTICE, MONEY_TOOLS, MoneyBook, type MoneySettings, moneyTools, moneyToolsOf } from "./money.ts";
import { type WorldTime, hoursAt } from "./calendar.ts";
import type { Tool } from "./tools.ts";
import { Random } from "./random.ts";
import { type LogLine, Recorder, type RunSetup, type Sampling } from "./recorder.ts";
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
  /**
   * For a run of an experiment, what it runs, which its log gives first, with the sampling settings its sessions use
   * once they are open (FR-RECORD-02).
   */
  setup?: RunSetup;
  /** How long a model turn may run before it is aborted. */
  modelTurnTimeoutMs: number;
  /** How a model turn whose provider answers with a rate limit is retried; without it, it is not (FR-ADAPTER-02). */
  rateLimit?: RateLimitRetry;
  /** The thinking level every session of the run uses (FR-EXPERIMENT-05). */
  thinkingLevel: ThinkingLevel;
  /** The context compaction every session of the run uses (FR-ADAPTER-03). */
  compaction: Compaction;
  /** The maximum number of model calls running at once, across all agents. */
  parallelismLimit: number;
  /** How long the run may last, from its start; a tool call still running when it passes is cut off (FR-CLOCK-02). */
  timeLimitMs: number;
  /** How long the run waits between metric samples; without it, the metrics are sampled only at the start and the end (FR-METRIC-02). */
  metricIntervalMs?: number;
  /** Called with each line of the run's log as it is written, so a caller follows the run from what it records (FR-RUN-04). */
  onRecord?: (line: LogLine) => void;
  /**
   * Stops the run when it aborts, as an error would: with the error its reason gives, such as that the experiment
   * stopped (FR-RUN-06), or else with a log that says it was interrupted (FR-RUN-05).
   */
  interruption?: AbortSignal;
  /**
   * Called with the run's stimuli once every session is open, before any agent wakes, so a caller can deliver stimuli while the run goes on. A seam
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
  assertNamesDiffer([...agents.map(({ name }) => name), ...loaded.components.map(({ name }) => name)]);
  const recorder = Recorder.open(settings.logDirectory, settings.runId, settings.onRecord);
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
  const interrupt = () => {
    // Aborted without a reason, a signal's reason is Node's own AbortError, a DOMException, which says nothing of why.
    const reason: unknown = settings.interruption?.reason;
    stop(reason instanceof Error && !(reason instanceof DOMException) ? reason : new Error("the run was interrupted"));
  };
  if (settings.interruption?.aborted) interrupt();
  settings.interruption?.addEventListener("abort", interrupt, { once: true });
  try {
    const stimuli = new Stimuli(
      loaded.channels,
      (agent, stimulus) => recorder.record({ type: "stimulus", agent, ...stimulus, deliveredAtMs: performance.now() }),
      loaded.firstStimuli,
    );
    // The setup goes first: nothing is recorded before the sessions are open and onStart is called.
    const opened = (sampling: Sampling | null) => {
      if (settings.setup !== undefined) recorder.record({ type: "run_setup", runId: recorder.runId, ...settings.setup, sampling });
    };
    const result = await runAgents(loaded, agents, seed, settings, stimuli, recorder, runEnd, stop, opened);
    if (stoppedOn !== undefined) throw stoppedOn;
    return { runId: recorder.runId, ...result };
  } catch (error) {
    // Whatever stops the run, its log says so; the run fails with the error that stopped it first.
    stop(error instanceof Error ? error : new Error(String(error)));
    throw stoppedOn;
  } finally {
    settings.interruption?.removeEventListener("abort", interrupt);
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

/**
 * Refuses a run that would give two of its agents and components the same name: they would share a random sequence and
 * be told apart neither among the changes since sensing nor in the log (FR-WORKPLACE-05).
 */
function assertNamesDiffer(names: readonly string[]): void {
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice !== undefined) throw new Error(`The run gives two of its agents and components the name "${twice}"; each must have its own`);
}

/** Every sampling parameter but the thinking level, which the engine never sends, so the provider's defaults apply. */
export const PROVIDER_DEFAULTS = "the provider's defaults";

/**
 * Runs the agents of a run whose log is open. Once every session is open, or one failed to, it says so with the
 * sampling settings the sessions use, or null.
 */
async function runAgents<State>(
  { world, scenario, systemPrompts, rhythms, components, calendar, mail, phone, money, participants = [], variant, channels }: LoadedScenario<State>,
  agents: readonly Agent[],
  seed: number,
  settings: RunSettings,
  stimuli: Stimuli,
  recorder: Recorder,
  runEnd: AbortController,
  stop: (error: Error) => void,
  opened: (sampling: Sampling | null) => void,
): Promise<Omit<RunResult, "runId">> {
  const clock = new RunClock(calendar);
  const sessionSettings = {
    clock,
    modelTurnTimeoutMs: settings.modelTurnTimeoutMs,
    rateLimit: settings.rateLimit ?? { retries: 0, waitMs: 0 },
    thinkingLevel: settings.thinkingLevel,
    compaction: settings.compaction,
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
    retry: (retry) => recorder.record({ type: "rate_limit_retry", ...retry }),
    start: (start) => recorder.record({ type: "effector_start", ...start }),
    compaction: (compaction) => recorder.record({ type: "compaction", ...compaction }),
  };
  const sensings = new Sensings();
  const changes = new ChangesSinceSensing();
  const messages = new Map<string, AgentSession["messages"]>();
  // Every session is open before any agent starts, so opening them uses none of the time limit (FR-CLOCK-02). One that
  // fails to open stops the run, once the others have opened, and those are closed.
  // The mail's tools are every agent's, beside the scenario's own (FR-MESSAGE-01).
  // So are the phone's, when the configuration declares one; a callee is within its hours, when it keeps hours, by the
  // world's time as the call is placed (FR-PHONE-01).
  const inHours = (callee: string) => {
    const hours = participants.find(({ name }) => name === callee)?.hours;
    return hours === undefined || calendar === undefined || hoursAt(calendar, hours, clock.worldTime() as WorldTime).within;
  };
  const engineTools = [
    ...(mail === undefined ? [] : mailTools(mail.settings, mail.keeper)),
    ...(phone === undefined ? [] : phoneTools({ ...phone, acts: mail?.settings.acts ?? {}, inHours })),
    ...(money === undefined ? [] : moneyTools(money.settings, money.keeper)),
  ];
  const slowedBy = scenario.slowedBy;
  const tools = [...scenario.tools, ...(slowedBy === undefined ? engineTools : engineTools.map((tool) => slowed(tool, slowedBy)))];
  const opening = await Promise.allSettled(
    agents.map((agent) =>
      openSession(world, toolsOf(tools, participants, agent.name, money?.settings), agent, runtime, { ...sessionSettings, systemPrompt: systemPromptOf(systemPrompts, agent.name) }, parallelism, records, stimuli, sensings, changes).catch((error: unknown) => {
        throw failure(`the session of agent "${agent.name}" failed to open`, error);
      }),
    ),
  );
  const failed = opening.find((opened) => opened.status === "rejected");
  if (failed !== undefined) {
    for (const each of opening) if (each.status === "fulfilled") each.value.dispose();
    opened(null);
    throw failed.reason;
  }
  const sessions = opening.map((each) => (each as PromiseFulfilledResult<AgentSession>).value);
  opened({
    thinkingLevels: Object.fromEntries(agents.map((agent, index) => [agent.name, sessions[index].thinkingLevel])),
    otherParameters: PROVIDER_DEFAULTS,
  });
  // What the replica's variant drew, before anything acts (FR-CONGRESS-01).
  if (variant !== undefined) recorder.record({ type: "variant", ...variant });
  settings.onStart?.(stimuli);
  const startedAtMs = clock.start();
  // The phone watches the world for calls placed before any agent or participant can place one (FR-PHONE-01).
  const exchange =
    phone === undefined ? undefined : new PhoneExchange({ world, ...phone, clock, runEnd: runEnd.signal, changes, stimuli, record: (line) => recorder.record(line) });
  exchange?.start();
  // The money's book writes each money event as the world applies it (FR-MONEY-01).
  const notices = channels.some(({ name }) => name === INVOICE_NOTICE) ? { notices: stimuli } : {};
  const book = money === undefined ? undefined : new MoneyBook({ world, ...money, clock, record: (line) => recorder.record(line), ...notices });
  book?.start();
  // A participant's stimuli are held by its hours and reply delay, and its rule set woken by them (FR-PARTICIPANT-01).
  const parties = new Participants({
    world,
    tools,
    participants,
    ruleSets: scenario.ruleSets ?? {},
    clock,
    ...(calendar === undefined ? {} : { calendar }),
    seed,
    runEnd: runEnd.signal,
    stimuli,
    call: { sensings, changes, stimuli, records, runEnd: runEnd.signal, stop, clock },
    records,
  });
  // The mail watches the world for messages sent before any agent or component can send one (FR-MESSAGE-01).
  const medium =
    mail === undefined
      ? undefined
      : new MailMedium({ world, ...mail, clock, runEnd: runEnd.signal, changes, stimuli, seed, agents: [...agents.map(({ name }) => name), ...participants.flatMap(({ name, decides }) => (decides === "rules" ? [name] : []))], record: (line) => recorder.record(line) });
  medium?.start(startedAtMs);
  // Participants start once the mail and the phone watch the world, so a rule set's first step reaches them (FR-PARTICIPANT-01).
  parties.start();
  const sample = () => sampleMetrics(world, toolCalls, scenario.metrics, recorder, performance.now());
  sampleMetrics(world, toolCalls, scenario.metrics, recorder, startedAtMs);
  const timer = setTimeout(() => runEnd.abort(), settings.timeLimitMs);
  const samplingEnd = new AbortController();
  const sampling = settings.metricIntervalMs === undefined ? Promise.resolve() : sampleEvery(settings.metricIntervalMs, sample, samplingEnd.signal);
  try {
    // Components run alongside the agents from the moment they can start, without turns; the run ends once every agent
    // and every component has ended and every message sent has landed, or at its time limit (FR-PROCESS-01, FR-MESSAGE-01).
    const cycles = components.map((component) =>
      runComponent(component, {
        world,
        // From the seed and the component's name, as an agent's rhythm is, so a condition that adds a component leaves
        // the others' sequences as they were.
        random: Random.derive(seed, `cycle of ${component.name}`),
        clock,
        runEnd: runEnd.signal,
        changes,
        stimuli,
        ...(mail === undefined ? {} : { mail }),
        record: (action) => recorder.record({ type: "component_action", ...action }),
      }),
    );
    const agentLoops = agents.map(async (agent, index) => {
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
    });
    await Promise.all([...cycles, ...agentLoops]);
    // A message in transit, a participant's held stimulus or its rule set at work keeps the run going, until none
    // remains or the run's time limit passes (FR-MESSAGE-01, FR-PARTICIPANT-01).
    do {
      await medium?.delivered();
      await exchange?.settled();
      await parties.settled();
    } while (medium?.busy === true || exchange?.busy === true || parties.busy);
  } finally {
    // A run that ends at its budget must not leave its time limit pending, nor a sample to write once its log is closed.
    clearTimeout(timer);
    samplingEnd.abort();
    await sampling;
  }
  // A call the run's end cut off has its line, as one that ended does (FR-PHONE-01).
  exchange?.cutOff();
  // Each account's summary as the run ends (FR-MONEY-01).
  book?.summarise();
  // Each participant decided by rules gives its outcome record as the run ends (FR-PARTICIPANT-01).
  for (const { participant, outcome } of parties.outcomes()) recorder.record({ type: "participant_outcome", participant, outcome });
  sample();
  return { turns, toolCalls, messages, sensings, startedAtMs };
}

/**
 * Writes one metric sample to the log: each of the scenario's metrics computed from the world's state and the tool
 * calls recorded so far, never by a model, with the version it was computed from and when (FR-METRIC-02).
 */
function sampleMetrics<State>(world: World<State>, toolCalls: readonly ToolCall[], metrics: Scenario<State>["metrics"], recorder: Recorder, atMs: number): void {
  const values = Object.fromEntries(Object.entries(metrics).map(([name, metric]) => [name, metric(world.state, toolCalls)]));
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

/** An engine's tool whose every duration is the factor the scenario gives for the caller and the state times its own (FR-CONGRESS-01). */
function slowed<State>(tool: Tool<State>, slowedBy: (state: State, agent: string, tool: string) => number): Tool<State> {
  return {
    ...tool,
    durationMs: (state, call) => {
      const duration = tool.durationMs(state, call);
      const factor = slowedBy(state, call.agent, tool.name);
      return typeof duration === "number" ? duration * factor : { worldSeconds: duration.worldSeconds * factor };
    },
  };
}

/**
 * The tools an agent's session offers: a participant decided by a model is offered only those it declares
 * (FR-PARTICIPANT-01); any other agent, of the money tools, only those its account gives it (FR-MONEY-01).
 */
function toolsOf<State>(tools: readonly Tool<State>[], participants: readonly ParticipantSettings[], agent: string, money: MoneySettings | undefined): readonly Tool<State>[] {
  const participant = participants.find(({ name }) => name === agent);
  if (participant !== undefined) return tools.filter(({ name }) => participant.tools.includes(name));
  const given = money === undefined ? [] : moneyToolsOf(money, participants, agent);
  return tools.filter(({ name }) => !(MONEY_TOOLS as readonly string[]).includes(name) || given.includes(name));
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
