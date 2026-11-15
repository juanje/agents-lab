import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, stringify } from "smol-toml";
import { effortMoney } from "../../src/engine/parts.ts";
import * as parts from "../../src/scenarios/congress-parts.ts";
import type { Congress } from "../../src/scenarios/congress.ts";
import type { Context } from "../support/context.ts";
import { change, hourMsOf, organiserTurns, setupOf } from "./congress.steps.ts";
import { before, changePools, fieldsOf, minutesOf, minutesOfWorld, moneyLines, ranLines, sentBy, sentWith, untilTime } from "./congress-parties.steps.ts";
import { END, TIMES, confirmed, emptyWorld, mail, minutes, money, publish, records, recordsOf, session } from "./congress-parts.steps.ts";
import { CITY, V1 } from "./run-corrections.steps.ts";
import { runTheScenario } from "./tool.steps.ts";

// FR-CONGRESS-17: the corrections from E1's sixth technical run, on FR-CONGRESS-09's congress with a fixed budget, no
// board, the venues "v1" (three rooms, outside catering free) and "v2" (in-house catering), two speakers, the partner
// "p1", the caterer "c1" and "v2"'s in-house caterer "c2".

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
const V2_ROOMS = [
  { id: "room-x", seats: 60 },
  { id: "room-y", seats: 40 },
];
const VENUE_1: TomlTable = { ...structuredClone(V1), rooms: V1_ROOMS.map((room) => ({ ...room, equipment: [] })), catering: "outside_free" };
const VENUE_2: TomlTable = { ...structuredClone(V1), id: "v2", rooms: V2_ROOMS.map((room) => ({ ...room, equipment: [] })), catering: "in_house", outside_diet_fee_per_head: 5, price: 2500 };
const SPEAKERS: TomlTable[] = ["s1", "s2"].map((id, index) => ({ id, title: `Soil ${index + 1}`, draw: 1, fee: 0, home: "local", available: true, acceptance: 1, pick_up: 1 }));
const P1: TomlTable = { id: "p1", title: "Partner's soil", session: 3, fee: 0, home: "north", available: true, pick_up: 1 };
const CATERER = { price_per_head: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], pick_up: 1 };
const C1: TomlTable = { id: "c1", ...CATERER, diets: { gluten_free: {} } };
const C2: TomlTable = { id: "c2", ...CATERER, in_house_for: "v2", diets: { gluten_free: { limit: 5 }, vegetarian: {} } };

Given(
  literal(
    'the draw gives no board, "budget" [8000, 8000] and "advance" [3000, 3000], and the variant draws the venues "v1" (rooms "hall-a" of 90 seats, "hall-b" of 90 seats and "room-c" of 30 seats, catering "outside_free") and "v2" (rooms "room-x" and "room-y", catering "in_house", "outside_diet_fee_per_head" 5), the speakers "s1" and "s2", the partner "p1" (session 3), the caterer "c1" (serves "gluten_free" with no limit) and "v2"\'s in-house caterer "c2" (serves "gluten_free" with limit 5, and "vegetarian" with no limit)',
  ),
  function (this: Context) {
    changePools(this, (pool) => {
      pool.venue = [structuredClone(VENUE_1), structuredClone(VENUE_2)];
      pool.speaker = structuredClone(SPEAKERS);
      pool.partner = [structuredClone(P1)];
      pool.caterer = [structuredClone(C1), structuredClone(C2)];
      pool.sponsor = [];
    });
    change(this, (configuration) => {
      configuration.draw = stringify({ attendance: [50, 50], budget: [8000, 8000], advance: [3000, 3000], venue: 2, speaker: 2, partner: 1, caterer: 1 });
      configuration.travel = stringify({
        stations: ["north"],
        trains: [{ id: "t1", from: "north", arrives: "08:30", price: 0 }],
        hotels: [
          { id: "h1", near: "v1", rooms: 5, price: 90 },
          { id: "h2", near: "v1", rooms: 5, price: 90 },
        ],
        sold_out_probability: 0,
      });
      const city = structuredClone(CITY) as unknown as { venues: TomlTable[]; passages: TomlTable[] };
      city.venues[0].rooms = V1_ROOMS;
      city.venues.push({ id: "v2", entrance: "v2-entrance", hours: "always", rooms: V2_ROOMS });
      city.passages.push(
        { between: ["v1-entrance", "room-c"], length: 1, step_free: true },
        { between: ["office", "v2-entrance"], length: 30, step_free: true },
        { between: ["v2-entrance", "room-x"], length: 1, step_free: true },
        { between: ["v2-entrance", "room-y"], length: 1, step_free: true },
      );
      configuration.city = stringify(city as unknown as TomlTable);
    });
  },
);

/** The run's milliseconds from the calendar's start, "day 1 09:00", to a world time. */
const msUntil = (context: Context, time: string) => ((minutesOf(time) - minutesOf("day 1 09:00")) / 60) * hourMsOf(context);

/** The organiser's turns that book a venue for "day 26" with these rooms and accept its contract, then, when told to, pay its deposit, the run's first invoice. */
function booking(context: Context, venue: string, rooms: string, pays: boolean): void {
  const accept = `call "send_mail" to "${venue}" with the act "book", date "day 26", rooms "${rooms}" and hours "08:00-18:00", then wait 1 world hour, then "send_mail" to "${venue}" with the act "accept_contract" and the contract's id, then wait 1 world hour`;
  before(context, organiserTurns(`${accept}, then ${pays ? '"pay" "i-1"' : '"check_time"'}`, hourMsOf(context)));
}

/** The net commitment of the organiser with a party: what it committed less what was released. */
function committedWith(context: Context, party: string): number {
  const sum = (kind: string) => moneyLines(context, kind).filter((line) => line.from === ORGANISER && line.to === party).reduce((total, line) => total + Number(line.amount), 0);
  return sum("commitment") - sum("release");
}

/** The venue change "change" declared at a world time, of a kind. */
const changeAt = (context: Context, at: string, kind: string) => change(context, (configuration) => ((configuration.perturbations as TomlTable).change = { at, kind }));

/** A venue's history, as its outcome gives it. */
function historyOf(context: Context, venue: string): Record<string, unknown>[] {
  const outcome = ranLines(context).find((line) => line.type === "participant_outcome" && line.participant === venue)?.outcome as { history: string } | undefined;
  assert.ok(outcome !== undefined, `"${venue}" gave no outcome`);
  return JSON.parse(outcome.history) as Record<string, unknown>[];
}

/** The messages a party sent after its first message with an act. */
function sentAfter(context: Context, party: string, act: string): Record<string, unknown>[] {
  const sent = sentBy(context, party);
  const index = sent.findIndex((line) => line.act === act);
  assert.ok(index >= 0, `"${party}" sent no "${act}": it sent ${sent.map((line) => line.act).join(", ")}`);
  return sent.slice(index + 1);
}

/**
 * One world minute is one millisecond of these runs, so what a party does comes a few world minutes after its time:
 * within this many (as FR-CONGRESS-16's steps allow).
 */
const LATE = 10;

// A one-room booking can lose its room.
Given(
  /^the organiser's contract "c-1" with "v1" is confirmed at 2000 with "(hall-a|room-c)" only, and ("hall-b" is booked by another customer|"hall-a" and "hall-b" are booked by other customers)$/,
  function (this: Context, room: string, others: string) {
    // Rooms of "v1" other customers have that day, so no equal room is free to move to (FR-CONGRESS-19).
    const taken = [...others.matchAll(/"([\w-]+)"/g)].map(([, id]) => id);
    changePools(this, (pool) => (pool.venue.find(({ id }) => id === "v1") as TomlTable).rooms_booked_by_others = taken);
    booking(this, "v1", room, true);
  },
);

When('"v1" draws "room_lost" on "c-1" at "day 8 10:00"', { timeout: 60_000 }, async function (this: Context) {
  changeAt(this, "day 8 10:00", "room_lost");
  this.timeLimitMs = msUntil(this, "day 8 12:00");
  await runTheScenario(this);
});

Then('"v1" mailed "room_lost" for "hall-a" with the offer "smaller_room", the smaller room "room-c" and no price cut', function (this: Context) {
  const lost = fieldsOf(sentWith(this, "v1", "room_lost"));
  assert.deepEqual({ room: lost.room, offer: lost.offer, smaller: lost.smaller }, { room: "hall-a", offer: "smaller_room", smaller: "room-c" });
  assert.equal(Object.hasOwn(lost, "cut"), false, `the mail gives a price cut: ${JSON.stringify(lost)}`);
});

Then('"v1" mailed "price_change" for "c-1", and no "room_lost"', function (this: Context) {
  assert.equal(fieldsOf(sentWith(this, "v1", "price_change")).contract, "v1-contract-1");
  assert.deepEqual(
    sentBy(this, "v1").filter((line) => line.act === "room_lost"),
    [],
  );
});

Given('"v1" announced "room_lost" for "hall-a" on "c-1", offering the smaller room "room-c", at "day 8 10:00", and the organiser sent nothing to "v1" after it', function (this: Context) {
  // "room-c", 30 seats, is "v1"'s largest free room with fewer seats than "hall-a"'s 90.
  changeAt(this, "day 8 10:00", "room_lost");
});

Then('"v1" mailed "change_applied" with the room "hall-a" and the smaller room "room-c" at "day 11 10:01"', function (this: Context) {
  const lost = sentWith(this, "v1", "room_lost");
  assert.deepEqual([fieldsOf(lost).room, fieldsOf(lost).smaller], ["hall-a", "room-c"]);
  const applied = sentWith(this, "v1", "change_applied");
  assert.deepEqual(fieldsOf(applied), { contract: "v1-contract-1", room: "hall-a", smaller: "room-c" });
  const answerBy = minutesOf(String(fieldsOf(lost).answer_by));
  assert.ok(answerBy >= minutesOf("day 11 10:01") && answerBy <= minutesOf("day 11 10:01") + LATE, `answer_by at ${answerBy}`);
  const at = minutesOfWorld(applied.worldTime);
  assert.ok(at >= answerBy && at <= answerBy + LATE, `it came at ${at}, answer_by at ${answerBy}`);
});

Then('"c-1" stays confirmed with "room-c" only, at 2000', function (this: Context) {
  assert.deepEqual(
    sentBy(this, "v1").filter((line) => line.act === "cancelled"),
    [],
  );
  const applied = historyOf(this, "v1").filter((event) => event.event === "change_applied");
  assert.deepEqual(
    applied.map(({ contract, rooms, price }) => ({ contract, rooms, price })),
    [{ contract: "v1-contract-1", rooms: "room-c", price: 2000 }],
  );
  assert.equal(committedWith(this, "v1"), 2000);
});

Given('"v1" announced "room_lost" for "hall-a" on the organiser\'s one-room contract "c-1", offering the smaller room "room-c"', function (this: Context) {
  booking(this, "v1", "hall-a", false);
  changeAt(this, "day 1 12:00", "room_lost");
  untilTime(this, "day 1 13:00");
});

Then('"v1" answered "not_available" for "price_cut", and the change is still pending', function (this: Context) {
  assert.equal(fieldsOf(sentWith(this, "v1", "room_lost")).offer, "smaller_room");
  assert.deepEqual(
    sentAfter(this, "v1", "room_lost").map((line) => [line.act, fieldsOf(line)]),
    [["not_available", { what: "price_cut" }]],
  );
  const settled = historyOf(this, "v1").filter((event) => event.event === "change_accepted" || event.event === "change_applied" || event.event === "cancelled");
  assert.deepEqual(settled, []);
});

// Outside diet meals at a venue with its own caterer.
Given('the organiser\'s contract with "v2" is confirmed', function (this: Context) {
  booking(this, "v2", "room-x", false);
});

Then(/^"v2" answered "extra_quote" with the item "outside_catering" and the price (\d+)$/, function (this: Context, price: string) {
  assert.deepEqual(
    sentAfter(this, "v2", "confirmed").map((line) => [line.act, fieldsOf(line)]),
    [["extra_quote", { item: "outside_catering", price: Number(price) }]],
  );
});

Then('"v2" answered "not_available" for "outside_catering"', function (this: Context) {
  assert.deepEqual(
    sentAfter(this, "v2", "confirmed").map((line) => [line.act, fieldsOf(line)]),
    [["not_available", { what: "outside_catering" }]],
  );
});

Given('"v2" gave the organiser the permit "v2-permit-1" for outside "gluten_free" meals with the attendance 8', function (this: Context) {
  booking(this, "v2", "room-x", false);
  before(
    this,
    organiserTurns(
      'call "send_mail" to "v2" with the act "request_extra", the item "outside_catering", the attendance 8 and the diet "gluten_free", then wait 1 world hour, then "send_mail" to "v2" with the act "accept_extra" and the item "outside_catering", then wait 1 world hour, then "check_time"',
      hourMsOf(this),
    ),
  );
});

// An order with its counts as the contract writes them, "gluten_free: 6, standard: 2", which the order gives as the
// caterer reads counts, "gluten_free: 6; standard: 2".
Given(/^the organiser's scripted turns call "send_mail" to "(c1|c2)" with the act "order", (.+) and the counts "([^"]+)", then end$/, function (this: Context, caterer: string, written: string, counts: string) {
  const fields = Object.fromEntries([...written.matchAll(/the (\w+) "([^"]+)"/g)].map(([, name, value]) => [name, value]));
  const order = { to: caterer, act: "order", fields: { ...fields, counts: counts.replace(/,\s*/g, "; "), date: "day 26" } };
  before(this, [{ toolCalls: [{ name: "send_mail", arguments: order }] as never, delayMs: 0 }, ...organiserTurns('wait 1 world hour, then "check_time"', hourMsOf(this))]);
});

// Only FR-CONGRESS-17's answers: a total, permit_exceeded, or own_venue_only with the venue.
Then(/^"(c1|c2)" answered "(order_confirmed|order_refused)" with (the total \d+|the reason "permit_exceeded"|the reason "own_venue_only" and the venue "\w+")$/, function (this: Context, caterer: string, act: string, written: string) {
  const [, total] = /^the total (\d+)$/.exec(written) ?? [];
  const [, reason, venue] = /^the reason "(\w+)"(?: and the venue "(\w+)")?$/.exec(written) ?? [];
  assert.ok(total !== undefined || reason !== undefined, `the steps do not read "${written}"`);
  const answers = sentBy(this, caterer).filter((line) => line.to === ORGANISER).map((line) => [line.act, fieldsOf(line)]);
  assert.equal(answers.length, 1, JSON.stringify(answers));
  const [answered, fields] = answers[0] as [string, Record<string, unknown>];
  assert.equal(answered, act, JSON.stringify(answers));
  if (total !== undefined) assert.equal(fields.total, Number(total));
  if (reason !== undefined) assert.deepEqual(fields, { reason, ...(venue === undefined ? {} : { venue }) });
  if (caterer === "c1") assert.equal(fieldsOf(sentWith(this, "v2", "extra_confirmed")).permit, "v2-permit-1");
});

// A speaker who is out does not phone about its hotel.
Given('the organiser booked a hotel for "s1" and for "s2" for the night of "day 25"', function (this: Context) {
  before(this, organiserTurns('call "book_travel" "h1 day 25" for "s1", then "book_travel" "h1 day 25" for "s2"', hourMsOf(this)));
});

Given('"s2" cancelled at "early_cancel" on "day 10"', function (this: Context) {
  // "s2", the only confirmed speaker, is the one the illness reaches.
  before(
    this,
    organiserTurns(
      'call "send_mail" to "s2" with the act "invite", session 2, time "10:30", fee 0 and travel_paid false, then wait 1 world hour, then "send_mail" to "s2" with the act "confirm", time "10:30", room "hall-a", length 45 and travel "none", then wait 1 world hour, then "check_time"',
      hourMsOf(this),
    ),
  );
  change(this, (configuration) => ((configuration.perturbations as TomlTable).early_cancel = { between: ["day 10 09:00", "day 10 09:00"] }));
});

When('the hotel overbooks on "day 25" at 21:00', function (this: Context) {
  change(this, (configuration) => ((configuration.perturbations as TomlTable).hotel_overbooks = { at: "day 25 21:00" }));
});

// A hotel has no room left for a night on that night's own day (its rooms × days left / 14, FR-CONGRESS-05's addition),
// so the run cannot book "s1" another hotel at 21:30: the records P19 reads get that booking, as FR-CONGRESS-06's steps
// set them.
/** The booking the scenario adds to the records P19 reads. */
const rebooked = new WeakMap<Context, { option: string; traveller: string; price: number; at: number }>();

When('the organiser booked "s1" another hotel for the night of "day 25" at 21:30', { timeout: 120_000 }, async function (this: Context) {
  this.timeLimitMs = msUntil(this, "day 25 23:00");
  await runTheScenario(this);
  rebooked.set(this, { option: "h2 day 25", traveller: "s1", price: 90, at: minutesOf("day 25 21:30") });
});

Then('"s1" phoned the organiser and "s2" did not', function (this: Context) {
  sentWith(this, "s2", "cancel");
  const callers = ranLines(this).filter((line) => line.type === "call" && line.to === ORGANISER).map((line) => [line.from, line.act]);
  assert.deepEqual(callers, [["s1", "no_room"]]);
});

Then('"P19" holds', function (this: Context) {
  ranLines(this);
  const ran = setupOf(this).loaded?.world.state as Congress;
  assert.deepEqual(
    ran.perturbations.filter(({ name }) => name === "hotel_overbooks").map(({ target }) => target).sort(),
    ["s1", "s2"],
  );
  const booking = rebooked.get(this);
  assert.ok(booking !== undefined, "the organiser booked \"s1\" no other hotel");
  const state = { ...ran, travel: { ...ran.travel, booked: [...ran.travel.booked, booking] } };
  assert.equal(parts.congressParts.predicates.P19(state, {}), true, `booked: ${JSON.stringify(state.travel.booked)}; perturbations: ${JSON.stringify(state.perturbations)}`);
});

// The parts read what the venues and speakers settled, on world records the steps set directly.
/** The records of a scenario, an empty world with "v1"'s rooms "hall-a" and "hall-b" of 90 seats, set at its first step. */
function recordsHere(context: Context) {
  if (!records.has(context)) {
    const state = emptyWorld();
    state.rooms = { ...state.rooms, "hall-a": { venue: "v1", seats: 90 }, "hall-b": { venue: "v1", seats: 90 } } as Congress["rooms"];
    state.passages = [...state.passages, { between: ["foyer", "hall-a"], length: 1, step_free: true }, { between: ["foyer", "hall-b"], length: 1, step_free: true }] as Congress["passages"];
    records.set(context, { state, acts: [] });
  }
  return recordsOf(context);
}

Given('the organiser\'s contract "c-1" with "v1" is confirmed with "hall-a" and "hall-b"', function (this: Context) {
  recordsHere(this);
  mail(this, "v1", ORGANISER, "contract", { contract: "v1-contract-1", date: "day 26", rooms: "hall-a, hall-b", hours: "08:00-18:00", price: 2000 }, minutes("day 2"));
  mail(this, "v1", ORGANISER, "confirmed", { contract: "v1-contract-1" }, minutes("day 3"));
});

Given('"v1" mailed "change_applied" for "c-1" with the room "hall-b" and the cut 800', function (this: Context) {
  mail(this, "v1", ORGANISER, "change_applied", { contract: "v1-contract-1", room: "hall-b", cut: 800 }, minutes("day 11 10:01"));
});

Given('the latest programme has six sessions, two of them in "hall-b"', function (this: Context) {
  const rooms = ["hall-a", "hall-b", "hall-a", "hall-b", "hall-a", "hall-a"];
  publish(this, ["s1", "s2", "s3", "s4", "s5", "s6"].map((speaker, index) => session([speaker], TIMES[index], rooms[index])), minutes("day 12"));
});

Then('it does not hold, since "hall-b" is no longer in a confirmed booking', function (this: Context) {
  const built = recordsOf(this);
  assert.equal(built.result, false);
  // Without the change's mail it holds: the lost room is what makes it fail.
  const before = structuredClone(built.state);
  before.mail = { ...before.mail, mailboxes: { ...before.mail.mailboxes, [ORGANISER]: before.mail.mailboxes[ORGANISER].filter(({ act }) => act !== "change_applied") } };
  assert.equal(parts.congressParts.predicates.P03(before, {}), true);
});

Given('"s1" accepted session 5 on "day 4"', function (this: Context) {
  recordsHere(this);
  mail(this, ORGANISER, "s1", "invite", { session: 5, time: "15:00", fee: 0, travel_paid: false }, minutes("day 3"));
  mail(this, "s1", ORGANISER, "accept", { session: 5 }, minutes("day 4"));
});

Given('the organiser sent "s1" a "change" with the time "14:00" and the room "hall-a" on "day 16", and "s1" answered "acknowledged" on "day 16"', function (this: Context) {
  mail(this, ORGANISER, "s1", "change", { time: "14:00", room: "hall-a" }, minutes("day 16 10:00"));
  mail(this, "s1", ORGANISER, "acknowledged", {}, minutes("day 16 10:01"));
});

Given('the organiser never sent "s1" a "confirm"', function (this: Context) {
  assert.deepEqual(
    Object.values(recordsOf(this).state.mail.mailboxes)
      .flat()
      .filter(({ to, act }) => to === "s1" && act === "confirm"),
    [],
  );
});

/** The confirmed speakers the parts read. */
const confirmedSpeakers = new WeakMap<Context, string[]>();

When("the parts read the confirmed speakers at the end of preparation", function (this: Context) {
  const confirmedOf = (parts as Record<string, unknown>).confirmedOf as ((state: Congress) => string[]) | undefined;
  assert.ok(confirmedOf !== undefined, "the parts give no confirmed speakers");
  confirmedSpeakers.set(this, confirmedOf(recordsOf(this).state));
});

Then('"s1" is a confirmed speaker of session 5', function (this: Context) {
  assert.deepEqual(confirmedSpeakers.get(this), ["s1"]);
  assert.equal(parts.answerFor(recordsOf(this).state, "s1", 5), "accept");
});

// Effort money.
Given('a part activates on "day 6", and the organiser committed 3000 to "v1" on "day 4" and released it on "day 8"', function (this: Context) {
  recordsHere(this);
  money(this, { kind: "commitment", from: ORGANISER, to: "v1", amount: 3000, commitment: "k-1", for: "v1-contract-1" }, minutes("day 4"));
  money(this, { kind: "release", from: ORGANISER, to: "v1", amount: 3000, commitment: "k-1" }, minutes("day 8"));
});

/** The effort money the scenario computed. */
const efforts = new WeakMap<Context, number>();

When('the part\'s effort money is computed from "day 6" to the end of preparation', function (this: Context) {
  const entries = (recordsOf(this).state.money.events as readonly Record<string, unknown>[]).map((event) => ({ event, at: Number(event.at) }));
  efforts.set(this, effortMoney(entries, [ORGANISER], ["v1"], minutes("day 6"), END));
});

Then("it is {int}", function (this: Context, amount: number) {
  assert.equal(efforts.get(this), amount);
});

// P20.
Given('the partner "p1" is in session 3 of the latest programme, confirmed and acknowledged', function (this: Context) {
  recordsHere(this);
  mail(this, "association", ORGANISER, "partner_session", { speaker: "p1", session: 3 }, minutes("day 1 09:00"));
  mail(this, ORGANISER, "p1", "confirm", { time: TIMES[2], room: "main-hall", length: 45, travel: "none" }, minutes("day 5"));
  mail(this, "p1", ORGANISER, "acknowledged", {}, minutes("day 5 01:00"));
  // Every other session's speaker confirmed, but session 5's: "s5" was never invited.
  const speakers = ["s1", "s3", "p1", "s4", "s5", "s6"];
  speakers.forEach((speaker, index) => {
    if (speaker !== "p1" && speaker !== "s5") confirmed(this, speaker, TIMES[index]);
  });
  publish(this, speakers.map((speaker, index) => session([speaker], TIMES[index])), minutes("day 12"));
});

/** "s2"'s invitation to session 4, which it accepted. */
function s2Accepted(context: Context): void {
  mail(context, ORGANISER, "s2", "invite", { session: 4, time: TIMES[3], fee: 0, travel_paid: false }, minutes("day 3"));
  mail(context, "s2", ORGANISER, "accept", { session: 4 }, minutes("day 4"));
}

Given("session 5 has no confirmed speaker, and every speaker who accepted is in the programme", function (this: Context) {
  const { state } = recordsOf(this);
  const fifth = state.population?.programme.at(-1)?.sessions[4];
  assert.deepEqual(fifth?.speakers, ["s5"]);
  assert.equal(
    Object.values(state.mail.mailboxes)
      .flat()
      .some(({ from }) => from === "s5"),
    false,
  );
});

Given('"s2" accepted session 4 and is not in the programme', function (this: Context) {
  s2Accepted(this);
});

Given('the organiser sent "s2", who had accepted session 4, "withdraw_invitation" on "day 10"', function (this: Context) {
  s2Accepted(this);
  mail(this, ORGANISER, "s2", "withdraw_invitation", {}, minutes("day 10"));
});

// P20's misapplications, in a run that follows P20.
Given('the partner\'s session is 3 and the association\'s mail naming it was in the organiser\'s inbox on "day 1"', function (this: Context) {
  // The partner "p1" of the Background, whose session 3 the association's mail names as the run starts (FR-CONGRESS-07).
  change(this, (configuration) => (configuration.parts = stringify({ parts: [{ id: "P20", predicate: "P20", evaluate_at: "end", misapplications: [{ pattern: "P20" }] }] })));
});

Given('the organiser\'s scripted turns call "send_mail" to "s1" with the act "invite" and the session 3 on "day 2", and again on "day 4", then end', function (this: Context) {
  // With the fields a speaker's invite requires, so the world takes both invitations (FR-CONGRESS-09).
  const invite = organiserTurns('call "send_mail" to "s1" with the act "invite", the session 3, the time "11:30", the fee 0 and the travel_paid false', hourMsOf(this));
  untilTime(this, "day 2 09:00");
  before(this, invite);
  untilTime(this, "day 4 09:00");
  before(this, [...invite, ...organiserTurns('wait 1 world hour, then "check_time"', hourMsOf(this))]);
  this.timeLimitMs = msUntil(this, "day 4 13:00");
});

Then('"P20" records one misapplication', function (this: Context) {
  const invitations = ranLines(this).filter((line) => line.type === "tool_call" && line.tool === "send_mail" && (line.arguments as { act?: string }).act === "invite");
  assert.deepEqual(
    invitations.map((line) => line.outcome),
    ["success", "success"],
  );
  const line = ranLines(this).find((each) => each.type === "part" && each.part === "P20") as { misapplications?: { tool: string; arguments: { act: string }; at: string }[] } | undefined;
  assert.ok(line?.misapplications !== undefined, `the log has no evaluated part line for "P20": ${JSON.stringify(line)}`);
  assert.equal(line.misapplications.length, 1, JSON.stringify(line.misapplications));
  assert.equal(line.misapplications[0].arguments.act, "invite");
});
