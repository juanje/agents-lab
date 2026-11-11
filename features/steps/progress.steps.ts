import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then } from "@cucumber/cucumber";
import { Progress } from "../../src/cli/progress.ts";
import type { Context } from "../support/context.ts";
import { experimentFileOf, idleModels, indexOf, logOf, runLogs } from "./lab.steps.ts";

Given(
  "an experiment file {string} for the scenario {string}, with the model {string}, {int} replicas, the base seed {int}, {int} activation per agent, and the condition {string}, with no change",
  function (this: Context, id: string, scenario: string, model: string, replicas: number, seed: number, activationsPerAgent: number, condition: string) {
    this.experimentFile = experimentFileOf({ id, scenario, models: [model], replicas, seed, activationsPerAgent, conditions: { [condition]: {} } });
  },
);

Given("each scripted turn takes {int} milliseconds", function (this: Context, delayMs: number) {
  assert.ok(this.labModels.size > 0, "the scenario set up no scripted model");
  idleModels(this, [...this.labModels.keys()], { delayMs });
});

Given('"lab run" reports progress every {int} milliseconds', function (this: Context, intervalMs: number) {
  this.labOptions.push("--progress-interval-ms", String(intervalMs));
});

/** The lines "lab run" printed, in order, without empty ones. */
export function printedLines(context: Context): string[] {
  assert.ok(context.labOutput !== undefined, '"lab run" printed nothing');
  return context.labOutput.split("\n").filter((line) => line !== "");
}

/** The lines "lab run" printed once it completed. */
function completedLines(context: Context): string[] {
  assert.equal(context.labError, undefined, `"lab run" failed: ${context.labError?.message}`);
  return printedLines(context);
}

/** The model turns and the cost a run's log records. */
function recorded(context: Context, runId: string): { turns: number; cost: number; spanMs: number } {
  const log = logOf(context, runId);
  const turns = log.filter((line) => line.type === "model_turn");
  const times = log.flatMap((line) => ["wokeAtMs", "endedAtMs", "startedAtMs"].flatMap((field) => (typeof line[field] === "number" ? [line[field]] : [])));
  return {
    turns: turns.length,
    cost: turns.reduce((sum, turn) => sum + (turn.cost as { total: number }).total, 0),
    spanMs: times.length === 0 ? 0 : Math.max(...times) - Math.min(...times),
  };
}

/** A number as lab run prints it, in dollars or as a count. */
const NUMBER = String.raw`(\d+(?:\.\d+)?)`;

/** A duration as lab run prints it, in hours, minutes and seconds. */
const DURATION = String.raw`((?:\d+ h )?(?:\d+ min )?\d+(?:\.\d+)? s)`;

/** A printed duration in seconds. */
function secondsOf(duration: string): number {
  const match = duration.match(/^(?:(\d+) h )?(?:(\d+) min )?(\d+(?:\.\d+)?) s$/);
  assert.ok(match !== null, `"${duration}" is not a duration`);
  const [, hours = "0", minutes = "0", seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** How far a printed duration may be from the time it stands for: a tenth of a second under a minute, a second above. */
const rounding = (seconds: number) => (seconds < 60 ? 0.05 : 0.5);

/** Where a printed line is, failing when none matches. */
function lineAt(lines: readonly string[], pattern: RegExp, what: string): { at: number; match: RegExpMatchArray } {
  const at = lines.findIndex((line) => pattern.test(line));
  assert.ok(at >= 0, `it printed no line ${what}; it printed:\n${lines.join("\n")}`);
  return { at, match: lines[at].match(pattern) as RegExpMatchArray };
}

/** The lines printed while run `number` of `total` ran: those between its start and its end. */
function linesDuring(lines: readonly string[], number: number, total: number): string[] {
  const start = lineAt(lines, new RegExp(`^Run ${number} of ${total} started`), `starting run ${number}`).at;
  const end = lineAt(lines, new RegExp(`^Run ${number} of ${total} (completed|stopped)`), `ending run ${number}`).at;
  assert.ok(start < end, `run ${number} was said to end before it was said to start`);
  return lines.slice(start + 1, end);
}

Then(
  "it printed, before each run, a line with its number out of {int}, the condition {string}, the model {string}, its replica and its seed",
  function (this: Context, total: number, condition: string, model: string) {
    const lines = completedLines(this);
    const index = indexOf(this);
    assert.equal(index.length, total, `the index lists ${index.length} runs`);
    let previousEnd = -1;
    for (const [at, run] of index.entries()) {
      const number = at + 1;
      const quoted = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      const start = lineAt(
        lines,
        new RegExp(`^Run ${number} of ${total} started: condition "${quoted(condition)}", model "${quoted(model)}", replica ${run.replica}, seed ${run.seed}$`),
        `starting run ${number} with its condition, model, replica ${run.replica} and seed ${run.seed}`,
      ).at;
      assert.ok(start > previousEnd, `run ${number} was said to start before run ${number - 1} ended`);
      const end = lineAt(lines, new RegExp(`^Run ${number} of ${total} (completed|stopped)`), `ending run ${number}`).at;
      assert.ok(start < end, `run ${number} was said to start after it ended`);
      previousEnd = end;
    }
  },
);

Then(
  "it printed, after each run, a line saying it completed, with its duration, {int} activations, its model turns and its cost",
  function (this: Context, activations: number) {
    const lines = completedLines(this);
    const index = indexOf(this);
    for (const [at, { runId }] of index.entries()) {
      const number = at + 1;
      const { match } = lineAt(
        lines,
        new RegExp(`^Run ${number} of ${index.length} completed in ${DURATION}: ${NUMBER} activations?, ${NUMBER} model turns?, cost \\$${NUMBER}$`),
        `saying run ${number} completed, with its duration, activations, model turns and cost`,
      );
      const [, duration, ...counts] = match;
      const [done, turns, cost] = counts.map(Number);
      const seconds = secondsOf(duration);
      const log = recorded(this, runId);
      assert.equal(done, activations, `run ${number} was said to make ${done} activations`);
      assert.equal(turns, log.turns, `run ${number} was said to make ${turns} model turns; its log records ${log.turns}`);
      assert.equal(cost, Number(log.cost.toFixed(4)), `run ${number} was said to cost ${cost}; its log records ${log.cost}`);
      // Printed rounded, so at most by its rounding below what the log spans.
      assert.ok(seconds >= log.spanMs / 1000 - rounding(seconds), `run ${number} was said to last ${seconds} s; its log spans ${log.spanMs} ms`);
    }
  },
);

/**
 * Checks that the last line printed says how many runs completed and how many stopped, as the index lists them, with a
 * total cost that is what the runs' logs record and a total duration no shorter than the runs' own.
 */
function assertTotalLine(context: Context, lines: readonly string[], completed: number, stopped: number): void {
  const last = lines.at(-1) ?? "";
  const match = last.match(new RegExp(`^${completed} runs? completed and ${stopped} stopped in ${DURATION}, cost \\$${NUMBER}$`));
  assert.ok(match !== null, `the last line it printed is: ${last}`);
  const seconds = secondsOf(match[1]);
  const cost = Number(match[2]);
  const index = indexOf(context);
  assert.equal(index.filter((run) => run.status === "completed").length, completed, "the index lists another count of completed runs");
  assert.equal(index.filter((run) => run.status === "stopped").length, stopped, "the index lists another count of stopped runs");
  const totalCost = index.reduce((sum, { runId }) => sum + recorded(context, runId).cost, 0);
  assert.equal(cost, Number(totalCost.toFixed(4)), `the experiment was said to cost ${cost}; its logs record ${totalCost}`);
  const runSeconds = lines.flatMap((line) => {
    const run = line.match(new RegExp(`^Run \\d+ of \\d+ (?:completed|stopped) in ${DURATION}:`));
    return run === null ? [] : [secondsOf(run[1])];
  });
  assert.equal(runSeconds.length, completed + stopped, `it printed ${runSeconds.length} run ends`);
  const sum = runSeconds.reduce((total, one) => total + one, 0);
  // Each duration is printed rounded.
  assert.ok(seconds >= sum - [seconds, ...runSeconds].reduce((total, one) => total + rounding(one), 0), `the experiment was said to last ${seconds} s; its runs lasted ${sum} s`);
}

Then(
  "it printed, last, a line saying {int} runs completed, with the total duration and the total cost",
  function (this: Context, count: number) {
    assertTotalLine(this, completedLines(this), count, 0);
  },
);

Then(
  "it printed, last, a line saying {int} runs completed and {int} stopped, with the total duration and the total cost",
  function (this: Context, completed: number, stopped: number) {
    assert.ok(this.labError !== undefined, '"lab run" did not fail');
    assertTotalLine(this, printedLines(this), completed, stopped);
  },
);

Then("it printed, last, a line saying {int} runs completed and {int} stopped", function (this: Context, completed: number, stopped: number) {
  assert.ok(this.labError !== undefined, '"lab run" did not fail');
  assertTotalLine(this, printedLines(this), completed, stopped);
});

Then(
  "during each run it printed at least {int} progress lines, each with the time since the run started, the activations done out of {int}, the model turns and the cost so far",
  function (this: Context, least: number, budget: number) {
    const lines = completedLines(this);
    const index = indexOf(this);
    for (const [at, { runId }] of index.entries()) {
      const number = at + 1;
      const during = linesDuring(lines, number, index.length);
      const progress = new RegExp(`^Run ${number} of ${index.length} running: ${DURATION}, ${NUMBER} of ${budget} activations, ${NUMBER} model turns?, cost \\$${NUMBER}$`);
      assert.ok(during.length >= least, `it printed ${during.length} lines during run ${number}:\n${during.join("\n")}`);
      const log = recorded(this, runId);
      let lastSeconds = 0;
      for (const line of during) {
        const match = line.match(progress);
        assert.ok(match !== null, `a line printed during run ${number} is not a progress line: ${line}`);
        const [, duration, ...counts] = match;
        const [done, turns, cost] = counts.map(Number);
        const seconds = secondsOf(duration);
        assert.ok(seconds >= lastSeconds, `the time since run ${number} started went back: ${line}`);
        assert.ok(done <= budget && turns <= log.turns && cost <= log.cost + 0.00005, `a progress line of run ${number} says more than its log records: ${line}`);
        lastSeconds = seconds;
      }
      // The run's 300-millisecond turns leave the second report at least 0.2 s in.
      assert.ok(lastSeconds >= 0.15, `the last progress line of run ${number} was at ${lastSeconds} s`);
    }
  },
);

Then("it printed, after the first run, a line saying it stopped", function (this: Context) {
  assert.ok(this.labError !== undefined, '"lab run" did not fail');
  const lines = printedLines(this);
  const stopped = lineAt(lines, /^Run 1 of 2 stopped/, "saying run 1 stopped");
  const started = lineAt(lines, /^Run 1 of 2 started/, "starting run 1");
  assert.ok(started.at < stopped.at, "run 1 was said to stop before it started");
});

Then("no line of any run's log holds what lab run printed", function (this: Context) {
  const printed = completedLines(this);
  const logs = runLogs(this).map((file) => readFileSync(join(this.home, "runs", String(this.experimentFile.id), file), "utf8"));
  assert.ok(logs.length > 0, "no run wrote a log");
  for (const log of logs) {
    for (const line of log.split("\n")) {
      for (const text of printed) assert.ok(!line.includes(text), `a log line holds what lab run printed, "${text}": ${line}`);
    }
  }
});

Then("a duration of {int} milliseconds is printed as {string}", function (this: Context, ms: number, expected: string) {
  // A run that lasts that long, by a clock the step sets, as lab run prints its end.
  let nowMs = 0;
  let printed = "";
  const progress = new Progress((text) => (printed += text), { intervalMs: 30_000, now: () => nowMs });
  progress.runStarted({ number: 1, total: 1, condition: "baseline", model: "scripted/one", replica: 1, seed: 1, activations: 2 });
  nowMs = ms;
  progress.runEnded(1, "completed");
  const prefix = "Run 1 of 1 completed in ";
  const ended = printed.split("\n").find((line) => line.startsWith(prefix));
  assert.ok(ended !== undefined, `it printed no end of the run:\n${printed}`);
  assert.equal(ended.slice(prefix.length).split(":")[0], expected);
});
