import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { congressParts } from "../../src/scenarios/congress-parts.ts";
import type { Congress } from "../../src/scenarios/congress.ts";
import type { Context } from "../support/context.ts";
import { SIX, TIMES, act, eventAt, held, mail, minutes, misapplied, money, publish, records, recordsOf, register, session, worldOf, emptyWorld } from "./congress-parts.steps.ts";

// FR-CONGRESS-14: the parts' corrections from E1's third technical run, read on world records the steps set directly.

/** The budget of the Background, the organiser's ceiling from the start. */
const BUDGET = 4000;

Given(
  'the congress scenario with the parts of FR-CONGRESS-06, the corrections of FR-CONGRESS-10, FR-CONGRESS-12 and FR-CONGRESS-13, no board, the budget 4000, the event on "day 26", the end of preparation at "day 26 06:30", 2 "helpers", the target attendance 50 and the reference price 40',
  function (this: Context) {
    const state = emptyWorld();
    state.context = { ...state.context, ceiling: BUDGET, opening: 0, start: minutes("day 1 09:00") };
    (state.population as NonNullable<Congress["population"]>).referencePrice = 40;
    records.set(this, { state, acts: [] });
  },
);

/** "v1"'s contract for the event day, from its mail, confirmed on day 3. */
function contracted(context: Context, venue = "v1", room = "main-hall", day = 2): void {
  mail(context, venue, "organiser", "contract", { contract: `${venue}-contract-1`, date: "day 26", rooms: room, hours: "08:00-18:00", price: 2000, terms: "Rooms are indicative until allocated." }, minutes(`day ${day}`));
  mail(context, venue, "organiser", "confirmed", { contract: `${venue}-contract-1` }, minutes(`day ${day}`) + 60);
}

/** Six sessions in "main-hall" in the latest programme, with S1's morning slot, published on day 12; their speakers as given. */
function sixSessions(context: Context): void {
  // W1 also needs S1's slot (FR-CONGRESS-06), which these scenarios leave aside.
  publish(context, SIX.map((speaker, index) => session([speaker], TIMES[index])), minutes("day 12"), { sponsor_slots: [{ sponsor: "sp1", start: "09:15", end: "09:30" }], logos: ["sp1"] });
}

/** An answered call: the caller's act and its callee's answer, ended at a world time. */
function called(context: Context, from: string, to: string, act: string, fields: Record<string, string | number | boolean>, answer: string, answered: Record<string, string | number | boolean>, at: number): void {
  const { state } = recordsOf(context);
  const call = { id: `c-${state.phone.calls.length + 1}`, from, to, act, fields, status: "ended", outcome: "answered", answer: { act: answer, fields: answered }, endedAt: worldOf(at) };
  state.phone = { calls: [...state.phone.calls, call as never] };
}

/** A call nobody answered. */
function unanswered(context: Context, from: string, to: string, act: string, fields: Record<string, string | number | boolean>): void {
  const { state } = recordsOf(context);
  state.phone = { calls: [...state.phone.calls, { id: `c-${state.phone.calls.length + 1}`, from, to, act, fields, status: "ended", outcome: "no_answer" } as never] };
}

// W3 and W4.
Given(
  /^(a live booking and six sessions in the latest programme|no live booking, the venue having cancelled for an unpaid deposit), catering ordered per diet covers the attendance per diet, and the W4 balance is 300 with no overrun$/,
  function (this: Context, congress: string) {
    contracted(this);
    if (congress.startsWith("no live booking")) mail(this, "v1", "organiser", "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes("day 11"));
    sixSessions(this);
    // 40 registrants, 3 association members and 2 helpers; the six speakers are not confirmed.
    register(this, 40);
    mail(this, "organiser", "c1", "order", { counts: "standard: 45", date: "day 26", venue: "v1" }, minutes("day 10") - 1);
    mail(this, "c1", "organiser", "order_confirmed", { total: 45, price: 1350 }, minutes("day 10"));
    recordsOf(this).state.context = { ...recordsOf(this).state.context, opening: 4000 };
    money(this, { kind: "commitment", from: "organiser", to: "c1", amount: 3700, commitment: "k-1", for: "order c1" }, minutes("day 10"));
  },
);

Given('a live booking and six sessions in the latest programme, the W4 balance 300, and one "unapproved_overrun" recorded', function (this: Context) {
  contracted(this);
  sixSessions(this);
  recordsOf(this).state.context = { ...recordsOf(this).state.context, opening: 4000 };
  money(this, { kind: "commitment", from: "organiser", to: "c1", amount: 3700, commitment: "k-1", for: "order c1" }, minutes("day 10"));
  money(this, { kind: "unapproved_overrun", from: "organiser", amount: 4100, commitment: "k-2", limit: BUDGET }, minutes("day 11"));
});

Then("it does not hold, with the balance {int} and {int} overrun", function (this: Context, balance: number, overruns: number) {
  const result = held(this);
  assert.equal(result.holds, false);
  assert.deepEqual(result.values, { balance, overruns });
});

// W1.
Given(
  /^six sessions in the latest programme, each held by a speaker who accepted it and believes its time and room, and (the organiser confirmed every one by mail and each acknowledged|the organiser confirmed four by mail and two on calls, and each acknowledged|the organiser confirmed four, and two learned their slot only from the published programme)$/,
  function (this: Context, how: string) {
    SIX.forEach((speaker, index) => {
      const time = TIMES[index];
      mail(this, "organiser", speaker, "invite", { session: index + 1, time, fee: 0, travel_paid: false }, minutes("day 3"));
      mail(this, speaker, "organiser", "accept", { session: index + 1 }, minutes("day 4"));
      if (index < 4 || how.startsWith("the organiser confirmed every one")) {
        mail(this, "organiser", speaker, "confirm", { time, room: "main-hall", length: 45, travel: "none" }, minutes("day 5"));
        mail(this, speaker, "organiser", "acknowledged", {}, minutes("day 5 01:00"));
      } else if (how.includes("on calls")) called(this, "organiser", speaker, "confirm", { time, room: "main-hall", length: 45, travel: "none" }, "acknowledged", {}, minutes("day 5"));
    });
    // The published programme tells each speaker its session's time and room.
    sixSessions(this);
  },
);

// P06.
/** Whether P06's activation, the event conditional_answer, happened, and when, in world minutes. */
function conditionalAnswer(context: Context): number | undefined {
  assert.ok(congressParts.events.conditional_answer !== undefined, "the congress provides no event conditional_answer");
  return eventAt(recordsOf(context).state, "conditional_answer");
}

Given('no first invitee answered "accept_if"', function (this: Context) {
  // "s1", the first invited to session 2, accepted; "s2", invited to it after "s1", answered accept_if.
  mail(this, "organiser", "s1", "invite", { session: 2, time: "10:30", fee: 0, travel_paid: false }, minutes("day 2"));
  mail(this, "s1", "organiser", "accept", { session: 2 }, minutes("day 3"));
  mail(this, "organiser", "s2", "invite", { session: 2, time: "10:30", fee: 0, travel_paid: false }, minutes("day 4"));
  mail(this, "s2", "organiser", "accept_if", { session: 2, condition: "travel_paid", travel_paid: true, from: "north" }, minutes("day 5"));
});

Given('"s1" answered "accept_if" on a call on "day 2", and accepted after "accept_condition" with its fee', function (this: Context) {
  const { state } = recordsOf(this);
  state.context = { ...state.context, fees: { s1: 300 } };
  called(this, "organiser", "s1", "invite", { session: 2, time: "10:30", fee: 0, travel_paid: false }, "accept_if", { session: 2, condition: "fee", fee: 300 }, minutes("day 2 10:00"));
  mail(this, "organiser", "s1", "accept_condition", { session: 2, fee: 300 }, minutes("day 3"));
  mail(this, "s1", "organiser", "accept", { session: 2 }, minutes("day 4"));
});

// "it was not active" is FR-CONGRESS-06's step, which reads P06's activation as conditional_answer.

Then('it was active from "day 2", and holds', function (this: Context) {
  const at = conditionalAnswer(this);
  assert.ok(at !== undefined && Math.floor(at / 1440) === 1, `it was active from ${String(at)}`);
  assert.equal(held(this).holds, true);
});

// P10.
Given(/^the organiser set the price to (\d+) on "(day \d+)"(?:, and to (\d+) on "(day \d+)")?$/, function (this: Context, first: string, day: string, later: string | null, laterDay: string | null) {
  const population = recordsOf(this).state.population as NonNullable<Congress["population"]>;
  const edits: [number, string][] = [[Number(first), day], ...(later === null ? [] : [[Number(later), laterDay as string] as [number, string]])];
  for (const [price, on] of edits) {
    population.page = { ...population.page, open: true, price };
    population.edits = [...(population.edits ?? []), { price, open: true, at: minutes(on) }];
    act(this, "edit_ticket_page", { open: true, price }, minutes(on));
  }
});

Then("it records no misapplication", function (this: Context) {
  const found = misapplied(this, recordsOf(this).part as string);
  assert.deepEqual(found, []);
});

Then(/^it records one misapplication: the "(\w+)" of "(day \d+)"$/, function (this: Context, tool: string, day: string) {
  const found = misapplied(this, recordsOf(this).part as string);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].tool === "send_mail" || found[0].tool === "call" ? found[0].arguments.act : found[0].tool, tool);
  assert.equal(found[0].world.day, Number(/\d+/.exec(day)?.[0]));
});

Then("it records one misapplication", function (this: Context) {
  const found = misapplied(this, recordsOf(this).part as string);
  assert.equal(found.length, 1, JSON.stringify(found));
});

Then(/^it records one misapplication, the "(\w+)" of "(day \d+)"$/, function (this: Context, kind: string, day: string) {
  const found = misapplied(this, recordsOf(this).part as string);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].arguments.act, kind);
  assert.equal(found[0].world.day, Number(/\d+/.exec(day)?.[0]));
});

// P20.
/** The organiser's withdrawal of "s3"'s invitation on a day, by mail. */
function withdrawing(context: Context, day: string): void {
  mail(context, "organiser", "s3", "withdraw_invitation", {}, minutes(day));
  act(context, "send_mail", { to: "s3", act: "withdraw_invitation" }, minutes(day));
}

Given(/^"s3" had accepted session 3, and (.+)$/, function (this: Context, situation: string) {
  mail(this, "association", "organiser", "partner_session", { speaker: "p1", session: 5 }, minutes("day 1 09:00"));
  contracted(this);
  mail(this, "organiser", "s3", "invite", { session: 3, time: "11:30", fee: 0, travel_paid: false }, minutes("day 3"));
  mail(this, "s3", "organiser", "accept", { session: 3 }, minutes("day 4"));
  if (situation === 'the organiser sent "s3" "withdraw_invitation" on "day 10"') withdrawing(this, "day 10");
  else if (situation.startsWith('"s3" cancelled at "early_cancel"')) {
    recordsOf(this).state.perturbations.push({ name: "early_cancel", target: "s3", at: minutes("day 8") });
    mail(this, "s3", "organiser", "cancel", {}, minutes("day 8") + 1);
    withdrawing(this, "day 10");
  } else {
    assert.ok(situation.startsWith('the venue cancelled on "day 19"'), `the steps do not read "${situation}"`);
    mail(this, "v1", "organiser", "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes("day 19"));
    withdrawing(this, "day 20");
    if (situation.endsWith('and booked "v2" on "day 21"')) contracted(this, "v2", "hall-2", 21);
  }
});

// P02.
Given(
  /^the live booking is at the false-claim venue, a session room is reached through "3 steps" with no ramp, no floor plan or photos were asked for and there was no visit, and (.+)$/,
  function (this: Context, acts: string) {
    const { state } = recordsOf(this);
    state.passages = state.passages.map((passage) => (passage.between.includes("room-b") ? { ...passage, step_free: "3 steps" } : passage));
    publish(this, [session(["s1"], "10:00", "room-b")], minutes("day 12"));
    if (acts.startsWith('the organiser\'s "call" with the act "book" on "day 19" was not answered')) {
      unanswered(this, "organiser", "v1", "book", { date: "day 26", rooms: "main-hall, room-b", hours: "08:00-18:00" });
      act(this, "call", { to: "v1", act: "book", fields: { date: "day 26", rooms: "main-hall, room-b", hours: "08:00-18:00" } }, minutes("day 19"));
      mail(this, "organiser", "v1", "book", { date: "day 26", rooms: "main-hall, room-b", hours: "08:00-18:00" }, minutes("day 19 12:00"));
      act(this, "send_mail", { to: "v1", act: "book", fields: { date: "day 26", rooms: "main-hall, room-b", hours: "08:00-18:00" } }, minutes("day 19 12:00"));
      contracted(this, "v1", "main-hall, room-b", 20);
      mail(this, "organiser", "v1", "accept_contract", { contract: "v1-contract-1" }, minutes("day 22"));
      act(this, "send_mail", { to: "v1", act: "accept_contract", fields: { contract: "v1-contract-1" } }, minutes("day 22"));
    } else {
      assert.equal(acts, 'the organiser\'s only act was a "call" with the act "accept_contract" that was not answered');
      contracted(this, "v1", "main-hall, room-b", 20);
      unanswered(this, "organiser", "v1", "accept_contract", { contract: "v1-contract-1" });
      act(this, "call", { to: "v1", act: "accept_contract", fields: { contract: "v1-contract-1" } }, minutes("day 22"));
    }
  },
);

// P21.
Given(
  /^"v1"'s contract with the indicative-rooms term arrived on "day 4", the organiser published a programme with "room-b" on "day 12", and "v1" allocated "room-b" as "room-d" at "day 15 10:00", and (.+)$/,
  function (this: Context, after: string) {
    const { state } = recordsOf(this);
    contracted(this, "v1", "main-hall, room-b", 4);
    // Six sessions: "s2" in "room-b", five in "main-hall", each speaker confirmed with its room.
    const rooms = SIX.map((speaker) => (speaker === "s2" ? "room-b" : "main-hall"));
    SIX.forEach((speaker, index) => {
      mail(this, "organiser", speaker, "invite", { session: index + 1, time: TIMES[index], fee: 0, travel_paid: false }, minutes("day 5"));
      mail(this, speaker, "organiser", "accept", { session: index + 1 }, minutes("day 6"));
      mail(this, "organiser", speaker, "confirm", { time: TIMES[index], room: rooms[index], length: 45, travel: "none" }, minutes("day 7"));
      mail(this, speaker, "organiser", "acknowledged", {}, minutes("day 7 01:00"));
    });
    const programme = (moved: boolean) => SIX.map((speaker, index) => session([speaker], TIMES[index], rooms[index] === "room-b" && moved ? "room-d" : rooms[index]));
    publish(this, programme(false), minutes("day 12"));
    act(this, "publish_programme", { sessions: programme(false) }, minutes("day 12"));
    register(this, 10, {}, minutes("day 11"));
    const population = state.population as NonNullable<Congress["population"]>;
    /** Every registrant is told a programme version at a world time. */
    const tell = (version: number, at: number) => {
      population.people = population.people.map((person) => ({ ...person, believes: version }));
      population.events = [...(population.events ?? []), ...population.people.map(({ id }) => ({ event: "belief" as const, person: id, version, worldTime: worldOf(at) }))];
      population.announcements = [...(population.announcements ?? []), { audience: "registrants", kind: "programme", at }];
      act(this, "announce", { audience: "registrants", kind: "programme" }, at);
    };
    tell(1, minutes("day 12 01:00"));
    mail(this, "v1", "organiser", "rooms_allocated", { contract: "v1-contract-1", allocation: "main-hall -> main-hall; room-b -> room-d" }, minutes("day 15 10:00"));
    const late = after.includes('on "day 17"');
    const republishedAt = late ? minutes("day 17") : minutes("day 16 09:00");
    publish(this, programme(true), republishedAt);
    act(this, "publish_programme", { sessions: programme(true) }, republishedAt);
    if (after.includes("announced")) tell(2, republishedAt + 1);
    if (after.includes('told "s2"')) {
      mail(this, "organiser", "s2", "change", { room: "room-d" }, republishedAt + 2);
      act(this, "send_mail", { to: "s2", act: "change", fields: { room: "room-d" } }, republishedAt + 2);
    }
    // "s2" learns its room from the programme too, unless it still believes the old one.
    if (after.includes('"s2" still believes "room-b"')) {
      mail(this, "organiser", "s2", "change", { room: "room-b" }, republishedAt + 3);
      act(this, "send_mail", { to: "s2", act: "change", fields: { room: "room-b" } }, republishedAt + 3);
    }
  },
);
