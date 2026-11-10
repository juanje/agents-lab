import { type TomlTable, parse } from "smol-toml";
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

/** A named change over a scenario's base configuration. */
export interface Condition {
  name: string;
  /** The change, in TOML. */
  change: string;
}

/** A scenario ready to run: its parts, its resolved configuration and its world in its initial state. */
export interface LoadedScenario<State> {
  scenario: Scenario<State>;
  configuration: Configuration;
  world: World<State>;
}

/** Each part a scenario must provide, and how an error names it. */
const requiredParts = [
  ["initialState", "initial state"],
  ["perception", "perception"],
  ["actions", "actions"],
  ["metrics", "metrics"],
  ["systemPrompt", "system prompt"],
  ["baseConfiguration", "base configuration"],
] as const satisfies readonly (readonly [keyof Scenario<unknown>, string])[];

/**
 * Loads a scenario under a condition, or under its base configuration alone. Scenarios reach the engine as modules,
 * not through the type checker, so any part may be missing; a scenario that lacks one is refused before anything runs.
 */
export function loadScenario<State>(parts: Partial<Scenario<State>>, condition?: Condition): LoadedScenario<State> {
  for (const [property, part] of requiredParts) {
    if (parts[property] === undefined) throw new Error(`Scenario "${parts.name}" lacks its ${part}`);
  }
  const scenario = parts as Scenario<State>;
  const configuration = { ...parse(scenario.baseConfiguration), ...parse(condition?.change ?? "") };
  return { scenario, configuration, world: new World(scenario.initialState(configuration)) };
}
