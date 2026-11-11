import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Experiment, replicaSeed } from "../src/engine/experiment.ts";
import { inventory } from "../src/engine/inventory.ts";
import { runExperiment } from "../src/engine/runner.ts";
import { loadScenario } from "../src/engine/scenario.ts";
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

/** Runs git in this repository, the code that runs, and gives what it prints. */
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" });
}

describe("runExperiment", () => {
  it("writes first in each run's log what it ran: its id, experiment, condition, resolved configuration, replica, seed, model, code and condition's inventory", async () => {
    const directory = newRunsDirectory();
    const models = new Map([["scripted/one", new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }])]]);
    const once = { ...experiment, models: ["scripted/one"], replicas: 1, conditions: [experiment.conditions[1]] };

    await runExperiment(once, slotsScenario, models, directory);

    const [{ runId, seed }] = indexOf(directory);
    const [first] = readFileSync(join(directory, `${String(runId)}.jsonl`), "utf8").split("\n").map((line) => (line === "" ? undefined : JSON.parse(line)));
    expect(first).toEqual({
      type: "run_setup",
      runId,
      experiment: "e-test",
      condition: "five-slots",
      configuration: loadScenario(slotsScenario, replicaSeed(7, 1), experiment.conditions[1]).configuration,
      replica: 1,
      seed: replicaSeed(7, 1),
      model: "scripted/one",
      code: { commit: git("rev-parse", "HEAD").trim(), uncommittedChanges: git("status", "--porcelain").trim() !== "" },
      inventory: inventory(once, slotsScenario).conditions[0],
      sampling: { thinkingLevels: { a: "off" }, otherParameters: "the provider's defaults" },
    });
    expect(seed).toBe(replicaSeed(7, 1));
  });

  it("samples each run's metrics at the experiment's interval", async () => {
    const directory = newRunsDirectory();
    const models = new Map([["scripted/one", new ScriptedModel([{ text: "Waiting.", delayMs: 250 }])]]);
    const once = { ...experiment, models: ["scripted/one"], replicas: 1, conditions: [{ name: "baseline", change: "" }], metricIntervalMs: 50 };

    await runExperiment(once, slotsScenario, models, directory);

    const [{ runId }] = indexOf(directory);
    const samples = readFileSync(join(directory, `${String(runId)}.jsonl`), "utf8")
      .split("\n")
      .filter((line) => line !== "" && JSON.parse(line).type === "metric_sample");
    expect(samples.length).toBeGreaterThanOrEqual(5);
  });

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
