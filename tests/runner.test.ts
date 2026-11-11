import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Experiment, replicaSeed } from "../src/engine/experiment.ts";
import { inventory } from "../src/engine/inventory.ts";
import { type ExperimentObserver, runExperiment } from "../src/engine/runner.ts";
import { loadScenario } from "../src/engine/scenario.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { slotsScenario } from "./fixtures/slots.ts";

/** An experiment over the slots test scenario, whose one agent "a" makes one activation in each run. */
const experiment: Experiment = {
  id: "e-test",
  scenario: "slots",
  models: ["scripted/one", "scripted/two"],
  thinkingLevel: "off",
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

/**
 * A model whose sessions cannot open, so a run with it stops: it can use the thinking level "off", but opening a session
 * reads its provider, which fails.
 */
const unopenable = {
  model: {
    reasoning: false,
    get provider(): never {
      throw new Error("this model cannot be given to a session");
    },
  } as never,
};

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
      materials: [],
      levels: {},
      sampling: { thinkingLevels: { a: "off" }, otherParameters: "the provider's defaults" },
    });
    expect(seed).toBe(replicaSeed(7, 1));
  });

  it("gives the level of each factor of a run's condition in its setup line and its index line, and none for a condition without levels", async () => {
    const directory = newRunsDirectory();
    const models = new Map([["scripted/one", new ScriptedModel(Array.from({ length: 2 }, () => ({ text: "Nothing to do.", delayMs: 0 })))]]);
    const levels = { count: "five", held: "none" };
    const conditions = [{ name: "baseline", change: "" }, { ...experiment.conditions[1], name: "count=five,held=none", levels }];

    await runExperiment({ ...experiment, models: ["scripted/one"], replicas: 1, conditions }, slotsScenario, models, directory);

    const index = indexOf(directory);
    const setups = index.map(({ runId }) => JSON.parse(readFileSync(join(directory, `${String(runId)}.jsonl`), "utf8").split("\n")[0]));
    expect(index.map((line) => line.levels)).toEqual([{}, levels]);
    expect(setups.map((line) => line.levels)).toEqual([{}, levels]);
  });

  it("gives every session of every run the experiment's thinking level", async () => {
    const answers = () => Array.from({ length: 10 }, () => ({ text: "Nothing to do.", delayMs: 0 }));
    const models = new Map(experiment.models.map((name) => [name, new ScriptedModel(answers(), undefined, { reasoning: true })]));

    await runExperiment({ ...experiment, thinkingLevel: "high" }, slotsScenario, models, newRunsDirectory());

    for (const model of models.values()) expect(model.reasoningLevels).toEqual(["high", "high", "high", "high"]);
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

  it("refuses a thinking level one of its models cannot use, naming the model and the level, before any run, even when that model comes last", async () => {
    const directory = newRunsDirectory();
    const answers = () => Array.from({ length: 10 }, () => ({ text: "Nothing to do.", delayMs: 0 }));
    const models = new Map([
      ["scripted/one", new ScriptedModel(answers(), undefined, { reasoning: true })],
      ["scripted/two", new ScriptedModel(answers())],
    ]);

    const running = runExperiment({ ...experiment, thinkingLevel: "high" }, slotsScenario, models, directory);

    await expect(running).rejects.toThrow('The model "scripted/two" cannot use the thinking level "high"; it can use: off');
    expect(existsSync(directory)).toBe(false);
    for (const model of models.values()) expect(model.received).toHaveLength(0);
  });

  it("stops at a run that stops on an error: its index line says it stopped, no run starts after it, and it fails naming the run", async () => {
    const directory = newRunsDirectory();
    const models = scriptedModels();

    // The second model's sessions cannot open, so the first run with it stops.
    const running = runExperiment(experiment, slotsScenario, new Map([...models].map(([name, model]) => [name, name === "scripted/two" ? unopenable : model])), directory);

    await expect(running).rejects.toThrow('the run of condition "baseline", model "scripted/two", replica 1 stopped');
    const index = indexOf(directory);
    expect(index.map(({ model, replica, status }) => ({ model, replica, status }))).toEqual([
      { model: "scripted/one", replica: 1, status: "completed" },
      { model: "scripted/one", replica: 2, status: "completed" },
      { model: "scripted/two", replica: 1, status: "stopped" },
    ]);
    expect(readdirSync(directory).sort()).toEqual([...index.map(({ runId }) => `${String(runId)}.jsonl`), "index.jsonl"].sort());
  });

  it("tells its observer when each run starts, with its number out of all, what it runs and its activations, then each line its log records, then that it completed", async () => {
    const directory = newRunsDirectory();
    const events: unknown[] = [];
    const observer: ExperimentObserver = {
      runStarted: (started) => events.push({ started }),
      recorded: (line) => events.push({ line }),
      runEnded: (status) => events.push({ ended: status }),
    };

    await runExperiment(experiment, slotsScenario, scriptedModels(), directory, observer);

    const expected = indexOf(directory).flatMap(({ runId, condition, model, replica, seed }, at) => [
      // The slots test scenario's one agent, "a", makes one activation in each run.
      { started: { number: at + 1, total: 8, condition, model, replica, seed, activations: 1 } },
      ...logLinesOf(directory, String(runId)).map((line) => ({ line })),
      { ended: "completed" },
    ]);
    expect(events).toEqual(expected);
  });

  it("tells its observer that a run stopped, after each line its log records, and starts no run after it", async () => {
    const directory = newRunsDirectory();
    const events: unknown[] = [];
    const observer: ExperimentObserver = {
      runStarted: ({ number }) => events.push({ started: number }),
      recorded: ({ type }) => events.push({ line: type }),
      runEnded: (status) => events.push({ ended: status }),
    };

    const running = runExperiment({ ...experiment, models: ["scripted/one"] }, slotsScenario, new Map([["scripted/one", unopenable]]), directory, observer);

    await expect(running).rejects.toThrow("stopped");
    expect(events).toEqual([{ started: 1 }, { line: "run_setup" }, { line: "run_stopped" }, { ended: "stopped" }]);
  });

  it("stops the run in progress when it is interrupted: its index line says it stopped, no run starts after it, and it fails saying so", async () => {
    const directory = newRunsDirectory();
    const slow = new ScriptedModel(Array.from({ length: 10 }, () => ({ text: "Nothing to do.", delayMs: 500 })));
    const interruption = new AbortController();
    const observer: ExperimentObserver = {
      // Interrupted while the first run's first model turn is running.
      runStarted: () => setTimeout(() => interruption.abort(), 100),
      recorded: () => {},
      runEnded: () => {},
    };

    const running = runExperiment({ ...experiment, models: ["scripted/one"] }, slotsScenario, new Map([["scripted/one", slow]]), directory, observer, interruption.signal);

    await expect(running).rejects.toThrow("the run was interrupted");
    const index = indexOf(directory);
    expect(index.map(({ condition, replica, status }) => ({ condition, replica, status }))).toEqual([{ condition: "baseline", replica: 1, status: "stopped" }]);
    expect(readdirSync(directory).sort()).toEqual([`${String(index[0].runId)}.jsonl`, "index.jsonl"].sort());
  });

  it("starts no run once it is interrupted between runs, and fails saying so", async () => {
    const directory = newRunsDirectory();
    const interruption = new AbortController();
    const started: number[] = [];
    const observer: ExperimentObserver = {
      runStarted: ({ number }) => started.push(number),
      recorded: () => {},
      // Interrupted as the first run ends, before the next starts.
      runEnded: () => interruption.abort(),
    };

    const running = runExperiment(experiment, slotsScenario, scriptedModels(), directory, observer, interruption.signal);

    await expect(running).rejects.toThrow("interrupted");
    expect(started).toEqual([1]);
    expect(indexOf(directory).map(({ status }) => status)).toEqual(["completed"]);
  });
});

/** The lines of a run's log, parsed. */
function logLinesOf(directory: string, runId: string): unknown[] {
  return readFileSync(join(directory, `${runId}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}
