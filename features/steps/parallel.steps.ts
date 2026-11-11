import assert from "node:assert/strict";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import type { TomlTable } from "smol-toml";
import type { AgentModel } from "../../src/engine/adapter.ts";
import { waitAtLeast } from "../../src/engine/clock.ts";
import type { Context } from "../support/context.ts";
import { tableAt } from "./experiment.steps.ts";
import { experimentFileOf, idleModels, indexOf, logOf, runLab, runLogs, timesOf } from "./lab.steps.ts";
import { printedLines } from "./progress.steps.ts";

Given(
  "the scripted model {string}, whose agents wait {int} milliseconds and then end every turn without a tool call",
  function (this: Context, name: string, delayMs: number) {
    idleModels(this, [name], { delayMs });
  },
);

Given(
  "an experiment file {string} for the scenario {string}, with the model {string}, {int} replicas, the base seed {int}, {int} activation per agent, and the conditions {string}, with no change, and {string}, which sets {string} to {int}",
  function (
    this: Context,
    id: string,
    scenario: string,
    model: string,
    replicas: number,
    seed: number,
    activationsPerAgent: number,
    unchanged: string,
    changed: string,
    path: string,
    value: number,
  ) {
    const conditions = { [unchanged]: {}, [changed]: tableAt(path, value) };
    this.experimentFile = experimentFileOf({ id, scenario, models: [model], replicas, seed, activationsPerAgent, conditions });
  },
);

Given("progress is printed every {int} milliseconds", function (this: Context, intervalMs: number) {
  this.labOptions.push("--progress-interval-ms", String(intervalMs));
});

Given("the scripted model's agents wait {int} milliseconds before each turn", function (this: Context, delayMs: number) {
  assert.equal(this.labModels.size, 1, "the scenario set up another count of scripted models than one");
  idleModels(this, [...this.labModels.keys()], { delayMs });
});

/** The run whose session fails to open, as the scenario names it, and the error it fails with. */
const FAILING = { message: "this model cannot be given to a session" };

Given(
  "the scripted model's first session in {string} replica {int} fails to open",
  function (this: Context, condition: string, replica: number) {
    // Runs start in the experiment's order, and the first of them is the first to open a session: opening one reads
    // the model's provider, which this model cannot give the first time.
    const [first] = Object.keys(this.experimentFile.conditions as TomlTable);
    assert.ok(condition === first && replica === 1, `"${condition}" replica ${replica} is not the experiment's first run`);
    assert.equal(this.labModels.size, 1, "the scenario set up another count of scripted models than one");
    const [[name, scripted]] = [...this.labModels];
    let read = false;
    const failingOnce: AgentModel = {
      model: scripted.model,
      get provider() {
        if (!read) {
          read = true;
          throw new Error(FAILING.message);
        }
        return scripted.provider;
      },
    };
    this.labModels.set(name, failingOnce);
  },
);

When('"lab run" is interrupted {int} milliseconds after it starts', async function (this: Context, afterMs: number) {
  const running = runLab(this, "run");
  let ended = false;
  void running.finally(() => {
    ended = true;
  });
  try {
    await waitAtLeast(afterMs);
    assert.ok(!ended, `"lab run" ended before it was interrupted; it printed:\n${this.labOutput}`);
    this.labInterruption.abort();
  } finally {
    await running;
  }
  this.labRunning = running;
});

/** A run as "lab run" printed it: its number, and the lines that say it started and ended. */
interface Printed {
  number: number;
  total: number;
  started: number;
  ended: number;
  condition: string;
  replica: number;
}

/** Each run "lab run" said started, by its number, with where it said it started and ended. */
function printedRuns(lines: readonly string[]): Printed[] {
  const runs = new Map<number, Printed>();
  for (const [at, line] of lines.entries()) {
    const start = line.match(/^Run (\d+) of (\d+) started: condition "(.*)", model ".*", replica (\d+), seed \d+$/);
    if (start !== null) {
      const number = Number(start[1]);
      assert.ok(!runs.has(number), `run ${number} was said to start twice`);
      runs.set(number, { number, total: Number(start[2]), started: at, ended: Number.POSITIVE_INFINITY, condition: start[3], replica: Number(start[4]) });
    }
    const end = line.match(/^Run (\d+) of \d+ (?:completed|stopped) in /);
    if (end !== null) {
      const run = runs.get(Number(end[1]));
      assert.ok(run !== undefined, `run ${end[1]} was said to end before it started`);
      run.ended = at;
    }
  }
  return [...runs.values()];
}

/** The numbers of the runs "lab run" had said started and not yet ended when it printed line `at`. */
function inProgressAt(runs: readonly Printed[], at: number): number[] {
  return runs.filter((run) => run.started < at && at < run.ended).map((run) => run.number);
}

/** The most runs in progress at once by what "lab run" printed. */
function mostPrintedInProgress(context: Context): number {
  const runs = printedRuns(printedLines(context));
  return Math.max(0, ...runs.map((run) => inProgressAt(runs, run.started).length + 1));
}

/** Each run's span in time, from the first to the last time its log gives, by performance.now(). */
function spans(context: Context): { runId: string; fromMs: number; toMs: number }[] {
  return indexOf(context).map(({ runId }) => {
    const times = logOf(context, runId).flatMap(timesOf);
    assert.ok(times.length > 0, `run ${runId}'s log gives no time`);
    return { runId, fromMs: Math.min(...times), toMs: Math.max(...times) };
  });
}

/** The most runs whose logs' spans overlap at one moment. */
function mostOverlapping(context: Context): number {
  const all = spans(context);
  return Math.max(0, ...all.map((one) => all.filter((other) => other.fromMs <= one.fromMs && one.fromMs < other.toMs).length));
}

/** The experiment's runs once "lab run" completed: each listed as completed, each with its own log. */
function completedRuns(context: Context, count: number) {
  assert.equal(context.labError, undefined, `"lab run" failed: ${context.labError?.message}`);
  const index = indexOf(context);
  assert.equal(index.length, count, `the index lists ${index.length} runs`);
  for (const run of index) assert.equal(run.status, "completed", `run ${run.runId} is listed as ${run.status}`);
  return index;
}

Then("{int} runs ran and no two of them overlapped in time", function (this: Context, count: number) {
  completedRuns(this, count);
  assert.equal(mostOverlapping(this), 1, "the logs of two runs overlap in time");
  assert.equal(mostPrintedInProgress(this), 1, `two runs were said to be in progress at once:\n${this.labOutput}`);
});

Then("{int} runs ran, and at some moment {int} of them were in progress", function (this: Context, count: number, together: number) {
  completedRuns(this, count);
  assert.equal(mostOverlapping(this), together, `at most ${mostOverlapping(this)} runs' logs overlap in time`);
});

Then("never more than {int} were in progress", function (this: Context, most: number) {
  assert.ok(mostOverlapping(this) <= most, `${mostOverlapping(this)} runs' logs overlap in time`);
  assert.ok(mostPrintedInProgress(this) <= most, `${mostPrintedInProgress(this)} runs were said to be in progress at once:\n${this.labOutput}`);
});

Then(
  "they started in the order {string} replica {int}, {string} replica {int}, {string} replica {int}, {string} replica {int}",
  function (this: Context, c1: string, r1: number, c2: string, r2: number, c3: string, r3: number, c4: string, r4: number) {
    const started = printedRuns(printedLines(this)).sort((one, other) => one.started - other.started);
    assert.deepEqual(
      started.map(({ number, condition, replica }) => `${number}: ${condition} ${replica}`),
      [`1: ${c1} ${r1}`, `2: ${c2} ${r2}`, `3: ${c3} ${r3}`, `4: ${c4} ${r4}`],
    );
    // Each run's log is that of the run started with that condition and replica.
    for (const { runId, condition, replica } of indexOf(this)) {
      const [setup] = logOf(this, runId);
      assert.equal(setup.condition, condition);
      assert.equal(setup.replica, replica);
    }
  },
);

Then("each run has its own log, and {string} has one line per run", function (this: Context, path: string) {
  assert.equal(path, `runs/${String(this.experimentFile.id)}/index.jsonl`);
  const index = indexOf(this);
  const logs = runLogs(this);
  assert.equal(new Set(index.map((run) => run.runId)).size, index.length, "two lines of the index give the same run id");
  assert.equal(logs.length, index.length, `the runs directory holds ${logs.length} run logs for ${index.length} index lines`);
  for (const { runId } of index) assert.ok(logs.includes(`${runId}.jsonl`), `no log is named for run ${runId}`);
  const runs = new Set(index.map(({ condition, replica }) => `${condition} ${replica}`));
  assert.equal(runs.size, index.length, "two lines of the index give the same condition and replica");
});

Then("each run's setup line gives {string} as {int}", function (this: Context, field: string, value: number) {
  assert.equal(field, "parallel_runs");
  for (const { runId } of indexOf(this)) {
    const [setup] = logOf(this, runId);
    assert.equal(setup.type, "run_setup", `run ${runId}'s log starts with a "${setup.type}" line`);
    assert.equal(setup.parallelRuns, value, `run ${runId}'s setup line gives parallelRuns as ${String(setup.parallelRuns)}`);
  }
});

Then(
  'each replica has the same seed in every condition, and the seeds are those of the same file run without {string}',
  async function (this: Context, field: string) {
    assert.equal(field, "parallel_runs");
    const seedsOf = (index: ReturnType<typeof indexOf>) => new Map(index.map(({ condition, replica, seed }) => [`${condition} ${replica}`, seed]));
    const parallel = seedsOf(completedRuns(this, 4));
    for (const replica of [1, 2]) {
      const given = new Set([...parallel].filter(([run]) => run.endsWith(` ${replica}`)).map(([, seed]) => seed));
      assert.equal(given.size, 1, `replica ${replica} has the seeds ${[...given].join(", ")}`);
    }
    // The same file without parallel_runs, run from another directory.
    delete this.experimentFile.parallel_runs;
    const elsewhere = join(this.home, "without-parallel-runs");
    await runLab(this, "run", elsewhere);
    assert.equal(this.labError, undefined, `"lab run" without parallel_runs failed: ${this.labError?.message}`);
    assert.deepEqual(parallel, seedsOf(indexOf(this, elsewhere)));
  },
);

Then("a progress line printed while {int} runs were in progress gives both runs by their numbers", function (this: Context, together: number) {
  assert.equal(this.labError, undefined, `"lab run" failed: ${this.labError?.message}`);
  const lines = printedLines(this);
  const runs = printedRuns(lines);
  const progress = [...lines.entries()].filter(([at, line]) => / running: /.test(line) && inProgressAt(runs, at).length === together);
  assert.ok(progress.length > 0, `it printed no progress line while ${together} runs were in progress:\n${this.labOutput}`);
  const part = String.raw`Run (\d+) of 4 running: \d+(?:\.\d+)? s, \d+ of 2 activations, \d+ model turns?, cost \$\d+\.\d{4}`;
  for (const [at, line] of progress) {
    const match = line.match(new RegExp(`^${part}; ${part}$`));
    assert.ok(match !== null, `a progress line printed while ${together} runs were in progress does not give both: ${line}`);
    assert.deepEqual([Number(match[1]), Number(match[2])], inProgressAt(runs, at), `the progress line gives other runs than those in progress: ${line}`);
  }
});

/** The last line of a run's log, by its condition and replica, and its line in the index. */
function lastLineOf(context: Context, condition: string, replica: number) {
  const run = indexOf(context).find((line) => line.condition === condition && line.replica === replica);
  assert.ok(run !== undefined, `the index lists no run of "${condition}" replica ${replica}`);
  return { run, last: logOf(context, run.runId).at(-1) };
}

Then("the {int} runs in progress end as stopped, each log's last line saying it was interrupted", function (this: Context, count: number) {
  assert.ok(this.labError !== undefined, '"lab run" did not fail');
  const index = indexOf(this);
  assert.equal(index.length, count, `the index lists ${index.length} runs`);
  for (const { runId, status } of index) {
    assert.equal(status, "stopped", `run ${runId} is listed as ${status}`);
    const last = logOf(this, runId).at(-1);
    assert.equal(last?.type, "run_stopped", `run ${runId}'s log ends with: ${JSON.stringify(last)}`);
    assert.match(String(last.error), /interrupted/, `run ${runId}'s log ends with: ${JSON.stringify(last)}`);
  }
});

Then("no other run started", function (this: Context) {
  const index = indexOf(this);
  assert.equal(runLogs(this).length, index.length, "a run wrote a log the index does not list");
  const started = printedRuns(printedLines(this)).map((run) => run.number);
  assert.deepEqual(started.sort(), index.map((_, at) => at + 1), `it printed that other runs started:\n${this.labOutput}`);
});

Then("the experiment's total says {int} runs completed and {int} stopped", function (this: Context, completed: number, stopped: number) {
  const last = printedLines(this).at(-1) ?? "";
  assert.match(last, new RegExp(`^${completed} runs? completed and ${stopped} stopped in `), `the last line it printed is: ${last}`);
});

Then("{string} replica {int} stopped on its error", function (this: Context, condition: string, replica: number) {
  assert.ok(this.labError !== undefined, '"lab run" did not fail');
  assert.ok(this.labError.message.includes(FAILING.message), `"lab run" failed with another error: ${this.labError.message}`);
  const { run, last } = lastLineOf(this, condition, replica);
  assert.equal(run.status, "stopped");
  assert.equal(last?.type, "run_stopped", `its log ends with: ${JSON.stringify(last)}`);
  assert.ok(String(last.error).includes(FAILING.message), `its log ends with: ${JSON.stringify(last)}`);
});

Then("{string} replica {int} ended as stopped, saying the experiment stopped", function (this: Context, condition: string, replica: number) {
  const { run, last } = lastLineOf(this, condition, replica);
  assert.equal(run.status, "stopped");
  assert.equal(last?.type, "run_stopped", `its log ends with: ${JSON.stringify(last)}`);
  assert.match(String(last.error), /the experiment stopped/, `its log ends with: ${JSON.stringify(last)}`);
  assert.ok(!String(last.error).includes("interrupted"), `its log ends with: ${JSON.stringify(last)}`);
});
