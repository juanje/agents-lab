import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import type { TomlTable } from "smol-toml";
import { waitAtLeast } from "../../src/engine/clock.ts";
import { replicaSeed } from "../../src/engine/experiment.ts";
import type { Context } from "../support/context.ts";
import { tableAt } from "./experiment.steps.ts";
import { completedIndex, failedNaming, idleModels, indexOf, logOf, runLab, runLogs } from "./lab.steps.ts";
import { printedLines } from "./progress.steps.ts";

/** How often the step looks at what "lab run" printed while it waits for a run to start. */
const LOOK_EVERY_MS = 5;

/** The experiment's runs directory, under the home "lab run" ran in. */
function runsDirectory(context: Context): string {
  return join(context.home, "runs", String(context.experimentFile.id));
}

/**
 * Keeps what "lab run" left in the runs directory, then sets up the next "lab": scripted models no session has called,
 * an interruption not yet given, and no error.
 */
function keepRunsBefore(context: Context): void {
  const index = indexOf(context);
  const logs = new Map(runLogs(context).map((file) => [file.replace(/\.jsonl$/, ""), readFileSync(join(runsDirectory(context), file), "utf8")]));
  context.runsBefore = { index, logs };
  idleModels(context, [...context.labModels.keys()]);
  context.labInterruption = new AbortController();
  context.labError = undefined;
}

/** Runs "lab run" and interrupts it as soon as it says its third run started, so its first 2 runs completed. */
async function interruptedInThirdRun(context: Context): Promise<void> {
  const running = runLab(context, "run");
  let ended = false;
  void running.finally(() => {
    ended = true;
  });
  try {
    while (!/^Run 3 of \d+ started/m.test(context.labOutput ?? "")) {
      assert.ok(!ended, `"lab run" ended before its third run started; it printed:\n${context.labOutput}`);
      await waitAtLeast(LOOK_EVERY_MS);
    }
    context.labInterruption.abort();
  } finally {
    await running;
  }
  keepRunsBefore(context);
  const statuses = context.runsBefore?.index.map((line) => line.status);
  assert.deepEqual(statuses, ["completed", "completed", "stopped"], `the interrupted "lab run" left the index with the runs ${statuses?.join(", ")}`);
}

Given(
  '"lab run" ran the experiment file and was interrupted after its first 2 runs completed and while its third was in progress',
  async function (this: Context) {
    await interruptedInThirdRun(this);
  },
);

Given('"lab run" ran the experiment file and was interrupted after its first 2 runs completed', async function (this: Context) {
  await interruptedInThirdRun(this);
});

Given('"lab run" ran the experiment file to the end', async function (this: Context) {
  await runLab(this, "run");
  assert.equal(this.labError, undefined, `"lab run" failed: ${this.labError?.message}`);
  keepRunsBefore(this);
});

Given("the condition {string} now sets {string} to {int}", function (this: Context, condition: string, path: string, value: number) {
  const conditions = this.experimentFile.conditions as TomlTable;
  assert.ok(Object.hasOwn(conditions, condition), `the experiment file has no condition "${condition}"`);
  this.experimentFile.conditions = { ...conditions, [condition]: tableAt(path, value) };
});

Given("the file's base seed is now {int}", function (this: Context, seed: number) {
  assert.notEqual(this.experimentFile.seed, seed, `the file's base seed is already ${seed}`);
  this.experimentFile.seed = seed;
});

/** A commit no code here has: as many hexadecimal digits as git's, all zero. */
const OTHER_COMMIT = "0".repeat(40);

Given("the code's commit differs from the one the runs recorded", function (this: Context) {
  // The code cannot change commit while the scenario runs, so the runs' setup lines record another one, as runs made
  // by an earlier commit would.
  for (const { runId, status } of this.runsBefore?.index ?? []) {
    if (status !== "completed") continue;
    const [setup, ...rest] = logOf(this, runId);
    const code = setup.code as { commit: string };
    assert.notEqual(code.commit, OTHER_COMMIT);
    const lines = [{ ...setup, code: { ...code, commit: OTHER_COMMIT } }, ...rest];
    writeFileSync(join(runsDirectory(this), `${runId}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  }
});

When('"lab run --resume" runs the experiment file', async function (this: Context) {
  this.labOptions.push("--resume");
  await runLab(this, "run");
});

/** The lines the resumed "lab run" added to the index, after those it found there. */
function addedLines(context: Context) {
  return completedIndex(context).slice(context.runsBefore?.index.length ?? 0);
}

Then(
  "it ran {int} runs: {string} replica {int} and {string} replica {int}",
  function (this: Context, count: number, first: string, firstReplica: number, second: string, secondReplica: number) {
    const added = addedLines(this);
    assert.deepEqual(added.map((line) => `${line.condition} replica ${line.replica} ${line.status}`), [`${first} replica ${firstReplica} completed`, `${second} replica ${secondReplica} completed`]);
    assert.equal(added.length, count);
    const before = this.runsBefore?.logs ?? new Map<string, string>();
    for (const { runId } of added) assert.ok(!before.has(runId), `run ${runId} was already in the runs directory`);
    assert.equal(runLogs(this).length, before.size + count, `the runs directory holds ${runLogs(this).length} run logs, ${before.size} before`);
  },
);

Then("each had the seed its replica has in {string}", function (this: Context, condition: string) {
  const index = completedIndex(this);
  for (const { runId, replica, seed } of addedLines(this)) {
    const there = index.find((line) => line.condition === condition && line.replica === replica);
    assert.ok(there !== undefined, `the index lists no run of "${condition}" replica ${replica}`);
    assert.equal(seed, there.seed, `run ${runId} of replica ${replica} has the seed ${seed}, and "${condition}" ${there.seed}`);
    assert.equal(logOf(this, runId)[0].seed, seed, `run ${runId}'s setup line gives another seed than its index line`);
  }
});

Then("the first {int} runs' logs are unchanged", function (this: Context, count: number) {
  const first = (this.runsBefore?.index ?? []).slice(0, count);
  assert.equal(first.length, count);
  for (const { runId } of first) {
    assert.equal(readFileSync(join(runsDirectory(this), `${runId}.jsonl`), "utf8"), this.runsBefore?.logs.get(runId), `run ${runId}'s log changed`);
  }
});

Then(
  "{string} lists {int} completed runs, one for each condition and replica, and the interrupted run as stopped",
  function (this: Context, path: string, count: number) {
    assert.equal(path, `runs/${String(this.experimentFile.id)}/index.jsonl`);
    const index = completedIndex(this);
    const completed = index.filter((line) => line.status === "completed").map((line) => `${line.condition} replica ${line.replica}`);
    const expected = Object.keys(this.experimentFile.conditions as TomlTable).flatMap((condition) =>
      Array.from({ length: this.experimentFile.replicas as number }, (_, at) => `${condition} replica ${at + 1}`),
    );
    assert.equal(completed.length, count, `the index lists ${completed.length} completed runs`);
    assert.deepEqual(completed.sort(), expected.sort());
    const stoppedBefore = this.runsBefore?.index.filter((line) => line.status === "stopped");
    assert.deepEqual(index.filter((line) => line.status === "stopped"), stoppedBefore);
  },
);

/** Where "lab run" printed how many runs were already completed and how many were left, and the counts it printed. */
function resumeLine(context: Context): { at: number; completed: number; left: number } {
  const lines = printedLines(context);
  const at = lines.findIndex((line) => /\b\d+ runs? already completed, \d+ left\b/.test(line));
  assert.ok(at >= 0, `it did not print how many runs were already completed and left:\n${context.labOutput}`);
  const [, completed, left] = lines[at].match(/\b(\d+) runs? already completed, (\d+) left\b/) ?? [];
  return { at, completed: Number(completed), left: Number(left) };
}

Then(
  "before the first run it printed that {int} runs were already completed and {int} were left",
  function (this: Context, completed: number, left: number) {
    const printed = resumeLine(this);
    assert.deepEqual({ completed: printed.completed, left: printed.left }, { completed, left });
    const firstRun = printedLines(this).findIndex((line) => /^Run \d+ of \d+ started/.test(line));
    assert.ok(firstRun > printed.at, `it printed the counts after the first run started:\n${this.labOutput}`);
  },
);

Then("it printed that {int} runs were already completed and {int} were left", function (this: Context, completed: number, left: number) {
  assert.equal(this.labError, undefined, `"lab run" failed: ${this.labError?.message}`);
  const printed = resumeLine(this);
  assert.deepEqual({ completed: printed.completed, left: printed.left }, { completed, left });
});

Then("{int} runs ran", function (this: Context, count: number) {
  const index = completedIndex(this);
  assert.deepEqual(index.map((line) => line.status), Array.from({ length: count }, () => "completed"));
  assert.equal(runLogs(this).length, count, `the runs directory holds ${runLogs(this).length} run logs`);
});

/** The first run the earlier "lab run" completed, as its index listed it. */
function firstCompleted(context: Context) {
  const first = context.runsBefore?.index.find((line) => line.status === "completed");
  assert.ok(first !== undefined, 'the earlier "lab run" completed no run');
  return first;
}

Then("it fails with an error that names the seed", function (this: Context) {
  const { replica, seed } = firstCompleted(this);
  failedNaming(this, ["seed", String(seed), String(replicaSeed(this.experimentFile.seed as number, replica))]);
});

Then("it fails with an error that names the commit", function (this: Context) {
  failedNaming(this, ["commit", OTHER_COMMIT]);
});
