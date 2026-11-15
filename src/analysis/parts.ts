import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { IndexLine } from "../engine/runner.ts";
import { quartiles } from "./replicas.ts";
import { indexOf, linesOf } from "./runs.ts";

/** A part line as a run's log gives it (FR-PARTS-01). */
interface PartLine {
  part: string;
  active: boolean;
  /** Its group, beside its kind, active or not (FR-PARTS-01's addition). */
  group?: string;
  held?: boolean;
  reached_at?: string;
  effort?: { calls: number; money: number };
  misapplications?: { tool: string; at: string }[];
  kind?: string;
  values?: Record<string, unknown>;
}

/** A row per part and condition. */
export interface PartRow {
  part: string;
  condition: string;
  kind: string;
  completed: number;
  stopped: number;
  active: number;
  held: number;
  /** Each completed run's reached_at, in replica order; none when it was not reached. */
  reached: (string | null)[];
  calls: number[];
  money: number[];
  minimum: number | null;
  median: number | null;
  maximum: number | null;
  misapplications: { replica: number; count: number; acts: string[] }[];
}

/** A row per kind and condition: of the active parts of that kind, how many held. */
export interface KindRow {
  kind: string;
  condition: string;
  active: number;
  held: number;
  share: number | null;
}

/** A row per outcome and condition: in how many runs it held, and each run's values when it gives them. */
export interface OutcomeRow {
  outcome: string;
  condition: string;
  completed: number;
  stopped: number;
  held: number;
  values: Record<string, unknown>[];
}

/** A row per condition: its guidance's length in words and estimated tokens, and its runs' model turns, input tokens and cost. */
export interface ConditionRow {
  condition: string;
  completed: number;
  stopped: number;
  words: number | null;
  tokens: number | null;
  modelTurns: number;
  inputTokens: number;
  cost: number;
}

/** What lab parts gives. */
export interface PartsReport {
  parts: PartRow[];
  kinds: KindRow[];
  outcomes: OutcomeRow[];
  conditions: ConditionRow[];
  /** The file each run's part lines were read from: its re-evaluated parts, or its log (FR-CONGRESS-24). */
  read: { run: string; from: string }[];
}

/** A run of the index with its log's lines, and the part lines read: its re-evaluated parts' when it has them, or its log's. */
interface Run extends IndexLine {
  lines: Record<string, unknown>[];
  from: string;
  parts: Record<string, unknown>[];
}

/**
 * The words of the guidance text a run's setup line names; none when it names none or the file is missing. Its path is
 * read from the experiment file's directory the setup line gives, against the directory the runs were written under
 * (`<it>/runs/<id>`); a setup line without one reads it from the directory given (FR-ANALYSIS-04's addition).
 */
function guidanceWords(run: Run, runsDirectory: string, materialsFrom: string): number | null {
  const setup = run.lines.find((line) => line.type === "run_setup") as { experimentFile?: string; materials?: { path: string; key: string }[] } | undefined;
  const material = setup?.materials?.find(({ key }) => key === "guidance" || key.endsWith(".guidance"));
  if (material === undefined) return null;
  const base = setup?.experimentFile === undefined ? materialsFrom : resolve(runsDirectory, "..", "..", dirname(setup.experimentFile));
  const path = join(base, material.path);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").split(/\s+/).filter((word) => word !== "").length;
}

/**
 * The parts of an experiment's runs (FR-ANALYSIS-04), from its runs directory: its index, its logs, and the materials
 * their setup lines name, read from a directory. Rows by part, kind, outcome and condition; a stopped run is counted
 * apart and gives no values. A run's part lines are those of its `<run id>.parts.jsonl` when lab reevaluate wrote one,
 * and of its log otherwise; the report gives which it read (FR-CONGRESS-24). It refuses a directory without an index,
 * naming it as given.
 */
export function partsOfRuns(directory: string, materialsFrom: string, name: string = directory): PartsReport {
  const runs: Run[] = indexOf(directory, name).map((run) => {
    const lines = linesOf<Record<string, unknown>>(join(directory, `${run.runId}.jsonl`));
    // A run's re-evaluated parts, which lab reevaluate wrote, stand for its own part lines (FR-CONGRESS-24).
    const reevaluated = `${run.runId}.parts.jsonl`;
    const from = existsSync(join(directory, reevaluated)) ? reevaluated : `${run.runId}.jsonl`;
    return { ...run, lines, from, parts: from === reevaluated ? linesOf<Record<string, unknown>>(join(directory, reevaluated)) : lines };
  });
  const conditions = [...new Set(runs.map(({ condition }) => condition))];
  const completedOf = (condition: string) => runs.filter((run) => run.condition === condition && run.status === "completed").sort((one, other) => one.replica - other.replica);
  const stoppedOf = (condition: string) => runs.filter((run) => run.condition === condition && run.status !== "completed").length;
  const partLines = (run: Run) => run.parts.filter((line) => line.type === "part") as unknown as PartLine[];
  const lineOf = (run: Run, part: string) => partLines(run).find((line) => line.part === part);
  const names = [...new Set(runs.filter(({ status }) => status === "completed").flatMap((run) => partLines(run).map(({ part }) => part)))];
  // The group stands for the kind when the lines give one (FR-PARTS-01's addition).
  const kindOf = (part: string, condition: string) => {
    const line = runs.filter((run) => run.condition === condition).flatMap((run) => partLines(run)).find((each) => each.part === part && (each.group !== undefined || each.kind !== undefined));
    return line?.group ?? line?.kind;
  };
  // A part line with a group or a kind is a part, active or not.
  const isOutcome = (part: string) => runs.every((run) => partLines(run).every((line) => line.part !== part || (line.kind === undefined && line.group === undefined)));
  // With no kind or group on any line, the experiment has no kind_factor: every part is listed, with no kinds (FR-CONGRESS-22).
  const kindless = names.every(isOutcome);

  const parts: PartRow[] = [];
  const outcomes: OutcomeRow[] = [];
  for (const part of names) {
    for (const condition of conditions) {
      const completed = completedOf(condition);
      const lines = completed.map((run) => lineOf(run, part));
      const active = lines.filter((line) => line?.active === true).length;
      const held = lines.filter((line) => line?.active === true && line.held === true).length;
      if (isOutcome(part)) {
        outcomes.push({ outcome: part, condition, completed: completed.length, stopped: stoppedOf(condition), held, values: lines.flatMap((line) => (line?.values === undefined ? [] : [line.values])) });
        if (!kindless) continue;
      }
      const calls = lines.map((line) => line?.effort?.calls ?? 0);
      const { minimum, median, maximum } = quartiles(calls);
      parts.push({
        part,
        condition,
        kind: kindOf(part, condition) ?? "",
        completed: completed.length,
        stopped: stoppedOf(condition),
        active,
        held,
        reached: lines.map((line) => line?.reached_at ?? null),
        calls,
        money: lines.map((line) => line?.effort?.money ?? 0),
        minimum,
        median,
        maximum,
        misapplications: completed.flatMap((run, at) => {
          const found = lines[at]?.misapplications ?? [];
          return found.length === 0 ? [] : [{ replica: run.replica, count: found.length, acts: found.map(({ tool, at: when }) => `${tool} at ${when}`) }];
        }),
      });
    }
  }
  const kinds: KindRow[] = [];
  for (const condition of kindless ? [] : conditions) {
    for (const kind of [...new Set(parts.filter((row) => row.condition === condition).map((row) => row.kind))]) {
      const rows = parts.filter((row) => row.condition === condition && row.kind === kind);
      const active = rows.reduce((sum, row) => sum + row.active, 0);
      const held = rows.reduce((sum, row) => sum + row.held, 0);
      kinds.push({ kind, condition, active, held, share: active === 0 ? null : held / active });
    }
  }
  const rows: ConditionRow[] = conditions.map((condition) => {
    const completed = completedOf(condition);
    const turns = completed.flatMap((run) => run.lines.filter((line) => line.type === "model_turn")) as { tokens?: { input?: number }; cost?: { total?: number } }[];
    const words = runs.filter((run) => run.condition === condition).map((run) => guidanceWords(run, directory, materialsFrom)).find((count) => count !== null) ?? null;
    return {
      condition,
      completed: completed.length,
      stopped: stoppedOf(condition),
      words,
      tokens: words === null ? null : Math.round((words * 4) / 3),
      modelTurns: turns.length,
      inputTokens: turns.reduce((sum, turn) => sum + (turn.tokens?.input ?? 0), 0),
      cost: Math.round(turns.reduce((sum, turn) => sum + (turn.cost?.total ?? 0), 0) * 1e6) / 1e6,
    };
  });
  return { parts, kinds, outcomes, conditions: rows, read: runs.map(({ runId, from }) => ({ run: runId, from })) };
}

/** A share as a cell: one decimal, more when it needs them. */
const shareText = (share: number | null) => (share === null ? "-" : Number.isInteger(share * 10) ? share.toFixed(1) : String(Math.round(share * 1000) / 1000));

/** A Markdown table with a heading. */
function tableOf(heading: string, headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |\n`;
  return `## ${heading}\n\n${line(headers)}${line(headers.map(() => "---"))}${rows.map(line).join("")}\n`;
}

/**
 * The report as Markdown: its four tables, the kinds left out for an experiment with no kind_factor, and the file each
 * run's part lines were read from; or a line saying the runs have no parts.
 */
export function partsMarkdown({ parts, kinds, outcomes, conditions, read }: PartsReport): string {
  if (parts.length === 0 && outcomes.length === 0) return "The runs have no parts.\n";
  const or = (value: number | null) => (value === null ? "-" : String(value));
  return [
    tableOf(
      "Parts",
      ["Part", "Condition", "Kind", "Completed", "Stopped", "Active", "Held", "Reached at", "Effort (calls)", "Effort (money)", "Minimum", "Median", "Maximum", "Misapplications"],
      parts.map((row) => [
        row.part,
        row.condition,
        row.kind,
        String(row.completed),
        String(row.stopped),
        String(row.active),
        String(row.held),
        row.reached.map((at) => at ?? "-").join(", "),
        row.calls.join(", "),
        row.money.join(", "),
        or(row.minimum),
        or(row.median),
        or(row.maximum),
        row.misapplications.length === 0 ? "0" : `${row.misapplications.reduce((sum, { count }) => sum + count, 0)} (${row.misapplications.map(({ replica, acts }) => `replica ${replica}: ${acts.join(", ")}`).join("; ")})`,
      ]),
    ),
    // An experiment with no kind_factor has no kinds (FR-CONGRESS-22).
    ...(kinds.length === 0
      ? []
      : [tableOf("Kinds", ["Kind", "Condition", "Active", "Held", "Share"], kinds.map((row) => [row.kind, row.condition, String(row.active), String(row.held), shareText(row.share)]))]),
    tableOf(
      "Outcomes",
      ["Outcome", "Condition", "Completed", "Stopped", "Held", "Values"],
      outcomes.map((row) => [row.outcome, row.condition, String(row.completed), String(row.stopped), String(row.held), row.values.map((values) => JSON.stringify(values)).join("; ")]),
    ),
    tableOf(
      "Conditions",
      ["Condition", "Completed", "Stopped", "Words", "Tokens (estimate)", "Model turns", "Input tokens", "Cost"],
      conditions.map((row) => [row.condition, String(row.completed), String(row.stopped), or(row.words), or(row.tokens), String(row.modelTurns), String(row.inputTokens), String(row.cost)]),
    ),
    tableOf(
      "Part lines read",
      ["Run", "From"],
      read.map(({ run, from }) => [run, from]),
    ),
  ].join("");
}
