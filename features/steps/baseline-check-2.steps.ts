import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import type { TomlTable } from "smol-toml";
import { type Congress, congressScenario } from "../../src/scenarios/congress.ts";
import type { Context } from "../support/context.ts";
import { hourMsOf, organiserTurns } from "./congress.steps.ts";
import { before, changePools, fieldsOf, minutesOfWorld, moneyLines, outcomeOf, sentBy, untilTime } from "./congress-parties.steps.ts";
import { mail, minutes, publish, recordsOf, register, session } from "./congress-parts.steps.ts";
import { bookingTurns, C1, drawParties, evaluate, holds, lastAnswer, registerAt, results, SIX, TIMES, VENUE_1, VENUE_2 } from "./baseline-check.steps.ts";

// FR-CONGRESS-23: the corrections from the E1 baseline's second check run, on FR-CONGRESS-22's congress with "v1" now
// catering "outside_free" with the extra "ramp" at 100, "v2" catering "outside_fee" at 5 a head, and a caterer "c1"
// that serves every diet. The venues', caterers' and speakers' answers are read from runs; the ticket page, D7 and the
// milestone from world records the steps build, as FR-CONGRESS-22's steps build them.

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The literal text of a step, as a regular expression that matches it alone. */
const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** The diets a caterer may serve beside standard meals. */
const DIETS = ["vegetarian", "vegan", "gluten_free", "halal", "nut_allergy"];

Given(
  literal(
    'the draw gives no board, no partner, no agency, "budget" [8000, 8000] and "advance" [3000, 3000], and the variant draws the venues "v1" (catering "outside_free", rooms "hall-a" of 90 seats, extra "ramp" 100) and "v2" (catering "outside_fee", outside_fee_per_head 5), the speakers "s1" to "s6" with no condition, and the caterer "c1" (serves every diet)',
  ),
  function (this: Context) {
    const v1: TomlTable = { ...structuredClone(VENUE_1), catering: "outside_free", extras: { ramp: 100 } };
    delete v1.outside_fee_per_head;
    const v2: TomlTable = { ...structuredClone(VENUE_2), catering: "outside_fee", outside_fee_per_head: 5 };
    drawParties(this, [v1, v2], { ...structuredClone(C1), diets: Object.fromEntries(DIETS.map((diet) => [diet, {}])) });
  },
);

// No special diet reads as standard.
Given("the attendee {string} with no special diet registered through the ticket page, which required {string}", function (this: Context, person: string, field: string) {
  const population = recordsOf(this).state.population as NonNullable<Congress["population"]>;
  population.page = { ...population.page, required_fields: [field] };
  registerAt(this, person, minutes("day 23 10:00"));
  assert.ok(recordsOf(this).state.population?.people.find(({ id }) => id === person)?.registered !== undefined, `"${person}" did not register`);
});

/** What the ticket page gave the organiser, by detail. */
const pages = new WeakMap<Context, { list: { registrants: Record<string, unknown>[] }; summary: { diets: Record<string, number> } }>();

When('the organiser reads "ticket_page"', function (this: Context) {
  const page = congressScenario.tools.find(({ name }) => name === "ticket_page");
  assert.ok(page?.kind === "sensor", "the congress has no ticket_page");
  const { state } = recordsOf(this);
  pages.set(this, { list: JSON.parse(page.sense(state, ORGANISER, { detail: "list" }, 0)), summary: JSON.parse(page.sense(state, ORGANISER, { detail: "summary" }, 0)) });
});

Then("{string}'s diet reads {string}, and no registrant's diet reads {string}", function (this: Context, person: string, shown: string, hidden: string) {
  const { list, summary } = pages.get(this) ?? assert.fail("the organiser read no ticket page");
  assert.equal(list.registrants.find(({ id }) => id === person)?.diet, shown, JSON.stringify(list));
  assert.ok(!list.registrants.some(({ diet }) => diet === hidden), JSON.stringify(list));
  assert.ok(!Object.hasOwn(summary.diets, hidden), JSON.stringify(summary));
});

// A venue with free outside catering says so.
Given(/^the organiser's contract with "(v1)" for "(day 26)" is confirmed(?: with "([^"]+)")?$/, function (this: Context, venue: string, _date: string, rooms: string | null) {
  before(this, organiserTurns(bookingTurns(this, venue, rooms ?? undefined), hourMsOf(this)));
});

/** The organiser's commitments with a party, each as its purpose and amount. */
const commitmentsWith = (context: Context, party: string) => moneyLines(context, "commitment").filter((line) => line.from === ORGANISER && line.to === party).map((line) => [String(line.for), Number(line.amount)]);

Then('"v1" answered "not_needed" with the item "outside_catering", and the organiser\'s commitments did not change', function (this: Context) {
  const answer = lastAnswer(this, "v1");
  assert.deepEqual([answer.act, fieldsOf(answer)], ["not_needed", { item: "outside_catering" }], `"v1" sent ${sentBy(this, "v1").map((line) => `${String(line.act)} ${JSON.stringify(line.fields)}`).join("; ")}`);
  // Only the contract's commitment, made as it was confirmed.
  assert.deepEqual(commitmentsWith(this, "v1"), [["v1-contract-1", 2000]]);
});

// A caterer takes an order for a free-catering venue with any permit or none.
Given(/^the organiser's scripted turns call "send_mail" to "c1" with the act "order", the venue "v1", the date "day 26" and the counts "standard: 40", and the permit "([^"]+)", then end$/, function (this: Context, permit: string) {
  const order = { to: "c1", act: "order", fields: { venue: "v1", date: "day 26", counts: "standard: 40", permit } };
  before(this, [{ toolCalls: [{ name: "send_mail", arguments: order }] as never, delayMs: 0 }, ...organiserTurns('wait 1 world hour, then "check_time"', hourMsOf(this))]);
});

// "c1" answered "order_confirmed" is FR-CONGRESS-06's step.

// An unknown room is named.
Then('"v1" answered "unavailable" with the room "step-free toilets" and no date', function (this: Context) {
  const answer = lastAnswer(this, "v1");
  assert.deepEqual([answer.act, fieldsOf(answer)], ["unavailable", { room: "step-free toilets" }]);
});

// A repeated invitation gets its answer again.
Given('{string} declined the organiser\'s invitation to session {int} on {string}', function (this: Context, speaker: string, number: number, day: string) {
  // It would accept no invitation.
  changePools(this, (pool) => ((pool.speaker.find(({ id }) => id === speaker) as TomlTable).acceptance = 0));
  untilTime(this, `${day} 09:00`);
  before(this, organiserTurns(`call "send_mail" to "${speaker}" with the act "invite", the session ${number}, the time "09:00", the fee 0 and travel_paid false, then wait 1 world hour, then "check_time"`, hourMsOf(this)));
});

Then("{string} answered {string} for session {int} again on {string}, and its answers are unchanged", function (this: Context, speaker: string, act: string, number: number, day: string) {
  const answers = sentBy(this, speaker).filter((line) => line.to === ORGANISER);
  assert.deepEqual(
    answers.map((line) => [line.act, fieldsOf(line)]),
    [
      [act, { session: number }],
      [act, { session: number }],
    ],
  );
  assert.equal(`day ${Math.floor(minutesOfWorld(answers[1].worldTime) / 1440) + 1}`, day);
  assert.equal(outcomeOf(this, speaker).answer, act);
});

// An extra is confirmed once.
Given('the organiser\'s contract with "v1" for "day 26" is confirmed, and "v1" confirmed the extra "ramp" at 100', function (this: Context) {
  before(
    this,
    organiserTurns(`${bookingTurns(this, "v1")}, then "send_mail" to "v1" with the act "request_extra" and item "ramp", then wait 1 world hour, then "send_mail" to "v1" with the act "accept_extra" and item "ramp", then wait 1 world hour`, hourMsOf(this)),
  );
  this.timeLimitMs = Math.max(this.timeLimitMs ?? 0, 8 * hourMsOf(this));
});

Then('"v1" answered "already_confirmed" with the item "ramp", and the organiser has one commitment of 100 for the ramp', function (this: Context) {
  const answer = lastAnswer(this, "v1");
  assert.deepEqual([answer.act, fieldsOf(answer)], ["already_confirmed", { item: "ramp" }], `"v1" sent ${sentBy(this, "v1").map((line) => String(line.act)).join(", ")}`);
  assert.deepEqual(
    commitmentsWith(this, "v1").filter(([what]) => String(what).endsWith(" extra ramp")),
    [["v1-contract-1 extra ramp", 100]],
  );
});

// On time means real by day 12.
Given('the organiser\'s contract with "v1" was confirmed on "day 6", "s1" to "s5" accepted their sessions by "day 8", and "s6" accepted session 6 on {string}', function (this: Context, accepted: string) {
  mail(this, "v1", ORGANISER, "contract", { contract: "v1-contract-1", date: "day 26", rooms: "hall-a", hours: "08:00-18:00", price: 2000 }, minutes("day 6") - 60);
  mail(this, "v1", ORGANISER, "confirmed", { contract: "v1-contract-1" }, minutes("day 6"));
  SIX.forEach((speaker, index) => {
    mail(this, ORGANISER, speaker, "invite", { session: index + 1, time: TIMES[index], fee: 0, travel_paid: false }, minutes("day 7"));
    mail(this, speaker, ORGANISER, "accept", { session: index + 1 }, speaker === "s6" ? minutes(accepted) : minutes("day 8"));
  });
});

Given('the organiser published a programme of six sessions with "s1" to "s6" in "hall-a" on {string}, and never again', function (this: Context, at: string) {
  publish(
    this,
    SIX.map((speaker, index) => session([speaker], TIMES[index], "hall-a")),
    minutes(at),
  );
});

Given("every registrant believes that version", function (this: Context) {
  register(this, 50, { believes: recordsOf(this).state.population?.programme.at(-1)?.version });
});

When('"programme_on_time" and "programme_published" are evaluated at the end of preparation', function (this: Context) {
  evaluate(this, ["programme_on_time", "programme_published"]);
});

Then(/^"programme_on_time" (holds|does not hold), and "programme_published" was reached at "([^"]+)"$/, function (this: Context, verdict: string, at: string) {
  const found = results.get(this) ?? {};
  assert.equal(holds(found.programme_on_time), verdict === "holds", JSON.stringify(found));
  assert.deepEqual(found.programme_published, { holds: true, reachedAt: minutes(at) });
});
