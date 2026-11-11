import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { quartiles, summarizeRuns, summaryMarkdown } from "../src/analysis/replicas.ts";

describe("quartiles", () => {
  it("gives the minimum, the quartiles and the maximum by linear interpolation between the sorted values", () => {
    expect(quartiles([1, 3, 2])).toEqual({ minimum: 1, lowerQuartile: 1.5, median: 2, upperQuartile: 2.5, maximum: 3 });
    expect(quartiles([4, 1, 3, 2])).toEqual({ minimum: 1, lowerQuartile: 1.75, median: 2.5, upperQuartile: 3.25, maximum: 4 });
  });

  it("gives the one value for all five", () => {
    expect(quartiles([4])).toEqual({ minimum: 4, lowerQuartile: 4, median: 4, upperQuartile: 4, maximum: 4 });
  });

  it("gives none without values", () => {
    expect(quartiles([])).toEqual({ minimum: null, lowerQuartile: null, median: null, upperQuartile: null, maximum: null });
  });
});

/** A line of a JSONL file. */
const jsonl = (lines: readonly object[]) => lines.map((line) => `${JSON.stringify(line)}\n`).join("");

/** A metric sample with these values. */
const sample = (atMs: number, metrics: object) => ({ type: "metric_sample", atMs, version: atMs, metrics });

/**
 * A runs directory whose index lists these runs, each with its log: a sample as it started, then its last sample, when
 * it gives one.
 */
function runsDirectory(runs: readonly { condition: string; model: string; replica: number; status: string; last?: object }[]): string {
  const directory = mkdtempSync(join(tmpdir(), "agents-lab-runs-"));
  const index = runs.map(({ condition, model, replica, status, last }, at) => {
    const runId = `run-${at}`;
    const started = sample(0, { held: 0, "slot of": { a: 9 } });
    writeFileSync(join(directory, `${runId}.jsonl`), jsonl([started, ...(last === undefined ? [] : [sample(100, last)])]));
    return { runId, condition, model, replica, seed: replica, status };
  });
  writeFileSync(join(directory, "index.jsonl"), jsonl(index));
  return directory;
}

/** A row with no values. */
const empty = { values: [], replicas: [], nulls: 0, minimum: null, lowerQuartile: null, median: null, upperQuartile: null, maximum: null };

describe("summarizeRuns", () => {
  it("gives a row for each condition, model and metric, and each agent or situation of a metric that has them, from each completed run's last sample", () => {
    const directory = runsDirectory([
      { condition: "baseline", model: "m/one", replica: 2, status: "completed", last: { held: 3, "slot of": { a: 2, b: 1 } } },
      { condition: "baseline", model: "m/one", replica: 1, status: "completed", last: { held: 1, "slot of": { a: 1 } } },
      { condition: "baseline", model: "m/one", replica: 3, status: "stopped", last: { held: 7, "slot of": { a: 7 } } },
      { condition: "baseline", model: "m/two", replica: 1, status: "completed", last: { held: null, "slot of": { b: 5 } } },
      { condition: "other", model: "m/two", replica: 1, status: "stopped" },
    ]);

    expect(summarizeRuns(directory)).toEqual([
      { condition: "baseline", model: "m/one", metric: "held", completed: 2, stopped: 1, values: [1, 3], replicas: [1, 2], nulls: 0, minimum: 1, lowerQuartile: 1.5, median: 2, upperQuartile: 2.5, maximum: 3 },
      { condition: "baseline", model: "m/one", metric: "slot of", key: "a", completed: 2, stopped: 1, values: [1, 2], replicas: [1, 2], nulls: 0, minimum: 1, lowerQuartile: 1.25, median: 1.5, upperQuartile: 1.75, maximum: 2 },
      { condition: "baseline", model: "m/one", metric: "slot of", key: "b", completed: 2, stopped: 1, values: [1], replicas: [2], nulls: 0, minimum: 1, lowerQuartile: 1, median: 1, upperQuartile: 1, maximum: 1 },
      { condition: "baseline", model: "m/two", metric: "held", completed: 1, stopped: 0, ...empty, nulls: 1 },
      { condition: "baseline", model: "m/two", metric: "slot of", key: "a", completed: 1, stopped: 0, ...empty },
      { condition: "baseline", model: "m/two", metric: "slot of", key: "b", completed: 1, stopped: 0, values: [5], replicas: [1], nulls: 0, minimum: 5, lowerQuartile: 5, median: 5, upperQuartile: 5, maximum: 5 },
      { condition: "other", model: "m/two", metric: "held", completed: 0, stopped: 1, ...empty },
      { condition: "other", model: "m/two", metric: "slot of", key: "a", completed: 0, stopped: 1, ...empty },
      { condition: "other", model: "m/two", metric: "slot of", key: "b", completed: 0, stopped: 1, ...empty },
    ]);
  });

  it("refuses a directory without an index, naming it as it was given", () => {
    const directory = mkdtempSync(join(tmpdir(), "agents-lab-runs-"));

    expect(() => summarizeRuns(directory, "runs/missing")).toThrow(/"runs\/missing" has no index/);
  });
});

describe("summaryMarkdown", () => {
  it("gives the rows as a Markdown table, with each list of values and replicas in one cell and no quartiles as a dash", () => {
    const rows = [
      { condition: "baseline", model: "m/one", metric: "held", completed: 2, stopped: 1, values: [1, 3], replicas: [1, 2], nulls: 0, minimum: 1, lowerQuartile: 1.5, median: 2, upperQuartile: 2.5, maximum: 3 },
      { condition: "baseline", model: "m/two", metric: "slot of", key: "a", completed: 1, stopped: 0, ...empty, nulls: 1 },
    ];

    expect(summaryMarkdown(rows)).toBe(
      [
        "| Condition | Model | Metric | Key | Completed | Stopped | Values | Replicas | Nulls | Minimum | Lower quartile | Median | Upper quartile | Maximum |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| baseline | m/one | held |  | 2 | 1 | 1, 3 | 1, 2 | 0 | 1 | 1.5 | 2 | 2.5 | 3 |",
        "| baseline | m/two | slot of | a | 1 | 0 |  |  | 1 | - | - | - | - | - |",
        "",
      ].join("\n"),
    );
  });
});
