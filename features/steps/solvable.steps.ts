import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { readExperiment, replicaSeed } from "../../src/engine/experiment.ts";
import { type Inventory, inventory, inventoryMarkdown } from "../../src/engine/inventory.ts";
import { Random } from "../../src/engine/random.ts";
import { loadScenario } from "../../src/engine/scenario.ts";
import * as congress from "../../src/scenarios/congress.ts";
import { type Population, registrationProbability } from "../../src/scenarios/population.ts";
import type { Context } from "../support/context.ts";
import { change, congressOf, hourMsOf, organiserTurns, setupOf } from "./congress.steps.ts";
import { before, changePools, minutesOf, ranLines } from "./congress-parties.steps.ts";
import { V1, setUpCorrectionsCongress } from "./run-corrections.steps.ts";
import { runTheScenario } from "./tool.steps.ts";

// FR-CONGRESS-21: a replica the organiser can complete, in more than one way. Its scenarios have no Background: each
// sets up FR-CONGRESS-09's congress with parties of its own, as FR-CONGRESS-20's scenarios and E1's baseline give them.

/** The literal text of a step, as a regular expression that matches it alone. */
const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** A plan as the solvability check gives it. */
interface Plan {
  venue: string;
  room: string;
  ramp: boolean;
  orders: { caterer: string; counts: Record<string, number>; permits: { diet?: string; price: number }[] }[];
  speakers: { id: string }[];
  price: number;
  cost: number;
}

/** The solvability check's counts, as the variant gives them. */
interface Solvable {
  counts: Record<string, number>;
  solutions: number;
  venues: string[];
  draws: number;
  cheapest?: { cost: number; venue: string };
}

/** A venue of the draw with its rooms: "hall-a" of 90 seats unless given. */
const venue = (id: string, more: TomlTable = {}): TomlTable => ({ ...structuredClone(V1), id, rooms: [{ id: `${id}-hall`, seats: 90, equipment: [] }], price: 2000, extras: {}, catering: "outside_free", enquiries_per_day: 0, ...more });

/** Eight plain speakers, local, each accepting, with no fee and a draw of 1. */
const SPEAKERS: TomlTable[] = Array.from({ length: 8 }, (_, index) => ({ id: `s${index + 1}`, title: `Soil ${index + 1}`, draw: 1, fee: 0, home: "local", available: true, acceptance: 1, pick_up: 1 }));

/** A caterer that serves vegan and gluten-free meals with no limit, at 30 a head, with no minimum. */
const C1: TomlTable = { id: "c1", price_per_head: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], pick_up: 1, diets: { vegan: {}, gluten_free: {} } };

/**
 * An attendees material whose demand reaches the target at a price: a pool of twice the target, each registering at 0.2
 * a day (more in the last two weeks), every registrant paying and none cancelling.
 */
const ATTENDEES: TomlTable = { pool_factor: 2, base_per_day: 0.2, unannounced: 0.5, promotion_factor: 1, payment_fee_share: 0, cancel_share: 0, consent_share: 1, pay_share: 1, no_show_share: 0, diets: { none: 1 }, access: { none: 1 }, fixed: [] };

/**
 * FR-CONGRESS-09's congress, with these venues (each in the city with its rooms, joined to the office step-free), eight
 * speakers, the caterer "c1", no sponsor, a target attendance of 50, a budget of 20000 and similar events priced around 40.
 */
function congressWith(context: Context, venues: TomlTable[], draw: TomlTable = {}): void {
  setUpCorrectionsCongress(context, "day 1 Monday 09:00", 60000, 60);
  changePools(context, (pool) => {
    pool.venue = structuredClone(venues);
    pool.speaker = structuredClone(SPEAKERS);
    pool.partner = [];
    pool.caterer = [structuredClone(C1)];
    pool.sponsor = [];
    pool.agency = [];
    pool.board = [];
  });
  change(context, (configuration) => {
    const topics = (parse(configuration.pools as string).topics ?? []) as string[];
    configuration.draw = stringify({ attendance: [50, 50], budget: [20000, 20000], advance: [3000, 3000], venue: venues.length, speaker: 8, caterer: 1, ...draw });
    configuration.attendees = stringify(ATTENDEES);
    configuration.similar_events = stringify({ events: topics.flatMap((topic) => [30, 40, 50].map((price, index) => ({ topic, name: `${topic} ${index + 1}`, price, size: 60 }))) });
    configuration.travel = stringify({ stations: ["north"], trains: [], hotels: [], sold_out_probability: 0 });
    configuration.perturbations = {};
    configuration.city = stringify(cityOf(venues));
  });
}

/** The city of these venues: each entrance joined to the office, each room to its entrance, step-free. */
function cityOf(venues: TomlTable[]): TomlTable {
  return {
    places: [{ id: "office" }],
    venues: venues.map(({ id, rooms }) => ({ id, entrance: `${id}-entrance`, hours: "always", rooms: (rooms as TomlTable[]).map(({ id: room, seats }) => ({ id: room, seats })) })),
    passages: venues.flatMap(({ id, rooms }) => [{ between: ["office", `${id}-entrance`], length: 10, step_free: true }, ...(rooms as TomlTable[]).map(({ id: room }) => ({ between: [`${id}-entrance`, room], length: 1, step_free: true }))]),
  } as unknown as TomlTable;
}

/** Changes a TOML text of the configuration. */
function changeText(context: Context, key: string, changing: (table: TomlTable) => void): void {
  change(context, (configuration) => {
    const table = parse(configuration[key] as string);
    changing(table);
    configuration[key] = stringify(table);
  });
}

// Other customers' enquiries.
/** "v1"'s enquiry times in the run before the last, and in the last, as its outcome gives them. */
const enquiries = new WeakMap<Context, string[][]>();

/** The organiser's turns that mail "v1" twenty times before "day 6", every 5 world hours from the start. */
const twentyMails = (context: Context) =>
  organiserTurns(
    Array.from({ length: 20 }, (_, index) => `"send_mail" to "v1" with the act "ask_quote", date "day 26" and attendance ${60 + index}, then wait 5 world hours`)
      .join(", then ")
      .concat(', then "check_time"')
      .replace(/^"send_mail"/, 'call "send_mail"'),
    hourMsOf(context),
  );

Given('two runs with the same seed, in one of which the organiser mails "v1" twenty times before "day 6"', function (this: Context) {
  // "v1" has other customers enquiring about 1.5 times a day.
  congressWith(this, [venue("v1", { enquiries_per_day: 1.5 })]);
  change(this, (configuration) => (configuration.attendees = stringify({ ...ATTENDEES, base_per_day: 0 })));
  assert.ok(twentyMails(this).length === 21);
});

/** "v1"'s enquiries in a run's log, at their world times. */
function enquiriesIn(context: Context): string[] {
  const outcome = ranLines(context).find((line) => line.type === "participant_outcome" && line.participant === "v1")?.outcome as { history: string } | undefined;
  assert.ok(outcome !== undefined, '"v1" gave no outcome');
  return (JSON.parse(outcome.history) as { at: string; event: string }[]).filter(({ event }) => event === "enquiry").map(({ at }) => at);
}

When('both runs reach "day 10"', { timeout: 180_000 }, async function (this: Context) {
  this.timeLimitMs = ((minutesOf("day 10 09:00") - minutesOf("day 1 09:00")) / 60) * hourMsOf(this);
  await runTheScenario(this);
  const quiet = enquiriesIn(this);
  before(this, twentyMails(this));
  await runTheScenario(this);
  enquiries.set(this, [quiet, enquiriesIn(this)]);
});

Then('"v1"\'s other customers enquired at the same world times in both', function (this: Context) {
  const [quiet, mailed] = enquiries.get(this) ?? [];
  // The organiser's mail reached "v1".
  assert.ok(ranLines(this).filter((line) => line.type === "message_sent" && line.from === "organiser" && line.to === "v1").length >= 20);
  assert.ok((quiet ?? []).length > 3, `"v1" had too few enquiries to compare: ${JSON.stringify(quiet)}`);
  assert.deepEqual(mailed, quiet);
});

// The check counts the plans.
/** The variant's draw, or its refusal, and the configuration it completed. */
interface Drawn {
  variant?: Record<string, unknown>;
  configuration?: TomlTable;
  error?: Error;
}
const drawnOf = new WeakMap<Context, Drawn>();

/** The venues the seed's first draw gives, with no solvability check. */
const firstVenues = (context: Context) => ((loadScenario(congressOf(setupOf(context)), context.seed).variant as { chosen: { venue: string[] } }).chosen.venue);

Given("a draw whose parties allow plans on venues {string} and {string}", function (this: Context, one: string, other: string) {
  congressWith(this, [venue(one), venue(other)]);
});

Given('a draw whose parties allow plans on "v1" only', function (this: Context) {
  // "v3"'s only room seats 30, below the attendance: of two venues drawn from three, a draw with "v3" has plans on one.
  congressWith(this, [venue("v1"), venue("v2"), venue("v3", { rooms: [{ id: "v3-hall", seats: 30, equipment: [] }] })], { venue: 2 });
  // A seed whose first draw has "v3".
  for (this.seed = 1; !firstVenues(this).includes("v3"); this.seed += 1) assert.ok(this.seed < 100, "no seed draws v3 first");
});

Given("a draw whose parties allow no plan, in any of 100 draws", function (this: Context) {
  // A budget of 100 pays for no venue.
  congressWith(this, [venue("v1"), venue("v2")], { budget: [100, 100] });
});

When("the variant is drawn with {string}", function (this: Context, written: string) {
  // "[solvable] a = 1, b = 2": the table and its keys, each on a line of its own.
  const solvable = parse(written.replace(/\]\s*/, "]\n").replace(/,\s*/g, "\n")).solvable as TomlTable;
  changeText(this, "draw", (draw) => (draw.solvable = solvable));
  try {
    const loaded = loadScenario(congressOf(setupOf(this)), this.seed);
    drawnOf.set(this, { variant: loaded.variant as Record<string, unknown>, configuration: loaded.configuration as TomlTable });
  } catch (error) {
    drawnOf.set(this, { error: error as Error });
  }
});

/** The variant's solvability, as its line gives it. */
function solvableOf(context: Context): Solvable {
  const { variant, error } = drawnOf.get(context) ?? {};
  assert.equal(error, undefined, `the variant was refused: ${error?.message}`);
  const solvable = variant?.solvable as Solvable | undefined;
  assert.ok(solvable !== undefined, `the variant gives no solvability: ${JSON.stringify(variant)}`);
  return solvable;
}

Then("the variant is kept, and lab inventory gives their count", function (this: Context) {
  const solvable = solvableOf(this);
  assert.equal(solvable.draws, 1);
  assert.ok(solvable.solutions >= 2, `${solvable.solutions} global solutions`);
  assert.deepEqual([...solvable.venues].sort(), ["v1", "v2"]);
  for (const check of ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"]) assert.ok((solvable.counts[check] ?? 0) > 0, `${check} counts ${solvable.counts[check]}`);
  assert.ok(solvable.cheapest !== undefined && ["v1", "v2"].includes(solvable.cheapest.venue) && solvable.cheapest.cost > 0);
  // What lab inventory prints of the world.
  const world = congress.congressScenario.worldInventory?.(drawnOf.get(this)?.configuration as never) as Record<string, unknown> | undefined;
  assert.deepEqual(world?.solvable, solvable);
});

Then("the variant is redrawn", function (this: Context) {
  const solvable = solvableOf(this);
  assert.ok(solvable.draws > 1, `the variant was drawn ${solvable.draws} time(s)`);
  assert.deepEqual([...solvable.venues].sort(), ["v1", "v2"]);
});

Then('the variant is refused, naming "solvable"', function (this: Context) {
  const { error } = drawnOf.get(this) ?? {};
  assert.ok(error !== undefined, "the variant was not refused");
  assert.match(error.message, /solvable/);
  assert.match(error.message, /100/);
});

// A plan meets each check as the world allows.
/** The difference a scenario's Given made, by which the Then reads which check leaves "v1" without plans. */
const differences = new WeakMap<Context, string>();

/** The venue "v1" of a one-venue draw, with its one room of 90 seats, and a demand that reaches the target. */
const oneVenue = (context: Context, more: TomlTable = {}, draw: TomlTable = {}) => congressWith(context, [venue("v1", more)], draw);

Given("a draw with one venue {string} and its only room seats 70 for a target attendance of 75", function (this: Context, id: string) {
  oneVenue(this, { rooms: [{ id: `${id}-hall`, seats: 70, equipment: [] }] }, { attendance: [75, 75] });
  differences.set(this, "D3");
});

Given(literal('a draw with one venue "v1" and a wheelchair attendee, its toilets behind "3 steps", and a "ramp" extra of 100'), function (this: Context) {
  oneVenue(this, { extras: { ramp: 100 }, rooms: [{ id: "v1-hall", seats: 90, equipment: [] }, { id: "v1-toilets", seats: 0, equipment: [] }] });
  change(this, (configuration) => {
    configuration.attendees = stringify({ ...ATTENDEES, fixed: [{ id: "a-wheelchair", access: "wheelchair", between: ["day 9 00:00", "day 17 23:59"] }] });
    const city = parse(configuration.city as string) as unknown as { passages: TomlTable[] };
    city.passages = city.passages.map((passage) => ((passage.between as string[]).includes("v1-toilets") ? { between: ["v1-hall", "v1-toilets"], length: 1, step_free: "3 steps" } : passage));
    configuration.city = stringify(city as unknown as TomlTable);
  });
  differences.set(this, "ramp");
});

Given(literal('a draw with one venue "v1" and catering "in_house" whose caterer serves at most 5 gluten-free, 7 expected'), function (this: Context) {
  // 7 of a target of 70 are gluten-free: 70 × 0.1.
  oneVenue(this, { catering: "in_house", outside_diet_fee_per_head: 3 }, { attendance: [70, 70] });
  changePools(this, (pool) => pool.caterer.push({ ...structuredClone(C1), id: "c9", in_house_for: "v1", diets: { gluten_free: { limit: 5 } } }));
  change(this, (configuration) => (configuration.attendees = stringify({ ...ATTENDEES, diets: { none: 0.9, gluten_free: 0.1 } })));
  differences.set(this, "permit");
});

/** The day of the first enquiry that books "v1"'s event day, with its other customers enquiring at a rate, by a seed: each enquiry an interval, then whether it books with 0.5. */
function firstBookingDay(seed: number, rate: number): number | undefined {
  const random = Random.derive(seed, "enquiries of v1");
  let at = minutesOf("day 1 09:00");
  for (;;) {
    at += (-Math.log(1 - random.next()) / rate) * 1440;
    if (at > minutesOf("day 26 00:00")) return undefined;
    if (random.next() < 0.5) return Math.floor(at / 1440) + 1;
  }
}

Given('a draw with one venue "v1" and its other customers\' sequence books the event day on "day 4"', function (this: Context) {
  oneVenue(this, { enquiries_per_day: 0.3 });
  for (this.seed = 1; firstBookingDay(this.seed, 0.3) !== 4; this.seed += 1) assert.ok(this.seed < 1000, "no seed books day 4");
  differences.set(this, "D0");
});

Given('a draw with one venue "v1" and a budget 100 below its cheapest plan\'s commitments', function (this: Context) {
  oneVenue(this);
  differences.set(this, "D6");
});

/** The plans the check gives, and its counts. */
const plansOf = new WeakMap<Context, { plans: Plan[]; counts: Record<string, number> }>();

/** The congress's solvability check, as it gives the plans of a completed configuration. */
function check(context: Context): { plans: Plan[]; counts: Record<string, number>; cheapest?: { cost: number } } {
  const solvability = (congress as Record<string, unknown>).solvabilityOf as ((configuration: unknown, seed: number) => { plans: Plan[]; counts: Record<string, number>; cheapest?: { cost: number } }) | undefined;
  assert.ok(solvability !== undefined, "the congress gives no solvability check");
  changeText(context, "draw", (draw) => (draw.solvable = { min_solutions: 0, min_venues: 0 }));
  const loaded = loadScenario(congressOf(setupOf(context)), context.seed);
  return solvability(loaded.configuration, context.seed);
}

When("the variant counts its plans", function (this: Context) {
  if (differences.get(this) === "D6") {
    // The budget, 100 below the cheapest plan's commitments.
    const cheapest = check(this).cheapest;
    assert.ok(cheapest !== undefined, "the draw has no plan to set the budget below");
    changeText(this, "draw", (draw) => (draw.budget = [cheapest.cost - 100, cheapest.cost - 100]));
  }
  plansOf.set(this, check(this));
});

/** The plans the check counted. */
function counted(context: Context) {
  const found = plansOf.get(context);
  assert.ok(found !== undefined, "the plans were not counted");
  return found;
}

Then('no plan has "v1"', function (this: Context) {
  const { plans, counts } = counted(this);
  assert.deepEqual(
    plans.filter(({ venue: id }) => id === "v1"),
    [],
  );
  // The check that leaves it none: the others have options.
  const reason = differences.get(this) as string;
  assert.equal(counts[reason], 0, `${reason} counts ${counts[reason]}`);
  for (const other of ["D2", "D5"].filter((each) => each !== reason)) assert.ok(counts[other] > 0, `${other} counts ${counts[other]}`);
});

Then("its plans book the ramp", function (this: Context) {
  const { plans } = counted(this);
  assert.ok(plans.length > 0, "the check gives no plan");
  assert.deepEqual(
    plans.filter(({ ramp }) => !ramp),
    [],
  );
});

Then("its plans add a permit and an outside order for 2 gluten-free meals, or have none", function (this: Context) {
  const { plans } = counted(this);
  for (const plan of plans) {
    const inHouse = plan.orders.find(({ caterer }) => caterer === "c9");
    const outside = plan.orders.filter(({ caterer }) => caterer !== "c9");
    assert.ok(inHouse !== undefined && (inHouse.counts.gluten_free ?? 0) === 5, JSON.stringify(plan.orders));
    assert.deepEqual(
      outside.map(({ counts }) => counts),
      [{ gluten_free: 2 }],
    );
    assert.deepEqual(
      outside.flatMap(({ permits }) => permits),
      [{ diet: "gluten_free", price: 6 }],
    );
  }
});

// FR-CONGRESS-22: the solvable price leaves a margin, and the inventory gives each replica's variant.
/** The page opened and registration announced, as the check takes them: "day 2 09:00" (FR-CONGRESS-22). */
const OPENED = minutesOf("day 2 09:00");

/**
 * The expected paying registrants of a one-venue draw at a price, as the contract defines them: the pool, each person
 * registering by FR-POPULATION-01's hourly probability from the page's opening to the end of preparation, the
 * programme's draw from six of the eight speakers (a draw of 1 each), every registrant paying and none cancelling.
 */
function expectedAt(price: number, attendees: TomlTable, referencePrice: number, target: number, eventDay: number): number {
  const population = {
    material: attendees,
    page: { open: true, price, required_fields: [], info: [], waiting_list: false },
    announced: true,
    referencePrice,
    programme: [{ version: 1, sessions: [{ start: "09:00", end: "09:45", title: "", speakers: ["s1", "s2", "s3", "s4", "s5", "s6"], room: "" }], breaks: [], sponsor_slots: [], logos: [] }],
    draws: { s1: 1, s2: 1, s3: 1, s4: 1, s5: 1, s6: 1 },
    promotions: [],
    eventDay,
  } as unknown as Population;
  let staying = 1;
  for (let hour = OPENED + 60; hour < (eventDay - 1) * 1440; hour += 60) staying *= 1 - registrationProbability({ population }, hour);
  return Math.round((attendees.pool_factor as number) * target) * (1 - staying);
}

/** The highest whole price at which the expected paying registrants reach a share of the target. */
function highestAt(share: number, expected: (price: number) => number, target: number): number {
  let price = 0;
  while (expected(price + 1) >= share * target) price += 1;
  return price;
}

Given("a draw whose plans' expected paying registrants reach {float} of the target at a price of {int} and {float} at a price of {int}", function (this: Context, upper: number, upperPrice: number, lower: number, lowerPrice: number) {
  // A pool of 46 for the target of 50, registering at 0.0375 a day, and similar events whose middle price is 44.5.
  const attendees = { ...ATTENDEES, pool_factor: 0.92, base_per_day: 0.0375 };
  oneVenue(this);
  change(this, (configuration) => {
    configuration.attendees = stringify(attendees);
    const topics = (parse(configuration.pools as string).topics ?? []) as string[];
    configuration.similar_events = stringify({ events: topics.flatMap((topic) => [44, 44.5, 45].map((price, index) => ({ topic, name: `${topic} ${index + 1}`, price, size: 60 }))) });
  });
  const eventDay = loadScenario(congressOf(setupOf(this)), this.seed).configuration.event_day as number;
  const expected = (price: number) => expectedAt(price, attendees, 44.5, 50, eventDay);
  assert.deepEqual([highestAt(upper, expected, 50), highestAt(lower, expected, 50)], [upperPrice, lowerPrice]);
  differences.set(this, "margin");
});

Then("each plan's price is {int} or lower", function (this: Context, highest: number) {
  const { plans } = counted(this);
  assert.ok(plans.length > 0, "the check gives no plan");
  assert.deepEqual(
    plans.filter(({ price }) => price > highest).map(({ price }) => price),
    [],
  );
});

/** The inventory of an experiment of two replicas, and the Markdown "lab inventory" prints of it. */
const inventories = new WeakMap<Context, { made: Inventory; printed: string }>();

Given('an experiment with two replicas of different seeds and "[solvable]" in its draw', function (this: Context) {
  congressWith(this, [venue("v1"), venue("v2")]);
  changeText(this, "draw", (draw) => (draw.solvable = { min_solutions: 2, min_venues: 2 }));
});

When('"lab inventory" runs on it', function (this: Context) {
  const experiment = readExperiment(
    [
      'id = "e"',
      'scenario = "congress"',
      'models = ["scripted/one"]',
      'thinking_level = "off"',
      "replicas = 2",
      "seed = 1",
      "[limits]",
      "time_limit_ms = 1000",
      "activations_per_agent = 1",
      "parallelism_limit = 1",
      "model_turn_timeout_ms = 500",
      "[compaction]",
      "enabled = false",
      "[conditions.only]",
      "",
    ].join("\n"),
  );
  // What lab inventory prints: the inventory of the experiment over its scenario, as Markdown.
  const made = inventory(experiment, congressOf(setupOf(this)));
  inventories.set(this, { made, printed: inventoryMarkdown(made) });
});

Then("it gives, for each replica, its seed, its drawn venues, its solvability counts, and its kept plans with their price and expected paying registrants", function (this: Context) {
  const { made, printed } = inventories.get(this) ?? {};
  assert.ok(made !== undefined && printed !== undefined, "lab inventory did not run");
  const replicas = (made as { replicas?: { replica: number; seed: number; variant: Record<string, unknown>; plans?: Record<string, unknown>[] }[] }).replicas ?? [];
  assert.deepEqual(
    replicas.map(({ replica, seed }) => [replica, seed]),
    [1, 2].map((replica) => [replica, replicaSeed(1, replica)]),
  );
  for (const { replica, seed, variant, plans = [] } of replicas) {
    // Each replica's own draw, as loading that replica draws it.
    assert.deepEqual(variant, loadScenario(congressOf(setupOf(this)), seed).variant);
    assert.deepEqual([...(variant.chosen as { venue: string[] }).venue].sort(), ["v1", "v2"]);
    const solvable = variant.solvable as Solvable;
    assert.ok(solvable.solutions >= 2 && Object.keys(solvable.counts).length === 10, JSON.stringify(solvable));
    assert.ok(plans.length > 0, `replica ${replica} gives no plans`);
    for (const plan of plans) assert.ok(typeof plan.price === "number" && plan.price > 0 && typeof plan.expected === "number" && plan.expected >= 0.85 * 50, JSON.stringify(plan));
    // The printed inventory gives each replica, its seed and its plans.
    assert.ok(printed.includes(`Replica ${replica}`) && printed.includes(String(seed)), `the printed inventory does not give replica ${replica}`);
  }
  assert.match(printed, /"expected"/);
});
