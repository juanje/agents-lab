import { join } from "node:path";
import type { LogLine } from "../engine/recorder.ts";
import type { IndexLine } from "../engine/runner.ts";
import type { MetricValue } from "../engine/scenario.ts";
import { indexOf, linesOf } from "./runs.ts";

/** The five numbers that show a distribution of values: none, when there are no values. */
export interface Quartiles {
  minimum: number | null;
  lowerQuartile: number | null;
  median: number | null;
  upperQuartile: number | null;
  maximum: number | null;
}

/**
 * The minimum, the quartiles and the maximum of the values, each by linear interpolation between the two sorted values
 * around its place, at its share of the way from the first to the last; none, without values.
 */
export function quartiles(values: readonly number[]): Quartiles {
  if (values.length === 0) return { minimum: null, lowerQuartile: null, median: null, upperQuartile: null, maximum: null };
  const sorted = [...values].sort((one, other) => one - other);
  const at = (share: number) => {
    const place = share * (sorted.length - 1);
    const below = Math.floor(place);
    return sorted[below] + (sorted[Math.ceil(place)] - sorted[below]) * (place - below);
  };
  return { minimum: at(0), lowerQuartile: at(0.25), median: at(0.5), upperQuartile: at(0.75), maximum: at(1) };
}

/**
 * A row of the summary of an experiment's runs: a condition, a model and a metric, and the agent or situation the
 * metric gives a value for, when it gives one for each.
 */
export interface SummaryRow extends Quartiles {
  condition: string;
  model: string;
  metric: string;
  key?: string;
  completed: number;
  stopped: number;
  values: number[];
  replicas: number[];
  nulls: number;
}

/** The values of a completed run's last metric sample, by metric; none when its log has no sample. */
function lastSample(directory: string, runId: string): Record<string, MetricValue> {
  const samples = linesOf<LogLine>(join(directory, `${runId}.jsonl`)).filter((line) => line.type === "metric_sample");
  return samples.at(-1)?.metrics ?? {};
}

/** A row's metric, and the agent or situation it gives a value for, if any. */
type RowKey = { metric: string; key?: string };

/** What a row's metric and key are called, to tell rows apart. */
const nameOf = ({ metric, key }: RowKey) => JSON.stringify([metric, key ?? null]);

/** The values a metric sample gives, one for each row: a metric's own, or one for each of its agents or situations. */
function valuesOf(metrics: Record<string, MetricValue>): { rowKey: RowKey; value: number | null }[] {
  return Object.entries(metrics).flatMap(([metric, value]) =>
    value === null || typeof value === "number"
      ? [{ rowKey: { metric }, value }]
      : Object.entries(value).map(([key, of]) => ({ rowKey: { metric, key }, value: of })),
  );
}

/**
 * The summary of an experiment's runs, from its runs directory: its index and its run logs, and nothing else.
 * - It gives a row for each condition and model, in the order the index first lists them, and each metric, or each agent
 *   or situation of a metric that gives a value for each, in the order the completed runs first give them.
 * - Every condition and model gets a row for every one of them, so one whose runs all stopped still shows its counts.
 * - Each row gives how many of its runs completed and stopped, and the values of the completed runs' last samples, in
 *   replica order, with the replica each comes from; a null is counted, not given. A stopped run gives no values.
 *
 * It refuses a directory without an index, naming it as it was given.
 */
export function summarizeRuns(directory: string, name: string = directory): SummaryRow[] {
  const index = indexOf(directory, name);
  const last = new Map(index.filter((run) => run.status === "completed").map((run) => [run.runId, valuesOf(lastSample(directory, run.runId))]));
  const rowKeys = new Map<string, RowKey>();
  for (const given of last.values()) for (const { rowKey } of given) if (!rowKeys.has(nameOf(rowKey))) rowKeys.set(nameOf(rowKey), rowKey);
  const groups = new Map<string, { condition: string; model: string; runs: IndexLine[] }>();
  for (const run of index) {
    const group = JSON.stringify([run.condition, run.model]);
    groups.set(group, { condition: run.condition, model: run.model, runs: [...(groups.get(group)?.runs ?? []), run] });
  }
  return [...groups.values()].flatMap(({ condition, model, runs }) => {
    const completed = runs.filter((run) => run.status === "completed").sort((one, other) => one.replica - other.replica);
    return [...rowKeys].map(([rowName, { metric, key }]) => {
      const values: number[] = [];
      const replicas: number[] = [];
      let nulls = 0;
      for (const run of completed) {
        for (const { rowKey, value } of last.get(run.runId) ?? []) {
          if (nameOf(rowKey) !== rowName) continue;
          if (value === null) nulls += 1;
          else {
            values.push(value);
            replicas.push(run.replica);
          }
        }
      }
      const of = key === undefined ? {} : { key };
      return { condition, model, metric, ...of, completed: completed.length, stopped: runs.length - completed.length, values, replicas, nulls, ...quartiles(values) };
    });
  });
}

/** The summary's columns, in order: each one's header and its cell in a row. */
const COLUMNS: readonly [string, (row: SummaryRow) => string][] = [
  ["Condition", (row) => row.condition],
  ["Model", (row) => row.model],
  ["Metric", (row) => row.metric],
  ["Key", (row) => row.key ?? ""],
  ["Completed", (row) => String(row.completed)],
  ["Stopped", (row) => String(row.stopped)],
  ["Values", (row) => row.values.join(", ")],
  ["Replicas", (row) => row.replicas.join(", ")],
  ["Nulls", (row) => String(row.nulls)],
  ["Minimum", (row) => String(row.minimum ?? "-")],
  ["Lower quartile", (row) => String(row.lowerQuartile ?? "-")],
  ["Median", (row) => String(row.median ?? "-")],
  ["Upper quartile", (row) => String(row.upperQuartile ?? "-")],
  ["Maximum", (row) => String(row.maximum ?? "-")],
];

/** The summary's rows as a Markdown table, a row on each line; a quartile there is none of is a dash. */
export function summaryMarkdown(rows: readonly SummaryRow[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |\n`;
  return [line(COLUMNS.map(([header]) => header)), line(COLUMNS.map(() => "---")), ...rows.map((row) => line(COLUMNS.map(([, cell]) => cell(row))))].join("");
}
