import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { loadScenario } from "../../src/engine/scenario.ts";
import type { Context } from "../support/context.ts";
import { change, hourMsOf, organiserTurns, setUpCongress, turnsBefore } from "./congress.steps.ts";
import { before, changePools, fieldsOf, moneyLines, ranLines, sentBy, sentWith, untilTime } from "./congress-parties.steps.ts";
import { C1, organiserSummary } from "./services.steps.ts";
import { modelOf, runTheScenario, script } from "./tool.steps.ts";

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
export const CITY = {
  places: [{ id: "office" }],
  venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "hall-a", seats: 80 }, { id: "hall-b", seats: 40 }] }],
  passages: [
    { between: ["office", "v1-entrance"], length: 20, step_free: true },
    { between: ["v1-entrance", "hall-a"], length: 1, step_free: true },
    { between: ["v1-entrance", "hall-b"], length: 1, step_free: true },
  ],
};

/** The venue "v1" of the Background. */
export const V1: TomlTable = {
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
export const ATTENDEES = {
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
    setUpCorrectionsCongress(this, start, scale, hourMs);
  },
);

/** FR-CONGRESS-09's congress: its city with "v1", a ticket page nobody comes to, and a run that ends 5 world hours in. */
export function setUpCorrectionsCongress(context: Context, start: string, scale: number, hourMs: number): void {
  assert.equal((3600 * 1000) / scale, hourMs);
  setUpCongress(context, { start, segments: [{ scale }], hours: HOURS });
  change(context, (configuration) => {
    configuration.city = stringify(CITY);
    // A population with a ticket page and no one who registers unless a scenario says so.
    configuration.attendees = stringify(ATTENDEES);
  });
  // The run ends 5 world hours in, unless a scenario says when.
  context.timeLimitMs = 5 * hourMs;
}

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

Given('"s1" answered "accept_if" with the condition "fee" to an invitation with fee 0', function (this: Context) {
  before(this, inviteTurns(this, "s1", 3, "11:00", 0));
});

/** Each replica's directory, by its seed, as its organiser's system prompt gives it. */
const directories = new WeakMap<Context, string[][]>();

When("two replicas run with the seeds 1 and 2", function (this: Context) {
  change(this, (configuration) => (configuration.knowledge = "{directory}"));
  const scenario = this.inventoryScenario?.();
  assert.ok(scenario !== undefined, "the scenario set up no congress");
  directories.set(
    this,
    [1, 2].map((seed) => {
      const prompt = loadScenario(scenario, seed).systemPrompts.get(ORGANISER) ?? "";
      return [...prompt.matchAll(/^- ([\w-]+):/gm)].map(([, id]) => id);
    }),
  );
});

Then("each directory lists the same parties, in an order drawn from its seed, not grouped by role", function (this: Context) {
  const [first, second] = directories.get(this) ?? [];
  // The draw's parties, by kind as the pools give them.
  const grouped = ["chair", "v1", "s1", "s2", "sp1"];
  assert.deepEqual([...first].sort(), [...grouped].sort());
  assert.deepEqual([...second].sort(), [...grouped].sort());
  assert.notDeepEqual(first, second, `both seeds list ${first.join(", ")}`);
  const byKind = (order: string[]) => ["chair", "v1", "s", "sp1"].map((kind) => order.filter((id) => id === kind || (kind === "s" && /^s\d$/.test(id)))).flat();
  assert.ok(first.join() !== byKind(first).join() || second.join() !== byKind(second).join(), `the directories are grouped by kind: ${first.join(", ")}; ${second.join(", ")}`);
});

/** The organiser's turns that book "v1" for "day 26" with these rooms and accept its contract. */
function bookingTurns(context: Context, rooms: string, accepts = true) {
  return organiserTurns(
    [
      `call "send_mail" to "v1" with the act "book", date "day 26", rooms "${rooms}" and hours "08:00-18:00"`,
      "wait 1 world hour",
      ...(accepts ? [`"send_mail" to "v1" with the act "accept_contract" and the contract's id`, "wait 1 world hour"] : []),
      '"check_time"',
    ].join(", then "),
    hourMsOf(context),
  );
}

Given('the organiser holds a contract "v1-contract-1" with "v1" for "day 26"', function (this: Context) {
  // For "hall-b": the same book again would be a repeat, which gets no second answer.
  before(this, bookingTurns(this, "hall-b", false));
});

Then('"v1" answered "contract_held" with "v1-contract-1"', function (this: Context) {
  assert.equal(fieldsOf(sentWith(this, "v1", "contract_held")).contract, "v1-contract-1");
  assert.equal(sentAll(this, "v1", "contract").length, 1);
});

/** The perturbation "change" of the kind "room_lost", at day 1's 13:00, after the contract is accepted. */
function roomLostAt(context: Context) {
  change(context, (configuration) => ((configuration.perturbations as TomlTable).change = { at: "day 1 13:00", kind: "room_lost" }));
}

Given('the organiser\'s contract with "v1" has only "hall-a", and the perturbation "change" of the kind "room_lost" fires', function (this: Context) {
  before(this, bookingTurns(this, "hall-a"));
  roomLostAt(this);
});

Then('"v1" lost no room', function (this: Context) {
  sentWith(this, "v1", "confirmed");
  assert.equal(sentAll(this, "v1", "room_lost").length, 0, '"v1" lost a room');
});

Then(
  'with the rooms "hall-a" and "hall-b" booked instead, "v1" lost "hall-b", and a later "change_booking" adding "hall-b" is answered "unavailable"',
  { timeout: 30_000 },
  async function (this: Context) {
    turnsBefore.set(this, []);
    // The room is lost at 13:00; then the organiser asks to have both rooms.
    before(this, bookingTurns(this, "hall-a, hall-b"));
    untilTime(this, "day 1 13:30");
    before(this, organiserTurns('call "send_mail" to "v1" with the act "change_booking", rooms "hall-a, hall-b" and hours "08:00-18:00", then wait 1 world hour, then "check_time"', hourMsOf(this)));
    this.timeLimitMs = 6 * hourMsOf(this);
    await runTheScenario(this);
    assert.equal(fieldsOf(sentWith(this, "v1", "room_lost")).room, "hall-b");
    assert.equal(sentAll(this, "v1", "unavailable").length, 1, `"v1" sent ${sentBy(this, "v1").map((line) => line.act).join(", ")}`);
  },
);

/** The organiser's turn that publishes a programme of one session with "s1", sp1's logo, and its morning slot when asked. */
function programmeTurn(slot: boolean) {
  const programme = {
    sessions: [{ start: "10:00", end: "10:45", title: "Soil life", speakers: ["s1"], room: "hall-a" }],
    logos: ["sp1"],
    ...(slot ? { sponsor_slots: [{ sponsor: "sp1", start: "09:30", end: "09:45" }] } : {}),
  };
  return { toolCalls: [{ name: "publish_programme", arguments: programme }] as never, delayMs: 0 };
}

/** The sponsor scenario's turns: an agreement on both conditions, a programme, then an invoice on day 20 at 17:30. */
function sponsorTurns(context: Context, slot: boolean): void {
  turnsBefore.set(context, []);
  changePools(context, (pool) => Object.assign(pool.sponsor[0], { hours: "office" }));
  before(context, [
    ...organiserTurns('call "send_mail" to "sp1" with the act "accept_sponsorship" and conditions "logo" and "morning_slot", then wait 1 world hour, then "check_time"', hourMsOf(context)),
    programmeTurn(slot),
  ]);
  untilTime(context, "day 20 17:30");
  before(context, [{ toolCalls: [{ name: "issue_invoice", arguments: { to: "sp1", amount: 1200, due: "day 22", for: "sponsorship" } }] as never, delayMs: 0 }]);
}

Given('"sp1" keeps the hours "office", agreed to "logo" and "morning_slot", and the latest programme has its logo but no morning slot after day 19', function (this: Context) {
  sponsorTurns(this, false);
});

Given(/^the organiser issued "sp1" an invoice of 1200 on "day 20 \w+ 17:30"$/, function (this: Context) {
  // In the turns the sponsor scenario set.
});

/** The payments "sp1" made, as the log gives them. */
const paymentsBySponsor = (context: Context) => moneyLines(context, "payment").filter((line) => line.from === "sp1");

Then('"sp1" paid nothing', function (this: Context) {
  sentWith(this, "sp1", "agreement");
  assert.deepEqual(paymentsBySponsor(this), []);
});

// The scenario's weekday names are a day off its calendar's, which starts on day 1 Monday: the day and the hours are checked.
Then(/^with the slot published, "sp1" pays on "day 23 \w+" within its hours$/, { timeout: 120_000 }, async function (this: Context) {
  sponsorTurns(this, true);
  await runTheScenario(this);
  const [payment, ...more] = paymentsBySponsor(this);
  assert.equal(more.length, 0);
  const at = payment?.worldTime as { day: number; weekday: string; seconds: number } | undefined;
  assert.ok(at !== undefined, '"sp1" paid nothing');
  assert.equal(at.day, 23);
  assert.ok(at.seconds >= 9 * 3600 && at.seconds <= 17 * 3600, `"sp1" paid at ${at.seconds / 3600} h`);
});

// The venue's own mail that falls due at night is its perturbation's notice: the price change at that time.
Given('"v1" keeps the hours "office", and its hold-lapse reminder falls due at "day 3 Wednesday 23:00"', function (this: Context) {
  changePools(this, (pool) => Object.assign(pool.venue[0], { hours: "office" }));
  before(this, bookingTurns(this, "hall-a"));
  change(this, (configuration) => ((configuration.perturbations as TomlTable).change = { at: "day 3 23:00", kind: "price_change" }));
});

Then('"v1" sent it at "day 4 Thursday 09:00", within one world hour', function (this: Context) {
  const sent = sentWith(this, "v1", "price_change");
  const at = sent.worldTime as { day: number; weekday: string; seconds: number };
  assert.deepEqual({ day: at.day, weekday: at.weekday }, { day: 4, weekday: "Thursday" });
  assert.ok(at.seconds >= 9 * 3600 && at.seconds <= 10 * 3600, `"v1" sent it at ${at.seconds / 3600} h`);
});

Given('"c1" confirmed an order, and the organiser mails "c1" "final_numbers" and then "cancel_order", and then "cancel_order" again', function (this: Context) {
  changePools(this, (pool) => (pool.caterer = [{ ...structuredClone(C1), pick_up: 1 }]));
  change(this, (configuration) => (configuration.draw = stringify({ ...parse(configuration.draw as string), caterer: 1 })));
  before(
    this,
    organiserTurns(
      'call "send_mail" to "c1" with the act "order", counts "standard" 60, date "day 26" and venue "v1", then wait 1 world hour, then "send_mail" to "c1" with the act "final_numbers" and counts "standard" 50, then "send_mail" to "c1" with the act "cancel_order", then "send_mail" to "c1" with the act "cancel_order", then wait 1 world hour, then "check_time"',
      hourMsOf(this),
    ),
  );
});

Then('"c1" handled "final_numbers" before "cancel_order", and answered "cancelled" once', function (this: Context) {
  // The second cancel_order repeats the first: its already_sent recalls the one cancellation (FR-CONGRESS-11).
  const acts = sentBy(this, "c1").map((line) => String(line.act)).filter((act) => act !== "already_sent");
  assert.equal(acts[0], "order_confirmed", `"c1" sent ${acts.join(", ")}`);
  assert.ok(["numbers_accepted", "numbers_refused"].includes(acts[1]), `"c1" sent ${acts.join(", ")}`);
  assert.deepEqual(acts.slice(2), ["cancelled"], `"c1" sent ${acts.join(", ")}`);
});

/** The registrants of the questions' scenario, who register at day 1's 10:00. */
const REGISTRANTS = ["f-1", "f-2", "f-3", "f-4"];

Given("the attendees material's {string} is {int} and {int} people registered", function (this: Context, key: string, share: number, people: number) {
  assert.equal(people, REGISTRANTS.length);
  const fixed = REGISTRANTS.map((id) => ({ id, between: ["day 1 10:00", "day 1 10:00"] }));
  change(this, (configuration) => (configuration.attendees = stringify({ ...ATTENDEES, [key]: share, fixed })));
  before(this, [{ toolCalls: [{ name: "edit_ticket_page", arguments: { open: true, price: 10 } }] as never, delayMs: 0 }]);
});

When("the run's time limit passes {int} world days after they registered", { timeout: 60_000 }, async function (this: Context, days: number) {
  // From the calendar's start, day 1 at 09:00, to 10:00 that many days later.
  this.timeLimitMs = (days * 24 + 1) * hourMsOf(this);
  await runTheScenario(this);
});

Then("the organiser received {int} questions from registrants", function (this: Context, count: number) {
  const questions = ranLines(this).filter((line) => line.type === "message_sent" && line.act === "question" && line.to === ORGANISER && REGISTRANTS.includes(String(line.from)));
  assert.equal(questions.length, count, `the registrants sent ${questions.length} questions`);
  for (const question of questions) assert.ok(["address", "access", "diet", "refund"].includes(String(fieldsOf(question).about)), `a question about ${String(fieldsOf(question).about)}`);
});
