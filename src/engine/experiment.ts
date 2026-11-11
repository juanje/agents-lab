import { type TomlTable, parse, stringify } from "smol-toml";
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
  const limits = file.limits as TomlTable;
  return {
    id: file.id as string,
    scenario: file.scenario as string,
    models: file.models as string[],
    replicas: file.replicas as number,
    seed: file.seed as number,
    limits: {
      timeLimitMs: limits.time_limit_ms as number,
      activationsPerAgent: limits.activations_per_agent as number,
      parallelismLimit: limits.parallelism_limit as number,
      modelTurnTimeoutMs: limits.model_turn_timeout_ms as number,
    },
    conditions: Object.entries(file.conditions as TomlTable).map(([name, change]) => ({
      name,
      change: stringify(change as TomlTable),
    })),
  };
}
