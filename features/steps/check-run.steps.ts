import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { loadScenario } from "../../src/engine/scenario.ts";
import * as parts from "../../src/scenarios/congress-parts.ts";
import type { Congress } from "../../src/scenarios/congress.ts";
import type { Context } from "../support/context.ts";
import { change, congressOf, hourMsOf, organiserTurns, setupOf } from "./congress.steps.ts";
import { before, changePools, fieldsOf, minutesOf, moneyLines, ranLines, sentBy, sentWith, untilTime } from "./congress-parties.steps.ts";
import { END, SIX, TIMES, booked, confirmed, emptyWorld, mail, minutes, publish, records, recordsOf, session } from "./congress-parts.steps.ts";
import { CITY, V1 } from "./run-corrections.steps.ts";
import { runTheScenario } from "./tool.steps.ts";

// FR-CONGRESS-19: the corrections from E1's check run, on FR-CONGRESS-09's congress with a fixed budget, no board, the
// venue "v1" (price 2100, rooms "hall-a" and "hall-b" of 90 seats and "room-c" of 30, so its rooms' prices are 900, 900
// and 300), two speakers, the partner "p1" and the caterer "c1".

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The literal text of a step, as a regular expression that matches it alone. */
const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** The parties of the Background. */
const V1_ROOMS = [
  { id: "hall-a", seats: 90 },
  { id: "hall-b", seats: 90 },
  { id: "room-c", seats: 30 },
];
const VENUE: TomlTable = { ...structuredClone(V1), price: 2100, rooms: V1_ROOMS.map((room) => ({ ...room, equipment: [] })) };
const SPEAKERS: TomlTable[] = ["s1", "s2"].map((id, index) => ({ id, title: `Soil ${index + 1}`, draw: 1, fee: 0, home: "local", available: true, acceptance: 1, pick_up: 1 }));
const P1: TomlTable = { id: "p1", title: "Partner's soil", session: 3, fee: 0, home: "north", available: true, pick_up: 1 };
const C1: TomlTable = { id: "c1", price_per_head: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], pick_up: 1, diets: { gluten_free: {} } };

Given(
  literal(
    'the draw gives no board, "budget" [8000, 8000] and "advance" [3000, 3000], and the variant draws the venue "v1" (price 2100, rooms "hall-a" of 90 seats, "hall-b" of 90 seats and "room-c" of 30 seats), the speakers "s1" and "s2", the partner "p1" (session 3) and the caterer "c1"',
  ),
  function (this: Context) {
    changePools(this, (pool) => {
      pool.venue = [structuredClone(VENUE)];
      pool.speaker = structuredClone(SPEAKERS);
      pool.partner = [structuredClone(P1)];
      pool.caterer = [structuredClone(C1)];
      pool.sponsor = [];
    });
    change(this, (configuration) => {
      configuration.draw = stringify({ attendance: [50, 50], budget: [8000, 8000], advance: [3000, 3000], venue: 1, speaker: 2, partner: 1, caterer: 1 });
      configuration.travel = stringify({ stations: ["north"], trains: [{ id: "t1", from: "north", arrives: "08:30", price: 0 }], hotels: [{ id: "h1", near: "v1", rooms: 5, price: 90 }], sold_out_probability: 0 });
      const city = structuredClone(CITY) as unknown as { venues: TomlTable[]; passages: TomlTable[] };
      city.venues[0].rooms = V1_ROOMS;
      city.passages.push({ between: ["v1-entrance", "room-c"], length: 1, step_free: true });
      configuration.city = stringify(city as unknown as TomlTable);
    });
  },
);

/** The run's milliseconds from the calendar's start, "day 1 09:00", to a world time. */
const msUntil = (context: Context, time: string) => ((minutesOf(time) - minutesOf("day 1 09:00")) / 60) * hourMsOf(context);

/** The organiser's turns that book "v1" for "day 26" with these rooms and accept the contract of this id. */
const bookingTurns = (context: Context, rooms: string, contract = "v1-contract-1") =>
  organiserTurns(
    `call "send_mail" to "v1" with the act "book", date "day 26", rooms "${rooms}" and hours "08:00-18:00", then wait 1 world hour, then "send_mail" to "v1" with the act "accept_contract" and contract "${contract}", then wait 1 world hour, then "check_time"`,
    hourMsOf(context),
  );

/** The organiser's turns that send "v1" one act with its fields as the contract writes them, then wait 1 world hour. */
const actTurns = (context: Context, written: string) => organiserTurns(`call "send_mail" to "v1" with the act ${written}, then wait 1 world hour, then "check_time"`, hourMsOf(context));

/** The net commitment of the organiser with "v1" for a contract: its commitments, its changes' and extras', less what was released of them. */
function committedFor(context: Context, contract: string): number {
  const committed = moneyLines(context, "commitment").filter((line) => line.from === ORGANISER && line.to === "v1" && (line.for === contract || String(line.for).startsWith(`${contract} `)));
  const ids = new Set(committed.map((line) => line.commitment));
  const released = moneyLines(context, "release").filter((line) => ids.has(line.commitment));
  return committed.reduce((sum, line) => sum + Number(line.amount), 0) - released.reduce((sum, line) => sum + Number(line.amount), 0);
}

/** A venue's outcome, as the log gives it. */
function outcomeOf(context: Context, venue: string): { history: Record<string, unknown>[]; dates: Record<string, string> } {
  const outcome = ranLines(context).find((line) => line.type === "participant_outcome" && line.participant === venue)?.outcome as { history: string; dates: string } | undefined;
  assert.ok(outcome !== undefined, `"${venue}" gave no outcome`);
  return { history: JSON.parse(outcome.history) as Record<string, unknown>[], dates: JSON.parse(outcome.dates) as Record<string, string> };
}

// A lost room is replaced by an equal free room.
// With "hall-a" and "hall-b", FR-CONGRESS-16's step.
Given('the organiser\'s contract "c-1" with "v1" is confirmed at 2000 with "hall-a" only', function (this: Context) {
  // At 2000 a day, the price the contract is confirmed at, its deposit paid (as FR-CONGRESS-17's scenarios need it).
  changePools(this, (pool) => (pool.venue[0].price = 2000));
  before(this, organiserTurns(`call "send_mail" to "v1" with the act "book", date "day 26", rooms "hall-a" and hours "08:00-18:00", then wait 1 world hour, then "send_mail" to "v1" with the act "accept_contract" and the contract's id, then wait 1 world hour, then "pay" "i-1"`, hourMsOf(this)));
});

Then(
  '"v1" mailed "room_moved" with the room "hall-a" and the room now "hall-b", and "c-1" stays confirmed with "hall-b" only, at 2000, with no change pending',
  function (this: Context) {
    assert.deepEqual(fieldsOf(sentWith(this, "v1", "room_moved")), { contract: "v1-contract-1", room: "hall-a", room_now: "hall-b" });
    assert.deepEqual(
      sentBy(this, "v1").filter((line) => ["room_lost", "price_change", "cancelled"].includes(String(line.act))).map((line) => line.act),
      [],
    );
    // A change pending is set only as the venue records "room_lost" or "price_change".
    const history = outcomeOf(this, "v1").history.filter(({ event }) => ["room_moved", "room_lost", "price_change", "booking_changed", "cancelled"].includes(String(event)));
    assert.deepEqual(
      history.map(({ event, contract, room, room_now: now }) => ({ event, contract, room, room_now: now })),
      [{ event: "room_moved", contract: "v1-contract-1", room: "hall-a", room_now: "hall-b" }],
    );
    assert.equal(committedFor(this, "v1-contract-1"), 2000);
  },
);

Then('"v1" mailed "room_lost" for "hall-b" with the offer "smaller_room" and the smaller room "room-c"', function (this: Context) {
  const lost = fieldsOf(sentWith(this, "v1", "room_lost"));
  assert.deepEqual({ room: lost.room, offer: lost.offer, smaller: lost.smaller }, { room: "hall-b", offer: "smaller_room", smaller: "room-c" });
  assert.deepEqual(
    sentBy(this, "v1").filter((line) => line.act === "room_moved"),
    [],
  );
});

// The parts read a moved room.
/** The records of a scenario, an empty world with "v1"'s rooms of the Background, set at its first step. */
function recordsHere(context: Context) {
  if (!records.has(context)) {
    const state = emptyWorld();
    state.rooms = { ...state.rooms, ...Object.fromEntries(V1_ROOMS.map(({ id, seats }) => [id, { venue: "v1", seats }])) } as Congress["rooms"];
    records.set(context, { state, acts: [] });
  }
  return recordsOf(context);
}

Given('"v1" mailed "room_moved" for the organiser\'s contract "c-1" with the room "hall-a" and the room now "hall-b"', function (this: Context) {
  recordsHere(this);
  mail(this, "v1", ORGANISER, "contract", { contract: "v1-contract-1", date: "day 26", rooms: "hall-a", hours: "08:00-18:00", price: 2000 }, minutes("day 2"));
  mail(this, "v1", ORGANISER, "confirmed", { contract: "v1-contract-1" }, minutes("day 3"));
  mail(this, "v1", ORGANISER, "room_moved", { contract: "v1-contract-1", room: "hall-a", room_now: "hall-b" }, minutes("day 8 10:01"));
});

/** The bookings the parts read. */
const bookings = new WeakMap<Context, parts.Booking[]>();

When("the parts read the organiser's bookings", function (this: Context) {
  bookings.set(this, parts.bookingsOf(recordsOf(this).state));
});

Then('"c-1" has "hall-b" and not "hall-a"', function (this: Context) {
  const booking = bookings.get(this)?.find(({ contract }) => contract === "v1-contract-1");
  assert.deepEqual(booking?.rooms, ["hall-b"]);
});

// Cancelled contracts are never the live one.
Given(
  'the organiser\'s contract "c-1" with "v1" for "day 26" was cancelled on "day 18", and its contract "c-2" with "v1" for "day 26" was confirmed on "day 22" at 2000',
  function (this: Context) {
    changePools(this, (pool) => (pool.venue[0].price = 2000));
    untilTime(this, "day 18 09:00");
    before(this, [...bookingTurns(this, "hall-a"), ...actTurns(this, '"cancel_booking"')]);
    untilTime(this, "day 22 09:00");
    before(this, bookingTurns(this, "hall-a", "v1-contract-2"));
  },
);

Then('"v1" answered "cancelled" for "c-2", and the organiser has no commitment with "v1" for "c-2"', function (this: Context) {
  const cancelled = sentBy(this, "v1").filter((line) => line.act === "cancelled");
  assert.deepEqual(
    cancelled.map((line) => fieldsOf(line).contract),
    ["v1-contract-1", "v1-contract-2"],
  );
  assert.equal(committedFor(this, "v1-contract-2"), 0);
});

Given('the organiser\'s contract "c-1" with "v1" for "day 26" was cancelled on "day 18", and its contract "c-2" with "v1" for "day 26" is confirmed', function (this: Context) {
  untilTime(this, "day 18 09:00");
  before(this, [...bookingTurns(this, "hall-a"), ...actTurns(this, '"cancel_booking"'), ...bookingTurns(this, "hall-a", "v1-contract-2")]);
});

When('"v1" receives "cancel_booking" naming the contract "c-1"', { timeout: 90_000 }, async function (this: Context) {
  before(this, actTurns(this, '"cancel_booking" and contract "v1-contract-1"'));
  this.timeLimitMs = msUntil(this, "day 18 18:00");
  await runTheScenario(this);
});

Then('"c-2" stays confirmed and "day 26" stays booked at "v1"', function (this: Context) {
  const sent = sentBy(this, "v1");
  assert.equal(sent.filter((line) => line.act === "confirmed").length, 2, sent.map((line) => line.act).join(", "));
  assert.deepEqual(
    sent.filter((line) => line.act === "cancelled").map((line) => fieldsOf(line).contract),
    ["v1-contract-1"],
  );
  assert.equal(outcomeOf(this, "v1").dates["day 26"], "confirmed");
});

// An allocated room keeps its price.
Given('the organiser\'s contract "c-1" with "v1" is confirmed with "hall-a" and "hall-b" at hall-a\'s and hall-b\'s prices, whose rooms are indicative', function (this: Context) {
  changePools(this, (pool) => (pool.venue[0].indicative = true));
  // Booked at the day price, 2100, which is the three rooms' prices; then "room-c", 300, dropped.
  before(this, [...bookingTurns(this, "hall-a, hall-b, room-c"), ...actTurns(this, '"change_booking", rooms "hall-a, hall-b" and hours "08:00-18:00"')]);
});

Given('"rooms_allocated" moved no room, so it named "hall-b" anew as "hall-b-allocated"', function (this: Context) {
  change(this, (configuration) => ((configuration.perturbations as TomlTable).room_allocation = { at: "day 1 12:00" }));
  untilTime(this, "day 1 13:00");
  this.timeLimitMs = msUntil(this, "day 1 16:00");
});

Then('"v1" answered "contract_changed" with the rooms "hall-a" and hall-a\'s price', function (this: Context) {
  assert.equal(fieldsOf(sentWith(this, "v1", "rooms_allocated")).allocation, "hall-a -> hall-a; hall-b -> hall-b-allocated");
  const changed = sentBy(this, "v1").filter((line) => line.act === "contract_changed");
  assert.deepEqual(
    changed.map((line) => [fieldsOf(line).rooms, fieldsOf(line).price]),
    [
      ["hall-a, hall-b", 1800],
      ["hall-a", 900],
    ],
  );
});

Then('the parts read "hall-b-allocated" as 90 seats', function (this: Context) {
  ranLines(this);
  const seatsOf = (parts as Record<string, unknown>).seatsOf as ((state: Congress, room: string) => number) | undefined;
  assert.ok(seatsOf !== undefined, "the parts give no seats of a room");
  assert.equal(seatsOf(setupOf(this).loaded?.world.state as Congress, "hall-b-allocated"), 90);
});

// A congress that does not happen.
Given('the organiser\'s contract "c-1" with "v1" was confirmed and the latest programme has six sessions with confirmed speakers', function (this: Context) {
  records.set(this, { state: emptyWorld(), acts: [] });
  // Confirmed with "main-hall", 120 seats, its deposit paid.
  booked(this, "main-hall");
  SIX.forEach((speaker, index) => confirmed(this, speaker, TIMES[index]));
  publish(this, SIX.map((speaker, index) => session([speaker], TIMES[index])), minutes("day 12"));
});

Given('the organiser cancelled "c-1" on "day 21" and booked nothing else', function (this: Context) {
  mail(this, "v1", ORGANISER, "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes("day 21"));
});

Given('"c-1" stays confirmed', function (this: Context) {
  assert.equal(
    Object.values(recordsOf(this).state.mail.mailboxes)
      .flat()
      .some(({ act }) => act === "cancelled"),
    false,
  );
});

/** Whether a predicate's result holds. */
const holds = (result: unknown) => (typeof result === "boolean" ? result : (result as { holds: boolean }).holds);

/** The parts' and outcomes' results at the end of preparation, by predicate. */
const evaluated = new WeakMap<Context, Record<string, unknown>>();

When("the parts and outcomes are evaluated at the end of preparation", function (this: Context) {
  const { state } = recordsOf(this);
  evaluated.set(this, Object.fromEntries(Object.entries(parts.congressParts.predicates).map(([name, predicate]) => [name, predicate(state, { at: END })])));
});

Then('"P01", "P21", "W2", "W5" and "W6" do not hold, and "P04" is evaluated as before', function (this: Context) {
  const results = evaluated.get(this) as Record<string, unknown>;
  assert.deepEqual(
    ["P01", "P21", "W2", "W5", "W6"].filter((part) => holds(results[part])),
    [],
  );
  // P04 gives what it gives on the same records with the booking never cancelled.
  const state = structuredClone(recordsOf(this).state);
  state.mail = { ...state.mail, mailboxes: { ...state.mail.mailboxes, [ORGANISER]: state.mail.mailboxes[ORGANISER].filter(({ act }) => act !== "cancelled") } };
  assert.deepEqual(results.P04, parts.congressParts.predicates.P04(state, { at: END }));
});

Then('"P01" is evaluated as before', function (this: Context) {
  // Its booking is confirmed, its deposit paid and its room seats the attendance: it holds by its own rule.
  assert.equal(holds((evaluated.get(this) as Record<string, unknown>).P01), true);
});

// The contacts.
/** The organiser's system prompt, as the scenario built it. */
const prompts = new WeakMap<Context, string>();

When("the organiser's prompt is built", function (this: Context) {
  const scenario = congressOf(setupOf(this));
  const withDirectory = { ...scenario, baseConfiguration: stringify({ ...parse(scenario.baseConfiguration ?? ""), knowledge: "{directory}" }) };
  prompts.set(this, loadScenario(withDirectory, 1).systemPrompts.get(ORGANISER) ?? "");
});

Then(literal('the venue\'s acts in the contacts read "request_extra (item, seats, attendance, diet)"'), function (this: Context) {
  const prompt = prompts.get(this) ?? "";
  const venue = prompt
    .split("\n")
    .find((line) => line.startsWith("A venue takes "));
  assert.ok(venue !== undefined, `the contacts list no venue's acts: ${prompt}`);
  assert.ok(venue.includes("request_extra (item, seats, attendance, diet)"), venue);
});

