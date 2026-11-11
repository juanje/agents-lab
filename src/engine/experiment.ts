import { type TomlTable, type TomlValue, parse, stringify } from "smol-toml";
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
  /** Its conditions, each a named change over the scenario's base configuration, in the order the file gives them. */
  conditions: readonly Condition[];
}

/** Reads an experiment file, in TOML, and validates it against the experiment schema before anything runs. */
export function readExperiment(toml: string): Experiment {
  const file = parse(toml);
  onlyKnown(file, [], ["id", "scenario", "models", "replicas", "seed", "limits", "conditions"]);
  const limits = field(file, ["limits"], table);
  onlyKnown(limits, ["limits"], ["time_limit_ms", "activations_per_agent", "parallelism_limit", "model_turn_timeout_ms"]);
  const conditions = field(file, ["conditions"], namedConditions);
  return {
    id: field(file, ["id"], text),
    scenario: field(file, ["scenario"], text),
    models: field(file, ["models"], modelIds),
    replicas: field(file, ["replicas"], atLeastOne),
    seed: field(file, ["seed"], seed),
    limits: {
      timeLimitMs: field(limits, ["limits", "time_limit_ms"], atLeastOne),
      activationsPerAgent: field(limits, ["limits", "activations_per_agent"], atLeastOne),
      parallelismLimit: field(limits, ["limits", "parallelism_limit"], atLeastOne),
      modelTurnTimeoutMs: field(limits, ["limits", "model_turn_timeout_ms"], atLeastOne),
    },
    conditions: Object.keys(conditions).map((name) => ({
      name,
      change: stringify(field(conditions, ["conditions", name], table)),
    })),
  };
}

/** Refuses a key of a table, at its path from the file, that the schema does not give it. */
function onlyKnown(holder: TomlTable, at: readonly string[], known: readonly string[]): void {
  for (const key of Object.keys(holder)) {
    if (!known.includes(key)) {
      throw new Error(`The experiment file has the field "${[...at, key].join(".")}", which the experiment schema does not know`);
    }
  }
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

/**
 * The value of a required field, from the table that holds it: the file itself or a table in it. The field's path,
 * from the file, names it in errors.
 */
function field<T extends TomlValue>(holder: TomlTable, path: readonly string[], kind: Kind<T>): T {
  const key = path[path.length - 1];
  const name = path.join(".");
  if (!Object.hasOwn(holder, key)) throw new Error(`The experiment file lacks the field "${name}"`);
  const value = holder[key];
  if (!kind.holds(value)) throw new Error(`The experiment file's field "${name}" must be ${kind.expected}`);
  return value;
}
