import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type DataTable, Given, Then, When } from "@cucumber/cucumber";
import { lab } from "../../src/cli/lab.ts";
import { scenarioLibrary } from "../../src/scenarios/library.ts";
import type { Context } from "../support/context.ts";

/** What "lab summarize" gave: what it printed, and the error it failed with, if it failed. */
interface Summarized {
  output: string;
  error?: Error;
}

/** A row of the summary, as the steps compare them, whichever form it was printed in. */
interface Row {
  condition: string;
  model: string;
  metric: string;
  key: string;
  completed: number;
  stopped: number;
  values: number[];
  replicas: number[];
  nulls: number;
  quartiles: (number | null)[];
}

/** A metric's value as a cell of the background's table gives it: a number, null, or values by agent ("a: 1, b: 2"). */
function valueOf(cell: string): number | null | Record<string, number> {
  if (cell === "null") return null;
  if (cell.includes(":")) {
    return Object.fromEntries(
      cell.split(",").map((pair) => {
        const [key, value] = pair.split(":").map((part) => part.trim());
        return [key, Number(value)];
      }),
    );
  }
  return Number(cell);
}

Given("a runs directory {string} whose index lists these runs, each with its log:", function (this: Context, directory: string, table: DataTable) {
  const runs = join(this.home, directory);
  mkdirSync(runs, { recursive: true });
  const index: string[] = [];
  for (const [at, row] of table.hashes().entries()) {
    const runId = `run-${at + 1}`;
    const replica = Number(row.replica);
    index.push(JSON.stringify({ runId, condition: row.condition, model: row.model, replica, seed: replica, status: row.status }));
    // Every run samples its metrics as it starts; only the last sample of a completed run gives its values.
    const lines: object[] = [{ type: "metric_sample", atMs: 0, version: 0, metrics: { held: 0, "slot of": { a: 9 } } }];
    const held = row['last sample of "held"'];
    const slotOf = row['last sample of "slot of"'];
    if (held !== "" || slotOf !== "") {
      lines.push({ type: "metric_sample", atMs: 100, version: 3, metrics: { held: valueOf(held), "slot of": valueOf(slotOf) } });
    }
    if (row.status === "stopped") lines.push({ type: "run_stopped", error: "a tool threw an error" });
    writeFileSync(join(runs, `${runId}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  }
  writeFileSync(join(runs, "index.jsonl"), index.map((line) => `${line}\n`).join(""));
});

/**
 * Runs "lab" with a command line, as the person types it, from the scenario's home, with the scenario's library, the
 * whole library unless it gives one, and its models by name.
 */
export async function runCommand(context: Context, command: string): Promise<Summarized> {
  const [program, ...args] = command.split(" ");
  assert.equal(program, "lab");
  const done: Summarized = { output: "" };
  try {
    await lab(args, {
      directory: context.home,
      print: (text) => {
        done.output += text;
      },
      scenarios: context.library ?? scenarioLibrary,
      model: async (name) => {
        const found = context.labModels.get(name);
        if (found === undefined) throw new Error(`No model is named "${name}"`);
        return found;
      },
    });
  } catch (error) {
    done.error = error as Error;
  }
  return done;
}

// What it printed and the error it failed with are kept where the other "lab" steps keep them.
When("{string} runs", async function (this: Context, command: string) {
  const { output, error } = await runCommand(this, command);
  this.labOutput = output;
  this.labError = error;
});

/** What "lab summarize" printed, once it did not fail. */
function printed(context: Context): string {
  assert.equal(context.labError, undefined, `"lab summarize" failed: ${context.labError?.message}`);
  assert.ok(context.labOutput !== undefined, '"lab summarize" did not run');
  return context.labOutput;
}

/** A list of numbers in a cell, "1, 3, 2"; an empty cell is none. */
function numbersOf(cell: string): number[] {
  return cell.trim() === "" ? [] : cell.split(",").map((part) => Number(part.trim()));
}

/** A quartile in a Markdown cell: a number, or "-" when there are no values. */
function quartileOf(cell: string): number | null {
  return cell === "-" ? null : Number(cell);
}

/** The headers of the Markdown summary's table, in order. */
const HEADERS = ["Condition", "Model", "Metric", "Key", "Completed", "Stopped", "Values", "Replicas", "Nulls", "Minimum", "Lower quartile", "Median", "Upper quartile", "Maximum"];

/** The rows of the Markdown table "lab summarize" printed. */
function markdownRows(output: string): Row[] {
  const lines = output.split("\n").filter((line) => line.startsWith("|"));
  assert.ok(lines.length >= 2, `"lab summarize" printed no Markdown table:\n${output}`);
  const cellsOf = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim());
  assert.deepEqual(cellsOf(lines[0]), HEADERS, "the table has other columns");
  return lines.slice(2).map((line) => {
    const cells = cellsOf(line);
    return {
      condition: cells[0],
      model: cells[1],
      metric: cells[2],
      key: cells[3],
      completed: Number(cells[4]),
      stopped: Number(cells[5]),
      values: numbersOf(cells[6]),
      replicas: numbersOf(cells[7]),
      nulls: Number(cells[8]),
      quartiles: cells.slice(9).map(quartileOf),
    };
  });
}

/** The row of a condition, model, metric and key, which the summary must give once. */
function rowOf(rows: readonly Row[], condition: string, model: string, metric: string, key = ""): Row {
  const found = rows.filter((row) => row.condition === condition && row.model === model && row.metric === metric && row.key === key);
  assert.equal(found.length, 1, `the summary gives ${found.length} rows for "${condition}", "${model}", "${metric}"${key === "" ? "" : ` and "${key}"`}`);
  return found[0];
}

Then(
  /^it prints the row for "([^"]*)", "([^"]*)" and "([^"]*)" with (\d+) completed and (\d+) stopped, the values ([\d., ]+) in replica order, and the minimum ([\d.]+), lower quartile ([\d.]+), median ([\d.]+), upper quartile ([\d.]+) and maximum ([\d.]+)$/,
  function (
    this: Context,
    condition: string,
    model: string,
    metric: string,
    completed: string,
    stopped: string,
    values: string,
    minimum: string,
    lowerQuartile: string,
    median: string,
    upperQuartile: string,
    maximum: string,
  ) {
    const row = rowOf(markdownRows(printed(this)), condition, model, metric);
    assert.equal(row.completed, Number(completed), "another count of completed runs");
    assert.equal(row.stopped, Number(stopped), "another count of stopped runs");
    assert.deepEqual(row.values, numbersOf(values), "other values");
    assert.deepEqual(row.replicas, [...row.replicas].sort((one, other) => one - other), "the values are not in replica order");
    assert.equal(row.nulls, 0, "it counts nulls");
    assert.deepEqual(row.quartiles, [minimum, lowerQuartile, median, upperQuartile, maximum].map(Number), "other quartiles");
  },
);

Then(
  /^it prints the row for "([^"]*)", "([^"]*)" and "([^"]*)" with (\d+) completed, the value ([\d.]+) and (\d+) null$/,
  function (this: Context, condition: string, model: string, metric: string, completed: string, value: string, nulls: string) {
    const row = rowOf(markdownRows(printed(this)), condition, model, metric);
    assert.equal(row.completed, Number(completed), "another count of completed runs");
    assert.equal(row.stopped, 0, "it counts a stopped run");
    assert.deepEqual(row.values, [Number(value)], "other values");
    assert.equal(row.nulls, Number(nulls), "another count of nulls");
  },
);

/** The row the scenario checked last, for a step that names only another agent. */
const lastRow = new WeakMap<Context, { condition: string; model: string; metric: string }>();

Then(
  /^it prints a row for "([^"]*)", "([^"]*)", "([^"]*)" and agent "([^"]*)" with the values ([\d., ]+)$/,
  function (this: Context, condition: string, model: string, metric: string, agent: string, values: string) {
    const row = rowOf(markdownRows(printed(this)), condition, model, metric, agent);
    assert.deepEqual(row.values, numbersOf(values), "other values");
    lastRow.set(this, { condition, model, metric });
  },
);

Then(/^a row for agent "([^"]*)" with the values ([\d., ]+), from replicas (\d+) and (\d+)$/, function (this: Context, agent: string, values: string, first: string, second: string) {
  const last = lastRow.get(this);
  assert.ok(last !== undefined, "no row was checked before");
  const row = rowOf(markdownRows(printed(this)), last.condition, last.model, last.metric, agent);
  assert.deepEqual(row.values, numbersOf(values), "other values");
  assert.deepEqual(row.replicas, [Number(first), Number(second)], "the values come from other replicas");
});

/** A row of the JSON summary, as "lab summarize --json" writes it. */
interface JsonRow {
  condition: string;
  model: string;
  metric: string;
  key?: string;
  completed: number;
  stopped: number;
  values: number[];
  replicas: number[];
  nulls: number;
  minimum: number | null;
  lowerQuartile: number | null;
  median: number | null;
  upperQuartile: number | null;
  maximum: number | null;
}

Then("it prints JSON with the same rows, counts, values and quartiles", async function (this: Context) {
  const json = JSON.parse(printed(this)) as JsonRow[];
  assert.ok(Array.isArray(json), "the JSON is not a list of rows");
  const fromJson: Row[] = json.map((row) => ({
    condition: row.condition,
    model: row.model,
    metric: row.metric,
    key: row.key ?? "",
    completed: row.completed,
    stopped: row.stopped,
    values: row.values,
    replicas: row.replicas,
    nulls: row.nulls,
    quartiles: [row.minimum, row.lowerQuartile, row.median, row.upperQuartile, row.maximum],
  }));
  // The same summary, as Markdown, from the same runs directory.
  const command = "lab summarize runs/e-test";
  const markdown = await runCommand(this, command);
  assert.equal(markdown.error, undefined, `"${command}" failed: ${markdown.error?.message}`);
  const fromMarkdown = markdownRows(markdown.output);
  assert.ok(fromMarkdown.length > 0, "the Markdown summary gives no rows");
  assert.deepEqual(fromJson, fromMarkdown);
});
