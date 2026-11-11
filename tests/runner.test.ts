import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Experiment, replicaSeed } from "../src/engine/experiment.ts";
import { runExperiment } from "../src/engine/runner.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { slotsScenario } from "./fixtures/slots.ts";

/** An experiment over the slots test scenario, whose one agent "a" makes one activation in each run. */
const experiment: Experiment = {
  id: "e-test",
  scenario: "slots",
  models: ["scripted/one", "scripted/two"],
  replicas: 2,
  seed: 7,
  limits: { timeLimitMs: 60_000, activationsPerAgent: 1, parallelismLimit: 10, modelTurnTimeoutMs: 10_000 },
  conditions: [
    { name: "baseline", change: "" },
    { name: "five-slots", change: "[slots]\ncount = 5\n" },
  ],
};

/** Each model of the experiment, by its name, in its order: a scripted model that ends every turn without a tool call. */
function scriptedModels(): Map<string, ScriptedModel> {
  const answers = () => Array.from({ length: 10 }, () => ({ text: "Nothing to do.", delayMs: 0 }));
  return new Map(experiment.models.map((name) => [name, new ScriptedModel(answers())]));
}

/** A new, empty directory for an experiment's runs. */
const newRunsDirectory = () => join(mkdtempSync(join(tmpdir(), "agents-lab-runs-")), "e-test");

/** The lines of the experiment's index, parsed. */
function indexOf(directory: string): Record<string, unknown>[] {
  return readFileSync(join(directory, "index.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

describe("runExperiment", () => {
  it("runs each condition with each model for each replica, in that order, and lists each run in the index as it completes", async () => {
    const directory = newRunsDirectory();
    const models = scriptedModels();

    await runExperiment(experiment, slotsScenario, models, directory);

    const index = indexOf(directory);
    expect(index.map(({ condition, model, replica, seed, status }) => ({ condition, model, replica, seed, status }))).toEqual(
      experiment.conditions.flatMap(({ name }) =>
        experiment.models.flatMap((model) =>
          [1, 2].map((replica) => ({ condition: name, model, replica, seed: replicaSeed(7, replica), status: "completed" })),
        ),
      ),
    );
    expect(readdirSync(directory).sort()).toEqual([...index.map(({ runId }) => `${String(runId)}.jsonl`), "index.jsonl"].sort());
    for (const model of models.values()) expect(model.received).toHaveLength(4);
  });

  it("refuses a condition the scenario's configuration refuses, naming it, before any run, even when it comes last", async () => {
    const directory = newRunsDirectory();
    const models = scriptedModels();
    const typo = { name: "typo", change: "[slots]\ncuont = 5\n" };

    const running = runExperiment({ ...experiment, conditions: [...experiment.conditions, typo] }, slotsScenario, models, directory);

    await expect(running).rejects.toThrow("slots.cuont");
    expect(existsSync(directory)).toBe(false);
    for (const model of models.values()) expect(model.received).toHaveLength(0);
  });

  it("stops at a run that stops on an error: its index line says it stopped, no run starts after it, and it fails naming the run", async () => {
    const directory = newRunsDirectory();
    const models = scriptedModels();
    // The second model's sessions cannot open, so the first run with it stops.
    const failing = {
      get model(): never {
        throw new Error("this model cannot be given to a session");
      },
    };

    const running = runExperiment(experiment, slotsScenario, new Map([...models].map(([name, model]) => [name, name === "scripted/two" ? failing : model])), directory);

    await expect(running).rejects.toThrow('the run of condition "baseline", model "scripted/two", replica 1 stopped');
    const index = indexOf(directory);
    expect(index.map(({ model, replica, status }) => ({ model, replica, status }))).toEqual([
      { model: "scripted/one", replica: 1, status: "completed" },
      { model: "scripted/one", replica: 2, status: "completed" },
      { model: "scripted/two", replica: 1, status: "stopped" },
    ]);
    expect(readdirSync(directory).sort()).toEqual([...index.map(({ runId }) => `${String(runId)}.jsonl`), "index.jsonl"].sort());
  });
});
