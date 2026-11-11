import { type TomlTable, type TomlValue, parse, stringify } from "smol-toml";
import type { Condition } from "./scenario.ts";

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
  const limits = field(file, "limits") as TomlTable;
  return {
    id: field(file, "id") as string,
    scenario: field(file, "scenario") as string,
    models: field(file, "models") as string[],
    replicas: field(file, "replicas") as number,
    seed: field(file, "seed") as number,
    limits: {
      timeLimitMs: field(limits, "time_limit_ms", "limits") as number,
      activationsPerAgent: field(limits, "activations_per_agent", "limits") as number,
      parallelismLimit: field(limits, "parallelism_limit", "limits") as number,
      modelTurnTimeoutMs: field(limits, "model_turn_timeout_ms", "limits") as number,
    },
    conditions: Object.entries(field(file, "conditions") as TomlTable).map(([name, change]) => ({
      name,
      change: stringify(change as TomlTable),
    })),
  };
}

/** The value of a required field of a table, which is the file itself or the table at a path in it. */
function field(table: TomlTable, key: string, tablePath?: string): TomlValue {
  if (!Object.hasOwn(table, key)) {
    throw new Error(`The experiment file lacks the field "${tablePath === undefined ? key : `${tablePath}.${key}`}"`);
  }
  return table[key];
}
