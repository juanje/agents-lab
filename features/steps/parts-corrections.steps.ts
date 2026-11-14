import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { effortMoney } from "../../src/engine/parts.ts";
import { answerFor, congressParts } from "../../src/scenarios/congress-parts.ts";
import type { Congress } from "../../src/scenarios/congress.ts";
import type { Context } from "../support/context.ts";
import {
  END,
  SIX,
  TIMES,
  act,
  booked,
  confirmed,
  emptyWorld,
  eventAt,
  evaluate,
  held,
  mail,
  minutes,
  misapplied,
  money,
  publish,
  records,
  recordsOf,
  register,
  session,
} from "./congress-parts.steps.ts";

// FR-CONGRESS-10: the parts' corrections, read on world records the steps set directly, as FR-CONGRESS-06's are.

Given(
  'the congress scenario with the parts of FR-CONGRESS-06 and the corrections of FR-CONGRESS-09, the event on "day 26", the end of preparation at "day 26 06:30", 2 "helpers" and the target attendance 50',
  function (this: Context) {
    records.set(this, { state: emptyWorld(), acts: [] });
  },
);

/** The population of the records. */
const populationOf = (context: Context) => recordsOf(context).state.population as NonNullable<Congress["population"]>;

/** Six sessions in the latest programme, each with a confirmed speaker, published on day 12. */
function sixSessions(context: Context): void {
  SIX.forEach((speaker, index) => confirmed(context, speaker, TIMES[index]));
  publish(context, SIX.map((speaker, index) => session([speaker], TIMES[index])), minutes("day 12"));
}

/** The states in which nothing happened, each with what makes its part otherwise hold. */
const EMPTY: Record<string, (context: Context) => void> = {
  "no registrant": () => {},
  "the gluten-free group has not registered": () => {},
  "no catering order, and the page closed": (context) => {
    populationOf(context).page = { ...populationOf(context).page, open: false };
  },
  "no confirmed speaker from a station in the programme": () => {},
  'S2 agreed to "attendee_list" with no consent field, and sent nothing yet': (context) => {
    mail(context, "organiser", "sp2", "accept_sponsorship", { conditions: "logo, attendee_list" }, minutes("day 4"));
    mail(context, "sp2", "organiser", "agreement", { amount: 1000, conditions: "logo, attendee_list" }, minutes("day 4 01:00"));
  },
  "S3 never agreed and withdrew": (context) => {
    recordsOf(context).state.perturbations.push({ name: "sponsor_withdraws", target: "sp3", at: minutes("day 12") });
  },
  "no allocation mail was received": (context) => {
    booked(context, "main-hall, room-b");
    sixSessions(context);
  },
  "no live booking": (context) => sixSessions(context),
  "3 sessions in the programme": (context) => {
    booked(context, "main-hall");
    SIX.slice(0, 3).forEach((speaker, index) => confirmed(context, speaker, TIMES[index]));
    publish(context, SIX.slice(0, 3).map((speaker, index) => session([speaker], TIMES[index])), minutes("day 12"));
  },
};

Given(/^(no registrant|the gluten-free group has not registered|no catering order, and the page closed|no confirmed speaker from a station in the programme|S2 agreed to "attendee_list" with no consent field, and sent nothing yet|S3 never agreed and withdrew|no allocation mail was received|no live booking|3 sessions in the programme)$/, function (this: Context, state: string) {
  EMPTY[state](this);
});

/** When a part is evaluated as it is due: at its event when it has one, or at the end of preparation. */
const DUE: Record<string, (state: Congress) => number | undefined> = {
  P04: (state) => eventAt(state, "limit_passed"),
  P11: (state) => eventAt(state, "final_numbers_due"),
};

When(/^"(\w+)" is evaluated as it is due$/, function (this: Context, part: string) {
  const { state } = recordsOf(this);
  evaluate(this, part, DUE[part]?.(state) ?? END);
});

// P04.
Given('the board approved a budget on "day 3 11:00" and the committed total first passed 300 on "day 4"', function (this: Context) {
  money(this, { kind: "approval", from: "board", to: "organiser", amount: 5500 }, minutes("day 3 11:00"));
  money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 200, commitment: "k-1", for: "a" }, minutes("day 2"));
  money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 200, commitment: "k-2", for: "b" }, minutes("day 4"));
});

/** The reached_at a part's predicate gives, as a world time "day <n> HH:MM". */
function reachedOf(context: Context): number | undefined {
  return (held(context) as { reachedAt?: number }).reachedAt;
}

Then('it was activated on "day 4", holds, and was reached at "day 3 11:00"', function (this: Context) {
  const { state } = recordsOf(this);
  assert.equal(Math.floor((eventAt(state, "limit_passed") as number) / 1440), 3);
  assert.equal(held(this).holds, true);
  assert.equal(reachedOf(this), minutes("day 3 11:00"));
});

// P11.
Given('the page opened on "day 3" without required fields, required "diet" and "access" from "day 5 10:00", and 3 people registered', function (this: Context) {
  const population = populationOf(this);
  population.page = { ...population.page, open: true, required_fields: ["diet", "access"] };
  population.edits = [
    { at: minutes("day 3"), open: true, required_fields: [] },
    { at: minutes("day 5 10:00"), required_fields: ["diet", "access"] },
  ] as never;
  register(this, 3, {}, minutes("day 6"));
});

Then('it holds, reached at "day 5 10:00"', function (this: Context) {
  assert.equal(held(this).holds, true);
  assert.equal(reachedOf(this), minutes("day 5 10:00"));
});

// P05.
Given('"s1" accepted session 2 and later declined a panel in slot 4', function (this: Context) {
  mail(this, "organiser", "s1", "invite", { session: 2, time: "10:30", fee: 0, travel_paid: false }, minutes("day 3"));
  mail(this, "s1", "organiser", "accept", { session: 2 }, minutes("day 4"));
  mail(this, "organiser", "s1", "ask_panel", { slot: 4 }, minutes("day 6"));
  mail(this, "s1", "organiser", "decline", { slot: 4 }, minutes("day 7"));
});

/** The answer the scenario read. */
const answers = new WeakMap<Context, string | undefined>();

When(/^"P05" reads "(\w+)"'s answer for session (\d+)$/, function (this: Context, speaker: string, sessionNumber: number) {
  answers.set(this, answerFor(recordsOf(this).state, speaker, sessionNumber));
});

Then(/^it is "(accept|accept_if|decline)"$/, function (this: Context, answer: string) {
  assert.equal(answers.get(this), answer);
});

// P06.
Given('"s1" answered "accept_if" for its fee 300, the organiser offered 0 and sent "accept_condition", and "s1" answered "accept_if" again', function (this: Context) {
  const { state } = recordsOf(this);
  state.context = { ...state.context, fees: { s1: 300 } } as never;
  mail(this, "organiser", "s1", "invite", { session: 2, time: "10:30", fee: 0, travel_paid: false }, minutes("day 3"));
  mail(this, "s1", "organiser", "accept_if", { session: 2, condition: "fee" }, minutes("day 4"));
  mail(this, "organiser", "s1", "accept_condition", { fee: 0 }, minutes("day 5"));
  mail(this, "s1", "organiser", "accept_if", { session: 2, condition: "fee" }, minutes("day 6"));
});

// P20.
Given(
  'the board\'s partner mail was in the inbox, the organiser invited first choices for sessions 1 to 6 by "day 2", re-invited 3 speakers after declines, and withdrew "s6" after it accepted, twice',
  function (this: Context) {
    mail(this, "board", "organiser", "partner_session", { speaker: "p1", session: 3 }, minutes("day 1 09:00"));
    const invite = (speaker: string, sessionNumber: number, at: number) => {
      const fields = { session: sessionNumber, time: TIMES[sessionNumber - 1], fee: 0, travel_paid: false };
      mail(this, "organiser", speaker, "invite", fields, at);
      act(this, "send_mail", { to: speaker, act: "invite", fields }, at);
    };
    SIX.forEach((speaker, index) => invite(speaker, index + 1, minutes("day 2") + index));
    // Declines for sessions 1, 2 and 4, and the others invited in their place.
    ["s1", "s2", "s4"].forEach((speaker, index) => mail(this, speaker, "organiser", "decline", { session: [1, 2, 4][index] }, minutes("day 3") + index));
    ["s7", "s8", "s9"].forEach((speaker, index) => invite(speaker, [1, 2, 4][index], minutes("day 4") + index));
    mail(this, "s6", "organiser", "accept", { session: 6 }, minutes("day 3 10:00"));
    for (const at of [minutes("day 6"), minutes("day 7")]) {
      mail(this, "organiser", "s6", "withdraw_invitation", {}, at);
      act(this, "send_mail", { to: "s6", act: "withdraw_invitation", fields: {} }, at);
    }
  },
);

Then("it lists 2 misapplications: the invitation completing the six sessions, and the first withdrawal of {string}", function (this: Context, speaker: string) {
  const found = misapplied(this, "P20");
  assert.equal(found.length, 2, JSON.stringify(found));
  const [completing, withdrawal] = found;
  assert.deepEqual([completing.arguments.act, (completing.arguments.fields as { session: number }).session], ["invite", 6]);
  assert.deepEqual([withdrawal.arguments.act, withdrawal.arguments.to, withdrawal.world.day], ["withdraw_invitation", speaker, 6]);
});

// P02.
Given(
  'the organiser accepted the false-claim venue\'s contract twice without a floor plan, and a session room of the live booking is reached through "3 steps" with no ramp',
  function (this: Context) {
    const { state } = recordsOf(this);
    state.passages = state.passages.map((passage) => (passage.between.includes("room-b") ? { ...passage, step_free: "3 steps" } : passage));
    booked(this, "main-hall, room-b");
    publish(this, [session(["s1"], "10:00", "room-b")], minutes("day 12"));
    for (const at of [minutes("day 3"), minutes("day 3 02:00")]) {
      mail(this, "organiser", "v1", "accept_contract", { contract: "v1-contract-1" }, at);
      act(this, "send_mail", { to: "v1", act: "accept_contract", fields: { contract: "v1-contract-1" } }, at);
    }
  },
);

Then(/^it lists (\d+) misapplications?(?:, the one on "(day \d+)")?$/, function (this: Context, count: number, day: string | null) {
  const found = misapplied(this, recordsOf(this).part as string);
  assert.equal(found.length, Number(count), JSON.stringify(found));
  if (day !== null) assert.equal(`day ${found[0].world.day}`, day);
});

// P21.
Given(
  'the organiser\'s "publish_programme" on "day 10" failed, and one on "day 12" succeeded, both naming rooms, and the allocation came on "day 15"',
  function (this: Context) {
    booked(this, "main-hall, room-b");
    const programme = { sessions: [session(["s1"], "10:00", "room-b")] };
    act(this, "publish_programme", programme, minutes("day 10"));
    recordsOf(this).acts[0].act = { ...recordsOf(this).acts[0].act, outcome: "invalid_value" } as never;
    act(this, "publish_programme", programme, minutes("day 12"));
    recordsOf(this).acts[1].act = { ...recordsOf(this).acts[1].act, outcome: "success" } as never;
    publish(this, programme.sessions, minutes("day 12"));
    mail(this, "v1", "organiser", "rooms_allocated", { contract: "v1-contract-1", allocation: "main-hall -> main-hall; room-b -> room-d" }, minutes("day 15"));
  },
);

// Effort.
Given(
  'the organiser committed 2889 to "v1", paid its deposit of 867 against it, then "v1" released 2889 and the organiser committed 3000 to "v2"',
  function (this: Context) {
    money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 2889, commitment: "k-1", for: "v1-contract-1" }, minutes("day 3"));
    money(this, { kind: "payment", from: "organiser", to: "v1", amount: 867, invoice: "i-1" }, minutes("day 4"));
    money(this, { kind: "release", from: "organiser", to: "v1", amount: 2889, commitment: "k-1" }, minutes("day 8"));
    money(this, { kind: "commitment", from: "organiser", to: "v2", amount: 3000, commitment: "k-2", for: "v2-contract-1" }, minutes("day 9"));
  },
);

/** The effort money the scenario read. */
const efforts = new WeakMap<Context, number>();

When(/^"P01"'s effort is read$/, function (this: Context) {
  const { state } = recordsOf(this);
  const entries = (state.money.events as readonly Record<string, unknown>[]).map((event) => ({ event, at: Number(event.at) }));
  efforts.set(this, effortMoney(entries, ["organiser"], ["v1", "v2"], 0, END));
});

Then("its money is {int}", function (this: Context, amount: number) {
  assert.equal(efforts.get(this), amount);
});

// W4.
Given("the organiser cancelled every booking and announced the cancellation to registrants, and the balance is 1800", function (this: Context) {
  booked(this, "main-hall");
  mail(this, "organiser", "v1", "cancel_booking", {}, minutes("day 12"));
  mail(this, "v1", "organiser", "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes("day 12 01:00"));
  money(this, { kind: "release", from: "organiser", to: "v1", amount: 2000, commitment: "k-1" }, minutes("day 12 01:00"));
  money(this, { kind: "transfer", from: "board", to: "organiser", amount: 1800, for: "budget" }, minutes("day 3"));
  const population = populationOf(this);
  population.announcements = [...(population.announcements ?? []), { audience: "registrants", kind: "change", at: minutes("day 12 02:00") }];
});

void congressParts;
