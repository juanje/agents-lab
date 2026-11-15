import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import type { Step } from "../../src/engine/components.ts";
import { Random } from "../../src/engine/random.ts";
import { congressParts } from "../../src/scenarios/congress-parts.ts";
import { type Congress, congressScenario } from "../../src/scenarios/congress.ts";
import { type AttendeesMaterial, type PopulationWorld, populationComponent } from "../../src/scenarios/population.ts";
import type { Context } from "../support/context.ts";
import { change, configurationOf, hourMsOf, organiserTurns } from "./congress.steps.ts";
import { before, changePools, fieldsOf, minutesOf, sentBy } from "./congress-parties.steps.ts";
import { END, emptyWorld, mail, minutes, publish, records, recordsOf, register, session, worldOf } from "./congress-parts.steps.ts";
import { CITY, V1 } from "./run-corrections.steps.ts";
import { runCommand } from "./summarize.steps.ts";

// FR-CONGRESS-22: the corrections from the E1 baseline's first check run, on FR-CONGRESS-09's congress with the venues
// "v1" (outside catering for a fee, one room "hall-a" of 90 seats) and "v2", six plain speakers and the caterer "c1".
// The venues' and caterers' answers are read from runs; D7, the milestone and a registrant's belief from world records
// the steps build, as FR-CONGRESS-20's steps build them.

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The literal text of a step, as a regular expression that matches it alone. */
const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** The parties of the Background. */
const V1_ROOMS = [{ id: "hall-a", seats: 90 }];
const V2_ROOMS = [{ id: "room-x", seats: 60 }];
const VENUE_1: TomlTable = { ...structuredClone(V1), rooms: V1_ROOMS.map((room) => ({ ...room, equipment: [] })), catering: "outside_fee", outside_fee_per_head: 5 };
const VENUE_2: TomlTable = { ...structuredClone(V1), id: "v2", rooms: V2_ROOMS.map((room) => ({ ...room, equipment: [] })) };
const SIX = ["s1", "s2", "s3", "s4", "s5", "s6"];
const TIMES = ["09:30", "10:30", "11:30", "14:00", "15:00", "16:00"];
const SPEAKERS: TomlTable[] = SIX.map((id, index) => ({ id, title: `Soil ${index + 1}`, draw: 1, fee: 0, home: "local", available: true, acceptance: 1, pick_up: 1 }));
const C1: TomlTable = { id: "c1", price_per_head: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], pick_up: 1, diets: {} };

/** The records of a scenario: an empty world with "v1"'s one room "hall-a". */
function worldHere(): Congress {
  const state = emptyWorld();
  state.rooms = { "hall-a": { venue: "v1", seats: 90 } } as Congress["rooms"];
  state.passages = [{ between: ["v1-entrance", "hall-a"], length: 1, step_free: true }] as Congress["passages"];
  state.context = { ...state.context, catering: { v1: { rule: "outside_fee" } } } as Congress["context"];
  return state;
}

Given(
  literal(
    'the draw gives no board, no partner, no agency, "budget" [8000, 8000] and "advance" [3000, 3000], and the variant draws the venues "v1" (catering "outside_fee", rooms "hall-a" of 90 seats) and "v2", the speakers "s1" to "s6" with no condition, and the caterer "c1"',
  ),
  function (this: Context) {
    changePools(this, (pool) => {
      pool.venue = [structuredClone(VENUE_1), structuredClone(VENUE_2)];
      pool.speaker = structuredClone(SPEAKERS);
      pool.partner = [];
      pool.caterer = [structuredClone(C1)];
      pool.sponsor = [];
      pool.agency = [];
      pool.board = [];
    });
    change(this, (configuration) => {
      configuration.draw = stringify({ attendance: [50, 50], budget: [8000, 8000], advance: [3000, 3000], venue: 2, speaker: 6, caterer: 1 });
      configuration.perturbations = {};
      const city = structuredClone(CITY) as unknown as { venues: TomlTable[]; passages: TomlTable[] };
      city.venues[0].rooms = V1_ROOMS;
      city.venues.push({ id: "v2", entrance: "v2-entrance", hours: "always", rooms: V2_ROOMS });
      city.passages = [
        ...city.passages.filter(({ between }) => !(between as string[]).includes("hall-b")),
        { between: ["office", "v2-entrance"], length: 30, step_free: true },
        { between: ["v2-entrance", "room-x"], length: 1, step_free: true },
      ];
      configuration.city = stringify(city as unknown as TomlTable);
    });
    records.set(this, { state: worldHere(), acts: [] });
  },
);

// A venue answers the asker's own booking.
/** A venue's template in the pools. */
function templateOf(context: Context, venue: string): TomlTable {
  const pool = parse(configurationOf(context).pools as string) as unknown as { venue: TomlTable[] };
  const found = pool.venue.find(({ id }) => id === venue);
  assert.ok(found !== undefined, `the pools have no venue "${venue}"`);
  return found;
}

/** The organiser's turns that book a venue's first room for "day 26" and accept its contract, an hour apart. */
function bookingTurns(context: Context, venue: string): string {
  const room = (templateOf(context, venue).rooms as TomlTable[])[0].id as string;
  return `call "send_mail" to "${venue}" with the act "book", date "day 26", rooms "${room}" and hours "08:00-18:00", then wait 1 world hour, then "send_mail" to "${venue}" with the act "accept_contract" and the contract's id, then wait 1 world hour`;
}

// "c-1" is the scenario's name for "v1"'s first contract, "v1-contract-1".
Given("the organiser's contract {string} with {string} for {string} is confirmed", function (this: Context, contract: string, venue: string, date: string) {
  assert.deepEqual([contract, venue, date], ["c-1", "v1", "day 26"]);
  before(this, organiserTurns(bookingTurns(this, venue), hourMsOf(this)));
});

Given("the organiser holds {string} at {string} until {string}", function (this: Context, date: string, venue: string, until: string) {
  assert.deepEqual([date, venue, until], ["day 26", "v1", "day 5 10:00"]);
  // A hold of 4 days, asked an hour into the run: it ends on day 5, about 10:00.
  changePools(this, (pool) => ((pool.venue.find(({ id }) => id === venue) as TomlTable).hold_days = 4));
  before(this, [{ toolCalls: [{ name: "check_time", arguments: {} }] as never, delayMs: hourMsOf(this) }, ...organiserTurns(`call "send_mail" to "${venue}" with the act "hold" and the date "${date}", then wait 1 world hour, then "check_time"`, hourMsOf(this))]);
});

/** The scenarios in which another customer booked the event day, whose "v1" answered "unavailable" this file reads. */
export const otherCustomerBooked = new WeakSet<Context>();

Given("another customer booked {string} at {string}", function (this: Context, date: string, venue: string) {
  changePools(this, (pool) => ((pool.venue.find(({ id }) => id === venue) as TomlTable).booked_by_others = [date]));
  otherCustomerBooked.add(this);
});

// An ask_quote needs an attendance as well as a date (FR-CONGRESS-02): the steps give the target, 50.
Given(/^the organiser's scripted turns call "send_mail" to "v1" with the act "(ask_quote|hold)" and the date "(day 26)", then end$/, function (this: Context, act: string, date: string) {
  const fields = { date, ...(act === "ask_quote" ? { attendance: 50 } : {}) };
  before(this, [{ toolCalls: [{ name: "send_mail", arguments: { to: "v1", act, fields } }] as never, delayMs: 0 }, ...organiserTurns('wait 1 world hour, then "check_time"', hourMsOf(this))]);
});

/** What a party answered the organiser last. */
function lastAnswer(context: Context, party: string): Record<string, unknown> {
  const answers = sentBy(context, party).filter((line) => line.to === ORGANISER);
  assert.ok(answers.length > 0, `"${party}" answered nothing`);
  return answers.at(-1) as Record<string, unknown>;
}

Then(/^"v1" answered "(contract_held|held)" with the (contract|end) "([^"]+)", and no "unavailable"$/, function (this: Context, act: string, field: string, value: string) {
  const answer = lastAnswer(this, "v1");
  const fields = fieldsOf(answer);
  assert.equal(answer.act, act, `"v1" sent ${sentBy(this, "v1").map((line) => `${String(line.act)} ${JSON.stringify(line.fields)}`).join("; ")}; the organiser sent ${sentBy(this, ORGANISER).map((line) => String(line.act)).join(", ")}`);
  if (field === "contract") assert.equal(fields.contract, value === "c-1" ? "v1-contract-1" : value);
  // The hold's end, within one world hour.
  else assert.ok(Math.abs(minutesOf(String(fields.until)) - minutesOf(value)) <= 60, `the hold's end is ${String(fields.until)}`);
  assert.deepEqual(
    sentBy(this, "v1").filter((line) => line.act === "unavailable"),
    [],
  );
});

/** FR-CONGRESS-22's "v1" answered "unavailable": its last answer to the organiser; FR-CONGRESS-11's step of the same text calls it. */
export function answeredUnavailable(context: Context): void {
  assert.equal(lastAnswer(context, "v1").act, "unavailable");
}

// A caterer takes only a permit the venue gave.
Given("{string} gave the organiser the permit {string} for outside catering", function (this: Context, venue: string, permit: string) {
  // Its first permit: the organiser books the venue, then asks for outside catering for 40 and accepts it.
  assert.equal(permit, `${venue}-permit-1`);
  before(
    this,
    organiserTurns(
      `${bookingTurns(this, venue)}, then "send_mail" to "${venue}" with the act "request_extra", item "outside_catering" and attendance 40, then wait 1 world hour, then "send_mail" to "${venue}" with the act "accept_extra" and item "outside_catering", then wait 1 world hour, then "check_time"`,
      hourMsOf(this),
    ),
  );
  // The run lasts beyond the four world hours this takes.
  this.timeLimitMs = Math.max(this.timeLimitMs ?? 0, 8 * hourMsOf(this));
});

Given(
  /^the organiser's scripted turns call "send_mail" to "c1" with the act "order", the venue "v1", the date "day 26", the counts "standard: 40" and the permit "([^"]+)", then end$/,
  function (this: Context, permit: string) {
    const order = { to: "c1", act: "order", fields: { venue: "v1", date: "day 26", counts: "standard: 40", permit } };
    before(this, [{ toolCalls: [{ name: "send_mail", arguments: order }] as never, delayMs: 0 }, ...organiserTurns('wait 1 world hour, then "check_time"', hourMsOf(this))]);
  },
);

Then('"c1" answered "order_refused" with the reason {string}', function (this: Context, reason: string) {
  const answer = lastAnswer(this, "c1");
  assert.deepEqual([answer.act, fieldsOf(answer).reason], ["order_refused", reason], JSON.stringify(answer));
});

// A registrant believes the programme it registered under.
Given("the organiser published a programme version {int} on {string} and announced it on {string}", function (this: Context, version: number, published: string, announced: string) {
  const sessions = SIX.map((speaker, index) => session([speaker], TIMES[index], "hall-a"));
  for (let earlier = 1; earlier < version; earlier += 1) publish(this, sessions, minutes("day 12"));
  publish(this, sessions, minutes(published));
  const announce = congressScenario.tools.find(({ name }) => name === "announce") as unknown as { action: { effect: (state: Congress, call: unknown) => Congress } };
  const built = recordsOf(this);
  built.state = announce.action.effect(built.state, { agent: ORGANISER, arguments: { audience: "registrants", kind: "programme" }, atMs: 0, world: worldOf(minutes(announced)) });
});

/** The attendees material of the records: nobody registers but the people given, at their times. */
const MATERIAL: AttendeesMaterial = {
  pool_factor: 1,
  base_per_day: 0,
  unannounced: 0,
  promotion_factor: 1,
  payment_fee_share: 0,
  cancel_share: 0,
  consent_share: 1,
  pay_share: 1,
  no_show_share: 0,
  diets: { none: 1 },
  access: { none: 1 },
  fixed: [],
};

When("the attendee {string} registers on {string}", function (this: Context, person: string, day: string) {
  const built = recordsOf(this);
  const population = built.state.population as NonNullable<Congress["population"]>;
  const registersAt = minutes(`${day} 10:00`);
  built.state.population = { ...population, material: MATERIAL, people: [{ id: person, diet: "none", access: "none", pays: true, consents: true, no_show: false, registersAt, given: {} }] };
  // The population's cycle, from the day before until two world hours after the person's time, applying its actions.
  const cycle = populationComponent({ organiser: ORGANISER, target: 50, msFor: (each) => each }).cycle(new Random(1));
  let state = built.state as unknown as PopulationWorld;
  let now = minutes("day 22");
  let outcome: string | undefined;
  for (let guard = 0; guard < 10_000 && now <= registersAt + 120; guard += 1) {
    const step: Step<PopulationWorld> = cycle.next(state, outcome, 0, worldOf(now));
    outcome = undefined;
    if (step.kind === "end") break;
    if (step.kind === "wait") now += step.ms;
    if (step.kind === "action") {
      state = step.action.effect(state, { component: "attendees", atMs: 0, world: worldOf(now) });
      outcome = "success";
    }
  }
  built.state = state as unknown as Congress;
});

Then("{string} believes version {int}", function (this: Context, person: string, version: number) {
  const found = recordsOf(this).state.population?.people.find(({ id }) => id === person);
  assert.ok(found?.registered !== undefined, `"${person}" did not register`);
  assert.equal(found.believes, version);
});

// The on-time programme is a real one.
/** "v1"'s contract for "day 26" with "hall-a", confirmed at a time. */
function liveBooking(context: Context, at: number): void {
  mail(context, "v1", ORGANISER, "contract", { contract: "v1-contract-1", date: "day 26", rooms: "hall-a", hours: "08:00-18:00", price: 2000 }, at - 60);
  mail(context, "v1", ORGANISER, "confirmed", { contract: "v1-contract-1" }, at);
}

/** The six speakers, each invited to its session at its time and accepting it at a time. */
function sixAccepted(context: Context, at: number): void {
  SIX.forEach((speaker, index) => {
    mail(context, ORGANISER, speaker, "invite", { session: index + 1, time: TIMES[index], fee: 0, travel_paid: false }, at - 60);
    mail(context, speaker, ORGANISER, "accept", { session: index + 1 }, at);
  });
}

/** A programme of six sessions, "s1" to "s6" in "hall-a", published at a time. */
const sixPublished = (context: Context, at: number) =>
  publish(
    context,
    SIX.map((speaker, index) => session([speaker], TIMES[index], "hall-a")),
    at,
  );

Given('the organiser\'s contract with "v1" was confirmed on "day 6", and "s1" to "s6" each accepted a session by "day 8"', function (this: Context) {
  liveBooking(this, minutes("day 6"));
  sixAccepted(this, minutes("day 8"));
});

Given('the organiser published a programme of six sessions with "s1" to "s6" in "hall-a" on {string}, and again on {string}', function (this: Context, first: string, again: string) {
  sixPublished(this, minutes(first));
  sixPublished(this, minutes(again));
});

Given(
  'the organiser published a placeholder programme on "day 3 10:00", and a programme whose six sessions name accepted speakers in rooms of its live booking only on "day 14 10:00"',
  function (this: Context) {
    // The placeholder names the same six speakers in "hall-a", before any booking or acceptance.
    sixPublished(this, minutes("day 3 10:00"));
    liveBooking(this, minutes("day 13 10:00"));
    sixAccepted(this, minutes("day 13 12:00"));
    sixPublished(this, minutes("day 14 10:00"));
  },
);

/** The predicates' results, by name. */
const results = new WeakMap<Context, Record<string, unknown>>();

/** Evaluates predicates at the end of preparation, on the records as they are. */
function evaluate(context: Context, names: string[]): void {
  const { state } = recordsOf(context);
  results.set(context, Object.fromEntries(names.map((name) => [name, congressParts.predicates[name](state, { at: END })])));
}

When('"programme_on_time" and "programme_published" are evaluated at the end of preparation, with every registrant believing the latest version', function (this: Context) {
  register(this, 50, { believes: recordsOf(this).state.population?.programme.at(-1)?.version });
  evaluate(this, ["programme_on_time", "programme_published"]);
});

/** Whether a predicate's result holds. */
const holds = (result: unknown) => (typeof result === "boolean" ? result : (result as { holds: boolean }).holds);

Then('"programme_published" was reached at {string}, and "programme_on_time" holds', function (this: Context, at: string) {
  const found = results.get(this) ?? {};
  assert.deepEqual(found.programme_published, { holds: true, reachedAt: minutes(at) });
  assert.equal(holds(found.programme_on_time), true);
});

// The parts report shows milestones without kinds.
Given('a runs directory of an experiment with no "kind_factor", whose parts include "M1" reached at "day 5 10:00"', function (this: Context) {
  const directory = join(this.home, "runs", "e-milestones");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "index.jsonl"), `${JSON.stringify({ runId: "run-1", condition: "only", model: "scripted/one", replica: 1, seed: 1, status: "completed" })}\n`);
  // The part lines of an experiment with no kind_factor give no kind and no group.
  const part = (id: string, held: boolean, reachedAt?: string) => ({ type: "part", part: id, evaluated_at: "day 26 06:30", active: true, held, ...(reachedAt === undefined ? {} : { reached_at: reachedAt }), effort: { calls: 0, money: 0 }, misapplications: [] });
  const lines = [{ type: "run_setup", runId: "run-1", condition: "only", materials: [] }, part("M1", true, "day 5 10:00"), part("D0", false)];
  writeFileSync(join(directory, "run-1.jsonl"), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
});

When('"lab parts" reads it', async function (this: Context) {
  const { output, error } = await runCommand(this, "lab parts runs/e-milestones");
  this.labOutput = output;
  this.labError = error;
});

Then('it lists "M1" with "day 5 10:00" for that run, and no kinds table', function (this: Context) {
  assert.equal(this.labError, undefined, `"lab parts" failed: ${this.labError?.message}`);
  const output = this.labOutput ?? "";
  const parts = output.split(/^## /m).find((section) => section.startsWith("Parts")) ?? "";
  const rows = parts.split("\n").filter((line) => line.startsWith("|"));
  const cellsOf = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim());
  const headers = cellsOf(rows[0] ?? "");
  const m1 = rows.slice(2).map(cellsOf).find((cells) => cells[0] === "M1");
  assert.ok(m1 !== undefined, `the Parts table has no row for "M1":\n${output}`);
  assert.equal(m1[headers.indexOf("Reached at")], "day 5 10:00");
  assert.doesNotMatch(output, /^## Kinds/m);
});
