import { type TomlTable, type TomlValue, parse, stringify } from "smol-toml";
import { Materials, materialReference } from "./materials.ts";
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
  /** The thinking level every session of every run uses (FR-EXPERIMENT-05). */
  thinkingLevel: ThinkingLevel;
  /** The context compaction every session of every run uses (FR-ADAPTER-03). */
  compaction: Compaction;
  replicas: number;
  /** The base seed, from which each replica's seed comes. */
  seed: number;
  limits: Limits;
  /** How long each run waits between metric samples; without it, each run samples only at its start and its end. */
  metricIntervalMs?: number;
  /** Its conditions, each a named change over the scenario's base configuration, in the order the file gives them. */
  conditions: readonly Condition[];
}

/**
 * The context compaction a session uses (FR-ADAPTER-03): off, or on, starting once the context fills the share
 * `triggerAt` of the model's context window, and keeping about `keepRecentTokens` of the most recent context as it is.
 */
export type Compaction = { enabled: false } | { enabled: true; triggerAt: number; keepRecentTokens: number };

/**
 * Reads an experiment file, in TOML, and validates it against the experiment schema before anything runs. Its
 * conditions read their materials from the directory the file is in, when given.
 */
export function readExperiment(toml: string, directory?: string): Experiment {
  const file = readTable(parse(toml), [], fileSchema, optionalFileSchema);
  const limits = readTable(file.limits, ["limits"], limitsSchema);
  const materials = directory === undefined ? {} : { materials: new Materials(directory) };
  return {
    id: file.id,
    scenario: file.scenario,
    models: file.models,
    thinkingLevel: file.thinking_level,
    compaction: compactionOf(file.compaction),
    replicas: file.replicas,
    seed: file.seed,
    limits: {
      timeLimitMs: limits.time_limit_ms,
      activationsPerAgent: limits.activations_per_agent,
      parallelismLimit: limits.parallelism_limit,
      modelTurnTimeoutMs: limits.model_turn_timeout_ms,
    },
    ...(file.metric_interval_ms === undefined ? {} : { metricIntervalMs: file.metric_interval_ms }),
    conditions: conditionsOf(file).map((condition) => ({ ...condition, ...materials })),
  };
}

/** The file's compaction table: whether it is on, and only when it is, its trigger and what it keeps. */
function compactionOf(holder: TomlTable): Compaction {
  const at = ["compaction"];
  if (!field(holder, [...at, "enabled"], trueOrFalse)) {
    readTable(holder, at, compactionOffSchema);
    return { enabled: false };
  }
  const on = readTable(holder, at, compactionOnSchema);
  return { enabled: true, triggerAt: on.trigger_at, keepRecentTokens: on.keep_recent_tokens };
}

/** A condition as the file gives it, before its materials: its name, its change as a table, and its levels, if it is a combination. */
interface Given {
  name: string;
  change: TomlTable;
  levels?: Readonly<Record<string, string>>;
}

/**
 * The file's conditions, in the order they run: when it declares factors, the baseline, which takes no level, unless
 * the file turns it off, then every combination of levels, the first factor's changing slowest; then the file's own
 * conditions (FR-EXPERIMENT-02). Each gets the change common to all, when the file gives one. A change's keys are checked when the scenario is loaded with it, against the
 * scenario's base configuration.
 */
function conditionsOf(file: { conditions?: TomlTable; factors?: TomlTable; baseline?: boolean; common?: TomlTable }): Condition[] {
  const own = file.conditions ?? {};
  const baseline: Given[] = file.baseline === false ? [] : [{ name: "baseline", change: {} }];
  const given: Given[] = [
    ...(file.factors === undefined ? [] : [...baseline, ...combinations(file.factors)]),
    ...Object.keys(own).map((name) => ({ name, change: field(own, ["conditions", name], table) })),
  ];
  if (given.length === 0) throw new Error('The experiment file gives no condition: it must give "conditions", "factors" or both');
  const names = new Set<string>();
  for (const { name } of given) {
    if (names.has(name)) throw new Error(`The experiment file gives two conditions named "${name}"`);
    names.add(name);
  }
  const common = file.common === undefined ? {} : { common: stringify(file.common) };
  return given.map(({ change, ...rest }) => ({ ...rest, change: stringify(change), ...common }));
}

/** A level of a factor, with its change. */
interface Level {
  factor: string;
  level: string;
  change: TomlTable;
}

/**
 * Every combination of the factors' levels, as a condition named after its levels, the first factor's changing
 * slowest, whose change is its levels' changes as one. Two levels of a combination that set the same key are refused.
 */
function combinations(factors: TomlTable): Required<Given>[] {
  let combined: Level[][] = [[]];
  for (const factor of Object.keys(factors)) {
    const levels = field(factors, ["factors", factor], namedLevels);
    combined = combined.flatMap((chosen) =>
      Object.keys(levels).map((level) => [...chosen, { factor, level, change: field(levels, ["factors", factor, level], table) }]),
    );
  }
  return combined.map((chosen) => {
    const name = chosen.map(({ factor, level }) => `${factor}=${level}`).join(",");
    for (const [at, one] of chosen.entries()) {
      for (const other of chosen.slice(at + 1)) {
        const key = sharedKey(one.change, other.change);
        if (key !== undefined) {
          throw new Error(
            `The levels "${one.level}" of factor "${one.factor}" and "${other.level}" of factor "${other.factor}" both set ${key}, so the condition "${name}" cannot be formed`,
          );
        }
      }
    }
    return {
      name,
      change: chosen.reduce<TomlTable>((change, { change: level }) => merged(change, level), {}),
      levels: Object.fromEntries(chosen.map(({ factor, level }) => [factor, level])),
    };
  });
}

/** Whether a change's value is a table of keys it sets inside, rather than a value, as a material's reference is. */
function setsInside(value: TomlValue): value is TomlTable {
  return isTable(value) && materialReference(value) === undefined;
}

/** The first key two changes both set, as a dotted path, or undefined when they set none in common. */
function sharedKey(one: TomlTable, other: TomlTable, path: readonly string[] = []): string | undefined {
  for (const [key, value] of Object.entries(other)) {
    if (!Object.hasOwn(one, key)) continue;
    const current = one[key];
    if (!setsInside(current) || !setsInside(value)) return [...path, key].join(".");
    const inside = sharedKey(current, value, [...path, key]);
    if (inside !== undefined) return inside;
  }
  return undefined;
}

/** Two changes that set no key in common as one: a table both set keys inside is merged the same way. */
function merged(one: TomlTable, other: TomlTable): TomlTable {
  const changed: TomlTable = { ...one };
  for (const [key, value] of Object.entries(other)) {
    const current = changed[key];
    changed[key] = current !== undefined && setsInside(current) && setsInside(value) ? merged(current, value) : value;
  }
  return changed;
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

const trueOrFalse: Kind<boolean> = { expected: "true or false", holds: (value) => typeof value === "boolean" };

const table: Kind<TomlTable> = { expected: "a table", holds: isTable };

const namedConditions: Kind<TomlTable> = { expected: "a table of named conditions", holds: isTable };

const namedFactors: Kind<TomlTable> = { expected: "a table of named factors", holds: isTable };

const namedLevels: Kind<TomlTable> = {
  expected: "a table of at least one named level",
  holds: (value): value is TomlTable => isTable(value) && Object.keys(value).length > 0,
};

const modelIds: Kind<string[]> = {
  expected: "a list of at least one model id",
  holds: (value): value is string[] =>
    Array.isArray(value) && value.length > 0 && value.every((model) => typeof model === "string"),
};

/** The thinking levels Pi knows (pi-agent-core 1.5.0), in its order, from none to the most. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** A thinking level Pi knows. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const thinkingLevel: Kind<ThinkingLevel> = {
  expected: `one of ${THINKING_LEVELS.slice(0, -1).join(", ")} or ${THINKING_LEVELS.at(-1)}`,
  holds: (value): value is ThinkingLevel => (THINKING_LEVELS as readonly TomlValue[]).includes(value),
};

function wholeNumber(expected: string, min: number, max = Number.MAX_SAFE_INTEGER): Kind<number> {
  return {
    expected,
    holds: (value): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max,
  };
}

const atLeastOne = wholeNumber("a whole number of at least 1", 1);

const share: Kind<number> = {
  expected: "a number above 0 and below 1",
  holds: (value): value is number => typeof value === "number" && value > 0 && value < 1,
};

const seed = wholeNumber("a whole number from 0 to 4294967295", 0, 4294967295);

/** Each field a table of the file has, by its key, with the kind of value it holds. */
type Schema = Readonly<Record<string, Kind<TomlValue>>>;

/** A table read against its schema: each field's value, of its kind. */
type Read<S extends Schema> = { [Key in keyof S]: S[Key] extends Kind<infer T> ? T : never };

const fileSchema = {
  id: text,
  scenario: text,
  models: modelIds,
  thinking_level: thinkingLevel,
  replicas: atLeastOne,
  seed,
  limits: table,
  compaction: table,
} satisfies Schema;

/** The fields the file may leave out. */
const optionalFileSchema = {
  metric_interval_ms: atLeastOne,
  conditions: namedConditions,
  factors: namedFactors,
  baseline: trueOrFalse,
  common: table,
} satisfies Schema;

const compactionOffSchema = { enabled: trueOrFalse } satisfies Schema;

const compactionOnSchema = {
  enabled: trueOrFalse,
  trigger_at: share,
  keep_recent_tokens: atLeastOne,
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
