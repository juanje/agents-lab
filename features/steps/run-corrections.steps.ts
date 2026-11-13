import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { type TomlTable, stringify } from "smol-toml";
import type { Context } from "../support/context.ts";
import { change, hourMsOf, organiserTurns, setUpCongress } from "./congress.steps.ts";
import { before, changePools, fieldsOf, moneyLines, ranLines, sentBy, sentWith } from "./congress-parties.steps.ts";
import { organiserSummary } from "./services.steps.ts";
import { modelOf, script } from "./tool.steps.ts";

/** A step's text as a regular expression that matches it alone, so its parentheses are text. */
const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** The congress's one agent. */
const ORGANISER = "organiser";

/** Every day of the week, all day; and office hours, Monday to Friday from 09:00 to 17:00. */
const HOURS = {
  always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" },
  office: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], from: "09:00", to: "17:00" },
};

/** The Background's city: an office and the venue "v1" with its rooms "hall-a" and "hall-b". */
const CITY = {
  places: [{ id: "office" }],
  venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "hall-a", seats: 80 }, { id: "hall-b", seats: 40 }] }],
  passages: [
    { between: ["office", "v1-entrance"], length: 20, step_free: true },
    { between: ["v1-entrance", "hall-a"], length: 1, step_free: true },
    { between: ["v1-entrance", "hall-b"], length: 1, step_free: true },
  ],
};

/** The venue "v1" of the Background. */
const V1: TomlTable = {
  id: "v1",
  rooms: [
    { id: "hall-a", seats: 80, equipment: [] },
    { id: "hall-b", seats: 40, equipment: [] },
  ],
  access_claim: "step-free access throughout",
  catering: "outside_free",
  opening: "doors open one hour before",
  price: 2000,
  extras: {},
  hold_days: 2,
  deposit_share: 0.25,
  deposit_due_days: 3,
  cancellation: [{ share: 0.5 }],
  indicative: false,
  enquiries_per_day: 0,
  pick_up: 1,
};

/** The speakers of the Background. */
const SPEAKERS: TomlTable[] = [
  { id: "s1", title: "Soil life", draw: 1, fee: 300, home: "local", available: true, acceptance: 1, condition: "fee", pick_up: 1 },
  { id: "s2", title: "Soil water", draw: 1, fee: 0, home: "local", available: true, acceptance: 0.5, pick_up: 1 },
];

/** The attendees material of the Background: a ticket page, and nobody who comes to it. */
const ATTENDEES = {
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

/** The sponsor of the Background. */
const SP1: TomlTable = { id: "sp1", amount: 1200, conditions: ["logo", "morning_slot"], insists: [], pay_days: [2, 2], pick_up: 1 };

Given(
  "the congress scenario of FR-CONGRESS-08, whose calendar starts at {string} with one segment of scale {int}, so one world hour is {int} milliseconds of the run",
  function (this: Context, start: string, scale: number, hourMs: number) {
    assert.equal((3600 * 1000) / scale, hourMs);
    setUpCongress(this, { start, segments: [{ scale }], hours: HOURS });
    change(this, (configuration) => {
      configuration.city = stringify(CITY);
      // A population with a ticket page and no one who registers unless a scenario says so.
      configuration.attendees = stringify(ATTENDEES);
    });
    // The run ends 5 world hours in, unless a scenario says when.
    this.timeLimitMs = 5 * hourMs;
  },
);

Given('the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1, unless a scenario says otherwise', function (this: Context) {
  // The base configuration's mail delivers in 1 world minute, and its kinds keep no hours and reply at once; each template picks up.
});

Given(
  literal('the variant draws the board "chair" (funds 6000, reserve 1000), the venue "v1" (rooms "hall-a" and "hall-b"), the speakers "s1" (acceptance 1, condition "fee", fee 300) and "s2" (acceptance 0.5, no condition), and the sponsor "sp1" (amount 1200, conditions "logo" and "morning_slot")'),
  function (this: Context) {
    changePools(this, (pool) => {
      pool.board = [{ id: "chair", funds: 6000, reserve: 1000, pick_up: 1 }];
      pool.venue = [structuredClone(V1)];
      pool.speaker = structuredClone(SPEAKERS);
      pool.sponsor = [structuredClone(SP1)];
    });
    change(this, (configuration) => (configuration.draw = stringify({ attendance: [50, 50], board: 1, venue: 1, speaker: 2, sponsor: 1 })));
  },
);

Given(
  /^the organiser's scripted turns call "send_mail" to "chair" with the act "submit_budget", costs 5000, income 3000, contingency 500, funds_requested 2500 and the text "([^"]+)" then end$/,
  function (this: Context, text: string) {
    const fields = { costs: 5000, income: 3000, contingency: 500, funds_requested: 2500 };
    script(this, ORGANISER, [{ toolCalls: [{ name: "send_mail", arguments: { to: "chair", act: "submit_budget", fields, text } }] as never, delayMs: 0 }, { text: "Done.", delayMs: 0 }]);
  },
);

Then('"chair" answered "budget_approved", and the organiser\'s ceiling is {int} and its balance {int}', function (this: Context, ceiling: number, balance: number) {
  sentWith(this, "chair", "budget_approved");
  const summary = organiserSummary(this);
  assert.deepEqual({ ceiling: summary.ceiling, balance: summary.balance }, { ceiling, balance });
});

/** The organiser's one call of a tool, as the log gives it. */
function organiserCall(context: Context, tool: string): Record<string, unknown> {
  const calls = ranLines(context).filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === tool);
  assert.equal(calls.length, 1, `the organiser called "${tool}" ${calls.length} times`);
  return calls[0];
}

Then(/^the "send_mail" call failed with the outcome "(\w+)" and took no time, (listing the acts "sp1" takes|naming "income")$/, function (this: Context, outcome: string, result: string) {
  const call = organiserCall(this, "send_mail");
  assert.equal(call.outcome, outcome);
  assert.equal(call.durationMs ?? 0, 0, `the call took ${String(call.durationMs)} ms`);
  // The reason reaches the organiser's model as its call's result.
  const messages = modelOf(this, ORGANISER).received.at(-1) ?? [];
  const reason = JSON.stringify(messages.filter((message) => message.role === "toolResult" && message.toolName === "send_mail").map((message) => message.content)).replaceAll('\\"', '"');
  if (result === 'naming "income"') assert.match(reason, /"income"/);
  else for (const act of ["ask_conditions", "accept_sponsorship", "counter", "send_attendee_list", "send_evidence"]) assert.ok(reason.includes(act), `the reason does not list "${act}": ${reason}`);
  // Nothing reached the party.
  assert.equal(sentBy(this, ORGANISER).length, 0);
});

/** The organiser's turns that submit a budget to "chair", then wait for its answer. */
function budgetTurns(context: Context, { costs = 5000, contingency = 500, funds = 2500 } = {}) {
  return organiserTurns(`call "send_mail" to "chair" with the act "submit_budget", costs ${costs}, income 3000, contingency ${contingency} and funds_requested ${funds}, then wait 1 world hour, then "check_time"`, hourMsOf(context));
}

Given('"chair" approved a budget with costs {int}, contingency {int} and funds_requested {int}', function (this: Context, costs: number, contingency: number, funds: number) {
  before(this, budgetTurns(this, { costs, contingency, funds }));
});

Given('"chair" approved a budget with funds_requested {int}', function (this: Context, funds: number) {
  before(this, budgetTurns(this, { costs: 5000, contingency: 500, funds }));
});

/** The messages a party sent with an act, in order. */
const sentAll = (context: Context, party: string, act: string) => sentBy(context, party).filter((line) => line.act === act);

Then('"chair" answered "budget_approved", transferred {int} more, and the organiser\'s ceiling is {int}', function (this: Context, more: number, ceiling: number) {
  assert.equal(sentAll(this, "chair", "budget_approved").length, 2, `"chair" sent ${sentBy(this, "chair").map((line) => line.act).join(", ")}`);
  const transfers = moneyLines(this, "transfer").filter((line) => line.from === "chair" && line.to === ORGANISER);
  assert.deepEqual(
    transfers.map((line) => line.amount),
    [2500, more],
  );
  assert.equal(organiserSummary(this).ceiling, ceiling);
});

Then('"chair" answered "budget_countered" with the funds {int}, and "refused" with the reserve {int}', function (this: Context, funds: number, reserve: number) {
  assert.equal(fieldsOf(sentWith(this, "chair", "budget_countered")).funds, funds);
  assert.equal(fieldsOf(sentWith(this, "chair", "refused")).reserve, reserve);
});

/** The organiser's turns that invite a speaker to a session at a time, then wait for its answer. */
function inviteTurns(context: Context, speaker: string, session: number, time: string, fee = 0) {
  return organiserTurns(`call "send_mail" to "${speaker}" with the act "invite", session ${session}, time "${time}", fee ${fee} and travel_paid false, then wait 1 world hour, then "check_time"`, hourMsOf(context));
}

Given(/^the organiser invites "(\w+)" to session (\d+) at "([^"]+)", then to session (\d+) at "([^"]+)", then to session (\d+) at "([^"]+)" again$/, function (this: Context, speaker: string, first: string, firstAt: string, second: string, secondAt: string, again: string, againAt: string) {
  const turns = [[first, firstAt], [second, secondAt], [again, againAt]].flatMap(([session, at]) => inviteTurns(this, speaker, Number(session), at));
  before(this, turns);
});

Then(/^"(\w+)" answered session (\d+) once and session (\d+) once, both "accept" or both "decline", as its one draw gave$/, function (this: Context, speaker: string, first: string, second: string) {
  const answers = sentBy(this, speaker).filter((line) => ["accept", "decline", "accept_if"].includes(String(line.act)));
  // Cucumber gives a group of digits as a number.
  const bySession = (session: string) => answers.filter((line) => String(fieldsOf(line).session) === String(session));
  assert.equal(bySession(first).length, 1, `"${speaker}" answered session ${first} ${bySession(first).length} times`);
  assert.equal(bySession(second).length, 1, `"${speaker}" answered session ${second} ${bySession(second).length} times`);
  assert.equal(answers.length, 2);
  assert.equal(bySession(first)[0].act, bySession(second)[0].act);
});

/** The organiser's turns that confirm a speaker's session, then wait for its answer. */
function confirmTurns(context: Context, speaker: string) {
  return organiserTurns(`call "send_mail" to "${speaker}" with the act "confirm", time "10:00", room "hall-a", length 45 and travel "none", then wait 1 world hour, then "check_time"`, hourMsOf(context));
}

Given('"s2" declined, and the organiser sent it a confirmation, which it answered "not_available"', function (this: Context) {
  // "s2" would never accept.
  changePools(this, (pool) => Object.assign(pool.speaker.find(({ id }) => id === "s2") as TomlTable, { acceptance: 0 }));
  before(this, [...inviteTurns(this, "s2", 2, "10:00"), ...confirmTurns(this, "s2")]);
});

Given('"s1" accepted and acknowledged its confirmation', function (this: Context) {
  before(this, [...inviteTurns(this, "s1", 3, "11:00", 300), ...confirmTurns(this, "s1")]);
});

Given('the perturbation "early_cancel" fires at {string}', function (this: Context, at: string) {
  change(this, (configuration) => ((configuration.perturbations as TomlTable).early_cancel = { between: [at, at] }));
});

Then('"s1" cancelled, and "s2" did not', function (this: Context) {
  assert.equal(sentWith(this, "s2", "not_available").to, ORGANISER);
  assert.equal(sentWith(this, "s1", "acknowledged").to, ORGANISER);
  const ill = ranLines(this).filter((line) => line.type === "stimulus" && line.channel === "early_cancel").map((line) => line.agent);
  assert.deepEqual(ill, ["s1"]);
  sentWith(this, "s1", "cancel");
  assert.equal(sentBy(this, "s2").filter((line) => line.act === "cancel").length, 0);
});

Then('the call failed with the outcome "invalid_value", naming "Rosa Ferreira"', function (this: Context) {
  assert.equal(organiserCall(this, "publish_programme").outcome, "invalid_value");
  const messages = modelOf(this, ORGANISER).received.at(-1) ?? [];
  const result = messages.find((message) => message.role === "toolResult" && message.toolName === "publish_programme");
  assert.match(JSON.stringify(result?.content), /Rosa Ferreira/);
});
