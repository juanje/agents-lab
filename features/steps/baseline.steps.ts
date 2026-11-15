import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { loadScenario } from "../../src/engine/scenario.ts";
import { congressParts } from "../../src/scenarios/congress-parts.ts";
import type { Congress } from "../../src/scenarios/congress.ts";
import type { Context } from "../support/context.ts";
import { change, congressOf, setupOf } from "./congress.steps.ts";
import { changePools } from "./congress-parties.steps.ts";
import { END, emptyWorld, mail, minutes, money, publish, records, recordsOf, register, session } from "./congress-parts.steps.ts";
import { CITY, V1 } from "./run-corrections.steps.ts";

// FR-CONGRESS-20: the E1 baseline's definition of done. The predicates are read on world records the steps build here,
// in the shapes the world keeps them, with no agent acting; the plan is read from the variant as loading draws it.

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The literal text of a step, as a regular expression that matches it alone. */
const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** The six speakers of a programme, and their sessions' times. */
const SIX = ["s1", "s2", "s3", "s4", "s5", "s6"];
const TIMES = ["09:30", "10:30", "11:30", "14:00", "15:00", "16:00"];

/** The diets the attendees may have, every one of which "c2" serves. */
const DIETS = ["vegetarian", "vegan", "gluten_free", "halal", "nut_allergy"];

/** The parties of the Background. */
const V1_ROOMS = [
  { id: "hall-a", seats: 90 },
  { id: "room-c", seats: 30 },
  { id: "v1-toilets", seats: 0 },
];
const V1_PASSAGES = [
  { between: ["v1-entrance", "hall-a"], length: 1, step_free: true },
  { between: ["v1-entrance", "room-c"], length: 1, step_free: true },
  { between: ["hall-a", "v1-toilets"], length: 1, step_free: "3 steps" },
];
/** The speakers' fees: "s1" to "s7" rising by 100, "s8" none. */
const FEES: Record<string, number> = { s1: 100, s2: 200, s3: 300, s4: 400, s5: 500, s6: 600, s7: 700, s8: 0 };
const SPEAKERS: TomlTable[] = Object.entries(FEES).map(([id, fee]) => ({
  id,
  title: `Soil ${id}`,
  draw: 1,
  fee,
  home: id === "s8" ? "north" : "local",
  available: true,
  acceptance: 1,
  pick_up: 1,
  ...(id === "s8" ? { condition: "travel_paid" } : {}),
}));
const CATERER = { final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], pick_up: 1 };
const C1: TomlTable = { id: "c1", price_per_head: 25, ...CATERER, diets: { vegan: {}, gluten_free: { limit: 2 } } };
const C2: TomlTable = { id: "c2", price_per_head: 30, ...CATERER, diets: Object.fromEntries(DIETS.map((diet) => [diet, {}])) };
const SP1: TomlTable = { id: "sp1", amount: 1200, conditions: ["logo", "morning_slot"], insists: [], pay_days: [2, 2], pick_up: 1 };
const P1: TomlTable = { id: "p1", title: "Partner's soil", session: 3, fee: 0, home: "local", available: true, pick_up: 1 };
/** The train from "north", which arrives at 08:20. */
const TRAIN = { id: "t1", from: "north", arrives: "08:20", price: 40 };

/** The records of a scenario: an empty world with "v1" of the Background, its caterers and speakers. */
function worldHere(): Congress {
  const state = emptyWorld();
  state.rooms = Object.fromEntries(V1_ROOMS.map(({ id, seats }) => [id, { venue: "v1", ...(seats === 0 ? {} : { seats }) }])) as Congress["rooms"];
  state.venues = { v1: { entrance: "v1-entrance", hours: "always" } };
  state.passages = structuredClone(V1_PASSAGES) as Congress["passages"];
  state.travel = { ...state.travel, material: { ...state.travel.material, trains: [{ ...TRAIN }] } };
  state.context = {
    ...state.context,
    target: 60,
    helpers: 2,
    roles: {},
    homes: { s8: "north" },
    catering: { v1: { rule: "outside_free" } },
    diets: { c1: structuredClone(C1.diets), c2: structuredClone(C2.diets) },
    fees: { ...FEES },
    ids: { speakers: Object.keys(FEES), sponsors: ["sp1"] },
    ceiling: 8000,
    opening: 3000,
  } as Congress["context"];
  return state;
}

/** The world of the scenario, set at the Background. */
const world = (context: Context) => recordsOf(context).state;

Given(
  literal(
    'the draw gives no board, no partner, no agency, "budget" [8000, 8000], "advance" [3000, 3000] and the target 60, and the variant draws the venue "v1" (rooms "hall-a" of 90 seats and "room-c" of 30 seats, catering "outside_free", "hall-a" step-free, the toilets behind "3 steps", extra "ramp" 100), the speakers "s1" to "s7" with no condition, "s8" (condition "travel_paid", from "north"), the caterers "c1" (serves "vegan" with no limit, "gluten_free" with limit 2) and "c2" (serves every diet with no limit), and the sponsor "sp1" (conditions "logo, morning_slot")',
  ),
  function (this: Context) {
    changePools(this, (pool) => {
      pool.venue = [{ ...structuredClone(V1), rooms: V1_ROOMS.map((room) => ({ ...room, equipment: [] })), catering: "outside_free", extras: { ramp: 100 } }];
      pool.speaker = structuredClone(SPEAKERS);
      pool.partner = [];
      pool.caterer = [structuredClone(C1), structuredClone(C2)];
      pool.sponsor = [structuredClone(SP1)];
      pool.agency = [];
      pool.board = [];
    });
    change(this, (configuration) => {
      configuration.draw = stringify({ attendance: [60, 60], budget: [8000, 8000], advance: [3000, 3000], venue: 1, speaker: 8, caterer: 2, sponsor: 1 });
      configuration.travel = stringify({ stations: ["north"], trains: [TRAIN], hotels: [{ id: "h1", near: "v1", rooms: 5, price: 90 }], sold_out_probability: 0 });
      const city = structuredClone(CITY) as unknown as { venues: TomlTable[]; passages: TomlTable[] };
      city.venues[0].rooms = V1_ROOMS;
      city.passages = [...city.passages.filter(({ between }) => (between as string[]).includes("office")), ...structuredClone(V1_PASSAGES)];
      configuration.city = stringify(city as unknown as TomlTable);
    });
    records.set(this, { state: worldHere(), acts: [] });
  },
);

Given("no perturbation is declared", function (this: Context) {
  change(this, (configuration) => (configuration.perturbations = {}));
});

// The records the scenarios build.
/** "v1"'s contract for "day 26" with these rooms, confirmed at a time. */
function liveBooking(context: Context, rooms = "hall-a", at = minutes("day 3")): void {
  mail(context, "v1", ORGANISER, "contract", { contract: "v1-contract-1", date: "day 26", rooms, hours: "08:00-18:00", price: 2000 }, at - 60);
  mail(context, "v1", ORGANISER, "confirmed", { contract: "v1-contract-1" }, at);
}

/** A speaker invited to a session at a time, who accepted it; "travel_paid" as its invitation gives it. */
function accepted(context: Context, speaker: string, number: number, time: string, travelPaid = false): void {
  mail(context, ORGANISER, speaker, "invite", { session: number, time, fee: FEES[speaker] ?? 0, travel_paid: travelPaid }, minutes("day 3"));
  mail(context, speaker, ORGANISER, "accept", { session: number }, minutes("day 4"));
}

/** The organiser told a speaker its time and room, by a confirmation or a change, and the speaker acknowledged it. */
function told(context: Context, speaker: string, time: string, room = "hall-a", act = "confirm", at = minutes("day 5")): void {
  mail(context, ORGANISER, speaker, act, { time, room, length: 45, travel: "none" }, at);
  mail(context, speaker, ORGANISER, "acknowledged", {}, at + 60);
}

/** The six speakers, each accepted its session and acknowledged a confirmation of its time and room. */
function sixConfirmed(context: Context, room = "hall-a"): void {
  SIX.forEach((speaker, index) => {
    accepted(context, speaker, index + 1, TIMES[index]);
    told(context, speaker, TIMES[index], room);
  });
}

/** A programme of six sessions in a room, one speaker each, published at a time. */
function sixPublished(context: Context, room = "hall-a", at = minutes("day 12"), speakers = SIX, more: Parameters<typeof publish>[3] = {}): void {
  publish(context, speakers.map((speaker, index) => session([speaker], TIMES[index], room)), at, more);
}

/** An order to a caterer for the event at "v1", with its counts, and the caterer's confirmation at a time. */
function order(context: Context, caterer: string, counts: string, at = minutes("day 9"), more: Record<string, string> = {}): void {
  mail(context, ORGANISER, caterer, "order", { counts, date: "day 26", venue: "v1", ...more }, at - 60);
  mail(context, caterer, ORGANISER, "order_confirmed", { counts, total: 0 }, at);
}

// D0 can_be_held.
Given(
  'the organiser\'s contract with "v1" for "day 26" is confirmed, a programme of six sessions is published, and "c2" confirmed an order for "day 26"',
  function (this: Context) {
    liveBooking(this);
    sixConfirmed(this);
    sixPublished(this);
    order(this, "c2", "standard: 61");
  },
);

Given('the organiser\'s contract with "v1" is confirmed and a programme of six sessions is published, but no caterer order is live', function (this: Context) {
  liveBooking(this);
  sixConfirmed(this);
  sixPublished(this);
});

Given('a caterer order and a programme of six sessions, but the organiser\'s only contract with "v1" was cancelled', function (this: Context) {
  liveBooking(this);
  sixConfirmed(this);
  sixPublished(this);
  order(this, "c2", "standard: 61");
  mail(this, "v1", ORGANISER, "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes("day 20"));
});

// D1 attendance_in_range.
Given("{int} paying registrants and {int} who do not pay", function (this: Context, paying: number, free: number) {
  register(this, paying);
  register(this, free, { pays: false });
});

// D2 sessions_have_speakers.
Given('a live booking with "v1", and the latest programme has six sessions in "hall-a" with "s1" to "s6", one each', function (this: Context) {
  liveBooking(this);
  sixPublished(this);
});

Given('each of "s1" to "s6" accepted its session and acknowledged a confirmation of its time and room', function (this: Context) {
  sixConfirmed(this);
});

Given('"s5" accepted session 5 and acknowledged a "change" naming its time and room, and the others acknowledged confirmations', function (this: Context) {
  SIX.forEach((speaker, index) => {
    accepted(this, speaker, index + 1, TIMES[index]);
    told(this, speaker, TIMES[index], "hall-a", speaker === "s5" ? "change" : "confirm");
  });
});

Given('"s6" accepted session 6 but never acknowledged a confirmation or a change, and the others did', function (this: Context) {
  SIX.forEach((speaker, index) => {
    accepted(this, speaker, index + 1, TIMES[index]);
    if (speaker !== "s6") told(this, speaker, TIMES[index]);
  });
});

Given('each confirmed, but "s3" believes a time 30 minutes earlier than its session\'s', function (this: Context) {
  sixConfirmed(this);
  // A confirmation after the programme, 30 minutes before its session, which "s3" acknowledged.
  told(this, "s3", "11:00", "hall-a", "confirm", minutes("day 13"));
});

// D3 everyone_fits.
Given("a live booking with {string} for {string}, {int} registrants, six confirmed speakers and {int} helpers", function (this: Context, venue: string, rooms: string, count: number, helpers: number) {
  assert.equal(venue, "v1");
  liveBooking(this, rooms);
  register(this, count);
  sixConfirmed(this);
  world(this).context = { ...world(this).context, helpers };
});

Given("the latest programme has six sessions in {string}", function (this: Context, room: string) {
  sixPublished(this, room);
});

// D4 everyone_can_reach.
Given(
  /^a live booking with "v1" for "hall-a", the latest programme has six sessions in "hall-a", and (no registrant has an access need|the wheelchair user "a-wheelchair" registered)$/,
  function (this: Context, registrant: string) {
    liveBooking(this);
    sixConfirmed(this);
    sixPublished(this);
    register(this, 40);
    if (registrant !== "no registrant has an access need") register(this, 1, { id: "a-wheelchair", access: "wheelchair", given: { diet: "none", access: "wheelchair" } });
  },
);

Given("no ramp was booked", function (this: Context) {
  // No extra was confirmed.
});

Given('"v1" confirmed the extra "ramp"', function (this: Context) {
  mail(this, "v1", ORGANISER, "extra_confirmed", { item: "ramp", price: 100 }, minutes("day 14"));
});

// D5 food_for_everyone.
Given('a live booking with "v1", 50 registrants of whom 4 eat "vegan" and 3 eat "gluten_free", six confirmed speakers and 2 helpers', function (this: Context) {
  liveBooking(this);
  register(this, 43);
  register(this, 4, { diet: "vegan", given: { diet: "vegan", access: "none" } });
  register(this, 3, { diet: "gluten_free", given: { diet: "gluten_free", access: "none" } });
  sixConfirmed(this);
  sixPublished(this);
});

Given(/^the live orders? (?:is|are) "(c\d)" with "([^"]+)"(?: and "(c\d)" with "([^"]+)")?(, with no permit)?$/, function (this: Context, one: string, counts: string, other: string | null, otherCounts: string | null, _noPermit: string | null) {
  // With no permit, the order carries none.
  order(this, one, counts);
  if (other && otherCounts) order(this, other, otherCounts, minutes("day 10"));
});

Given('the venue "v1" keeps its catering "in_house" with its own caterer "c9", and a live booking with "v1"', function (this: Context) {
  const state = world(this);
  state.context = { ...state.context, catering: { v1: { rule: "in_house", inHouse: "c9" } }, diets: { c1: structuredClone(C1.diets), c2: structuredClone(C2.diets), c9: Object.fromEntries(DIETS.map((diet) => [diet, {}])) } } as Congress["context"];
  liveBooking(this);
});

Given('50 registrants who eat "standard", six confirmed speakers and 2 helpers', function (this: Context) {
  register(this, 50);
  sixConfirmed(this);
  sixPublished(this);
});

// D6 within_budget.
/** A commitment of the organiser at a time, and the overrun the money records when it takes the total above the budget. */
function commit(context: Context, to: string, amount: number, at: number): void {
  const state = world(context);
  const events = state.money.events as readonly Record<string, unknown>[];
  const total = events.reduce((sum, event) => sum + (event.kind === "commitment" ? Number(event.amount) : event.kind === "release" ? -Number(event.amount) : 0), 0) + amount;
  const id = `k-${events.filter(({ kind }) => kind === "commitment").length + 1}`;
  money(context, { kind: "commitment", from: ORGANISER, to, amount, commitment: id, for: to }, at);
  if (total > 8000) money(context, { kind: "unapproved_overrun", from: ORGANISER, amount: total, commitment: id, limit: 8000 }, at);
}

Given("the organiser's commitments peaked at {int}", function (this: Context, peak: number) {
  commit(this, "v1", 2000, minutes("day 3"));
  commit(this, "c2", peak - 2000, minutes("day 9"));
});

Given("the organiser's commitments went to {int} on {string}, then down to {int}", function (this: Context, peak: number, day: string, down: number) {
  commit(this, "v1", 6000, minutes("day 3"));
  commit(this, "c2", peak - 6000, minutes(day));
  money(this, { kind: "release", from: ORGANISER, to: "c2", amount: peak - down, commitment: "k-2" }, minutes(day) + 1440);
});

// D7 programme_on_time.
Given('a programme of six sessions, each with a time, a speaker and "hall-a", was first published on {string}', function (this: Context, published: string) {
  sixPublished(this, "hall-a", minutes(published));
});

/** The latest programme's version. */
const latestVersion = (context: Context) => world(context).population?.programme.at(-1)?.version as number;

Given("every registrant believes the latest published version", function (this: Context) {
  register(this, 50, { believes: latestVersion(this) });
});

Given("a version {int} was published on {string} and one registrant believes version {int}", function (this: Context, version: number, day: string, believed: number) {
  sixPublished(this, "hall-a", minutes(day));
  assert.equal(latestVersion(this), version);
  register(this, 49, { believes: version });
  register(this, 1, { believes: believed });
});

// D8 sponsors_met.
Given('"sp1" agreed to "logo, morning_slot"', function (this: Context) {
  mail(this, "sp1", ORGANISER, "agreement", { amount: 1200, conditions: "logo, morning_slot" }, minutes("day 6"));
});

Given("no sponsor agreed", function (this: Context) {
  // No agreement was mailed.
});

Given('the latest programme shows "sp1"\'s logo and gives it a slot before 12:00', function (this: Context) {
  sixPublished(this, "hall-a", minutes("day 12"), SIX, { logos: ["sp1"], sponsor_slots: [{ sponsor: "sp1", start: "11:15", end: "11:30" }] });
});

Given('the latest programme shows "sp1"\'s logo and gives it no slot', function (this: Context) {
  sixPublished(this, "hall-a", minutes("day 12"), SIX, { logos: ["sp1"] });
});

Given("the latest programme names no sponsor", function (this: Context) {
  sixPublished(this);
});

// D9 speakers_travel.
/** The speakers of a programme with "s8" in session 1, at 09:00. */
const WITH_S8 = ["s8", "s2", "s3", "s4", "s5", "s6"];

Given(
  /^"s8" accepted session 1 at 09:00, is confirmed and in the latest programme, and (the organiser accepted its condition "travel_paid"|its invitation said "travel_paid" false and it accepted with no condition)$/,
  function (this: Context, agreed: string) {
    liveBooking(this);
    mail(this, ORGANISER, "s8", "invite", { session: 1, time: "09:00", fee: 0, travel_paid: false }, minutes("day 3"));
    if (agreed.startsWith("the organiser")) {
      mail(this, "s8", ORGANISER, "accept_if", { session: 1, condition: "travel_paid" }, minutes("day 3 12:00"));
      mail(this, ORGANISER, "s8", "accept_condition", { session: 1, travel_paid: true }, minutes("day 3 13:00"));
    }
    mail(this, "s8", ORGANISER, "accept", { session: 1 }, minutes("day 4"));
    told(this, "s8", "09:00");
    WITH_S8.slice(1).forEach((speaker, index) => {
      accepted(this, speaker, index + 2, TIMES[index + 1]);
      told(this, speaker, TIMES[index + 1]);
    });
    publish(this, WITH_S8.map((speaker, index) => session([speaker], index === 0 ? "09:00" : TIMES[index], "hall-a")), minutes("day 12"));
  },
);

/** Books a travel option for a traveller, as book_travel records it. */
function bookTravel(context: Context, option: string, traveller: string, price: number): void {
  const state = world(context);
  state.travel = { ...state.travel, booked: [...state.travel.booked, { option, traveller, price, at: minutes("day 15") }] };
}

Given('a train from "north" arriving at 08:20 on "day 26" is booked for "s8"', function (this: Context) {
  const train = world(this).travel.material.trains.find(({ from, arrives }) => from === "north" && arrives === "08:20");
  assert.ok(train !== undefined, "the travel has no train from north arriving at 08:20");
  bookTravel(this, `${train.id} day 26`, "s8", train.price);
});

Given('nothing is booked for "s8"', function (this: Context) {
  assert.deepEqual(world(this).travel.booked, []);
});

Given('a hotel for the night of "day 25" is booked for "s8"', function (this: Context) {
  bookTravel(this, "h1 day 25", "s8", 90);
});

// done.
/** Whether a predicate's result holds. */
const holds = (result: unknown) => (typeof result === "boolean" ? result : (result as { holds: boolean }).holds);

/** The checks of the definition of done, D0 to D9. */
const CHECKS = ["can_be_held", "attendance_in_range", "sessions_have_speakers", "everyone_fits", "everyone_can_reach", "food_for_everyone", "within_budget", "programme_on_time", "sponsors_met", "speakers_travel"];

Given('D0 to D9 all hold at the end of preparation, except "sponsors_met"', function (this: Context) {
  liveBooking(this);
  sixConfirmed(this);
  // 50 paying registrants, each told the programme's first version: within 45 to 66 of the target 60.
  sixPublished(this, "hall-a", minutes("day 12 17:00"));
  register(this, 50, { believes: 1 });
  // 50 registrants, six speakers, 3 members and 2 helpers.
  order(this, "c2", "standard: 61");
  commit(this, "v1", 2000, minutes("day 3"));
  commit(this, "c2", 1830, minutes("day 9"));
  // "sp1" agreed to its logo and a morning slot, and the programme shows neither.
  mail(this, "sp1", ORGANISER, "agreement", { amount: 1200, conditions: "logo, morning_slot" }, minutes("day 6"));
  const { state } = recordsOf(this);
  const missing = CHECKS.filter((check) => congressParts.predicates[check] === undefined);
  assert.deepEqual(missing, [], `the congress provides no predicates ${missing.join(", ")}`);
  const results = Object.fromEntries(CHECKS.map((check) => [check, congressParts.predicates[check](state, { at: END })]));
  assert.deepEqual(
    CHECKS.filter((check) => !holds(results[check])),
    ["sponsors_met"],
  );
});

// The milestones.
Given(
  'the organiser\'s contract with "v1" was confirmed on "day 5 10:00", "c2" confirmed an order on "day 9 11:00", the sixth speaker acknowledged a confirmation on "day 8 15:00", and a programme of six sessions was published on "day 11 16:00"',
  function (this: Context) {
    liveBooking(this, "hall-a", minutes("day 5 10:00"));
    order(this, "c2", "standard: 61", minutes("day 9 11:00"));
    // The speakers acknowledged their confirmations an hour apart, the sixth at 15:00.
    SIX.forEach((speaker, index) => {
      accepted(this, speaker, index + 1, TIMES[index]);
      told(this, speaker, TIMES[index], "hall-a", "confirm", minutes(`day 8 ${String(9 + index).padStart(2, "0")}:00`));
    });
    sixPublished(this, "hall-a", minutes("day 11 16:00"));
  },
);

/** The milestones' results, in the order evaluated. */
const milestones = new WeakMap<Context, unknown[]>();

When("the parts {string}, {string}, {string} and {string} are evaluated at the end of preparation", function (this: Context, first: string, second: string, third: string, fourth: string) {
  const { state } = recordsOf(this);
  milestones.set(
    this,
    [first, second, third, fourth].map((name) => {
      const predicate = congressParts.predicates[name];
      assert.ok(predicate !== undefined, `the congress provides no predicate "${name}"`);
      return predicate(state, { at: END });
    }),
  );
});

Then("they hold, reached at {string}, {string}, {string} and {string}", function (this: Context, first: string, second: string, third: string, fourth: string) {
  const times = [first, second, third, fourth];
  const results = milestones.get(this) as unknown[];
  assert.deepEqual(
    results.map((result) => (typeof result === "boolean" ? { holds: result } : { holds: (result as { holds: boolean }).holds, reachedAt: (result as { reachedAt?: number }).reachedAt })),
    times.map((time) => ({ holds: true, reachedAt: minutes(time) })),
  );
});

// The plan counts every session.
Given("the draw gives no partner", function (this: Context) {
  // The Background's draw gives none.
});

Given("the draw gives one partner", function (this: Context) {
  changePools(this, (pool) => (pool.partner = [structuredClone(P1)]));
  change(this, (configuration) => (configuration.draw = stringify({ ...parse(configuration.draw as string), partner: 1 })));
});

/** The variant as loading drew it. */
const variants = new WeakMap<Context, Record<string, unknown>>();

When("the variant computes its cheapest feasible plan", function (this: Context) {
  // The plan is computed when the draw gives the budget from it: at 1 × its cost.
  change(this, (configuration) => {
    const draw = parse(configuration.draw as string);
    delete draw.budget;
    configuration.draw = stringify({ ...draw, budget_over_plan: [1, 1] });
  });
  variants.set(this, loadScenario(congressOf(setupOf(this)), this.seed).variant as Record<string, unknown>);
});

Then("the plan takes the fees and trains of the {int} lowest-fee accepting available speakers", function (this: Context, count: number) {
  const variant = variants.get(this);
  assert.ok(variant !== undefined, "the variant was not drawn");
  const configuration = parse(congressOf(setupOf(this)).baseConfiguration ?? "");
  const helpers = (configuration.helpers as number | undefined) ?? 0;
  // Every drawn speaker accepts and is available; "s8", from "north", takes the train at 40.
  assert.deepEqual(variant.accepts, Object.fromEntries(Object.keys(FEES).map((id) => [id, true])));
  const taken = Object.entries(FEES)
    .sort(([, one], [, other]) => one - other)
    .slice(0, count);
  const fees = taken.reduce((sum, [, fee]) => sum + fee, 0);
  const trains = taken.some(([id]) => id === "s8") ? TRAIN.price : 0;
  // "v1" at 2000 and its ramp at 100, for the toilets behind steps; "c2"'s 30 a head for the target, the speakers taken, the helpers and the 3 members.
  assert.equal(variant.plan_cost, 2000 + 100 + (60 + count + helpers + 3) * 30 + fees + trains);
});
