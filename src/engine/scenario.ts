import { type TomlTable, type TomlValue, parse } from "smol-toml";
import { Random } from "./random.ts";
import { type Channel, RHYTHM_CHANNEL } from "./stimuli.ts";
import type { Tool } from "./tools.ts";
import { World } from "./world.ts";

/** A resolved configuration: the scenario's base configuration with the condition's change over it. */
export type Configuration = TomlTable;

/**
 * A metric's value: one number for the world, null when the state gives it no value, or a number for each agent it
 * applies to, by the agent's name.
 */
export type MetricValue = number | null | Readonly<Record<string, number>>;

/** What a scenario provides to the engine. */
export interface Scenario<State> {
  name: string;
  /** The names of the agents that run in the scenario, from the resolved configuration. */
  agents: (configuration: Configuration) => readonly string[];
  /** Builds the world's initial state from the resolved configuration, drawing any chance from its own sequence. */
  initialState: (configuration: Configuration, random: Random) => State;
  /** The agents' only interface with the world: its sensors and effectors. */
  tools: readonly Tool<State>[];
  /** The declared paths by which stimuli reach agents, from the resolved configuration. */
  channels: (configuration: Configuration) => readonly Channel[];
  /** Each metric by its name, computed from the world's state. */
  metrics: Readonly<Record<string, (state: State) => MetricValue>>;
  /** What an agent is told it is, from the resolved configuration and the agent's name; never the world's state. */
  systemPrompt: (configuration: Configuration, agent: string) => string;
  /** The base configuration, in TOML. */
  baseConfiguration: string;
}

/** A named change over a scenario's base configuration. */
export interface Condition {
  name: string;
  /** The change, in TOML. */
  change: string;
}

/**
 * A scenario ready to run as one replica: its parts, its resolved configuration, its world in its initial state, and
 * each of its agents with its system prompt.
 */
export interface LoadedScenario<State> {
  scenario: Scenario<State>;
  configuration: Configuration;
  world: World<State>;
  /** The scenario's agents, in the order it names them, each with its system prompt. */
  systemPrompts: ReadonlyMap<string, string>;
  /** The scenario's stimulus channels, as its configuration gives them. */
  channels: readonly Channel[];
}

/** Each part a scenario must provide, and how an error names it. */
const requiredParts = [
  ["initialState", "initial state"],
  ["agents", "agents"],
  ["tools", "tools"],
  ["channels", "stimulus channels"],
  ["metrics", "metrics"],
  ["systemPrompt", "system prompt"],
  ["baseConfiguration", "base configuration"],
] as const satisfies readonly (readonly [keyof Scenario<unknown>, string])[];

/**
 * Loads a scenario as one replica, with its seed, under a condition or under its base configuration alone. Scenarios
 * reach the engine as modules, not through the type checker, so any part may be missing; a scenario that lacks one is
 * refused before anything runs.
 */
export function loadScenario<State>(
  parts: Partial<Scenario<State>>,
  seed: number,
  condition?: Condition,
): LoadedScenario<State> {
  const lacks = (part: string) => new Error(`Scenario "${parts.name}" lacks its ${part}`);
  for (const [property, part] of requiredParts) {
    if (parts[property] === undefined) throw lacks(part);
  }
  const scenario = parts as Scenario<State>;
  const base = parse(scenario.baseConfiguration);
  // A text part that holds nothing gives the agents nothing, so it counts as missing.
  if (Object.keys(base).length === 0) throw lacks("base configuration");
  const configuration =
    condition === undefined
      ? base
      : applyChange(base, parse(condition.change), [], { condition: condition.name, scenario: scenario.name });
  const channels = scenario.channels(configuration);
  // Each agent wakes by its rhythm's stimulus: without that channel the run would fail at the first wake.
  if (!channels.some((channel) => channel.name === RHYTHM_CHANNEL)) {
    throw new Error(`Scenario "${scenario.name}" declares no stimulus channel named "${RHYTHM_CHANNEL}", which wakes each agent`);
  }
  const systemPrompts = new Map<string, string>();
  for (const agent of scenario.agents(configuration)) {
    const systemPrompt = scenario.systemPrompt(configuration, agent);
    if (systemPrompt.trim() === "") throw lacks(`system prompt for agent "${agent}"`);
    systemPrompts.set(agent, systemPrompt);
  }
  const initial = scenario.initialState(configuration, Random.derive(seed, "initial state"));
  return { scenario, configuration, world: new World(initial), systemPrompts, channels };
}

/** The names of the condition being applied and of the scenario whose base configuration it changes, for errors. */
interface Applying {
  condition: string;
  scenario: string;
}

/** Whether a TOML value is a table: an object that is neither an array nor a date and time. */
export function isTable(value: TomlValue): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Applies a condition's change over a configuration: a value replaces the one under the same key, and a table is
 * applied the same way inside the configuration's table, so the keys it does not name keep their values. A key the
 * configuration lacks is refused: a misspelled key would otherwise leave the condition the same as the baseline.
 */
function applyChange(configuration: TomlTable, change: TomlTable, path: readonly string[], applying: Applying): TomlTable {
  const changed: TomlTable = { ...configuration };
  for (const [key, value] of Object.entries(change)) {
    const keyPath = [...path, key];
    if (!Object.hasOwn(configuration, key)) {
      throw new Error(
        `Condition "${applying.condition}" sets ${keyPath.join(".")}, which the base configuration of scenario "${applying.scenario}" does not have`,
      );
    }
    const current = configuration[key];
    if (kindOf(value) !== kindOf(current)) {
      throw new Error(
        `Condition "${applying.condition}" gives ${keyPath.join(".")} ${kindOf(value)}, where the base configuration of scenario "${applying.scenario}" has ${kindOf(current)}`,
      );
    }
    changed[key] = isTable(value) && isTable(current) ? applyChange(current, value, keyPath, applying) : value;
  }
  return changed;
}

/**
 * The kind of a TOML value, with its article, as errors name it. Integers and fractions are one kind, numbers, as
 * smol-toml reads both as JavaScript numbers.
 */
function kindOf(value: TomlValue): string {
  if (Array.isArray(value)) return "an array";
  if (value instanceof Date) return "a date and time";
  if (isTable(value)) return "a table";
  return `a ${typeof value}`;
}
