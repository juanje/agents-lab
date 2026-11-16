import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import type { RuleStep } from "../../src/engine/participants.ts";
import { Random } from "../../src/engine/random.ts";
import { catererRules, venueRules } from "../../src/scenarios/congress-parties.ts";
import { type ToolAnswer, calls, conversation, drive, notice, tools } from "../../tests/fixtures/rules.ts";
import { type TomlTable, stringify } from "smol-toml";
import type { Context } from "../support/context.ts";
import { change } from "./congress.steps.ts";
import { changePools, ranLines, sentBy } from "./congress-parties.steps.ts";
import { CITY, V1, setUpCorrectionsCongress } from "./run-corrections.steps.ts";
import { modelOf } from "./tool.steps.ts";

// FR-CONGRESS-25: venues and caterers say what a permit is and where it comes from. The steps drive the venues' and the
// caterer's rule sets as the engine would, with the parameters the congress scenario gives them (its worldOf): a venue
// gets its in-house caterer's diets, a caterer each venue's catering rule. A caterer reads a permit as the world's
// read_permit gives it: from the extra_confirmed that gave it.

/** The organiser, who sends every message here. */
const ORGANISER = "organiser";
/** The time of every message. */
const DAY = "day 1 Monday 09:01";

/** A venue of the Background with its catering rule. */
const venue = (id: string, catering: Record<string, unknown>) => ({
  id,
  rooms: [{ id: "hall-a", seats: 90, equipment: [] }],
  access_claim: "step-free",
  price: 2000,
  hold_days: 2,
  deposit_share: 0.25,
  deposit_due_days: 3,
  cancellation: [{ share: 0.5 }],
  pick_up: 1,
  organiser: ORGANISER,
  event_day: 26,
  floor_plan: [],
  perturbations: [],
  ...catering,
});

/** The venues of the Background: "v1" with its in-house caterer "c9"'s diets, "v2" and "v3". */
const VENUES: Record<string, Record<string, unknown>> = {
  v1: venue("v1", { catering: "in_house", in_house_diets: { gluten_free: { limit: 5 } } }),
  v2: venue("v2", { catering: "outside_fee", outside_fee_per_head: 5 }),
  v3: venue("v3", { catering: "outside_free" }),
};

/** The caterer "c1", which knows each venue's catering rule. */
const C1 = {
  id: "c1",
  price_per_head: 30,
  final_days: 7,
  deposit_share: 0.2,
  deposit_due_days: 3,
  cancellation: [{ share: 0.3 }],
  organiser: ORGANISER,
  event_day: 26,
  venues: Object.fromEntries(Object.entries(VENUES).map(([id, { catering }]) => [id, { catering }])),
};

/** A party's message as read_mail renders it. */
const message = (act: string, fields: Record<string, string | number>): [string, string] => [DAY, `From: ${ORGANISER}. Act: ${act}.${Object.entries(fields).map(([name, value]) => ` ${name}: ${value}.`).join("")}`];

interface Sent {
  to: string;
  act: string;
  fields: Record<string, unknown>;
}

/** What a scenario's steps share: the permits the venues gave, and the answers each party sent. */
interface Permits {
  given: Sent[];
  answers: Map<string, Sent[]>;
  caterer?: ReturnType<typeof catererRules.start>;
  /** The venue the organiser asked for a quote. */
  quoted?: string;
}
const shared = new WeakMap<Context, Permits>();
function sharedOf(context: Context): Permits {
  const found = shared.get(context);
  assert.ok(found !== undefined, "the Background set up no congress");
  return found;
}

/** A venue's answers to the organiser's messages, in order, each to one message. */
function venueAnswers(id: string, messages: [string, string][]): Sent[] {
  const { steps } = conversation(venueRules.start(VENUES[id], new Random(1)), messages);
  return calls(steps, "send_mail") as unknown as Sent[];
}

/** The answers a venue gave to the organiser's messages, its last to the last message. */
function lastAnswer(context: Context, party: string): Sent {
  const answers = sharedOf(context).answers.get(party) ?? [];
  assert.ok(answers.length > 0, `"${party}" answered nothing`);
  return answers.at(-1) as Sent;
}

/** The literal text of a step, as a regular expression that matches it alone. */
const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

Given(
  literal(
    'the congress scenario with the venues "v1" (catering "in_house", its in-house caterer "c9", which serves "gluten_free" with limit 5), "v2" (catering "outside_fee", "outside_fee_per_head" 5) and "v3" (catering "outside_free"), and the caterer "c1"',
  ),
  function (this: Context) {
    shared.set(this, { given: [], answers: new Map() });
    setUpRun(this);
  },
);

/**
 * The same congress, to run: FR-CONGRESS-09's congress, whose calendar starts at "day 1 Monday 09:00" with one world
 * hour 60 milliseconds of the run, drawing the three venues and "c1", with "c9" beside "v1". The scenarios that need the
 * world (the directory, the act's fields) run it; the others drive the parties.
 */
function setUpRun(context: Context): void {
  setUpCorrectionsCongress(context, "day 1 Monday 09:00", 60000, 60);
  // Each venue has its own rooms, "hall-a" and "hall-b" for "v1", "v2-hall" for "v2" and "v3-hall" for "v3".
  const roomsOf = (id: string) => (id === "v1" ? (V1.rooms as TomlTable[]) : [{ id: `${id}-hall`, seats: 80, equipment: [] }]);
  const template = (id: string, catering: Record<string, unknown>): TomlTable => ({ ...structuredClone(V1), id, rooms: structuredClone(roomsOf(id)), ...catering });
  const caterer = { price_per_head: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], pick_up: 1 };
  changePools(context, (pool) => {
    pool.venue = [template("v1", { catering: "in_house" }), template("v2", { catering: "outside_fee", outside_fee_per_head: 5 }), template("v3", { catering: "outside_free" })];
    pool.caterer = [
      { id: "c1", ...caterer, diets: { gluten_free: {} } },
      { id: "c9", ...caterer, in_house_for: "v1", diets: { gluten_free: { limit: 5 } } },
    ];
    pool.speaker = [];
    pool.sponsor = [];
    pool.partner = [];
  });
  change(context, (configuration) => {
    configuration.draw = stringify({ attendance: [50, 50], budget: [8000, 8000], advance: [3000, 3000], venue: 3, caterer: 1 });
    const city = structuredClone(CITY) as unknown as { venues: TomlTable[]; passages: TomlTable[] };
    for (const id of ["v2", "v3"]) {
      city.venues.push({ id, entrance: `${id}-entrance`, hours: "always", rooms: [{ id: `${id}-hall`, seats: 80 }] });
      city.passages.push({ between: ["office", `${id}-entrance`], length: 20, step_free: true }, { between: [`${id}-entrance`, `${id}-hall`], length: 1, step_free: true });
    }
    configuration.city = stringify(city as unknown as TomlTable);
  });
}

// A venue's quote says its catering rule in words.
When("the organiser asks {string} for a quote for {string}", function (this: Context, id: string, date: string) {
  const answers = venueAnswers(id, [message("ask_quote", { date }), message("request_document", { kind: "terms" })]);
  sharedOf(this).answers.set(id, answers);
  sharedOf(this).quoted = id;
});

Then("the quote's {string} is {string}", function (this: Context, field: string, text: string) {
  const quote = (sharedOf(this).answers.get(sharedOf(this).quoted ?? "") ?? []).find(({ act }) => act === "quote");
  assert.ok(quote !== undefined, "the venue sent no quote");
  assert.equal(quote.fields[field], text);
});

Then("the venue's terms document says {string}", function (this: Context, text: string) {
  const terms = (sharedOf(this).answers.get(sharedOf(this).quoted ?? "") ?? []).find(({ act, fields }) => act === "document" && fields.kind === "terms");
  assert.ok(terms !== undefined, "the venue sent no terms");
  assert.ok(String(terms.fields.content).includes(text), `the terms say: ${terms.fields.content}`);
});

// An in-house venue asked for outside catering without a diet says why.
When('the organiser sends {string} the act "request_extra" with the item {string} and the attendance {int}', function (this: Context, id: string, item: string, attendance: number) {
  sharedOf(this).answers.set(id, venueAnswers(id, [message("request_extra", { item, attendance })]));
});

Then("{string} answers {string} for {string} with the reason {string}", function (this: Context, id: string, act: string, what: string, reason: string) {
  assert.deepEqual(lastAnswer(this, id), { to: ORGANISER, act, fields: { what, reason } });
});

// A caterer's refusal for a permit says what it needs.
Given("no permit was given", function (this: Context) {
  assert.deepEqual(sharedOf(this).given, []);
});

/** Whether a scenario is on FR-CONGRESS-25's congress, whose parties these steps drive, rather than on a run. */
export const onPermitsCongress = (context: Context) => shared.has(context);

/**
 * A venue's permit given to the organiser: it books the venue, accepts its contract, asks for outside catering for 40,
 * or for a diet's meals, and accepts it. FR-CONGRESS-22's step of the same text calls it on this congress.
 */
export function givePermit(context: Context, id: string, permit: string, diet?: { diet: string; attendance: number }): void {
  const answers = venueAnswers(id, [
    message("book", { date: "day 26", rooms: "hall-a", hours: "08:00-18:00" }),
    message("accept_contract", { contract: `${id}-contract-1` }),
    message("request_extra", { item: "outside_catering", attendance: 40, ...diet }),
    message("accept_extra", { item: "outside_catering" }),
  ]);
  const confirmed = answers.find(({ act }) => act === "extra_confirmed");
  assert.ok(confirmed !== undefined, `"${id}" confirmed no extra: ${JSON.stringify(answers)}`);
  assert.equal(confirmed.fields.permit, permit);
  sharedOf(context).given.push({ ...confirmed, from: id } as Sent);
}

Given(/^"(v1)" gave the organiser the permit "([^"]+)" for (\d+) "(\w+)" meals$/, function (this: Context, id: string, permit: string, attendance: string, diet: string) {
  givePermit(this, id, permit, { diet, attendance: Number(attendance) });
});

/** read_permit as the world's sensor answers it: the permit from the extra_confirmed that gave it, or no such permit. */
function readPermit(given: readonly Sent[], permit: unknown): string {
  const found = given.find(({ fields }) => fields.permit === permit) as (Sent & { from: string }) | undefined;
  if (found === undefined) return "No such permit.";
  const { diet, attendance } = found.fields;
  return JSON.stringify({ permit, venue: found.from, ...(diet === undefined ? {} : { diet }), ...(attendance === undefined ? {} : { attendance }) });
}

/** The caterer's answer to one message from the organiser, its state kept for the scenario's next message. */
function sendCaterer(context: Context, act: string, fields: Record<string, string | number>): void {
  const state = sharedOf(context);
  if (state.caterer === undefined) {
    state.caterer = catererRules.start(C1, new Random(1));
    drive(state.caterer, tools(() => ""));
  }
  const text = message(act, fields)[1];
  const answer: ToolAnswer = (tool, args) => (tool === "read_permit" ? { text: readPermit(state.given, args.permit) } : tools(() => text)(tool, args));
  const steps: RuleStep[] = drive(state.caterer, answer, [[notice]], true);
  state.answers.set("c1", [...(state.answers.get("c1") ?? []), ...(calls(steps, "send_mail") as unknown as Sent[])]);
}

When(
  /^the organiser sends "c1" the act "order" with the date "([^"]+)"(?:, the venue "(\w+)", (?:no permit|the permit "([^"]+)"))? and the counts "([^"]+)"$/,
  function (this: Context, date: string, venueId: string | null, permit: string | null, counts: string) {
    sendCaterer(this, "order", { date, counts, ...(venueId === null ? {} : { venue: venueId }), ...(permit === null ? {} : { permit }) });
  },
);

/** The fields a step writes after a refusal's reason: `the venue "v2"`, `the attendance 8`, `needs "…"`. */
function fieldsWritten(written: string): Record<string, string | number> {
  const fields: Record<string, string | number> = {};
  for (const [, name, text] of written.matchAll(/the (venue|permit|diet) "([^"]+)"/g)) fields[name] = text;
  for (const [, count] of written.matchAll(/the attendance (\d+)/g)) fields.attendance = Number(count);
  for (const [, text] of written.matchAll(/needs "([^"]+)"/g)) fields.needs = text;
  return fields;
}

Then(/^"c1" answers "order_refused" with the reason "(\w+)"(?: and (.+))?$/, function (this: Context, reason: string, written: string | null) {
  assert.deepEqual(lastAnswer(this, "c1"), { to: ORGANISER, act: "order_refused", fields: { reason, ...fieldsWritten(written ?? "") } });
});

Then('"c1" answers "order_confirmed"', function (this: Context) {
  assert.equal(lastAnswer(this, "c1").act, "order_confirmed", JSON.stringify(lastAnswer(this, "c1")));
});

// An order with no venue is refused.
Then('"c1" holds no order for {string}', function (this: Context, date: string) {
  // A caterer holding an order changes it by final numbers; with none, it has no order to change.
  sendCaterer(this, "final_numbers", { date, counts: "standard: 40" });
  assert.deepEqual(lastAnswer(this, "c1"), { to: ORGANISER, act: "not_available", fields: { what: "order" } });
});

// The directory lists the caterer's order with its venue and permit.
Then("the organiser's system prompt says {string}", function (this: Context, text: string) {
  ranLines(this);
  const prompts = modelOf(this, ORGANISER).received.map((messages) => String(messages.find((message) => message.role === "system")?.content ?? ""));
  assert.ok(prompts.length > 0, "the organiser's model was never called");
  for (const [turn, prompt] of prompts.entries()) assert.ok(prompt.split("\n").includes(text), `turn ${turn + 1}'s system prompt says:\n${prompt}`);
});

// An order sent with no venue fails at once.
Then(
  "the {string} call failed with the outcome {string} and took no time, naming {string}, and {string} received nothing",
  function (this: Context, tool: string, outcome: string, field: string, party: string) {
    const call = ranLines(this).find((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === tool);
    assert.ok(call !== undefined, `the organiser made no ${tool} call`);
    assert.equal(call.outcome, outcome);
    assert.equal(call.durationMs ?? 0, 0);
    const results = (modelOf(this, ORGANISER).received.at(-1) ?? []).filter((message) => message.role === "toolResult" && message.toolName === tool);
    assert.match(JSON.stringify(results.map((message) => message.content)), new RegExp(`\\b${field}\\b`));
    assert.deepEqual(
      sentBy(this, ORGANISER).filter((line) => line.to === party),
      [],
    );
  },
);
