import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { Random } from "../../src/engine/random.ts";
import type { Congress } from "../../src/scenarios/congress.ts";
import type { Context } from "../support/context.ts";
import { change, hourMsOf, organiserTurns, setupOf } from "./congress.steps.ts";
import { assertBetween, before, changePools, fieldsOf, minutesOf, minutesOfWorld, moneyLines, ranLines, sentBy, sentWith, untilTime } from "./congress-parties.steps.ts";
import { SIX, TIMES, confirmed, emptyWorld, mail, minutes, money, publish, records, recordsOf, session } from "./congress-parts.steps.ts";
import { CITY, V1 } from "./run-corrections.steps.ts";
import { modelOf } from "./tool.steps.ts";

// FR-CONGRESS-16: the corrections from E1's fifth technical run, on FR-CONGRESS-09's congress with a fixed budget, no
// board, the venues "v1" and "v2", two speakers, the partner "p1", one caterer and one sponsor.

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The literal text of a step, as a regular expression that matches it alone. */
const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** The parties of the Background. */
const V2: TomlTable = { ...structuredClone(V1), id: "v2", rooms: [{ id: "room-x", seats: 60, equipment: [] }, { id: "room-y", seats: 40, equipment: [] }], price: 2500 };
const SPEAKERS: TomlTable[] = [
  { id: "s1", title: "Soil life", draw: 1, fee: 300, home: "local", available: true, acceptance: 1, condition: "fee", pick_up: 1 },
  { id: "s2", title: "Soil water", draw: 1, fee: 0, home: "local", available: true, acceptance: 1, pick_up: 1 },
];
const P1: TomlTable = { id: "p1", title: "Partner's soil", session: 3, fee: 0, home: "north", available: true, pick_up: 1 };
const C1: TomlTable = { id: "c1", price_per_head: 30, diets: { vegan: {} }, minimum: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], pick_up: 1 };
const SP1: TomlTable = { id: "sp1", amount: 1000, conditions: ["logo", "table"], insists: [], counter_acceptance: 0, pay_days: [4, 4], pick_up: 1 };

Given(
  literal(
    'the draw gives no board, "budget" [8000, 8000] and "advance" [3000, 3000], and the variant draws the venues "v1" (rooms "hall-a" and "hall-b") and "v2" (rooms "room-x" and "room-y"), the speakers "s1" (condition "fee", fee 300) and "s2", the partner "p1" (session 3), the caterer "c1" and the sponsor "sp1" (amount 1000, conditions "logo, table", insists on nothing, "counter_acceptance" 0)',
  ),
  function (this: Context) {
    changePools(this, (pool) => {
      pool.venue = [structuredClone(V1), structuredClone(V2)];
      pool.speaker = structuredClone(SPEAKERS);
      pool.partner = [structuredClone(P1)];
      pool.caterer = [structuredClone(C1)];
      pool.sponsor = [structuredClone(SP1)];
    });
    change(this, (configuration) => {
      configuration.draw = stringify({ attendance: [50, 50], budget: [8000, 8000], advance: [3000, 3000], venue: 2, speaker: 2, partner: 1, caterer: 1, sponsor: 1 });
      configuration.travel = stringify({ stations: ["north"], trains: [{ id: "t1", from: "north", arrives: "08:30", price: 0 }], hotels: [], sold_out_probability: 0 });
      const city = structuredClone(CITY) as unknown as { venues: TomlTable[]; passages: TomlTable[] };
      city.venues.push({ id: "v2", entrance: "v2-entrance", hours: "always", rooms: [{ id: "room-x", seats: 60 }, { id: "room-y", seats: 40 }] });
      city.passages.push(
        { between: ["office", "v2-entrance"], length: 30, step_free: true },
        { between: ["v2-entrance", "room-x"], length: 1, step_free: true },
        { between: ["v2-entrance", "room-y"], length: 1, step_free: true },
      );
      configuration.city = stringify(city as unknown as TomlTable);
    });
  },
);

/** The world time of a day written alone, "day 3", at 09:00, the calendar's start of day; one with its time as it is. */
const timeOf = (day: string) => (/\d\d:\d\d$/.test(day) ? day : `${day} 09:00`);

/** The run's milliseconds from the calendar's start, "day 1 09:00", to a world time. */
const msUntil = (context: Context, time: string) => ((minutesOf(time) - minutesOf("day 1 09:00")) / 60) * hourMsOf(context);

/** The organiser's net commitment with a party: what it committed less what was released. */
function committedWith(context: Context, party: string): number {
  const sum = (kind: string) => moneyLines(context, kind).filter((line) => line.from === ORGANISER && line.to === party).reduce((total, line) => total + Number(line.amount), 0);
  return sum("commitment") - sum("release");
}

/** The world's state as the run left it. */
function finalState(context: Context): Congress {
  ranLines(context);
  const state = setupOf(context).loaded?.world.state as Congress | undefined;
  assert.ok(state !== undefined, "the congress did not run");
  return state;
}

/** The messages a party sent after its first message with an act. */
function sentAfter(context: Context, party: string, act: string): Record<string, unknown>[] {
  const sent = sentBy(context, party);
  const index = sent.findIndex((line) => line.act === act);
  assert.ok(index >= 0, `"${party}" sent no "${act}": it sent ${sent.map((line) => line.act).join(", ")}`);
  return sent.slice(index + 1);
}

// "the organiser's scripted turns call … on|at "day …", then end": the call made at that world time, the run ending 4
// world hours later unless the scenario's time limit says otherwise. FR-CONGRESS-17's call made "again on" a later day
// is its own step.
Given(/^the organiser's scripted turns (call (?!.*, and again on ).+) (?:on|at) "(day \d+(?: \d\d:\d\d)?)", then end$/, function (this: Context, written: string, day: string) {
  untilTime(this, timeOf(day));
  before(this, organiserTurns(`${written}, then wait 1 world hour, then "check_time"`, hourMsOf(this)));
  this.timeLimitMs = msUntil(this, timeOf(day)) + 4 * hourMsOf(this);
});

// A sponsor keeps its agreement.
Given('"sp1" answered "agreement" with the conditions "logo, table" to the organiser\'s "accept_sponsorship" on "day 2"', function (this: Context) {
  untilTime(this, "day 2 09:00");
  before(this, organiserTurns('call "send_mail" to "sp1" with the act "accept_sponsorship" and conditions "logo, table", then wait 1 world hour, then "check_time"', hourMsOf(this)));
});

Then('"sp1" answered "agreement" with the amount 1000 and the conditions "logo, table", and has not withdrawn', function (this: Context) {
  const sent = sentBy(this, "sp1");
  assert.deepEqual(
    sent.map((line) => [line.act, fieldsOf(line)]),
    [
      ["agreement", { amount: 1000, conditions: "logo, table" }],
      ["agreement", { amount: 1000, conditions: "logo, table" }],
    ],
  );
  // The second answers the organiser's message of day 3.
  assert.equal(Math.floor(minutesOfWorld(sent[1].worldTime) / 1440) + 1, 3);
});

// A venue change waits for its answer, and lapses.
/** Books "v1" for "day 26" with these rooms, accepts its contract "c-1" ("v1-contract-1") and pays its deposit, the run's first invoice. */
function confirmedC1(context: Context, rooms: string): void {
  before(
    context,
    organiserTurns(
      `call "send_mail" to "v1" with the act "book", date "day 26", rooms "${rooms}" and hours "08:00-18:00", then wait 1 world hour, then "send_mail" to "v1" with the act "accept_contract" and the contract's id, then wait 1 world hour, then "pay" "i-1"`,
      hourMsOf(context),
    ),
  );
}

Given('the organiser\'s contract "c-1" with "v1" is confirmed at 2000 with "hall-a" and "hall-b"', function (this: Context) {
  // At 2000 a day, whatever the day price the Background gives "v1" (FR-CONGRESS-19's is 2100).
  changePools(this, (pool) => ((pool.venue.find(({ id }) => id === "v1") as TomlTable).price = 2000));
  confirmedC1(this, "hall-a, hall-b");
});

Given('the organiser\'s contract "c-1" with "v1" is confirmed at 2000 with "hall-a" and "hall-b", and "hall-b"\'s price is 800', function (this: Context) {
  // A room's price is the day price × its seats ÷ all the venue's seats: 2000 × 40 ÷ 100.
  changePools(this, (pool) => (((pool.venue[0].rooms as TomlTable[])[0] as TomlTable).seats = 60));
  change(this, (configuration) => {
    const city = parse(configuration.city as string);
    (((city.venues as TomlTable[])[0].rooms as TomlTable[])[0] as TomlTable).seats = 60;
    configuration.city = stringify(city);
  });
  confirmedC1(this, "hall-a, hall-b");
});

Given('the organiser\'s contract "c-1" with "v1" is confirmed at 2000 and its deposit invoice of 600 is paid', function (this: Context) {
  changePools(this, (pool) => Object.assign(pool.venue[0], { deposit_share: 0.3 }));
  confirmedC1(this, "hall-a");
});

Given('the organiser\'s contract "c-1" with "v1" is confirmed at 2000', function (this: Context) {
  confirmedC1(this, "hall-a");
});

/**
 * The first replica seed for which "v1" draws a price change to this price from 2000: its first draw from its sequence,
 * as the change is the first thing it draws, raises the price by 15–25% (FR-CONGRESS-02).
 */
function seedRaisingTo(price: number): number {
  for (let seed = 1; seed < 100_000; seed += 1) if (Math.round(2000 * (1.15 + 0.1 * Random.derive(seed, "rules of v1").next())) === price) return seed;
  throw new Error(`no seed raises 2000 to ${price}`);
}

Given(/^"v1" announced a "price_change" on "c-1" to (\d+) at "(day \d+ \d\d:\d\d)"(?:, and the organiser sent nothing to "v1" after it)?$/, function (this: Context, price: string, at: string) {
  this.seed = seedRaisingTo(Number(price));
  change(this, (configuration) => ((configuration.perturbations as TomlTable).change = { at, kind: "price_change" }));
});

Given('"v1" announced "room_lost" for "hall-b" on "c-1", offering the price cut 800, at "day 8 10:00", and the organiser sent nothing to "v1" after it', function (this: Context) {
  // "hall-b" is the last room booked, and no free room of "v1" is smaller: it offers the price cut alone.
  change(this, (configuration) => ((configuration.perturbations as TomlTable).change = { at: "day 8 10:00", kind: "room_lost" }));
});

/**
 * One world minute is one millisecond of these runs, so what a party does comes a few world minutes after its time:
 * within this many (as FR-CONGRESS-13's steps allow).
 */
const LATE = 10;

Then('the "price_change" mail gave "answer_by" "day 11 10:01"', function (this: Context) {
  const announced = sentWith(this, "v1", "price_change");
  assertBetween(announced, "day 8 10:00", "day 8 10:00", LATE);
  const answerBy = minutesOf(String(fieldsOf(announced).answer_by));
  // 72 world hours after the mail is delivered, a world minute after it was sent: from the venue's clock as it sent it,
  // which the send itself may pass by a few world minutes.
  const delivered = minutesOfWorld(announced.worldTime) + 1;
  assert.ok(answerBy <= delivered + 72 * 60 && answerBy >= delivered + 72 * 60 - LATE, `${String(fieldsOf(announced).answer_by)}, delivered at ${delivered}`);
  assert.ok(answerBy >= minutesOf("day 11 10:01") && answerBy <= minutesOf("day 11 10:01") + LATE, String(fieldsOf(announced).answer_by));
});

/** Asserts that a venue's mail came at the "answer_by" of its change of a kind, "day 11 10:01" as late as these runs come. */
function atAnswerBy(context: Context, line: Record<string, unknown>, kind: string): void {
  const answerBy = minutesOf(String(fieldsOf(sentWith(context, "v1", kind)).answer_by));
  assert.ok(answerBy >= minutesOf("day 11 10:01") && answerBy <= minutesOf("day 11 10:01") + LATE, `answer_by at ${answerBy}`);
  const at = minutesOfWorld(line.worldTime);
  assert.ok(at >= answerBy && at <= answerBy + LATE, `it came at ${at}, answer_by at ${answerBy}`);
}

Then('"v1" answered "change_pending" with the kind "price_change" and the price 2400, and "c-1" stays at 2000 with its commitment of 2000', function (this: Context) {
  const after = sentAfter(this, "v1", "price_change");
  assert.deepEqual(
    after.map((line) => line.act),
    ["change_pending"],
  );
  assert.equal(fieldsOf(after[0]).kind, "price_change");
  assert.equal(fieldsOf(after[0]).price, 2400);
  assert.equal(fieldsOf(sentWith(this, "v1", "price_change")).price, 2400);
  assert.equal(committedWith(this, "v1"), 2000);
});

Then('"v1" mailed "cancelled" for "c-1" with the reason "change_unanswered" at "day 11 10:01"', function (this: Context) {
  const cancelled = sentWith(this, "v1", "cancelled");
  assert.equal(fieldsOf(cancelled).contract, "v1-contract-1");
  assert.equal(fieldsOf(cancelled).reason, "change_unanswered");
  atAnswerBy(this, cancelled, "price_change");
});

Then('the organiser has no commitment with "v1", no charge was invoiced, and the organiser\'s account got back 600', function (this: Context) {
  assert.equal(committedWith(this, "v1"), 0);
  assert.equal(fieldsOf(sentWith(this, "v1", "cancelled")).charge, 0);
  const invoices = finalState(this).money.invoices as unknown as readonly { for: string }[];
  assert.deepEqual(
    invoices.filter((invoice) => invoice.for === "cancellation v1-contract-1"),
    [],
  );
  const refunds = moneyLines(this, "refund").filter((line) => line.from === "v1" && line.to === ORGANISER);
  assert.equal(refunds.reduce((sum, line) => sum + Number(line.amount), 0), 600);
});

Then('"v1" mailed "change_applied" with the room "hall-b" and the cut 800 at "day 11 10:01"', function (this: Context) {
  const lost = sentWith(this, "v1", "room_lost");
  assert.deepEqual([fieldsOf(lost).room, fieldsOf(lost).offer, fieldsOf(lost).cut], ["hall-b", "price_cut", 800]);
  const applied = sentWith(this, "v1", "change_applied");
  assert.equal(fieldsOf(applied).room, "hall-b");
  assert.equal(fieldsOf(applied).cut, 800);
  atAnswerBy(this, applied, "room_lost");
});

Then('"c-1" stays confirmed with "hall-a" only, at 1200, with its commitment of 1200', function (this: Context) {
  assert.deepEqual(
    sentBy(this, "v1").filter((line) => line.act === "cancelled"),
    [],
  );
  const outcome = ranLines(this).find((line) => line.type === "participant_outcome" && line.participant === "v1")?.outcome as { dates: string; history: string };
  assert.equal(JSON.parse(outcome.dates)["day 26"], "confirmed");
  const applied = (JSON.parse(outcome.history) as Record<string, unknown>[]).filter((event) => event.event === "change_applied");
  assert.deepEqual(
    applied.map(({ contract, rooms, price }) => ({ contract, rooms, price })),
    [{ contract: "v1-contract-1", rooms: "hall-a", price: 1200 }],
  );
  assert.equal(committedWith(this, "v1"), 1200);
});

Then('"v1" answered "confirmed", "c-1" stays confirmed at 2400, and "v1" mailed no "cancelled" and no "change_applied"', function (this: Context) {
  const after = sentAfter(this, "v1", "price_change");
  assert.deepEqual(
    after.map((line) => [line.act, fieldsOf(line).price]),
    [["confirmed", 2400]],
  );
  assert.equal(committedWith(this, "v1"), 2400);
});

// Outside catering needs an attendance.
Given('"v1" allows outside catering at 5 a head', function (this: Context) {
  changePools(this, (pool) => Object.assign(pool.venue[0], { catering: "outside_fee", outside_fee_per_head: 5 }));
});

Then('the call failed with the outcome "missing_field", naming "attendance", took no time, and "v1" received nothing', function (this: Context) {
  const call = ranLines(this).find((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === "send_mail");
  assert.ok(call !== undefined, "the organiser made no send_mail call");
  assert.equal(call.outcome, "missing_field");
  assert.equal(call.durationMs ?? 0, 0);
  const results = (modelOf(this, ORGANISER).received.at(-1) ?? []).filter((message) => message.role === "toolResult" && message.toolName === "send_mail");
  assert.match(JSON.stringify(results.map((message) => message.content)), /attendance/);
  assert.deepEqual(
    sentBy(this, ORGANISER).filter((line) => line.to === "v1"),
    [],
  );
});

Then('"v1" answered "extra_quote" with the item "outside_catering" and the price 200', function (this: Context) {
  assert.deepEqual(
    sentBy(this, "v1").map((line) => [line.act, fieldsOf(line)]),
    [["extra_quote", { item: "outside_catering", price: 200 }]],
  );
});

// A late condition gets two days.
Given(/^the organiser invited "s1" to session 2 with fee 0 on "(day \d+ \d\d:\d\d)", and "s1" answered "accept_if" with the condition "fee" on "(day \d+ \d\d:\d\d)"$/, function (this: Context, invited: string, answered: string) {
  // "s1" answers within the mail's world minute.
  assert.equal(invited, answered);
  untilTime(this, invited);
  before(this, organiserTurns('call "send_mail" to "s1" with the act "invite", session 2, time "11:00", fee 0 and travel_paid false, then wait 1 world hour, then "check_time"', hourMsOf(this)));
});

Given('the organiser sent "s1" nothing after it', function (this: Context) {
  // The organiser's turns end after the invitation.
});

Then(/^"s1" mailed "withdraw" for session 2 on "(day \d+)"(?:, not before "(day \d+ \d\d:\d\d)")?$/, function (this: Context, day: string, earliest: string | null) {
  assert.equal(fieldsOf(sentWith(this, "s1", "accept_if")).condition, "fee");
  const withdrew = sentWith(this, "s1", "withdraw");
  assert.equal(String(fieldsOf(withdrew).sessions), "2");
  const at = minutesOfWorld(withdrew.worldTime);
  assert.equal(`day ${Math.floor(at / 1440) + 1}`, day);
  if (earliest !== null) assert.ok(at >= minutesOf(earliest), `it withdrew at ${at}, before ${earliest}`);
});

// A lost room is named.
Given('the organiser\'s contract "c-1" with "v1" is confirmed with "hall-a" and "hall-b", whose rooms are indicative, and "rooms_allocated" moved "hall-b" to "annex"', function (this: Context) {
  // "annex", a room of "v1" no booking has, seats "hall-b"'s audience.
  changePools(this, (pool) => Object.assign(pool.venue[0], { indicative: true, rooms: [...(pool.venue[0].rooms as TomlTable[]), { id: "annex", seats: 50, equipment: [] }] }));
  change(this, (configuration) => {
    const city = parse(configuration.city as string);
    const [v1] = city.venues as TomlTable[];
    v1.rooms = [...(v1.rooms as TomlTable[]), { id: "annex", seats: 50 }];
    city.passages = [...(city.passages as TomlTable[]), { between: ["v1-entrance", "annex"], length: 1, step_free: true }];
    configuration.city = stringify(city);
    (configuration.perturbations as TomlTable).room_allocation = { at: "day 1 13:00" };
  });
  confirmedC1(this, "hall-a, hall-b");
  untilTime(this, "day 1 14:00");
  this.timeLimitMs = 8 * hourMsOf(this);
});

Then('"v1" answered "unavailable" with the room "hall-b" and no date', function (this: Context) {
  assert.equal(fieldsOf(sentWith(this, "v1", "rooms_allocated")).allocation, "hall-a -> hall-a; hall-b -> annex");
  const after = sentAfter(this, "v1", "rooms_allocated");
  assert.deepEqual(
    after.map((line) => [line.act, fieldsOf(line)]),
    [["unavailable", { room: "hall-b" }]],
  );
});

// The live booking is the one the programme uses: the parts read on world records the steps set directly.
/** The world of the Background's venues: "v1" with "hall-a" and "hall-b", "v2" with "room-x" and "room-y". */
function twoVenues(): Congress {
  const state = emptyWorld();
  state.rooms = { "hall-a": { venue: "v1", seats: 80 }, "hall-b": { venue: "v1", seats: 40 }, "room-x": { venue: "v2", seats: 60 }, "room-y": { venue: "v2", seats: 40 } } as Congress["rooms"];
  state.passages = [
    { between: ["v1-entrance", "hall-a"], length: 1, step_free: true },
    { between: ["v1-entrance", "hall-b"], length: 1, step_free: true },
    { between: ["v2-entrance", "room-x"], length: 1, step_free: true },
    { between: ["v2-entrance", "room-y"], length: 1, step_free: true },
  ] as Congress["passages"];
  return state;
}

Given('the organiser\'s contract with "v1" was confirmed on "day 5" and its contract with "v2" on "day 8", both for the event day and neither cancelled', function (this: Context) {
  records.set(this, { state: twoVenues(), acts: [] });
  mail(this, "v1", ORGANISER, "contract", { contract: "v1-contract-1", date: "day 26", rooms: "hall-a, hall-b", hours: "08:00-18:00", price: 2000 }, minutes("day 4"));
  mail(this, "v1", ORGANISER, "confirmed", { contract: "v1-contract-1" }, minutes("day 5"));
  mail(this, "v2", ORGANISER, "contract", { contract: "v2-contract-1", date: "day 26", rooms: "room-x, room-y", hours: "08:00-18:00", price: 2500 }, minutes("day 7"));
  mail(this, "v2", ORGANISER, "confirmed", { contract: "v2-contract-1" }, minutes("day 8"));
});

Given('"v1" is the false-claim venue, whose session rooms are reached through "3 steps" with no ramp, and "v2"\'s rooms are step-free', function (this: Context) {
  const { state } = recordsOf(this);
  assert.deepEqual((state.context.roles as { venue: { false_claim: string[] } }).venue.false_claim, ["v1"]);
  state.passages = state.passages.map((passage) => (passage.between.includes("v1-entrance") ? { ...passage, step_free: "3 steps" } : passage));
});

Given(/^no floor plan or photos were asked for and there was no visit, and the latest programme has six sessions in "(room-x|hall-a)" and "(room-y|hall-b)"$/, function (this: Context, first: string, second: string) {
  // No mail asks "v1" for a document, and the world has no visit.
  publish(this, SIX.map((speaker, index) => session([speaker], TIMES[index], index % 2 === 0 ? first : second)), minutes("day 12"));
});

// P20 leaves out speakers who were out.
Given('the partner "p1" is in session 3 of the latest programme, confirmed and acknowledged, and each of the six sessions has a confirmed speaker', function (this: Context) {
  records.set(this, { state: emptyWorld(), acts: [] });
  mail(this, "board", ORGANISER, "partner_session", { speaker: "p1", session: 3 }, minutes("day 1 09:00"));
  const speakers = ["s1", "s3", "p1", "s4", "s5", "s6"];
  speakers.forEach((speaker, index) => {
    if (speaker !== "p1") confirmed(this, speaker, TIMES[index]);
  });
  mail(this, ORGANISER, "p1", "confirm", { time: TIMES[2], room: "main-hall", length: 45, travel: "none" }, minutes("day 5"));
  mail(this, "p1", ORGANISER, "acknowledged", {}, minutes("day 5 01:00"));
  publish(this, speakers.map((speaker, index) => session([speaker], TIMES[index])), minutes("day 12"));
});

/** The organiser's train for "s2" booked on a day: the travel's commitment with the organiser for it. */
function train(context: Context, day: string): void {
  const { state } = recordsOf(context);
  state.travel = { ...state.travel, booked: [...state.travel.booked, { option: "t1 day 26", traveller: "s2", price: 40, at: minutes(day) }] };
  money(context, { kind: "commitment", from: ORGANISER, to: "travel", amount: 40, commitment: "k-20", for: "t1 day 26 s2" }, minutes(day));
}

const S2_SITUATIONS: Record<string, (context: Context) => void> = {
  '"s2" cancelled at "early_cancel" on "day 8", and the organiser sent it "withdraw_invitation" on "day 10"': (context) => {
    mail(context, "s2", ORGANISER, "cancel", {}, minutes("day 8"));
    mail(context, ORGANISER, "s2", "withdraw_invitation", {}, minutes("day 10"));
  },
  'the organiser sent "s2" "withdraw_invitation" on "day 10"': (context) => mail(context, ORGANISER, "s2", "withdraw_invitation", {}, minutes("day 10")),
  'the organiser booked a train for "s2" on "day 7", and "s2" cancelled at "early_cancel" on "day 8"': (context) => {
    train(context, "day 7");
    mail(context, "s2", ORGANISER, "cancel", {}, minutes("day 8"));
  },
  '"s2" cancelled at "early_cancel" on "day 8", and the organiser booked a train for "s2" on "day 9"': (context) => {
    mail(context, "s2", ORGANISER, "cancel", {}, minutes("day 8"));
    train(context, "day 9");
  },
};

Given(/^"s2" accepted session 4 and is not in the latest programme, and (.+)$/, function (this: Context, situation: string) {
  const setting = S2_SITUATIONS[situation];
  assert.ok(setting !== undefined, `the steps do not set "${situation}"`);
  mail(this, ORGANISER, "s2", "invite", { session: 4, time: TIMES[3], fee: 0, travel_paid: false }, minutes("day 3"));
  mail(this, "s2", ORGANISER, "accept", { session: 4 }, minutes("day 4"));
  setting(this);
});
