import { type TomlTable, type TomlValue, parse, stringify } from "smol-toml";
import { Random } from "./random.ts";
import { type Condition, isTable } from "./scenario.ts";

/** The limits every run of an experiment runs under. */
export interface Limits {
  timeLimitMs: number;
  activationsPerAgent: number;
  parallelismLimit: number;
  modelTurnTimeoutMs: number;
}

/** An experiment as its file gives it, validated against the experiment schema. */
export interface Experiment {
  id: string;
  /** The name of the scenario it runs. */
  scenario: string;
  /** The ids of the models its agents work with. */
  models: readonly string[];
  replicas: number;
  /** The base seed, from which each replica's seed comes. */
  seed: number;
  limits: Limits;
  /** How long each run waits between metric samples; without it, each run samples only at its start and its end. */
  metricIntervalMs?: number;
  /** Its conditions, each a named change over the scenario's base configuration, in the order the file gives them. */
  conditions: readonly Condition[];
}

/** Reads an experiment file, in TOML, and validates it against the experiment schema before anything runs. */
export function readExperiment(toml: string): Experiment {
  const file = readTable(parse(toml), [], fileSchema, optionalFileSchema);
  const limits = readTable(file.limits, ["limits"], limitsSchema);
  return {
    id: file.id,
    scenario: file.scenario,
    models: file.models,
    replicas: file.replicas,
    seed: file.seed,
    limits: {
      timeLimitMs: limits.time_limit_ms,
      activationsPerAgent: limits.activations_per_agent,
      parallelismLimit: limits.parallelism_limit,
      modelTurnTimeoutMs: limits.model_turn_timeout_ms,
    },
    ...(file.metric_interval_ms === undefined ? {} : { metricIntervalMs: file.metric_interval_ms }),
    // A change's keys are checked when the scenario is loaded with it, against the scenario's base configuration.
    conditions: Object.keys(file.conditions).map((name) => ({
      name,
      change: stringify(field(file.conditions, ["conditions", name], table)),
    })),
  };
}

/**
 * The seed of replica r, from 1: derived from the base seed and r alone, so a replica has the same seed in every
 * condition and model, and its runs differ only by what the condition changes and how the model answers.
 */
export function replicaSeed(seed: number, replica: number): number {
  return Math.floor(Random.derive(seed, `replica ${replica}`).next() * 2 ** 32);
}

/** What a field must hold, as an error names it, and the check that its value holds it. */
interface Kind<T extends TomlValue> {
  expected: string;
  holds: (value: TomlValue) => value is T;
}

const text: Kind<string> = { expected: "a text", holds: (value) => typeof value === "string" };

const table: Kind<TomlTable> = { expected: "a table", holds: isTable };

const namedConditions: Kind<TomlTable> = { expected: "a table of named conditions", holds: isTable };

const modelIds: Kind<string[]> = {
  expected: "a list of at least one model id",
  holds: (value): value is string[] =>
    Array.isArray(value) && value.length > 0 && value.every((model) => typeof model === "string"),
};

function wholeNumber(expected: string, min: number, max = Number.MAX_SAFE_INTEGER): Kind<number> {
  return {
    expected,
    holds: (value): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max,
  };
}

const atLeastOne = wholeNumber("a whole number of at least 1", 1);

const seed = wholeNumber("a whole number from 0 to 4294967295", 0, 4294967295);

/** Each field a table of the file has, by its key, with the kind of value it holds. */
type Schema = Readonly<Record<string, Kind<TomlValue>>>;

/** A table read against its schema: each field's value, of its kind. */
type Read<S extends Schema> = { [Key in keyof S]: S[Key] extends Kind<infer T> ? T : never };

const fileSchema = {
  id: text,
  scenario: text,
  models: modelIds,
  replicas: atLeastOne,
  seed,
  limits: table,
  conditions: namedConditions,
} satisfies Schema;

/** The fields the file may leave out. */
const optionalFileSchema = {
  metric_interval_ms: atLeastOne,
} satisfies Schema;

const limitsSchema = {
  time_limit_ms: atLeastOne,
  activations_per_agent: atLeastOne,
  parallelism_limit: atLeastOne,
  model_turn_timeout_ms: atLeastOne,
} satisfies Schema;

/**
 * Reads a table of the file, at its path from the file, against its schema of required fields and, if it has any, of
 * fields it may leave out: a key neither knows is refused, since a misspelled key would otherwise be left unread, and
 * so is a required field that is missing or any field of another kind.
 */
function readTable<S extends Schema, O extends Schema = Record<never, never>>(
  holder: TomlTable,
  at: readonly string[],
  schema: S,
  optional: O = {} as O,
): Read<S> & Partial<Read<O>> {
  for (const key of Object.keys(holder)) {
    if (!Object.hasOwn(schema, key) && !Object.hasOwn(optional, key)) {
      throw new Error(`The experiment file has the field "${[...at, key].join(".")}", which the experiment schema does not know`);
    }
  }
  const given = Object.entries(optional).filter(([key]) => Object.hasOwn(holder, key));
  return Object.fromEntries([...Object.entries(schema), ...given].map(([key, kind]) => [key, field(holder, [...at, key], kind)])) as Read<S> &
    Partial<Read<O>>;
}

/**
 * The value of a field that must be there, from the table that holds it: the file itself or a table in it. The field's
 * path, from the file, names it in errors.
 */
function field<T extends TomlValue>(holder: TomlTable, path: readonly string[], kind: Kind<T>): T {
  const key = path[path.length - 1];
  const name = path.join(".");
  if (!Object.hasOwn(holder, key)) throw new Error(`The experiment file lacks the field "${name}"`);
  const value = holder[key];
  if (!kind.holds(value)) throw new Error(`The experiment file's field "${name}" must be ${kind.expected}`);
  return value;
}
