import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Then } from "@cucumber/cucumber";
import type { Context } from "../support/context.ts";

/** The log files in the scenario's log directory, by name, in no particular order. */
function logFiles(context: Context): string[] {
  return readdirSync(context.logDirectory);
}

/** The lines of a log file, as written: one per event, each ended by a line break. */
function linesOf(context: Context, file: string): string[] {
  const text = readFileSync(join(context.logDirectory, file), "utf8");
  assert.ok(text.endsWith("\n"), `the log "${file}" does not end with a line break`);
  return text.slice(0, -1).split("\n");
}

/** The only log the scenario's run wrote. */
export function theLog(context: Context): string {
  const files = logFiles(context);
  assert.equal(files.length, 1, `the run wrote ${files.length} log files`);
  return files[0];
}

Then("the run wrote one log file, named with its run id", function (this: Context) {
  assert.ok(this.runId !== undefined, "the run gave no run id");
  assert.deepEqual(logFiles(this), [`${this.runId}.jsonl`]);
});

Then("every line of it is a JSON object", function (this: Context) {
  const lines = linesOf(this, theLog(this));
  for (const [index, line] of lines.entries()) {
    const parsed: unknown = JSON.parse(line);
    assert.ok(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed), `line ${index + 1} is not a JSON object: ${line}`);
  }
});
