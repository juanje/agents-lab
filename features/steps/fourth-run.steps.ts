import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { loadScenario } from "../../src/engine/scenario.ts";
import type { Congress } from "../../src/scenarios/congress.ts";
import type { Context } from "../support/context.ts";
import { change, congressOf, hourMsOf, organiserTurns, setupOf } from "./congress.steps.ts";
import { before, changePools, moneyLines, ranLines, sentBy, untilTime } from "./congress-parties.steps.ts";
import { act, emptyWorld, mail, minutes, publish, records, recordsOf, register, session, worldOf } from "./congress-parts.steps.ts";
import { V1 } from "./run-corrections.steps.ts";
import { drawnVariant } from "./roles.steps.ts";
import { script } from "./tool.steps.ts";

// FR-CONGRESS-15: the corrections from E1's fourth technical run, on FR-CONGRESS-09's congress with a fixed budget, no
// board, the venue "v1", two speakers and the partner "p1".

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The literal text of a step, as a regular expression that matches it alone. */
const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** The parties of the Background. */
const SPEAKERS: TomlTable[] = ["s1", "s2"].map((id, index) => ({ id, title: `Soil ${index + 1}`, draw: 1, fee: 0, home: "local", available: true, acceptance: 1, pick_up: 1 }));
const P1: TomlTable = { id: "p1", title: "Partner's soil", session: 3, fee: 0, home: "north", available: true, pick_up: 1 };
const C1: TomlTable = { id: "c1", price_per_head: 30, diets: { vegan: {} }, minimum: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], pick_up: 1 };
const SP1: TomlTable = { id: "sp1", amount: 1000, conditions: ["logo"], insists: [], pay_days: [4, 4], pick_up: 1 };

Given(
  literal(
    'the draw gives no board, "budget" [4000, 4000] and "advance" [1500, 1500], and the variant draws the venue "v1" (rooms "hall-a" and "hall-b"), the speakers "s1" and "s2", the partner "p1" (session 3), the caterer "c1" and the sponsor "sp1"',
  ),
  function (this: Context) {
    changePools(this, (pool) => {
      pool.venue = [structuredClone(V1)];
      pool.speaker = structuredClone(SPEAKERS);
      pool.partner = [structuredClone(P1)];
      pool.caterer = [structuredClone(C1)];
      pool.sponsor = [structuredClone(SP1)];
    });
    change(this, (configuration) => {
      configuration.draw = stringify({ attendance: [50, 50], budget: [4000, 4000], advance: [1500, 1500], venue: 1, speaker: 2, partner: 1, caterer: 1, sponsor: 1 });
      configuration.travel = stringify({ stations: ["north"], trains: [{ id: "t1", from: "north", arrives: "08:30", price: 0 }], hotels: [], sold_out_probability: 0 });
    });
  },
);

/** Changes the draw of the scenario. */
const changeDraw = (context: Context, changing: (draw: TomlTable) => void) =>
  change(context, (configuration) => {
    const draw = parse(configuration.draw as string);
    changing(draw);
    configuration.draw = stringify(draw);
  });

// The reference price's floor.
/**
 * Plans whose break-even price at 30 paying of a target of 40 is the one given: the plan is "v1" at a day price, 35
 * heads (30 paying, two speakers and the association's three) at the caterer's price, less the advance 1500 and "sp1"'s
 * 1000, over the paying net of the payment fee share.
 */
const PLANS: Record<string, { price: number; feeShare: number }> = {
  // (2480 + 35 × 30 − 2500) / (30 × 0.96) = 1030 / 28.8
  "35.76/30": { price: 2480, feeShare: 0.04 },
  // (1881 + 35 × 38 − 2500) / 30 = 711 / 30
  "23.7/38": { price: 1881, feeShare: 0 },
};

Given(/^the draw gives "break_even_share" \[0\.75, 0\.75\], and the plan's break-even price is ([\d.]+) and its caterer charges (\d+) a head$/, function (this: Context, breakEven: string, perHead: string) {
  const plan = PLANS[`${breakEven}/${perHead}`];
  assert.ok(plan !== undefined, `the steps have no plan breaking even at ${breakEven} with ${perHead} a head`);
  changePools(this, (pool) => {
    Object.assign(pool.venue[0], { price: plan.price });
    Object.assign(pool.caterer[0], { price_per_head: Number(perHead) });
  });
  changeDraw(this, (draw) => Object.assign(draw, { attendance: [40, 40], break_even_share: [0.75, 0.75] }));
  change(this, (configuration) => (configuration.attendees = stringify({ ...parse(configuration.attendees as string), payment_fee_share: plan.feeShare })));
});

Then("the variant line gives the reference price {float}", function (this: Context, reference: number) {
  assert.equal(Math.round((drawnVariant(this).reference_price as number) * 100) / 100, reference);
});

// The partner in the directory.
/** The directory as the organiser's system prompt gives it, for the replica of seed 1. */
function directoryOf(context: Context): string[] {
  const scenario = congressOf(setupOf(context));
  const withDirectory = { ...scenario, baseConfiguration: stringify({ ...parse(scenario.baseConfiguration ?? ""), knowledge: "{directory}" }) };
  return (loadScenario(withDirectory, 1).systemPrompts.get(ORGANISER) ?? "").split("\n");
}

Then('the organiser\'s directory lists "p1" as a partner, after the speakers and before the caterers, with its title, its home and its acts', function (this: Context) {
  ranLines(this);
  const lines = directoryOf(this);
  const parties = lines.filter((line) => line.startsWith("- "));
  const kinds = parties.map((line) => (/^- [\w-]+: (\w+)/.exec(line) as RegExpExecArray)[1]);
  const partner = parties.find((line) => line.startsWith("- p1: "));
  assert.equal(partner, '- p1: partner, with a mailbox and a line; "Partner\'s soil", from north', parties.join("\n"));
  assert.ok(kinds.lastIndexOf("speaker") < kinds.indexOf("partner") && kinds.indexOf("partner") < kinds.indexOf("caterer"), kinds.join(", "));
  assert.ok(
    lines.includes("A partner takes confirm (time, room, length, travel), change, ask_slides (by)."),
    lines.filter((line) => / takes /.test(line)).join("\n"),
  );
});

// The partner's mail.
Given(/^"p1"'s template gives the mail "([^"]+)"$/, function (this: Context, text: string) {
  changePools(this, (pool) => Object.assign(pool.partner[0], { mail: text }));
});

Given('the organiser\'s scripted turns call "check_mail", then "read_mail" of the first message, then end', function (this: Context) {
  // The partner's session mail is the first message of the run.
  script(this, ORGANISER, [...organiserTurns('call "check_mail", then "read_mail" "m-1"', hourMsOf(this)), { text: "Done.", delayMs: 0 }]);
});

Then('the mail from "association" with the act "partner_session" has the text {string}', function (this: Context, text: string) {
  const read = ranLines(this).find((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === "read_mail");
  assert.equal(read?.outcome, "success");
  // read_mail is an effector: what the organiser read is its text.
  const shown = String(read?.text);
  assert.match(shown, /association/);
  assert.ok(shown.includes(text), shown);
  const state = setupOf(this).loaded?.world.state as Congress;
  const [message] = state.mail.mailboxes[ORGANISER].filter(({ from, act: kind }) => from === "association" && kind === "partner_session");
  assert.equal(message?.text, text);
});

// "it is refused before any model call, with an error that names … and …" is FR-CONGRESS-08's step.

// Venues.
/** The organiser's turns that book "v1" with these rooms and accept its contract. */
const booking = (context: Context, rooms: string) =>
  organiserTurns(
    `call "send_mail" to "v1" with the act "book", date "day 26", rooms "${rooms}" and hours "08:00-18:00", then wait 1 world hour, then "send_mail" to "v1" with the act "accept_contract" and the contract's id, then wait 1 world hour, then "check_time"`,
    hourMsOf(context),
  );

/** Declares the venue change at noon of day 1, of a kind, and has the organiser's next turn come after it. */
function changing(context: Context, kind: string): void {
  change(context, (configuration) => ((configuration.perturbations as TomlTable).change = { at: "day 1 12:00", kind }));
  untilTime(context, "day 1 13:00");
}

// "c-1" is the scenario's name for "v1"'s first contract, "v1-contract-1".
Given('"v1" raised the price of the organiser\'s confirmed contract "c-1" and the organiser declined the change, so "v1" cancelled "c-1"', function (this: Context) {
  before(this, booking(this, "hall-a"));
  changing(this, "price_change");
  before(this, organiserTurns('call "send_mail" to "v1" with the act "decline_change", then wait 1 world hour, then "check_time"', hourMsOf(this)));
});

Given('the organiser\'s scripted turns call "send_mail" to "v1" with the act "accept_contract" and the contract "c-1", then end', function (this: Context) {
  before(this, organiserTurns('call "send_mail" to "v1" with the act "accept_contract" and the contract\'s id, then wait 1 world hour, then "check_time"', hourMsOf(this)));
  this.timeLimitMs = 8 * hourMsOf(this);
});

Then('"v1" answered "not_available", "c-1" stays cancelled, and the organiser has no commitment with "v1"', function (this: Context) {
  const acts = sentBy(this, "v1").map((line) => line.act);
  assert.deepEqual(acts.slice(-2), ["cancelled", "not_available"], acts.join(", "));
  const committed = moneyLines(this, "commitment").filter((line) => line.from === ORGANISER && line.to === "v1").reduce((sum, line) => sum + Number(line.amount), 0);
  const released = moneyLines(this, "release").filter((line) => line.from === ORGANISER && line.to === "v1").reduce((sum, line) => sum + Number(line.amount), 0);
  assert.equal(committed - released, 0);
});

Given('"v1" announced a "price_change" on the organiser\'s contract', function (this: Context) {
  before(this, booking(this, "hall-a"));
  changing(this, "price_change");
});

Given('"v1" announced "room_lost" for "hall-b", offering a price cut and no smaller room', function (this: Context) {
  // "hall-b" (40 seats) is the smaller of "v1"'s two rooms: no smaller room is left to offer.
  before(this, booking(this, "hall-a, hall-b"));
  changing(this, "room_lost");
});

Given(/^the organiser's scripted turns call "send_mail" to "v1" with the act "accept_change" and (the option "\w+"|no option), then end$/, function (this: Context, written: string) {
  const option = /"(\w+)"/.exec(written)?.[1] ?? null;
  const turn = option === null ? 'call "send_mail" to "v1" with the act "accept_change"' : `call "send_mail" to "v1" with the act "accept_change" and option "${option}"`;
  before(this, organiserTurns(`${turn}, then wait 1 world hour, then "check_time"`, hourMsOf(this)));
  this.timeLimitMs = 8 * hourMsOf(this);
});

Then(/^"v1" answered "(not_available|confirmed)"$/, function (this: Context, answer: string) {
  const sent = sentBy(this, "v1");
  const announced = sent.findIndex((line) => line.act === "price_change" || line.act === "room_lost");
  assert.ok(announced >= 0, `"v1" announced no change: ${sent.map((line) => line.act).join(", ")}`);
  if (sent[announced].act === "room_lost") assert.equal((sent[announced].fields as { offer: string }).offer, "price_cut");
  assert.deepEqual(
    sent.slice(announced + 1).map((line) => line.act),
    [answer],
  );
});

// A withdrawn sponsor.
Given('"sp1" agreed 1000, was invoiced with payment due on "day 5", and withdrew at the perturbation "sponsor_withdraws" on "day 4"', function (this: Context) {
  before(
    this,
    organiserTurns(
      'call "send_mail" to "sp1" with the act "accept_sponsorship" and conditions "logo", then wait 1 world hour, then "issue_invoice" to "sp1" with the amount 1000, due "day 5" and for "sponsorship", then wait 1 world hour, then "check_time"',
      hourMsOf(this),
    ),
  );
  change(this, (configuration) => ((configuration.perturbations as TomlTable).sponsor_withdraws = { at: "day 4 09:00", for: "sp1" }));
});

Then('"sp1" paid nothing, and called "check_time" at most 10 times after "day 4"', function (this: Context) {
  const lines = ranLines(this);
  const withdrew = sentBy(this, "sp1").find((line) => line.act === "withdraw");
  assert.ok(withdrew !== undefined, '"sp1" did not withdraw');
  assert.equal(moneyLines(this, "payment").filter((line) => line.from === "sp1").length, 0);
  // Its clock calls after its withdrawal, which the perturbation of day 4 brought.
  const after = lines.filter((line) => line.type === "tool_call" && line.agent === "sp1" && line.tool === "check_time" && Number(line.startedAtMs) > Number(withdrew.atMs));
  assert.ok(after.length <= 10, `"sp1" called check_time ${after.length} times after day 4`);
});

// P21.
Given(
  '"v1"\'s contract with the indicative-rooms term arrived on "day 4", the organiser sent "s2" "confirm" with the room "room-b" on "day 6", published a programme with "room-b" on "day 12", and announced "request_needs" to registrants on "day 13"',
  function (this: Context) {
    const state = emptyWorld();
    records.set(this, { state, acts: [] });
    mail(this, "v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "main-hall, room-b", hours: "08:00-18:00", price: 2000, terms: "Rooms are indicative until allocated." }, minutes("day 4"));
    mail(this, "v1", "organiser", "confirmed", { contract: "v1-contract-1" }, minutes("day 4 01:00"));
    mail(this, "organiser", "s2", "invite", { session: 2, time: "10:30", fee: 0, travel_paid: false }, minutes("day 5"));
    mail(this, "s2", "organiser", "accept", { session: 2 }, minutes("day 5 01:00"));
    mail(this, "organiser", "s2", "confirm", { time: "10:30", room: "room-b", length: 45, travel: "none" }, minutes("day 6"));
    act(this, "send_mail", { to: "s2", act: "confirm", fields: { time: "10:30", room: "room-b", length: 45, travel: "none" } }, minutes("day 6"));
    mail(this, "s2", "organiser", "acknowledged", {}, minutes("day 6 01:00"));
    const sessions = ["s1", "s2", "s3", "s4", "s5", "s6"].map((speaker, index) => session([speaker], ["09:30", "10:30", "11:30", "14:00", "15:00", "16:00"][index], speaker === "s2" ? "room-b" : "main-hall"));
    publish(this, sessions, minutes("day 12"));
    act(this, "publish_programme", { sessions }, minutes("day 12"));
    register(this, 5, {}, minutes("day 11"));
    const population = state.population as NonNullable<Congress["population"]>;
    population.announcements = [...(population.announcements ?? []), { audience: "registrants", kind: "request_needs", at: minutes("day 13") }];
    act(this, "announce", { audience: "registrants", kind: "request_needs" }, minutes("day 13"));
    void worldOf;
  },
);

Given('"v1" allocated "room-b" as "room-d" at "day 15 10:00", and the organiser changed nothing by "day 16 10:00"', function (this: Context) {
  mail(this, "v1", "organiser", "rooms_allocated", { contract: "v1-contract-1", allocation: "main-hall -> main-hall; room-b -> room-d" }, minutes("day 15 10:00"));
  void recordsOf;
});
