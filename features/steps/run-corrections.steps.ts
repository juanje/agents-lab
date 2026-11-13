import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { type TomlTable, stringify } from "smol-toml";
import type { Context } from "../support/context.ts";
import { change, hourMsOf, organiserTurns, setUpCongress } from "./congress.steps.ts";
import { changePools, fieldsOf, ranLines, sentBy, sentWith } from "./congress-parties.steps.ts";
import { organiserSummary } from "./services.steps.ts";
import { script } from "./tool.steps.ts";

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

/** The sponsor of the Background. */
const SP1: TomlTable = { id: "sp1", amount: 1200, conditions: ["logo", "morning_slot"], insists: [], pay_days: [2, 2], pick_up: 1 };

Given(
  "the congress scenario of FR-CONGRESS-08, whose calendar starts at {string} with one segment of scale {int}, so one world hour is {int} milliseconds of the run",
  function (this: Context, start: string, scale: number, hourMs: number) {
    assert.equal((3600 * 1000) / scale, hourMs);
    setUpCongress(this, { start, segments: [{ scale }], hours: HOURS });
    change(this, (configuration) => (configuration.city = stringify(CITY)));
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
  const reason = String(call.reason ?? call.text ?? "");
  if (result === 'naming "income"') assert.match(reason, /"income"/);
  else for (const act of ["ask_conditions", "accept_sponsorship", "counter", "send_attendee_list", "send_evidence"]) assert.ok(reason.includes(act), `the reason does not list "${act}": ${reason}`);
  // Nothing reached the party.
  assert.equal(sentBy(this, ORGANISER).length, 0);
  void fieldsOf;
  void hourMsOf;
  void organiserTurns;
});
