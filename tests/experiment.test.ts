import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";
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
});
