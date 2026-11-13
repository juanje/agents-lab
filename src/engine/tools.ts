import type { WorldDuration, WorldTime } from "./calendar.ts";
import type { Position } from "./grid.ts";
import type { Sensing } from "./sensings.ts";
import type { Stimulus } from "./stimuli.ts";
import type { Action } from "./world.ts";

/**
 * What a tool's call gives the tool: the agent that made the call and the call's arguments, kept apart so that no
 * argument can make the tool act as another agent (FR-TOOL-02).
 */
export interface AgentCall {
  agent: string;
  arguments: Record<string, unknown>;
}

/**
 * What a tool declares: its name, the description the agent sees, its arguments as a JSON Schema, and its duration.
 */
interface Declared<State> {
  name: string;
  description: string;
  parameters: object;
  /**
   * How long a call takes, in milliseconds of the run or as a duration in world time (FR-CLOCK-03), before a sensor reads
   * the world or an effector's effect is checked and applied, from the call's arguments, the agent that makes it and the
   * state as the call starts (FR-TOOL-03, FR-TOOL-04).
   */
  durationMs(state: State, call: AgentCall): number | WorldDuration;
}

/** A tool that returns part of the world, as seen from where the agent is, and changes nothing. */
export interface Sensor<State> extends Declared<State> {
  kind: "sensor";
  /**
   * The text the agent receives, from the state, the agent that calls it, the call's arguments, the time since the run
   * started and the world's time then, for a run with a calendar (FR-CLOCK-03), as the sensor reads the world.
   */
  sense(state: State, agent: string, args: Readonly<Record<string, unknown>>, sinceStartMs: number, world?: WorldTime): string;
  /**
   * Where the agent senses from, read against the same state as what it receives, for a sensor whose result is relative
   * to it; the engine keeps it with the sensing, so an effector can find its target in it later.
   */
  takenFrom?(state: State, agent: string): Position;
}

/**
 * What an agent last sensed of an effector's target, recorded beside the call's outcome and never deciding it (NFR-11):
 * "outside" when that sensing showed the target is no place the agent can go.
 */
export type TargetAsSensed = "free" | "held" | "outside" | "not_sensed";

/**
 * The change an effector under way makes as its call starts (FR-SPACE-03), and how the scenario describes it for the
 * run's log, from the state before it and the call (FR-RECORD-01).
 */
export interface Start<State> extends Action<State, AgentCall> {
  describe(state: State, call: AgentCall): Readonly<Record<string, unknown>>;
  /**
   * Whether the call starts under way at all, from the state as it starts; when it does not (a place that is not one
   * passage away), no start is applied and the call's action alone decides its outcome. Every call starts when it is
   * not declared.
   */
  appliesTo?(state: State, call: AgentCall): boolean;
}

/**
 * An effector's call as its action is checked and applied: with the moment it is, by `performance.now()`, and the world's
 * time then, for a run with a calendar (FR-CLOCK-03).
 */
export interface LandingCall extends AgentCall {
  atMs: number;
  world?: WorldTime;
}

/** An agent's last sensing by a sensor, by the sensor's name, or undefined if it never used it. */
export type LastBy = (tool: string) => Sensing | undefined;

/**
 * What ends an effector's call before its duration has passed (FR-WORKPLACE-07): a change of the world, or a stimulus
 * that reaches the calling agent, that its conditions accept. The call then ends at that moment with its own outcome.
 */
export interface EarlyEnd<State> {
  outcome: string;
  /** Whether a change of the world, from the state before it to the state after it, ends the call. */
  byChange(before: State, after: State, call: AgentCall): boolean;
  /** Whether a stimulus that reaches the calling agent ends the call. */
  byStimulus(stimulus: Stimulus, call: AgentCall): boolean;
}

/**
 * What an agent sees from where it is as an effector's call ends, which follows the text of some of its outcomes
 * (FR-TOOL-02, FR-WORKPLACE-08). It is no sensing: it is kept apart, by the effector's name, for the agent's later calls.
 */
export interface Sight<State> {
  /** The outcomes whose text it follows. */
  outcomes: readonly string[];
  /** What it is, as the inventory names it, such as "who is in sight". */
  of: string;
  /**
   * What the agent sees, from the state as its call ends: the text that follows the outcome's, after one space, and what
   * is kept of it, which its effectors' later calls read by the effector's name.
   */
  see(state: State, agent: string): { text: string; seen: string };
}

/** A tool that changes the world through the arbiter. */
export interface Effector<State> extends Declared<State> {
  kind: "effector";
  /**
   * Why the effector does not take a call's arguments, from the state as the call starts, for a limit its schema cannot
   * give, such as one the configuration sets; undefined when it takes them. A call it does not take is invalid_arguments:
   * it applies nothing and takes no time (FR-TOOL-02).
   */
  refuses?(state: State, call: AgentCall): string | undefined;
  /** What ends a call before its duration has passed, for an effector that declares it (FR-WORKPLACE-07). */
  endsEarly?: EarlyEnd<State>;
  /**
   * For an effector under way in the world, such as crossing a passage, the change its call makes as it starts, through
   * the arbiter, once its duration is taken from the state before it (FR-TOOL-04, FR-SPACE-03). It cannot fail: a start
   * the world refuses is a defect of the scenario, and stops the run.
   */
  start?: Start<State>;
  /**
   * The change the call makes when it lands, checked then against the world as it is (FR-TOOL-04). An effector without
   * one changes nothing in the world: its call succeeds, or ends early, without going through the arbiter (FR-WORKPLACE-07).
   */
  action?: Action<State, LandingCall>;
  /**
   * The text the agent receives for each outcome of its call's effect, success included, by the outcome; an outcome
   * without one gives the outcome itself (FR-TOOL-02). It tells the agent only what happened to it, never the world's
   * state, except what its sight follows it with.
   */
  texts?: Readonly<Record<string, string>>;
  /** What the agent sees as the call ends, which follows the text of the outcomes it names (FR-WORKPLACE-08). */
  sight?: Sight<State>;
  /**
   * What the agent's last sensing says of the call's target, which it finds from the state as the call starts;
   * "not_sensed" when that sensing does not show it, or when the agent has sensed nothing. `lastBy` gives the agent's last
   * sensing by a sensor, or what an effector's sight last kept, by the tool's name, whatever came after it, for an
   * effector that reads its target in what one tool showed.
   */
  readTarget(sensing: Sensing | undefined, call: AgentCall, state: State, lastBy: LastBy): TargetAsSensed;
}

/** An agent's only interface with the world (FR-TOOL-01). */
export type Tool<State> = Sensor<State> | Effector<State>;
