import type { Action } from "./world.ts";

/** What a tool shares with the agent: its name, the description the agent sees, and its arguments as a JSON Schema. */
interface Declared {
  name: string;
  description: string;
  parameters: object;
}

/** A tool that returns part of the world, as seen from where the agent is, and changes nothing. */
export interface Sensor<State> extends Declared {
  kind: "sensor";
  /** The text the agent receives. */
  sense(state: State, agent: string): string;
}

/** What an effector's action receives: the call's arguments and the agent that made it. */
export type EffectorArguments = { agent: string } & Record<string, unknown>;

/** A tool that changes the world through the arbiter. */
export interface Effector<State> extends Declared {
  kind: "effector";
  action: Action<State, EffectorArguments>;
}

/** An agent's only interface with the world (FR-TOOL-01). */
export type Tool<State> = Sensor<State> | Effector<State>;
