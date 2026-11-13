import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import type { Context } from "../support/context.ts";
import { runCommand } from "./summarize.steps.ts";

/** A run of the Background: its condition and replica, whether it completed, and its part lines. */
interface Run {
  condition: string;
  replica: number;
  status: "completed" | "stopped";
  parts: Record<string, unknown>[];
}

/** The runs a scenario writes, by the scenario. */
const written = new WeakMap<Context, Run[]>();

/** A part line as the engine writes it (FR-PARTS-01). */
function part(id: string, kind: string | undefined, held: boolean, reachedAt?: string, calls = 0, misapplications: unknown[] = []): Record<string, unknown> {
  return {
    type: "part",
    part: id,
    evaluated_at: "day 26 06:30",
    active: true,
    held,
    ...(reachedAt === undefined ? {} : { reached_at: reachedAt }),
    effort: { calls, money: 0 },
    misapplications,
    ...(kind === undefined ? {} : { kind }),
  };
}

Given(
  'an experiment\'s runs directory with two conditions, "rules" and "character", one model and two replicas each, all completed',
  function (this: Context) {
    written.set(
      this,
      ["rules", "character"].flatMap((condition) => [1, 2].map((replica) => ({ condition, replica, status: "completed" as const, parts: [] }))),
    );
  },
);

Given(
  /^each run's log has "part" lines for "p1" \(kinds: "rules" covered, "character" new\) and "p2" \(kinds: "rules" changed, "character" variant\), and for the outcome "w1"$/,
  function (this: Context) {
    // The kinds are on the part lines the next steps write.
  },
);

/** The run of a condition and replica. */
const runOf = (context: Context, condition: string, replica: number) => (written.get(context) ?? []).find((run) => run.condition === condition && run.replica === replica) as Run;

Given(
  'in "rules", "p1" held in both runs, reached at "day 3 10:00" and "day 5 10:00", with efforts 4 and 6 calls and 0 money; "p2" held in neither, with one misapplication in replica 2',
  function (this: Context) {
    runOf(this, "rules", 1).parts.push(part("p1", "covered", true, "day 3 10:00", 4), part("p2", "changed", false), { ...part("w1", undefined, true), values: { balance: 120, overruns: 0 } });
    runOf(this, "rules", 2).parts.push(part("p1", "covered", true, "day 5 10:00", 6), part("p2", "changed", false, undefined, 0, [{ tool: "publish_programme", arguments: {}, at: "day 12 10:00" }]), { ...part("w1", undefined, false), values: { balance: -40, overruns: 1 } });
  },
);

Given('in "character", "p1" held in replica 1 only, reached at "day 7 10:00" with effort 9; "p2" held in both', function (this: Context) {
  runOf(this, "character", 1).parts.push(part("p1", "new", true, "day 7 10:00", 9), part("p2", "variant", true, "day 9 10:00", 3), { ...part("w1", undefined, true), values: { balance: 10, overruns: 0 } });
  runOf(this, "character", 2).parts.push(part("p1", "new", false, undefined, 5), part("p2", "variant", true, "day 11 10:00", 2), { ...part("w1", undefined, true), values: { balance: 5, overruns: 0 } });
});

/** The guidance material's words, by condition. */
const words = new WeakMap<Context, Record<string, number>>();

Given('the "rules" guidance material has {int} words and the "character" one {int}', function (this: Context, rules: number, character: number) {
  words.set(this, { rules, character });
});

Given('replica 2 of "character" stopped', function (this: Context) {
  const run = runOf(this, "character", 2);
  run.status = "stopped";
  // A stopped run's log may hold part lines it wrote before it stopped; they give no values.
});

Given('the runs\' logs have no "part" lines', function (this: Context) {
  for (const run of written.get(this) ?? []) run.parts = [];
});

/** Writes the runs directory "runs/e-test" under the scenario's home, with its index, logs and the materials they name. */
function writeRuns(context: Context): string {
  const directory = join(context.home, "runs", "e-test");
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(context.home, "materials"), { recursive: true });
  const counts = words.get(context) ?? { rules: 300, character: 150 };
  for (const [condition, count] of Object.entries(counts)) writeFileSync(join(context.home, "materials", `${condition}.md`), Array.from({ length: count }, (_, at) => `word${at}`).join(" "));
  const index: string[] = [];
  for (const [at, run] of (written.get(context) ?? []).entries()) {
    const runId = `run-${at + 1}`;
    index.push(JSON.stringify({ runId, condition: run.condition, model: "scripted/one", replica: run.replica, seed: run.replica, status: run.status }));
    const setup = { type: "run_setup", runId, condition: run.condition, materials: [{ path: `materials/${run.condition}.md`, key: "guidance", hash: "sha256:x", heldOut: false }] };
    // Two model turns of 1000 input tokens each, costing 0.01 each.
    const turns = [1, 2].map(() => ({ type: "model_turn", agent: "organiser", tokens: { input: 1000, output: 50 }, cost: { total: 0.01 } }));
    const lines = [setup, ...turns, ...run.parts, ...(run.status === "stopped" ? [{ type: "run_stopped", error: "stopped" }] : [])];
    writeFileSync(join(directory, `${runId}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  }
  writeFileSync(join(directory, "index.jsonl"), index.map((line) => `${line}\n`).join(""));
  return "runs/e-test";
}

When('{string} runs on the directory', async function (this: Context, command: string) {
  const { output, error } = await runCommand(this, `${command} ${writeRuns(this)}`);
  this.labOutput = output;
  this.labError = error;
});

When('"lab parts" runs on a directory with no index', async function (this: Context) {
  mkdirSync(join(this.home, "runs", "empty"), { recursive: true });
  const { output, error } = await runCommand(this, "lab parts runs/empty");
  this.labOutput = output;
  this.labError = error;
});

/** The rows of a Markdown table under a heading, as cells by header. */
function table(context: Context, heading: string): Record<string, string>[] {
  assert.equal(context.labError, undefined, `"lab parts" failed: ${context.labError?.message}`);
  const output = context.labOutput ?? "";
  const section = output.split(/^## /m).find((part) => part.startsWith(heading));
  assert.ok(section !== undefined, `"lab parts" printed no "${heading}" table:\n${output}`);
  const rows = section.split("\n").filter((line) => line.startsWith("|"));
  const cellsOf = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim());
  const headers = cellsOf(rows[0]);
  return rows.slice(2).map((line) => Object.fromEntries(cellsOf(line).map((cell, at) => [headers[at], cell])));
}

/** The one row of a table whose cells match. */
function rowOf(context: Context, heading: string, match: Record<string, string>): Record<string, string> {
  const rows = table(context, heading).filter((row) => Object.entries(match).every(([key, value]) => row[key] === value));
  assert.equal(rows.length, 1, `the "${heading}" table has ${rows.length} rows for ${JSON.stringify(match)}`);
  return rows[0];
}

Then(
  'the row for "p1" in "rules" gives the kind "covered", active 2, held 2, reached at "day 3 10:00" and "day 5 10:00", and efforts 4 and 6, minimum 4, median 5, maximum 6',
  function (this: Context) {
    const row = rowOf(this, "Parts", { Part: "p1", Condition: "rules" });
    assert.deepEqual(
      { kind: row.Kind, active: row.Active, held: row.Held, reached: row["Reached at"], calls: row["Effort (calls)"], minimum: row.Minimum, median: row.Median, maximum: row.Maximum },
      { kind: "covered", active: "2", held: "2", reached: "day 3 10:00, day 5 10:00", calls: "4, 6", minimum: "4", median: "5", maximum: "6" },
    );
  },
);

Then('the row for "p2" in "rules" gives the kind "changed", held 0 and one misapplication, in replica 2', function (this: Context) {
  const row = rowOf(this, "Parts", { Part: "p2", Condition: "rules" });
  assert.deepEqual({ kind: row.Kind, held: row.Held, misapplications: row.Misapplications }, { kind: "changed", held: "0", misapplications: "1 (replica 2: publish_programme at day 12 10:00)" });
});

Then(
  '"covered" in "rules" held 2 of 2 \\(1.0), "changed" in "rules" 0 of 2 \\(0.0), "new" in "character" 1 of 2 \\(0.5) and "variant" in "character" 2 of 2 \\(1.0)',
  function (this: Context) {
    for (const [kind, condition, held, share] of [
      ["covered", "rules", "2", "1.0"],
      ["changed", "rules", "0", "0.0"],
      ["new", "character", "1", "0.5"],
      ["variant", "character", "2", "1.0"],
    ]) {
      const row = rowOf(this, "Kinds", { Kind: kind, Condition: condition });
      assert.deepEqual({ active: row.Active, held: row.Held, share: row.Share }, { active: "2", held, share });
    }
  },
);

Then(
  'the row for "rules" gives 300 words and 400 estimated tokens, and the row for "character" 150 words and 200, each with its runs\' model turns, input tokens and cost',
  function (this: Context) {
    for (const [condition, wordCount, tokens] of [
      ["rules", "300", "400"],
      ["character", "150", "200"],
    ]) {
      const row = rowOf(this, "Conditions", { Condition: condition });
      assert.deepEqual(
        { words: row.Words, tokens: row["Tokens (estimate)"], turns: row["Model turns"], input: row["Input tokens"], cost: row.Cost },
        { words: wordCount, tokens, turns: "4", input: "4000", cost: "0.04" },
      );
    }
  },
);

Then('the rows for "character" count 1 completed and 1 stopped, and their values come from replica 1 only', function (this: Context) {
  const p1 = rowOf(this, "Parts", { Part: "p1", Condition: "character" });
  assert.deepEqual({ completed: p1.Completed, stopped: p1.Stopped, active: p1.Active, held: p1.Held, reached: p1["Reached at"], calls: p1["Effort (calls)"] }, { completed: "1", stopped: "1", active: "1", held: "1", reached: "day 7 10:00", calls: "9" });
  const w1 = rowOf(this, "Outcomes", { Outcome: "w1", Condition: "character" });
  assert.deepEqual({ completed: w1.Completed, stopped: w1.Stopped, held: w1.Held }, { completed: "1", stopped: "1", held: "1" });
  const condition = rowOf(this, "Conditions", { Condition: "character" });
  assert.deepEqual({ completed: condition.Completed, stopped: condition.Stopped, turns: condition["Model turns"] }, { completed: "1", stopped: "1", turns: "2" });
});

Then("it writes the same rows as JSON", async function (this: Context) {
  assert.equal(this.labError, undefined, `"lab parts --json" failed: ${this.labError?.message}`);
  const json = JSON.parse(this.labOutput ?? "") as { parts: Record<string, unknown>[]; kinds: Record<string, unknown>[]; outcomes: Record<string, unknown>[]; conditions: Record<string, unknown>[] };
  const markdown = await runCommand(this, "lab parts runs/e-test");
  this.labOutput = markdown.output;
  this.labError = markdown.error;
  assert.equal(json.parts.length, table(this, "Parts").length);
  assert.equal(json.kinds.length, table(this, "Kinds").length);
  assert.equal(json.outcomes.length, table(this, "Outcomes").length);
  assert.equal(json.conditions.length, table(this, "Conditions").length);
  const p1 = json.parts.find((row) => row.part === "p1" && row.condition === "rules") as Record<string, unknown>;
  assert.deepEqual({ kind: p1.kind, held: p1.held, reached: p1.reached, calls: p1.calls, median: p1.median }, { kind: "covered", held: 2, reached: ["day 3 10:00", "day 5 10:00"], calls: [4, 6], median: 5 });
  const w1 = json.outcomes.find((row) => row.outcome === "w1" && row.condition === "rules") as Record<string, unknown>;
  assert.deepEqual(w1.values, [{ balance: 120, overruns: 0 }, { balance: -40, overruns: 1 }]);
});

Then("it fails with an error that names the directory", function (this: Context) {
  assert.ok(this.labError !== undefined, '"lab parts" did not fail');
  assert.match(this.labError.message, /runs\/empty/);
});

Then("it prints that the runs have no parts", function (this: Context) {
  assert.equal(this.labError, undefined, `"lab parts" failed: ${this.labError?.message}`);
  assert.match(this.labOutput ?? "", /The runs have no parts\./);
});
