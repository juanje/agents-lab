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
  compaction: { enabled: false },
  replicas: 2,
  seed: 7,
  parallelRuns: 1,
  limits: { timeLimitMs: 60_000, activationsPerAgent: 1, parallelismLimit: 10, modelTurnTimeoutMs: 10_000 },
  rateLimit: { retries: 0, waitMs: 1000 },
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
  it("writes first in each run's log what it ran: its id, experiment, scenario, condition, resolved configuration, replica, seed, model, code and condition's inventory", async () => {
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
      scenario: "slots",
      condition: "five-slots",
      configuration: loadScenario(slotsScenario, replicaSeed(7, 1), experiment.conditions[1]).configuration,
      replica: 1,
      seed: replicaSeed(7, 1),
      model: "scripted/one",
      code: { commit: git("rev-parse", "HEAD").trim(), uncommittedChanges: git("status", "--porcelain").trim() !== "" },
      inventory: inventory(once, slotsScenario).conditions[0],
      materials: [],
      compaction: { enabled: false },
      parallelRuns: 1,
      sampling: { thinkingLevels: { a: "off" }, otherParameters: "the provider's defaults" },
    });
    expect(seed).toBe(replicaSeed(7, 1));
  });

  it("gives the experiment's compaction in each run's setup line", async () => {
    const directory = newRunsDirectory();
    const models = new Map([["scripted/one", new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }])]]);
    const compaction = { enabled: true, triggerAt: 0.5, keepRecentTokens: 500 } as const;

    await runExperiment({ ...experiment, models: ["scripted/one"], replicas: 1, conditions: [experiment.conditions[0]], compaction }, slotsScenario, models, directory);

    const [{ runId }] = indexOf(directory);
    expect(JSON.parse(readFileSync(join(directory, `${String(runId)}.jsonl`), "utf8").split("\n")[0]).compaction).toEqual(compaction);
  });

  it("gives the level of each factor of a run's condition in its setup line and its index line, and no levels for a condition that is not a combination", async () => {
    const directory = newRunsDirectory();
    const models = new Map([["scripted/one", new ScriptedModel(Array.from({ length: 2 }, () => ({ text: "Nothing to do.", delayMs: 0 })))]]);
    const levels = { count: "five", held: "none" };
    const conditions = [{ name: "baseline", change: "" }, { ...experiment.conditions[1], name: "count=five,held=none", levels }];

    await runExperiment({ ...experiment, models: ["scripted/one"], replicas: 1, conditions }, slotsScenario, models, directory);

    const index = indexOf(directory);
    const setups = index.map(({ runId }) => JSON.parse(readFileSync(join(directory, `${String(runId)}.jsonl`), "utf8").split("\n")[0]));
    expect(index.map((line) => Object.hasOwn(line, "levels"))).toEqual([false, true]);
    expect(setups.map((line) => Object.hasOwn(line, "levels"))).toEqual([false, true]);
    expect([index[1].levels, setups[1].levels]).toEqual([levels, levels]);
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
      recorded: (number, line) => events.push({ number, line }),
      runEnded: (number, status) => events.push({ number, ended: status }),
    };

    await runExperiment(experiment, slotsScenario, scriptedModels(), directory, observer);

    const expected = indexOf(directory).flatMap(({ runId, condition, model, replica, seed }, at) => [
      // The slots test scenario's one agent, "a", makes one activation in each run.
      { started: { number: at + 1, total: 8, condition, model, replica, seed, activations: 1 } },
      ...logLinesOf(directory, String(runId)).map((line) => ({ number: at + 1, line })),
      { number: at + 1, ended: "completed" },
    ]);
    expect(events).toEqual(expected);
  });

  it("tells its observer that a run stopped, after each line its log records, and starts no run after it", async () => {
    const directory = newRunsDirectory();
    const events: unknown[] = [];
    const observer: ExperimentObserver = {
      runStarted: ({ number }) => events.push({ started: number }),
      recorded: (_, { type }) => events.push({ line: type }),
      runEnded: (_, status) => events.push({ ended: status }),
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

  it("retries a rate-limit answer in every run as the experiment's limits say (FR-ADAPTER-02)", async () => {
    const directory = newRunsDirectory();
    const rateLimited = { error: "OpenAI API error (429): Rate limit reached for requests", delayMs: 0 };
    const models = new Map(experiment.models.map((name) => [name, new ScriptedModel([rateLimited, ...Array.from({ length: 10 }, () => ({ text: "Nothing to do.", delayMs: 0 }))])]));

    await runExperiment({ ...experiment, replicas: 1, conditions: experiment.conditions.slice(0, 1), rateLimit: { retries: 1, waitMs: 10 } }, slotsScenario, models, directory);

    const [first] = indexOf(directory);
    const lines = logLinesOf(directory, String(first.runId)) as { type: string }[];
    expect(lines.filter(({ type }) => type === "rate_limit_retry")).toEqual([{ type: "rate_limit_retry", agent: "a", attempt: 1, waitMs: 10, atMs: expect.any(Number) }]);
    expect(lines.filter(({ type }) => type === "model_turn")).toEqual([expect.objectContaining({ outcome: "success" })]);
  });

  it("gives parallel_runs in each run's setup line", async () => {
    const directory = newRunsDirectory();

    await runExperiment({ ...experiment, parallelRuns: 3 }, slotsScenario, scriptedModels(), directory);

    for (const { runId } of indexOf(directory)) expect(logLinesOf(directory, String(runId))[0]).toMatchObject({ type: "run_setup", parallelRuns: 3 });
  });

  it("gives the experiment file, as lab run was given it, in each run's setup line (FR-ANALYSIS-04's addition)", async () => {
    const directory = newRunsDirectory();

    await runExperiment({ ...experiment, replicas: 1, conditions: experiment.conditions.slice(0, 1), file: "experiments/E1/experiment.toml" }, slotsScenario, scriptedModels(), directory);

    const [first] = indexOf(directory);
    expect(logLinesOf(directory, String(first.runId))[0]).toMatchObject({ type: "run_setup", experimentFile: "experiments/E1/experiment.toml" });
  });
});

/** Each model of the experiment, by its name, in its order: a scripted model whose turns take this long and make no tool call. */
function slowModels(delayMs: number): Map<string, ScriptedModel> {
  return new Map(experiment.models.map((name) => [name, new ScriptedModel(Array.from({ length: 10 }, () => ({ text: "Nothing to do.", delayMs })))]));
}

/** An observer that keeps which runs started and ended, in order, and how many were in progress at most. */
function watching() {
  const events: string[] = [];
  const inProgress = new Set<number>();
  let most = 0;
  const observer: ExperimentObserver = {
    runStarted: ({ number }) => {
      events.push(`started ${number}`);
      inProgress.add(number);
      most = Math.max(most, inProgress.size);
    },
    recorded: (number) => expect(inProgress.has(number), `run ${number} recorded a line while not in progress`).toBe(true),
    runEnded: (number, status) => {
      events.push(`${status} ${number}`);
      inProgress.delete(number);
    },
  };
  return { observer, events, most: () => most };
}

describe("runExperiment, with runs in parallel", () => {
  it("keeps up to parallel_runs runs in progress at once, starting them in order, each next one as one ends", async () => {
    const directory = newRunsDirectory();
    const { observer, events, most } = watching();

    await runExperiment({ ...experiment, parallelRuns: 3 }, slotsScenario, slowModels(50), directory, observer);

    expect(events.filter((event) => event.startsWith("started"))).toEqual(Array.from({ length: 8 }, (_, at) => `started ${at + 1}`));
    expect(events.slice(0, 3)).toEqual(["started 1", "started 2", "started 3"]);
    // Each next run starts as soon as one ends.
    expect(events[3]).toMatch(/^completed \d$/);
    expect(events[4]).toBe("started 4");
    expect(most()).toBe(3);
    const index = indexOf(directory);
    expect(index).toHaveLength(8);
    expect(index.every(({ status }) => status === "completed")).toBe(true);
  });

  it("starts the runs replica by replica: every condition and model of replica 1, then of replica 2", async () => {
    const directory = newRunsDirectory();
    const started: string[] = [];
    const observer: ExperimentObserver = {
      runStarted: ({ number, condition, model, replica }) => started.push(`${number}: ${condition} ${model} ${replica}`),
      recorded: () => {},
      runEnded: () => {},
    };

    await runExperiment({ ...experiment, parallelRuns: 2 }, slotsScenario, scriptedModels(), directory, observer);

    expect(started).toEqual([
      "1: baseline scripted/one 1",
      "2: baseline scripted/two 1",
      "3: five-slots scripted/one 1",
      "4: five-slots scripted/two 1",
      "5: baseline scripted/one 2",
      "6: baseline scripted/two 2",
      "7: five-slots scripted/one 2",
      "8: five-slots scripted/two 2",
    ]);
  });

  it("gives each run its replica's seed, as one after another", async () => {
    const [one, other] = [newRunsDirectory(), newRunsDirectory()];

    await runExperiment(experiment, slotsScenario, scriptedModels(), one);
    await runExperiment({ ...experiment, parallelRuns: 8 }, slotsScenario, scriptedModels(), other);

    const seeds = (directory: string) => new Map(indexOf(directory).map(({ condition, model, replica, seed }) => [`${condition} ${model} ${replica}`, seed]));
    expect(seeds(other)).toEqual(seeds(one));
    for (const { replica, seed } of indexOf(other)) expect(seed).toBe(replicaSeed(7, replica as number));
  });

  it("stops the runs in progress when one stops on an error, each saying the experiment stopped, starts no other, and fails with that run's error", async () => {
    const directory = newRunsDirectory();
    const { observer, events } = watching();
    // The second run, "baseline" with "scripted/two", cannot open its sessions while the first one is running.
    const models = new Map<string, unknown>([...slowModels(500)].map(([name, model]) => [name, name === "scripted/two" ? unopenable : model]));

    const running = runExperiment({ ...experiment, parallelRuns: 2 }, slotsScenario, models as Map<string, ScriptedModel>, directory, observer);

    await expect(running).rejects.toThrow('the run of condition "baseline", model "scripted/two", replica 1 stopped');
    expect(events.filter((event) => event.startsWith("started"))).toEqual(["started 1", "started 2"]);
    expect(events.filter((event) => !event.startsWith("started")).sort()).toEqual(["stopped 1", "stopped 2"]);
    const index = indexOf(directory);
    expect(index.map(({ model, replica, status }) => `${model} ${replica} ${status}`).sort()).toEqual([
      "scripted/one 1 stopped",
      "scripted/two 1 stopped",
    ]);
    for (const { runId, model } of index) {
      const last = logLinesOf(directory, String(runId)).at(-1) as { type: string; error: string };
      expect(last.type).toBe("run_stopped");
      if (model === "scripted/two") expect(last.error).toContain("this model cannot be given to a session");
      else expect(last.error).toBe('the experiment stopped: the run of condition "baseline", model "scripted/two", replica 1 stopped');
    }
  });

  it("stops every run in progress when it is interrupted, each saying it was interrupted, and starts no other", async () => {
    const directory = newRunsDirectory();
    const { observer, events } = watching();
    const interruption = new AbortController();
    setTimeout(() => interruption.abort(), 200);

    const running = runExperiment({ ...experiment, parallelRuns: 2 }, slotsScenario, slowModels(1000), directory, observer, interruption.signal);

    await expect(running).rejects.toThrow("the run was interrupted");
    expect(events.filter((event) => event.startsWith("started"))).toEqual(["started 1", "started 2"]);
    const index = indexOf(directory);
    expect(index.map(({ status }) => status)).toEqual(["stopped", "stopped"]);
    for (const { runId } of index) expect(logLinesOf(directory, String(runId)).at(-1)).toEqual({ type: "run_stopped", error: "the run was interrupted" });
  });
});

/** The lines of a run's log, parsed. */
function logLinesOf(directory: string, runId: string): unknown[] {
  return readFileSync(join(directory, `${runId}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

/** Runs the experiment into the directory and interrupts it as its run of that number ends, so the runs up to it completed. */
async function interruptedAfter(runs: number, directory: string): Promise<void> {
  const interruption = new AbortController();
  const observer: ExperimentObserver = {
    runStarted: () => {},
    recorded: () => {},
    runEnded: (number) => {
      if (number === runs) interruption.abort();
    },
  };
  await expect(runExperiment(experiment, slotsScenario, scriptedModels(), directory, observer, interruption.signal)).rejects.toThrow("interrupted");
}

/** Each run the experiment makes, in its order, as "condition | model | replica". */
const everyRun = experiment.conditions.flatMap(({ name }) => experiment.models.flatMap((model) => [1, 2].map((replica) => `${name} | ${model} | ${replica}`)));

describe("runExperiment, resuming (FR-RUN-07)", () => {
  it("runs only the runs its index does not list as completed, each with its replica's seed, and adds their lines after those it found", async () => {
    const directory = newRunsDirectory();
    await interruptedAfter(3, directory);
    const before = indexOf(directory);

    await runExperiment(experiment, slotsScenario, scriptedModels(), directory, undefined, undefined, { resume: true });

    const index = indexOf(directory);
    expect(index.slice(0, 3)).toEqual(before);
    const added = index.slice(3);
    expect(added.map(({ condition, model, replica }) => `${String(condition)} | ${String(model)} | ${String(replica)}`)).toEqual(everyRun.slice(3));
    for (const { replica, seed, status } of added) expect({ seed, status }).toEqual({ seed: replicaSeed(7, Number(replica)), status: "completed" });
    expect(readdirSync(directory)).toHaveLength(everyRun.length + 1);
  });

  it("tells its observer, before the first run, how many runs are already completed and how many are left, and numbers each run out of all", async () => {
    const directory = newRunsDirectory();
    await interruptedAfter(3, directory);
    const events: unknown[] = [];
    const observer: ExperimentObserver = {
      resumed: (counts) => events.push({ resumed: counts }),
      runStarted: ({ number, total }) => events.push({ started: `${number} of ${total}` }),
      recorded: () => {},
      runEnded: () => {},
    };

    await runExperiment(experiment, slotsScenario, scriptedModels(), directory, observer, undefined, { resume: true });

    expect(events).toEqual([{ resumed: { completed: 3, left: 5 } }, ...[4, 5, 6, 7, 8].map((number) => ({ started: `${number} of 8` }))]);
  });

  it("runs the whole experiment when there is no runs directory yet", async () => {
    const directory = newRunsDirectory();

    await runExperiment(experiment, slotsScenario, scriptedModels(), directory, undefined, undefined, { resume: true });

    expect(indexOf(directory).map(({ condition, model, replica, status }) => `${String(condition)} | ${String(model)} | ${String(replica)} ${String(status)}`)).toEqual(
      everyRun.map((run) => `${run} completed`),
    );
  });

  it("runs nothing when every run is completed, and tells its observer so", async () => {
    const directory = newRunsDirectory();
    await runExperiment(experiment, slotsScenario, scriptedModels(), directory);
    const before = readFileSync(join(directory, "index.jsonl"), "utf8");
    const models = scriptedModels();
    const resumed: unknown[] = [];
    const observer: ExperimentObserver = { resumed: (counts) => resumed.push(counts), runStarted: () => {}, recorded: () => {}, runEnded: () => {} };

    await runExperiment(experiment, slotsScenario, models, directory, observer, undefined, { resume: true });

    expect(resumed).toEqual([{ completed: 8, left: 0 }]);
    expect(readFileSync(join(directory, "index.jsonl"), "utf8")).toBe(before);
    for (const model of models.values()) expect(model.received).toHaveLength(0);
  });

  it.each<[string, Partial<Experiment>, string[]]>([
    ["a condition's configuration", { conditions: [{ name: "baseline", change: "[slots]\ncount = 4\n" }, experiment.conditions[1]] }, ['"slots.count"', "3", "4"]],
    ["the base seed", { seed: 8 }, ["seed", String(replicaSeed(7, 1)), String(replicaSeed(8, 1))]],
    ["the thinking level", { thinkingLevel: "minimal" }, ["sampling", "minimal"]],
  ])("refuses, before any model call, when %s makes a completed run's setup differ, naming the run and what differs", async (_case, change, named) => {
    const directory = newRunsDirectory();
    await interruptedAfter(3, directory);
    const before = readFileSync(join(directory, "index.jsonl"), "utf8");
    const models = new Map([...scriptedModels()].map(([name]) => [name, new ScriptedModel([], undefined, { reasoning: true })]));

    const resuming = runExperiment({ ...experiment, ...change }, slotsScenario, models, directory, undefined, undefined, { resume: true });

    await expect(resuming).rejects.toThrow(/--resume/);
    const message = await resuming.catch((error: Error) => error.message);
    for (const name of [...named, '"baseline"', "replica 1"]) expect(message).toContain(name);
    expect(readFileSync(join(directory, "index.jsonl"), "utf8")).toBe(before);
    for (const model of models.values()) expect(model.received).toHaveLength(0);
  });
});
