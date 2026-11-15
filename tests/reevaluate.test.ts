import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { partsMarkdown, partsOfRuns } from "../src/analysis/parts.ts";
import { reevaluateRuns } from "../src/analysis/reevaluate.ts";
import type { WorldTime } from "../src/engine/calendar.ts";
import type { PartsProvided } from "../src/engine/parts.ts";

// FR-CONGRESS-24: a run's parts re-evaluated from the parts_state lines it kept, and lab parts reading what that wrote.

/** A world of flags, each raise recorded with its time. */
interface Flags {
  flags: Record<string, boolean>;
  raised: { flag: string; at: WorldTime }[];
}

const provided: PartsProvided<Flags> = {
  predicates: {
    flag_set: (state, params) => state.flags[String(params.flag)] === true,
    counted: (state) => ({ holds: true, values: { flags: Object.keys(state.flags).length }, reachedAt: 600 }),
  },
  events: { flag_raised: (state, params) => state.raised.find(({ flag }) => flag === params.flag)?.at },
  misapplications: {},
  traps: { door_open: (state) => state.flags.door === true },
};

/** The library a re-evaluation asks for the run's scenario. */
const scenarios = new Map([["flags", { name: "flags", parts: provided as PartsProvided<unknown> }]]);

const state = (flags: Record<string, boolean>, raised: Flags["raised"] = []): Flags => ({ flags, raised });
const day1 = (clock: string): WorldTime => ({ day: 1, weekday: "Monday", seconds: Number(clock.slice(0, 2)) * 3600 + Number(clock.slice(3)) * 60 });

/** A runs directory under a home: each run's id, status and lines after its setup line; and a parts file with these parts. */
function written(runs: { status: string; lines: Record<string, unknown>[]; setup?: Record<string, unknown> }[], parts: string) {
  const home = mkdtempSync(join(tmpdir(), "agents-lab-reevaluate-"));
  const directory = join(home, "runs", "e");
  mkdirSync(directory, { recursive: true });
  const index = runs.map((run, at) => {
    const runId = `run-${at + 1}`;
    const setup = { type: "run_setup", runId, scenario: "flags", condition: "a", configuration: { participants: { shop: {} } }, materials: [], ...run.setup };
    writeFileSync(join(directory, `${runId}.jsonl`), [setup, ...run.lines].map((line) => `${JSON.stringify(line)}\n`).join(""));
    return JSON.stringify({ runId, condition: "a", model: "m", replica: at + 1, seed: 1, status: run.status });
  });
  writeFileSync(join(directory, "index.jsonl"), `${index.join("\n")}\n`);
  writeFileSync(join(home, "parts.toml"), parts);
  return { home, directory, partsFile: join(home, "parts.toml") };
}

const kept = (at: string, flags: Flags) => ({ type: "parts_state", evaluated_at: at, state: flags });
const linesOf = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe("reevaluateRuns (FR-CONGRESS-24)", () => {
  it("evaluates each part on the state kept at its time and writes <run id>.parts.jsonl beside the log, which it leaves unchanged", () => {
    const run = { status: "completed", lines: [kept("day 1 18:00", state({ door: true })), { type: "part", part: "p1", evaluated_at: "day 1 18:00", active: true, held: false, effort: { calls: 3, money: 40 }, misapplications: [{ tool: "x", arguments: {}, at: "day 1 10:00" }] }] };
    const { directory, partsFile } = written([run], '[[parts]]\nid = "p1"\npredicate = "flag_set"\nparams = { flag = "door" }\nevaluate_at = "day 1 18:00"\nactors = ["shop"]\ntraps = [{ trap = "door_open" }]\ngroup = "covered"\n\n[[parts]]\nid = "w1"\npredicate = "counted"\nevaluate_at = "day 1 18:00"\n');
    const log = readFileSync(join(directory, "run-1.jsonl"), "utf8");
    const result = reevaluateRuns(directory, partsFile, scenarios);
    expect(result).toEqual({ written: [join(directory, "run-1.parts.jsonl")], notEvaluated: [] });
    expect(readFileSync(join(directory, "run-1.jsonl"), "utf8")).toBe(log);
    expect(linesOf(join(directory, "run-1.parts.jsonl"))).toEqual([
      // What the agent did is the run's own: its effort and misapplications are the run's line's for the part.
      { type: "part", part: "p1", evaluated_at: "day 1 18:00", active: true, held: true, effort: { calls: 3, money: 40 }, misapplications: [{ tool: "x", arguments: {}, at: "day 1 10:00" }], traps: ["door_open"], group: "covered", reevaluated: true },
      { type: "part", part: "w1", evaluated_at: "day 1 18:00", active: true, held: true, reached_at: "day 1 10:00", effort: { calls: 0, money: 0 }, misapplications: [], values: { flags: 1 }, reevaluated: true },
    ]);
  });

  it("reports a part whose time has no parts_state line as not evaluated, naming the part and the run, and lists it in the file", () => {
    const { directory, partsFile } = written([{ status: "completed", lines: [kept("day 1 18:00", state({ door: true }))] }], '[[parts]]\nid = "early"\npredicate = "flag_set"\nevaluate_at = "day 1 09:00"\n');
    expect(reevaluateRuns(directory, partsFile, scenarios).notEvaluated).toEqual([{ run: "run-1", part: "early", at: "day 1 09:00" }]);
    expect(linesOf(join(directory, "run-1.parts.jsonl"))).toEqual([{ type: "parts_not_evaluated", parts: ["early"] }]);
  });

  it("finds a part's time by its event in the kept states, its activation by its event, and the run's end as its last kept state", () => {
    const raised = [{ flag: "alarm", at: day1("12:00") }];
    const run = { status: "completed", lines: [kept("day 1 10:00", state({ door: true })), kept("day 1 13:00", state({ door: true }, raised)), kept("day 1 21:00", state({ door: false }, raised))] };
    const parts = [
      '[[parts]]\nid = "after"\npredicate = "flag_set"\nparams = { flag = "door" }\nevaluate_at = { event = "flag_raised", params = { flag = "alarm" }, after_minutes = 60 }',
      '[[parts]]\nid = "inactive"\npredicate = "flag_set"\nparams = { flag = "door" }\nactivation = { event = "flag_raised", params = { flag = "alarm" } }\nevaluate_at = "day 1 10:00"',
      '[[parts]]\nid = "last"\npredicate = "flag_set"\nparams = { flag = "door" }\nevaluate_at = "end"',
    ].join("\n\n");
    const { directory, partsFile } = written([run], parts);
    reevaluateRuns(directory, partsFile, scenarios);
    expect(linesOf(join(directory, "run-1.parts.jsonl")).map(({ part, evaluated_at, active, held, reevaluated }) => ({ part, evaluated_at, active, held, reevaluated }))).toEqual([
      { part: "after", evaluated_at: "day 1 13:00", active: true, held: true, reevaluated: true },
      { part: "inactive", evaluated_at: "day 1 10:00", active: false, held: undefined, reevaluated: true },
      { part: "last", evaluated_at: "day 1 21:00", active: true, held: false, reevaluated: true },
    ]);
  });

  it("refuses a parts file the run's scenario cannot follow, or with kinds, naming the run, and a run whose scenario is not in the library", () => {
    const kinded = written([{ status: "completed", lines: [] }], '[[parts]]\nid = "p1"\npredicate = "flag_set"\nevaluate_at = "day 1 18:00"\nkinds = { a = "new" }\n');
    expect(() => reevaluateRuns(kinded.directory, kinded.partsFile, scenarios)).toThrow(/run-1.*"p1" has kinds/);
    const { directory, partsFile } = written([{ status: "completed", lines: [] }], '[[parts]]\nid = "p1"\npredicate = "moon_full"\nevaluate_at = "day 1 18:00"\n');
    expect(() => reevaluateRuns(directory, partsFile, scenarios)).toThrow(/run-1.*p1\.predicate/);
    const other = written([{ status: "completed", lines: [], setup: { scenario: "tides" } }], '[[parts]]\nid = "p1"\npredicate = "flag_set"\nevaluate_at = "day 1 18:00"\n');
    expect(() => reevaluateRuns(other.directory, other.partsFile, scenarios)).toThrow(/run-1.*"tides"/);
  });
});

describe("lab parts reads a run's re-evaluated parts (FR-CONGRESS-24)", () => {
  it("reads <run id>.parts.jsonl when it exists, and the run's own part lines otherwise, and says which it read", () => {
    const own = { type: "part", part: "p1", evaluated_at: "day 1 18:00", active: true, held: false, effort: { calls: 0, money: 0 }, misapplications: [] };
    const { home, directory } = written(
      [
        { status: "completed", lines: [own] },
        { status: "completed", lines: [own] },
      ],
      "",
    );
    writeFileSync(join(directory, "run-1.parts.jsonl"), `${JSON.stringify({ ...own, held: true })}\n`);
    const report = partsOfRuns(directory, home);
    expect(report.parts[0]).toMatchObject({ part: "p1", completed: 2, held: 1 });
    expect(report.read).toEqual([
      { run: "run-1", from: "run-1.parts.jsonl" },
      { run: "run-2", from: "run-2.jsonl" },
    ]);
    expect(partsMarkdown(report)).toMatch(/## Part lines read\n\n\| Run \| From \|\n\| --- \| --- \|\n\| run-1 \| run-1\.parts\.jsonl \|\n\| run-2 \| run-2\.jsonl \|\n/);
    expect(existsSync(join(directory, "run-2.parts.jsonl"))).toBe(false);
  });
});
