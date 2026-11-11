import { describe, expect, it } from "vitest";
import { type TomlTable, type TomlValue, parse, stringify } from "smol-toml";
import { readExperiment } from "../src/engine/experiment.ts";

/** A valid experiment file, in TOML. */
const valid = [
  'id = "e-test"',
  'scenario = "slots"',
  'models = ["scripted/one", "scripted/two"]',
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
  it("gives the experiment's id, scenario, models, replicas, base seed and limits", () => {
    const experiment = readExperiment(valid);
    expect(experiment).toMatchObject({
      id: "e-test",
      scenario: "slots",
      models: ["scripted/one", "scripted/two"],
      replicas: 2,
      seed: 7,
      limits: { timeLimitMs: 1000, activationsPerAgent: 3, parallelismLimit: 2, modelTurnTimeoutMs: 500 },
    });
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
