import type { Position } from "./grid.ts";
import type { Sensing } from "./sensings.ts";
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
   * How long a call takes, in milliseconds, before a sensor reads the world or an effector's effect is checked and
   * applied, from the call's arguments, the agent that makes it and the state as the call starts (FR-TOOL-03, FR-TOOL-04).
   */
  durationMs(state: State, call: AgentCall): number;
}

/** A tool that returns part of the world, as seen from where the agent is, and changes nothing. */
export interface Sensor<State> extends Declared<State> {
  kind: "sensor";
  /** The text the agent receives. */
  sense(state: State, agent: string): string;
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

/** A tool that changes the world through the arbiter. */
export interface Effector<State> extends Declared<State> {
  kind: "effector";
  /**
   * For an effector under way in the world, such as crossing a passage, the change its call makes as it starts, through
   * the arbiter, once its duration is taken from the state before it (FR-TOOL-04, FR-SPACE-03). It cannot fail: a start
   * the world refuses is a defect of the scenario, and stops the run.
   */
  start?: Action<State, AgentCall>;
  /** The change the call makes when it lands, checked then against the world as it is (FR-TOOL-04). */
  action: Action<State, AgentCall>;
  /**
   * The text the agent receives for each outcome of its call's effect, success included, by the outcome; an outcome
   * without one gives the outcome itself (FR-TOOL-02). It tells the agent only what happened to it, never the world's state.
   */
  texts?: Readonly<Record<string, string>>;
  /**
   * What the agent's last sensing says of the call's target, which it finds from the state as the call starts;
   * "not_sensed" when that sensing does not show it.
   */
  readTarget(sensing: Sensing, call: AgentCall, state: State): TargetAsSensed;
}

/** An agent's only interface with the world (FR-TOOL-01). */
export type Tool<State> = Sensor<State> | Effector<State>;
