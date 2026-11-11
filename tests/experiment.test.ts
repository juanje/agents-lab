import { describe, expect, it } from "vitest";
import { type TomlTable, type TomlValue, parse, stringify } from "smol-toml";
import { readExperiment, replicaSeed } from "../src/engine/experiment.ts";

/** A valid experiment file, in TOML. */
const valid = [
  'id = "e-test"',
  'scenario = "slots"',
  'models = ["scripted/one", "scripted/two"]',
  'thinking_level = "low"',
  "replicas = 2",
  "seed = 7",
  "[limits]",
  "time_limit_ms = 1000",
  "activations_per_agent = 3",
  "parallelism_limit = 2",
  "model_turn_timeout_ms = 500",
  "[conditions.baseline]",
  "[conditions.five-slots]",
  "slots.count = 5",
  "",
].join("\n");

describe("readExperiment", () => {
  it("gives the experiment's id, scenario, models, thinking level, replicas, base seed and limits", () => {
    const experiment = readExperiment(valid);
    expect(experiment).toMatchObject({
      id: "e-test",
      scenario: "slots",
      models: ["scripted/one", "scripted/two"],
      thinkingLevel: "low",
      replicas: 2,
      seed: 7,
      limits: { timeLimitMs: 1000, activationsPerAgent: 3, parallelismLimit: 2, modelTurnTimeoutMs: 500 },
    });
  });

  it("gives the interval between metric samples when the file gives metric_interval_ms, and none when it does not", () => {
    expect(readExperiment(withSet("metric_interval_ms", 100)).metricIntervalMs).toBe(100);
    expect(readExperiment(valid).metricIntervalMs).toBeUndefined();
  });

  it("gives each condition its name and its change, in TOML, in the order the file gives them", () => {
    const { conditions } = readExperiment(valid);
    expect(conditions.map(({ name }) => name)).toEqual(["baseline", "five-slots"]);
    expect(conditions.map(({ change }) => parse(change))).toEqual([{}, { slots: { count: 5 } }]);
  });

  it.each([
    "id",
    "scenario",
    "models",
    "thinking_level",
    "replicas",
    "seed",
    "limits",
    "limits.time_limit_ms",
    "limits.activations_per_agent",
    "limits.parallelism_limit",
    "limits.model_turn_timeout_ms",
    "conditions",
  ])("refuses a file without %s, naming it", (path) => {
    expect(() => readExperiment(withSet(path, undefined))).toThrow(`The experiment file lacks the field "${path}"`);
  });

  const text = "a text";
  const models = "a list of at least one model id";
  const atLeastOne = "a whole number of at least 1";
  const seed = "a whole number from 0 to 4294967295";
  const thinkingLevel = "one of off, minimal, low, medium, high, xhigh or max";
  it.each<[string, TomlValue, string]>([
    ["id", 3, text],
    ["scenario", ["slots"], text],
    ["models", "scripted/one", models],
    ["models", [], models],
    ["models", ["scripted/one", 3], models],
    ["thinking_level", "huge", thinkingLevel],
    ["thinking_level", 3, thinkingLevel],
    ["replicas", "2", atLeastOne],
    ["replicas", 0, atLeastOne],
    ["replicas", 1.5, atLeastOne],
    ["seed", "7", seed],
    ["seed", 4294967296, seed],
    ["seed", -1, seed],
    ["seed", 1.5, seed],
    ["limits", 3, "a table"],
    ["limits.time_limit_ms", 0, atLeastOne],
    ["limits.activations_per_agent", "3", atLeastOne],
    ["limits.parallelism_limit", 2.5, atLeastOne],
    ["limits.model_turn_timeout_ms", -500, atLeastOne],
    ["conditions", ["baseline"], "a table of named conditions"],
    ["conditions.baseline", 5, "a table"],
    ["metric_interval_ms", 0, atLeastOne],
    ["metric_interval_ms", "100", atLeastOne],
  ])("refuses %s set to %j, naming it and what was expected", (path, value, expected) => {
    expect(() => readExperiment(withSet(path, value))).toThrow(
      `The experiment file's field "${path}" must be ${expected}`,
    );
  });

  it.each(["replica", "limits.time_limit"])("refuses the key %s, which the schema does not know, naming it", (path) => {
    expect(() => readExperiment(withSet(path, 2))).toThrow(
      `The experiment file has the field "${path}", which the experiment schema does not know`,
    );
  });
});

/** The valid file with the value at a dotted path set, or left out when the value is undefined. */
function withSet(path: string, value: TomlValue | undefined): string {
  const file = parse(valid);
  const keys = path.split(".");
  const last = keys.pop() as string;
  const table = keys.reduce((inner, key) => inner[key] as TomlTable, file);
  if (value === undefined) delete table[last];
  else table[last] = value;
  return stringify(file);
}

describe("replicaSeed", () => {
  it("derives each replica's seed from the base seed and the replica: the same pair gives the same seed, another replica another", () => {
    const seeds = [1, 2, 3].map((replica) => replicaSeed(7, replica));

    expect(new Set(seeds).size).toBe(3);
    expect([1, 2, 3].map((replica) => replicaSeed(7, replica))).toEqual(seeds);
    expect(replicaSeed(8, 1)).not.toBe(seeds[0]);
    for (const seed of seeds) expect(Number.isInteger(seed) && seed >= 0 && seed <= 4294967295).toBe(true);
  });
});
