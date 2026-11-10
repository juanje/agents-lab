import type { TomlTable } from "smol-toml";
import type { ActionArgs, DeclaredAction } from "./actions.ts";
import { World } from "./world.ts";

/** A resolved configuration: the scenario's base configuration with the condition's change over it. */
export type Configuration = TomlTable;

/** What a scenario provides to the engine. */
export interface Scenario<State> {
  name: string;
  /** Builds the world's initial state from the resolved configuration. */
  initialState: (configuration: Configuration) => State;
  /** What an agent observes of the state. */
  perception: (state: State, agent: string) => string;
  actions: readonly DeclaredAction<State, ActionArgs>[];
  /** Each metric by its name, computed from the world's state. */
  metrics: Readonly<Record<string, (state: State) => number>>;
  systemPrompt: string;
  /** The base configuration, in TOML. */
  baseConfiguration: string;
}

/** A scenario ready to run: its parts, its resolved configuration and its world in its initial state. */
export interface LoadedScenario<State> {
  scenario: Scenario<State>;
  configuration: Configuration;
  world: World<State>;
}

/**
 * Loads a scenario. Scenarios reach the engine as modules, not through the type checker, so any part may be missing.
 */
export function loadScenario<State>(_scenario: Partial<Scenario<State>>): LoadedScenario<State> {
  throw new Error("loading a scenario is not built");
}
