import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Given, Then, When } from "@cucumber/cucumber";
import { congressParts } from "../../src/scenarios/congress-parts.ts";
import type { Congress } from "../../src/scenarios/congress.ts";
import type { Context } from "../support/context.ts";
import { END, act, booked, emptyWorld, eventAt, evaluate, held, mail, minutes, misapplied, money, publish, records, recordsOf, register, session } from "./congress-parts.steps.ts";

// FR-CONGRESS-12: the parts' corrections from E1's second technical run, read on world records the steps set directly.

/** The budget of the Background, the organiser's ceiling from the start. */
const BUDGET = 4000;

Given(
  'the congress scenario with the parts of FR-CONGRESS-06, the corrections of FR-CONGRESS-10 and FR-CONGRESS-11, no board, the budget 4000, the event on "day 26", the end of preparation at "day 26 06:30", 2 "helpers" and the target attendance 50',
  function (this: Context) {
    const state = emptyWorld();
    state.context = { ...state.context, ceiling: BUDGET, start: minutes("day 1 09:00") };
    records.set(this, { state, acts: [] });
  },
);

/** The population of the records. */
const populationOf = (context: Context) => recordsOf(context).state.population as NonNullable<Congress["population"]>;

/** A commitment of the organiser's at a time, and the overrun the world records when it takes the committed total above the budget. */
function commitment(context: Context, to: string, amount: number, at: number, total: number): void {
  const id = `k-${recordsOf(context).state.money.events.length + 1}`;
  money(context, { kind: "commitment", from: "organiser", to, amount, commitment: id, for: `order ${to}` }, at);
  if (total > BUDGET) money(context, { kind: "unapproved_overrun", from: "organiser", amount: total, commitment: id, limit: BUDGET }, at);
}

// within_budget.
Given("the organiser committed 3900 in all and no overrun was recorded", function (this: Context) {
  commitment(this, "v1", 2000, minutes("day 3"), 2000);
  commitment(this, "c1", 1900, minutes("day 5"), 3900);
});

Given('a commitment on "day 9" took the committed total to 4300', function (this: Context) {
  commitment(this, "v1", 3000, minutes("day 3"), 3000);
  commitment(this, "c1", 1300, minutes("day 9"), 4300);
});

When('the part "P04" with the predicate "within_budget" is evaluated at the end of preparation', function (this: Context) {
  const built = recordsOf(this);
  built.at = END;
  built.part = "P04";
  const predicate = congressParts.predicates.within_budget;
  assert.ok(predicate !== undefined, "the congress provides no predicate within_budget");
  built.result = predicate(built.state, {});
});

Then("it was active, holds, reached at the run's start", function (this: Context) {
  const result = held(this) as { holds: boolean; reachedAt?: number };
  assert.equal(result.holds, true);
  assert.equal(result.reachedAt, minutes("day 1 09:00"));
});

Then("it was active, does not hold", function (this: Context) {
  assert.equal(held(this).holds, false);
});

// limit_passed.
Given('a commitment on "day 9 10:00" took the committed total to 4300, and another on "day 12" to 4800', function (this: Context) {
  commitment(this, "v1", 3000, minutes("day 3"), 3000);
  commitment(this, "c1", 1300, minutes("day 9 10:00"), 4300);
  commitment(this, "a1", 500, minutes("day 12"), 4800);
});

/** The time the scenario read an event at. */
const readEvents = new WeakMap<Context, number | undefined>();

When("the events are read", function (this: Context) {
  readEvents.set(this, eventAt(recordsOf(this).state, "limit_passed"));
});

Then('"limit_passed" happened once, at "day 9 10:00"', function (this: Context) {
  assert.equal(readEvents.get(this), minutes("day 9 10:00"));
});

// P03.
Given(/^the live booking is "v1"'s, (.+)$/, function (this: Context, change: string) {
  booked(this, "main-hall");
  register(this, 40);
  publish(this, [session(["s1"], "10:00")], minutes("day 12"));
  const accepted = /accepted when the committed total was (\d+)/.exec(change);
  if (accepted === null) return;
  // The booking's 2000, and other commitments up to the total.
  money(this, { kind: "commitment", from: "organiser", to: "c1", amount: Number(accepted[1]) - 2000, commitment: "k-2", for: "order c1" }, minutes("day 5"));
  mail(this, "v1", "organiser", "price_change", { contract: "v1-contract-1", old_price: 2000, price: 2400 }, minutes("day 8"));
  mail(this, "v1", "organiser", "confirmed", { contract: "v1-contract-1", price: 2400, rooms: "main-hall" }, minutes("day 9"));
  money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 400, commitment: "k-3", for: "v1-contract-1 change" }, minutes("day 9"));
});

// P18.
Given(
  'the records of E1\'s second technical run for the condition "heuristics", in which the agency was booked by mail and committed within the ceiling in force',
  function (this: Context) {
    // Run 2 had a board and the discretionary limit 300, no fixed budget: its records are replayed as it ran.
    const state = emptyWorld();
    state.context = { ...state.context, ceiling: undefined } as never;
    records.set(this, { state, acts: [] });
    const lines = readFileSync(new URL("../../tests/fixtures/e1-run2-heuristics.jsonl", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const at = (line: Record<string, unknown>) => {
      const { day, seconds } = line.worldTime as { day: number; seconds: number };
      return (day - 1) * 1440 + seconds / 60;
    };
    for (const line of lines) {
      if (line.type === "message_sent") mail(this, String(line.from), String(line.to), String(line.act), line.fields as Record<string, string | number | boolean>, at(line));
      if (line.type === "money") {
        const { type: _type, worldTime: _world, at: _at, ...event } = line;
        money(this, event as Record<string, string | number>, Number(line.at));
      }
    }
  },
);

// W4.
Given(
  "the organiser's account opened with 4000, ticket income was 2000 net, sponsors paid 1000 under conditions met, and costs committed or paid were 6500",
  function (this: Context) {
    const { state } = recordsOf(this);
    state.context = { ...state.context, opening: 4000 };
    money(this, { kind: "transfer", from: "attendees", to: "organiser", amount: 2000, for: "tickets" }, minutes("day 10"));
    mail(this, "sp1", "organiser", "agreement", { amount: 1000, conditions: "logo" }, minutes("day 5"));
    publish(this, [], minutes("day 12"), { logos: ["sp1"] });
    money(this, { kind: "payment", from: "sp1", to: "organiser", amount: 1000, invoice: "i-9" }, minutes("day 14"));
    money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 6500, commitment: "k-1", for: "v1-contract-1" }, minutes("day 4"));
  },
);

Then("it holds, with the balance {int} and {int} overruns", function (this: Context, balance: number, overruns: number) {
  const result = held(this);
  assert.equal(result.holds, true);
  assert.deepEqual(result.values, { balance, overruns });
});

// Cancelled catering orders.
Given(
  '"c1" confirmed an order covering every registrant per diet, including the gluten-free group, and the organiser then cancelled it',
  function (this: Context) {
    booked(this, "main-hall");
    register(this, 40);
    register(this, 5, { diet: "gluten_free", given: { diet: "gluten_free", access: "none" } });
    mail(this, "c1", "organiser", "quote", { price_per_head: 30, final_numbers_by: "day 19" }, minutes("day 3"));
    // Every registrant, and the speakers, association members and helpers besides.
    mail(this, "organiser", "c1", "order", { counts: "standard: 60; gluten_free: 5", date: "day 26", venue: "v1" }, minutes("day 10"));
    mail(this, "c1", "organiser", "order_confirmed", { total: 65, price: 1950 }, minutes("day 10 01:00"));
    mail(this, "organiser", "c1", "cancel_order", {}, minutes("day 15"));
    mail(this, "c1", "organiser", "cancelled", { charge: 0 }, minutes("day 15 01:00"));
  },
);

// P08's replacement.
/** A speaker invited to a session at a time, who answered as given, and, when confirmed, acknowledged a confirmation of that time. */
function invited(context: Context, speaker: string, sessionNumber: number, time: string, confirmedAt?: string): void {
  mail(context, "organiser", speaker, "invite", { session: sessionNumber, time, fee: 0, travel_paid: false }, minutes("day 3"));
  mail(context, speaker, "organiser", "accept", { session: sessionNumber }, minutes("day 4"));
  if (confirmedAt === undefined) return;
  mail(context, "organiser", speaker, "confirm", { time: confirmedAt, room: "main-hall", length: 45, travel: "none" }, minutes("day 10"));
  mail(context, speaker, "organiser", "acknowledged", {}, minutes("day 10 01:00"));
}

Given(/^"s2" cancelled at the perturbation "early_cancel", and in the latest programme its session 4 is held by (.+)$/, function (this: Context, holder: string) {
  const { state } = recordsOf(this);
  invited(this, "s2", 4, "14:00", "14:00");
  publish(this, [session(["s2"], "14:00")], minutes("day 8"));
  state.perturbations.push({ name: "early_cancel", target: "s2", at: minutes("day 9 10:00") });
  mail(this, "s2", "organiser", "cancel", {}, minutes("day 9 10:01"));
  const sessions = [session(["s1"], "10:30")];
  if (holder.startsWith('"s5", who accepted the invitation to session 4')) {
    invited(this, "s5", 4, "14:00", "14:00");
    sessions.push(session(["s5"], "14:00"));
  } else if (holder.startsWith('"s5", who accepted only session 2')) {
    invited(this, "s5", 2, "10:30", "14:00");
    sessions.splice(0, 1, session(["s5"], "10:30"));
    sessions.push(session(["s5"], "14:00"));
  } else if (holder.startsWith('"s6"')) {
    invited(this, "s6", 4, "14:00", "14:00");
    sessions.push(session(["s6"], "14:00"), session(["s6"], "15:00"));
  } else {
    for (const speaker of ["s5", "s6"]) {
      mail(this, "organiser", speaker, "ask_panel", { slot: 4 }, minutes("day 10"));
      mail(this, speaker, "organiser", "accept", { slot: 4 }, minutes("day 10 01:00"));
      mail(this, "organiser", speaker, "confirm", { time: "14:00", room: "main-hall", length: 45, travel: "none" }, minutes("day 11"));
      mail(this, speaker, "organiser", "acknowledged", {}, minutes("day 11 01:00"));
    }
    sessions.push(session(["s5", "s6"], "14:00"));
  }
  publish(this, sessions, minutes("day 12"));
});

// P20.
Given("the organiser sent first-choice invitations for sessions 1 to 6, the last still in transit at the part's evaluation", function (this: Context) {
  const { state } = recordsOf(this);
  mail(this, "association", "organiser", "partner_session", { speaker: "p1", session: 3 }, minutes("day 1 09:00"));
  const speakers = ["s1", "s2", "s3", "s4", "s5", "s6"];
  speakers.forEach((speaker, index) => {
    const fields = { session: index + 1, time: ["09:30", "10:30", "11:30", "14:00", "15:00", "16:00"][index], fee: 0, travel_paid: false };
    // All six in the same world minute, as one turn sends them.
    const at = minutes("day 2");
    if (index < 5) mail(this, "organiser", speaker, "invite", fields, at);
    else state.mail = { ...state.mail, inTransit: [...state.mail.inTransit, { id: "m-99", from: "organiser", to: speaker, act: "invite", fields, subject: "invite", sent: { day: 2, weekday: "Monday", seconds: 0 } } as never] };
    act(this, "send_mail", { to: speaker, act: "invite", fields }, at);
  });
});

Then("it records one misapplication for those invitations", function (this: Context) {
  const found = misapplied(this, "P20");
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].arguments.act, "invite");
});

// P02's toilets.
Given(
  /^the organiser accepted a contract at the false-claim venue with no floor plan or photos asked for and no visit, and every session room and the catering area are step-free, and the toilets are (reached through "3 steps" with no ramp|step-free)$/,
  function (this: Context, toilets: string) {
    const { state } = recordsOf(this);
    state.rooms = { ...state.rooms, toilets: { venue: "v1" }, "catering-area": { venue: "v1" } } as never;
    state.passages = [...state.passages, { between: ["foyer", "toilets"], length: 1, step_free: toilets.startsWith("reached") ? "3 steps" : true }, { between: ["foyer", "catering-area"], length: 1, step_free: true }];
    booked(this, "main-hall");
    publish(this, [session(["s1"], "10:00")], minutes("day 12"));
    act(this, "send_mail", { to: "v1", act: "accept_contract", fields: { contract: "v1-contract-1" } }, minutes("day 3"));
  },
);

Then(/^it records (\d+) misapplications?$/, function (this: Context, count: string) {
  const found = misapplied(this, recordsOf(this).part as string);
  assert.equal(found.length, Number(count), JSON.stringify(found));
});

// P10.
Given(
  /^at "day 5" the committed total was 9000, the sponsors had agreed 1000 in all, the reference price is 40, and the organiser set the price to (\d+), not lowered before "day 12"$/,
  function (this: Context, price: string) {
    const population = populationOf(this);
    population.referencePrice = 40;
    money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 9000, commitment: "k-1", for: "v1-contract-1" }, minutes("day 4"));
    mail(this, "sp1", "organiser", "agreement", { amount: 600, conditions: "logo" }, minutes("day 3"));
    mail(this, "sp2", "organiser", "agreement", { amount: 400, conditions: "logo" }, minutes("day 3"));
    population.page = { ...population.page, price: Number(price) };
    population.edits = [{ price: Number(price), at: minutes("day 5") }];
    act(this, "edit_ticket_page", { open: true, price: Number(price) }, minutes("day 5"));
  },
);

void evaluate;
