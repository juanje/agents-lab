import { describe, expect, it } from "vitest";
import { type TomlTable, type TomlValue, parse, stringify } from "smol-toml";
import { type Experiment, readExperiment, replicaSeed } from "../src/engine/experiment.ts";

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

/** The valid file with factors in place of its conditions: "count", whose levels set slots.count, then "held". */
const withFactors = [
  ...valid.split("[conditions.baseline]")[0].split("\n"),
  "[factors.count.three]",
  "slots.count = 3",
  "[factors.count.five]",
  "slots.count = 5",
  "[factors.held.none]",
  "[factors.held.two]",
  "slots.held = 2",
  "",
].join("\n");

/** A condition as the tests compare it: its name, its change as a table, and its levels, when it has any. */
function described({ name, change, ...rest }: Experiment["conditions"][number]) {
  return { name, change: { ...parse(change) }, ...("levels" in rest ? { levels: rest.levels } : {}) };
}

describe("readExperiment with factors", () => {
  it.each<[string, TomlValue | undefined]>([
    ["without conditions or factors", undefined],
    ["whose conditions are none, without factors", {}],
  ])("refuses a file %s, naming both", (_, conditions) => {
    expect(() => readExperiment(withSet("conditions", conditions))).toThrow(
      'The experiment file gives no condition: it must give "conditions", "factors" or both',
    );
  });

  it("gives the file's own conditions no levels", () => {
    expect(readExperiment(valid).conditions.map(described)).toEqual([
      { name: "baseline", change: {} },
      { name: "five-slots", change: { slots: { count: 5 } } },
    ]);
  });

  it("gives the baseline, with no change and no levels, then each combination of levels, named after them, the first factor's changing slowest", () => {
    const { conditions } = readExperiment(withFactors);
    expect(conditions.map(described)).toEqual([
      { name: "baseline", change: {} },
      { name: "count=three,held=none", change: { slots: { count: 3 } }, levels: { count: "three", held: "none" } },
      { name: "count=three,held=two", change: { slots: { count: 3, held: 2 } }, levels: { count: "three", held: "two" } },
      { name: "count=five,held=none", change: { slots: { count: 5 } }, levels: { count: "five", held: "none" } },
      { name: "count=five,held=two", change: { slots: { count: 5, held: 2 } }, levels: { count: "five", held: "two" } },
    ]);
  });
  it("gives no baseline when the file turns it off", () => {
    expect(readExperiment(`baseline = false\n${withFactors}`).conditions.map(({ name }) => name)).toEqual([
      "count=three,held=none",
      "count=three,held=two",
      "count=five,held=none",
      "count=five,held=two",
    ]);
  });

  it("refuses a baseline that is neither true nor false, naming it", () => {
    expect(() => readExperiment(`baseline = "no"\n${withFactors}`)).toThrow('The experiment file\'s field "baseline" must be true or false');
  });

  it("gives the file's own conditions after the combinations, in its order", () => {
    const own = `${withFactors}[conditions.six-slots]\nslots.count = 6\n[conditions.one-held]\nslots.held = 1\n`;
    expect(readExperiment(own).conditions.map(({ name }) => name).slice(-3)).toEqual(["count=five,held=two", "six-slots", "one-held"]);
  });

  it.each(["baseline", "count=three,held=two"])("refuses a condition of the file's own named %s, a name already taken, naming it", (name) => {
    expect(() => readExperiment(`${withFactors}[conditions."${name}"]\n`)).toThrow(
      `The experiment file gives two conditions named "${name}"`,
    );
  });

  it("gives a condition of the file's own the name baseline when the file turns the baseline off", () => {
    const conditions = readExperiment(`baseline = false\n${withFactors}[conditions.baseline]\n`).conditions;
    expect(conditions.map(({ name }) => name).at(-1)).toBe("baseline");
  });

  it.each<[string, string, string]>([
    ["the same key", "slots.count = 2", "slots.count"],
    ["a key the other sets a key inside", "slots = 2", "slots"],
  ])("refuses two levels of one combination that set %s, naming both factors and the key", (_, setting, key) => {
    expect(() => readExperiment(`${withFactors}[factors.size.small]\n${setting}\n`)).toThrow(
      `The levels "three" of factor "count" and "small" of factor "size" both set ${key}, so the condition "count=three,held=none,size=small" cannot be formed`,
    );
  });

  it("refuses two levels that set the same key to a material, naming the key and not a key inside the material", () => {
    const material = (path: string) => `rhythm.text = { file = "${path}" }`;
    const file = `${withFactors}[factors.wake.morning]\n${material("a.md")}\n[factors.sleep.night]\n${material("b.md")}\n`;
    expect(() => readExperiment(file)).toThrow('"morning" of factor "wake" and "night" of factor "sleep" both set rhythm.text,');
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
