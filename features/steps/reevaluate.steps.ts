import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { parse } from "smol-toml";
import { readParts } from "../../src/engine/parts.ts";
import { congressParts } from "../../src/scenarios/congress-parts.ts";
import type { Congress } from "../../src/scenarios/congress.ts";
import type { Context } from "../support/context.ts";
import { CHECKS, ORGANISER, commit, drawOfTheBaseline, holds, liveBooking, order, sixConfirmed, sixPublished } from "./baseline.steps.ts";
import { configurationOf } from "./congress.steps.ts";
import { END, mail, minutes, recordsOf, register } from "./congress-parts.steps.ts";
import { setUpCorrectionsCongress } from "./run-corrections.steps.ts";
import { runCommand } from "./summarize.steps.ts";

// FR-CONGRESS-24: D5 on the confirmed order, done with exceptions, and parts re-evaluated from a run's records. The
// predicates are read on world records the steps build, as FR-CONGRESS-20's steps build them; a run is a runs directory
// the steps write, with the lines a run writes.

/** The world of the scenario. */
const world = (context: Context) => recordsOf(context).state;

Given('the congress scenario and the draw of FR-CONGRESS-20\'s background, with "v1" keeping its catering "outside_fee" and its own caterer "c9"', function (this: Context) {
  setUpCorrectionsCongress(this, "day 1 Monday 09:00", 60000, 60);
  drawOfTheBaseline(this);
  const state = world(this);
  state.context = { ...state.context, catering: { v1: { rule: "outside_fee", inHouse: "c9" } }, diets: { ...state.context.diets, c9: {} } } as Congress["context"];
});

// D5 on the confirmed order.
Given('a live booking with "v1", 50 registrants who eat "standard", six confirmed speakers and 2 helpers', function (this: Context) {
  liveBooking(this);
  register(this, 50);
  sixConfirmed(this);
  sixPublished(this);
});

Given('"v1" confirmed the extra "outside_catering" with the permit {string}', function (this: Context, permit: string) {
  mail(this, "v1", ORGANISER, "extra_confirmed", { item: "outside_catering", price: 200, permit }, minutes("day 8"));
});

/** The permit an order is written with: none, or its id. */
const permitOf = (written: string): Record<string, string> => {
  const [, permit] = /^the permit "([^"]+)"$/.exec(written) ?? [];
  return permit === undefined ? {} : { permit };
};

/** Two orders to a caterer, on day 9 and day 10, and its confirmation of the second, an hour after it. */
function twoOrders(context: Context, caterer: string, first: string, second: string, counts = "standard: 61"): void {
  mail(context, ORGANISER, caterer, "order", { counts, date: "day 26", venue: "v1", ...permitOf(first) }, minutes("day 9"));
  order(context, caterer, counts, minutes("day 10"), permitOf(second));
}

Given(
  /^the organiser sent "(c\d)" an order for "([^"]+)" with (no permit|the permit "[^"]+"), then an order for "([^"]+)" with (no permit|the permit "[^"]+"), and "(c\d)" confirmed the second$/,
  function (this: Context, caterer: string, counts: string, first: string, again: string, second: string, confirming: string) {
    assert.deepEqual([confirming, again], [caterer, counts]);
    twoOrders(this, caterer, first, second, counts);
  },
);

// done with exceptions.
Given(/^D0 to D9 all hold at the end of preparation, except ("attendance_in_range"(?: and "speakers_travel")?)$/, function (this: Context, failing: string) {
  const expected = [...failing.matchAll(/"(\w+)"/g)].map(([, check]) => check);
  liveBooking(this);
  sixConfirmed(this);
  sixPublished(this, "hall-a", minutes("day 12 17:00"));
  // 70 paying registrants, above 66 of the target 60, each told the programme's first version; their meals and the
  // speakers', the 3 members' and the 2 helpers'.
  register(this, 70, { believes: 1 });
  // "v1" keeps its catering "outside_fee": "c2" serves with the permit "v1" confirmed.
  mail(this, "v1", ORGANISER, "extra_confirmed", { item: "outside_catering", price: 200, permit: "v1-permit-1" }, minutes("day 8"));
  order(this, "c2", "standard: 81", minutes("day 9"), { permit: "v1-permit-1" });
  commit(this, "v1", 2000, minutes("day 3"));
  commit(this, "c2", 81 * 30, minutes("day 9"));
  if (expected.includes("speakers_travel")) {
    // "s1" comes from "north", the organiser agreed to pay its travel, and nothing is booked for it.
    const state = world(this);
    state.context = { ...state.context, homes: { ...state.context.homes, s1: "north" } } as Congress["context"];
    mail(this, ORGANISER, "s1", "accept_condition", { travel_paid: true }, minutes("day 4"));
  }
  const { state } = recordsOf(this);
  assert.deepEqual(
    CHECKS.filter((check) => !holds(congressParts.predicates[check](state, { at: END }))),
    expected,
  );
});

/** The names of a step's exceptions: except "a" and "b". */
const exceptionsOf = (written: string) => [...written.matchAll(/"(\w+)"/g)].map(([, check]) => check);

When(/^a part with predicate "done" and params (none|except .+) is evaluated at the end of preparation$/, function (this: Context, params: string) {
  const written = { id: "DONE", predicate: "done", evaluate_at: "day 26 06:30", ...(params === "none" ? {} : { params: { except: exceptionsOf(params) } }) };
  const [part] = readParts([written], congressParts, { participants: [] });
  const built = recordsOf(this);
  built.at = END;
  built.part = "done";
  built.result = congressParts.predicates.done(built.state, { ...part.params, at: END });
});

/** The parts text a scenario loads, and the error loading it failed with. */
const loading = new WeakMap<Context, { text: string; error?: Error }>();

Given(/^a parts file with a part of predicate "done" and params (except .+)$/, function (this: Context, params: string) {
  const except = exceptionsOf(params)
    .map((check) => `"${check}"`)
    .join(", ");
  loading.set(this, { text: `[[parts]]\nid = "DONE-asked"\npredicate = "done"\nevaluate_at = "day 26 06:30"\nparams = { except = [${except}] }\n` });
});

When("the parts are loaded", function (this: Context) {
  const loaded = loading.get(this);
  assert.ok(loaded !== undefined, "the scenario gave no parts file");
  try {
    readParts((parse(loaded.text).parts ?? []) as Record<string, unknown>[], congressParts, { participants: [] });
  } catch (error) {
    loaded.error = error as Error;
  }
});

Then("they are refused, naming the part", function (this: Context) {
  const { error } = loading.get(this) ?? {};
  assert.ok(error !== undefined, "the parts were loaded");
  assert.match(error.message, /"?DONE-asked"?/);
  assert.match(error.message, /attendance/);
});

// Parts re-evaluated from a run's records.
/** The runs directory a scenario writes, under its home, and its one run. */
const RUNS = "runs/e-rerun";
const RUN_ID = "run-1";

/** What a scenario wrote of its run: its log's text. */
const kept = new WeakMap<Context, { log: string }>();

/** A part line as the engine writes it (FR-PARTS-01), at the end of preparation. */
const partLine = (part: string, held: boolean) => ({ type: "part", part, evaluated_at: "day 26 06:30", active: true, held, effort: { calls: 0, money: 0 }, misapplications: [] });

/** Writes a completed run: its index line and its log, with its setup line, then the given lines. */
function writeRun(context: Context, lines: readonly Record<string, unknown>[]): void {
  const directory = join(context.home, RUNS);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "index.jsonl"), `${JSON.stringify({ runId: RUN_ID, condition: "none", model: "scripted/one", replica: 1, seed: 1, status: "completed" })}\n`);
  const setup = { type: "run_setup", runId: RUN_ID, experiment: "e-rerun", scenario: "congress", condition: "none", configuration: configurationOf(context), replica: 1, seed: 1, model: "scripted/one", materials: [] };
  const log = [setup, ...lines].map((line) => `${JSON.stringify(line)}\n`).join("");
  writeFileSync(join(directory, `${RUN_ID}.jsonl`), log);
  kept.set(context, { log });
}

/** The world's state as a parts_state line keeps it, and as reading it back gives it. */
const keptState = (state: Congress) => JSON.parse(JSON.stringify(state)) as unknown;

Given('a completed run whose parts file evaluated "food_for_everyone" at "day 26 06:30" with the defect above, and wrote "D5" not held', function (this: Context) {
  // The first example above: an order with no permit, then one with the venue's, which "c2" confirmed.
  liveBooking(this);
  register(this, 50);
  sixConfirmed(this);
  sixPublished(this);
  mail(this, "v1", ORGANISER, "extra_confirmed", { item: "outside_catering", price: 200, permit: "v1-permit-1" }, minutes("day 8"));
  twoOrders(this, "c2", "no permit", 'the permit "v1-permit-1"');
  writeRun(this, [{ type: "parts_state", evaluated_at: "day 26 06:30", state: keptState(world(this)) }, partLine("D5", false)]);
});

Given('a completed run with "parts_state" lines only at "day 26 06:30"', function (this: Context) {
  writeRun(this, [{ type: "parts_state", evaluated_at: "day 26 06:30", state: keptState(world(this)) }, partLine("D5", false)]);
});

/** Runs lab reevaluate on the runs directory with a parts file of one part, keeping what it printed and its error. */
async function reevaluate(context: Context, id: string, predicate: string, at: string): Promise<void> {
  writeFileSync(join(context.home, "parts.toml"), `[[parts]]\nid = "${id}"\npredicate = "${predicate}"\nevaluate_at = "${at}"\n`);
  const { output, error } = await runCommand(context, `lab reevaluate ${RUNS} parts.toml`);
  context.labOutput = output;
  context.labError = error;
}

When('lab reevaluate is run on its directory with a parts file whose "D5" is "food_for_everyone"', async function (this: Context) {
  await reevaluate(this, "D5", "food_for_everyone", "day 26 06:30");
});

When('lab reevaluate is run with a part evaluated at "day 20 09:00"', async function (this: Context) {
  await reevaluate(this, "P-early", "within_budget", "day 20 09:00");
});

/** The lines of the run's re-evaluated parts file. */
function reevaluated(context: Context): Record<string, unknown>[] {
  const path = join(context.home, RUNS, `${RUN_ID}.parts.jsonl`);
  assert.ok(existsSync(path), `lab reevaluate wrote no ${RUN_ID}.parts.jsonl; it printed:\n${context.labOutput}`);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

Then('"<run id>.parts.jsonl" gives "D5" held, the run\'s log is unchanged, and lab parts reads the new file and says so', async function (this: Context) {
  assert.equal(this.labError, undefined, `lab reevaluate failed: ${this.labError?.message}`);
  const d5 = reevaluated(this).filter((line) => line.type === "part" && line.part === "D5");
  assert.deepEqual(
    d5.map(({ evaluated_at, active, held }) => ({ evaluated_at, active, held })),
    [{ evaluated_at: "day 26 06:30", active: true, held: true }],
  );
  assert.equal(readFileSync(join(this.home, RUNS, `${RUN_ID}.jsonl`), "utf8"), kept.get(this)?.log);
  const { output, error } = await runCommand(this, `lab parts ${RUNS}`);
  assert.equal(error, undefined, `lab parts failed: ${error?.message}`);
  // D5's row: one completed run, active and held.
  const row = output.split("\n").find((line) => line.startsWith("| D5 |"));
  assert.ok(row !== undefined, `lab parts printed no row for D5:\n${output}`);
  const cells = row.split("|").map((cell) => cell.trim());
  assert.deepEqual([cells[4], cells[6], cells[7]], ["1", "1", "1"], row);
  assert.match(output, new RegExp(`${RUN_ID}\\.parts\\.jsonl`), `lab parts did not say it read ${RUN_ID}.parts.jsonl:\n${output}`);
});

Then("that part is reported as not evaluated, naming the part and the run", function (this: Context) {
  assert.equal(this.labError, undefined, `lab reevaluate failed: ${this.labError?.message}`);
  const said = this.labOutput ?? "";
  assert.match(said, /not evaluated/, said);
  const line = said.split("\n").find((each) => each.includes("not evaluated")) ?? "";
  assert.ok(line.includes('"P-early"') && line.includes(`"${RUN_ID}"`), `it said: ${said}`);
  assert.deepEqual(
    reevaluated(this).filter((each) => each.type === "part"),
    [],
  );
  assert.deepEqual(
    reevaluated(this).filter((each) => each.type === "parts_not_evaluated"),
    [{ type: "parts_not_evaluated", parts: ["P-early"] }],
  );
});
