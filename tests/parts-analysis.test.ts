import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { partsMarkdown, partsOfRuns } from "../src/analysis/parts.ts";

/** A runs directory under a home with materials: each run its condition, replica, status, guidance words and part lines. */
function runsDirectory(runs: { condition: string; replica: number; status: string; parts: Record<string, unknown>[] }[], words: Record<string, number>) {
  const home = mkdtempSync(join(tmpdir(), "agents-lab-parts-"));
  const directory = join(home, "runs", "e");
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(home, "materials"));
  for (const [condition, count] of Object.entries(words)) writeFileSync(join(home, "materials", `${condition}.md`), Array.from({ length: count }, () => "word").join(" "));
  const index = runs.map((run, at) => {
    const runId = `run-${at + 1}`;
    const lines = [
      { type: "run_setup", materials: [{ path: `materials/${run.condition}.md`, key: "guidance", hash: "sha256:x", heldOut: false }] },
      { type: "model_turn", tokens: { input: 1000 }, cost: { total: 0.01 } },
      ...run.parts,
    ];
    writeFileSync(join(directory, `${runId}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    return JSON.stringify({ runId, condition: run.condition, model: "m", replica: run.replica, seed: 1, status: run.status });
  });
  writeFileSync(join(directory, "index.jsonl"), `${index.join("\n")}\n`);
  return { home, directory };
}

const part = (id: string, kind: string | undefined, held: boolean, extra: Record<string, unknown> = {}) => ({ type: "part", part: id, evaluated_at: "day 26 06:30", active: true, held, effort: { calls: 0, money: 0 }, misapplications: [], ...(kind === undefined ? {} : { kind }), ...extra });

describe("partsOfRuns (FR-ANALYSIS-04)", () => {
  it("gives a row per part and condition, with each run's reached_at and effort in replica order and their minimum, median and maximum", () => {
    const { home, directory } = runsDirectory(
      [
        { condition: "a", replica: 2, status: "completed", parts: [part("p1", "new", true, { reached_at: "day 5 10:00", effort: { calls: 6, money: 50 } })] },
        { condition: "a", replica: 1, status: "completed", parts: [part("p1", "new", true, { reached_at: "day 3 10:00", effort: { calls: 4, money: 0 }, misapplications: [{ tool: "x", at: "day 2 09:00" }] })] },
      ],
      { a: 30 },
    );
    const { parts } = partsOfRuns(directory, home);
    expect(parts).toEqual([
      { part: "p1", condition: "a", kind: "new", completed: 2, stopped: 0, active: 2, held: 2, reached: ["day 3 10:00", "day 5 10:00"], calls: [4, 6], money: [0, 50], minimum: 4, median: 5, maximum: 6, misapplications: [{ replica: 1, count: 1, acts: ["x at day 2 09:00"] }] },
    ]);
  });

  it("gives a row per kind and condition, per outcome and condition with its values, and per condition with the guidance's length and the runs' costs", () => {
    const { home, directory } = runsDirectory(
      [
        { condition: "a", replica: 1, status: "completed", parts: [part("p1", "new", true), part("p2", "new", false), part("w1", undefined, false, { values: { balance: -5, overruns: 1 } })] },
        { condition: "a", replica: 2, status: "stopped", parts: [part("p1", "new", false)] },
      ],
      { a: 30 },
    );
    const report = partsOfRuns(directory, home);
    expect(report.kinds).toEqual([{ kind: "new", condition: "a", active: 2, held: 1, share: 0.5 }]);
    expect(report.outcomes).toEqual([{ outcome: "w1", condition: "a", completed: 1, stopped: 1, held: 0, values: [{ balance: -5, overruns: 1 }] }]);
    expect(report.conditions).toEqual([{ condition: "a", completed: 1, stopped: 1, words: 30, tokens: 40, modelTurns: 1, inputTokens: 1000, cost: 0.01 }]);
    expect(partsMarkdown(report)).toMatch(/^## Parts\n/);
  });

  it("refuses a directory without an index, naming it, and says when the runs have no parts", () => {
    expect(() => partsOfRuns(join(tmpdir(), "nowhere"), tmpdir(), "runs/nowhere")).toThrow(/runs\/nowhere/);
    const { home, directory } = runsDirectory([{ condition: "a", replica: 1, status: "completed", parts: [] }], { a: 3 });
    expect(partsMarkdown(partsOfRuns(directory, home))).toBe("The runs have no parts.\n");
  });
});
