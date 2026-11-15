import assert from "node:assert/strict";
import { Before, Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { loadScenario } from "../../src/engine/scenario.ts";
import type { Context } from "../support/context.ts";
import { change, congressChanges, congressOf, hourMsOf, organiserTurns, setupOf } from "./congress.steps.ts";
import { before, changePools, fieldsOf, moneyLines, ranLines, sentBy, sentWith, untilTime } from "./congress-parties.steps.ts";
import { ATTENDEES, V1, setUpCorrectionsCongress } from "./run-corrections.steps.ts";
import { Random } from "../../src/engine/random.ts";
import { speakerRules } from "../../src/scenarios/congress-parties.ts";
import { calls, conversation } from "../../tests/fixtures/rules.ts";
import { modelOf } from "./tool.steps.ts";

// FR-CONGRESS-11: the world's corrections from E1's second technical run, on FR-CONGRESS-09's congress with a fixed
// budget and no board.

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The literal text of a step, as a regular expression that matches it alone. */
const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** The speakers of the Background. */
const SPEAKERS: TomlTable[] = [
  { id: "s1", title: "Soil life", draw: 1, fee: 300, home: "local", available: true, acceptance: 1, condition: "fee", pick_up: 1 },
  { id: "s2", title: "Soil water", draw: 1, fee: 0, home: "north", available: true, acceptance: 1, condition: "travel_paid", pick_up: 1 },
  { id: "s3", title: "Soil fungi", draw: 1, fee: 0, home: "local", available: true, acceptance: 1, condition: "morning_slot", pick_up: 1 },
  { id: "s4", title: "Soil maps", draw: 1, fee: 0, home: "local", available: true, acceptance: 1, pick_up: 1 },
];

/** The caterer of the Background, whose minimum is 30. */
const C1: TomlTable = { id: "c1", price_per_head: 30, diets: { vegan: {} }, minimum: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], pick_up: 1 };

/** The sponsor and the partner of the Background. */
const SP1: TomlTable = { id: "sp1", amount: 1200, conditions: ["logo"], insists: [], pay_days: [2, 2], pick_up: 1 };
const P1: TomlTable = { id: "p1", title: "Partner's soil", session: 3, fee: 0, home: "local", available: true, pick_up: 1 };

/** The Background's draw: no board, a budget and an advance, and one of each party, all four speakers. */
const DRAW = { attendance: [50, 50], budget: [4000, 4000], advance: [1500, 1500], venue: 1, speaker: 4, caterer: 1, sponsor: 1, partner: 1 };

Given(
  "the congress scenario of FR-CONGRESS-09, whose calendar starts at {string} with one segment of scale {int}, so one world hour is {int} milliseconds of the run",
  function (this: Context, start: string, scale: number, hourMs: number) {
    setUpCorrectionsCongress(this, start, scale, hourMs);
  },
);

Given(
  literal(
    'the draw gives no board, "budget" [4000, 4000] and "advance" [1500, 1500], and the variant draws the venue "v1" (rooms "hall-a" and "hall-b", extras "early_access" 50 and "ramp" 200), the speakers "s1" (acceptance 1, condition "fee", fee 300), "s2" (acceptance 1, condition "travel_paid", from "north"), "s3" (acceptance 1, condition "morning_slot") and "s4" (acceptance 1, no condition), the caterer "c1" (minimum 30), the sponsor "sp1" and the partner "p1"',
  ),
  function (this: Context) {
    changePools(this, (pool) => {
      pool.venue = [{ ...structuredClone(V1), extras: { early_access: 50, ramp: 200 } }];
      pool.speaker = structuredClone(SPEAKERS);
      pool.caterer = [structuredClone(C1)];
      pool.sponsor = [structuredClone(SP1)];
      pool.partner = [structuredClone(P1)];
    });
    change(this, (configuration) => {
      configuration.draw = stringify(DRAW);
      configuration.travel = stringify({ stations: ["north"], trains: [{ id: "t1", from: "north", arrives: "08:30", price: 40 }], hotels: [], sold_out_probability: 0 });
    });
  },
);

/** The variant line of the run. */
function variantLine(context: Context): Record<string, unknown> {
  const line = ranLines(context).find((each) => each.type === "variant");
  assert.ok(line !== undefined, "the log has no variant line");
  return line;
}

Then("the variant line gives the budget {int} and the advance {int}", function (this: Context, budget: number, advance: number) {
  const line = variantLine(this);
  assert.deepEqual({ budget: line.budget, advance: line.advance }, { budget, advance });
});

// Committing beyond the budget.
Given('"v1" committed 3500 with the organiser, and then "c1" commits 900', function (this: Context) {
  changePools(this, (pool) => Object.assign(pool.venue[0], { price: 3500 }));
  before(
    this,
    organiserTurns(
      [
        'call "send_mail" to "v1" with the act "book", date "day 26", rooms "hall-a" and hours "08:00-18:00"',
        "wait 1 world hour",
        '"send_mail" to "v1" with the act "accept_contract" and the contract\'s id',
        "wait 1 world hour",
        '"send_mail" to "c1" with the act "order", counts "standard" 30, date "day 26" and venue "v1"',
        "wait 1 world hour",
        '"check_time"',
      ].join(", then "),
      hourMsOf(this),
    ),
  );
});

Then(
  'the money records an "unapproved_overrun" for "c1"\'s commitment, with the committed total 4400 and the limit 4000, and both commitments stand',
  function (this: Context) {
    const commitments = moneyLines(this, "commitment").filter((line) => line.from === ORGANISER);
    assert.deepEqual(
      commitments.map((line) => [line.to, line.amount]),
      [
        ["v1", 3500],
        ["c1", 900],
      ],
    );
    const overruns = moneyLines(this, "unapproved_overrun");
    assert.equal(overruns.length, 1, JSON.stringify(overruns));
    assert.deepEqual({ commitment: overruns[0].commitment, amount: overruns[0].amount, limit: overruns[0].limit }, { commitment: commitments[1].commitment, amount: 4400, limit: 4000 });
    assert.equal(moneyLines(this, "release").length, 0);
  },
);

// The budget and the advance drawn.
Given('the draw gives "budget" [3000, 5000] and "advance" [1000, 2000]', function (this: Context) {
  change(this, (configuration) => (configuration.draw = stringify({ ...parse(configuration.draw as string), budget: [3000, 5000], advance: [1000, 2000] })));
});

/** Each replica's variant under the base configuration and under another condition, by seed. */
const variants = new WeakMap<Context, { base: Record<string, unknown>; other: Record<string, unknown> }[]>();

When("the variant is drawn for the seeds 1 to 20", function (this: Context) {
  const scenario = congressOf(setupOf(this));
  variants.set(
    this,
    Array.from({ length: 20 }, (_, index) => ({
      base: loadScenario(scenario, index + 1).variant as Record<string, unknown>,
      other: loadScenario(scenario, index + 1, { name: "other", change: 'guidance = "Mind the money."' }).variant as Record<string, unknown>,
    })),
  );
});

/** The replicas' variants the scenario drew. */
function drawnVariants(context: Context) {
  const drawn = variants.get(context);
  assert.ok(drawn !== undefined && drawn.length === 20, "the variant was not drawn for 20 seeds");
  return drawn;
}

Then("each budget is a whole number from 3000 to 5000 and each advance one from 1000 to 2000, the same for every condition of a replica", function (this: Context) {
  for (const { base, other } of drawnVariants(this)) {
    const budget = base.budget as number;
    const advance = base.advance as number;
    assert.ok(Number.isInteger(budget) && budget >= 3000 && budget <= 5000, `the budget ${budget}`);
    assert.ok(Number.isInteger(advance) && advance >= 1000 && advance <= 2000, `the advance ${advance}`);
    assert.deepEqual([other.budget, other.advance], [budget, advance]);
  }
});

// The association's mail.
Then('the "check_mail" result lists one message from "association" with the act "partner_session", received at "day 1 Monday 09:00"', function (this: Context) {
  const call = ranLines(this).find((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === "check_mail");
  const listed = String(call?.result ?? "").split("\n");
  assert.equal(listed.length, 1, `check_mail listed ${listed.join("; ")}`);
  assert.match(listed[0], /from association, .*received day 1 Monday 09:00$/);
  const delivered = ranLines(this).filter((line) => line.type === "message_delivered");
  assert.ok(delivered.length >= 1);
});

Then('the directory lists no "association" and no board', function (this: Context) {
  const scenario = congressOf(setupOf(this));
  const withDirectory = { ...scenario, baseConfiguration: stringify({ ...parse(scenario.baseConfiguration ?? ""), knowledge: "{directory}" }) };
  const prompt = loadScenario(withDirectory, 1).systemPrompts.get(ORGANISER) ?? "";
  assert.ok(!prompt.includes("association"), prompt);
  assert.ok(!/board/.test(prompt), prompt);
});

// The refusals.
congressChanges.push(
  [/^"budget" is \[5000, 3000\]$/, (setup) => change(setup.context, (configuration) => (configuration.draw = stringify({ ...parse(configuration.draw as string), budget: [5000, 3000] })))],
  [/^"advance" is \[2000, 1000\]$/, (setup) => change(setup.context, (configuration) => (configuration.draw = stringify({ ...parse(configuration.draw as string), advance: [2000, 1000] })))],
  [
    /^the "task" text names "\{budget\}" and the draw gives none$/,
    (setup) =>
      change(setup.context, (configuration) => {
        const { budget: _budget, ...draw } = parse(configuration.draw as string);
        configuration.draw = stringify(draw);
        configuration.task = "Spend at most {budget}.";
      }),
  ],
  [/^a money account's "ceiling" is -1$/, (setup) => change(setup.context, (configuration) => (((configuration.money as TomlTable).accounts as TomlTable).travel = { unlimited: true, ceiling: -1 }))],
);

// Speakers' acceptance drawn with the variant.
Given('the speaker pool has 12 available templates with acceptance 0.5 and the draw takes 8 of them with "min_accepting" 6', function (this: Context) {
  changePools(this, (pool) => (pool.speaker = Array.from({ length: 12 }, (_, index) => ({ id: `s${index + 1}`, title: `Talk ${index + 1}`, fee: 0, home: "local", available: true, acceptance: 0.5, pick_up: 1 }))));
  change(this, (configuration) => (configuration.draw = stringify({ ...parse(configuration.draw as string), speaker: { count: 8, min_accepting: 6 } })));
});

Then('each replica\'s variant line gives every chosen speaker\'s "accepts", and at least 6 available chosen speakers accept', function (this: Context) {
  for (const { base } of drawnVariants(this)) {
    const chosen = (base.chosen as Record<string, string[]>).speaker;
    const accepts = base.accepts as Record<string, boolean>;
    assert.deepEqual(Object.keys(accepts ?? {}).sort(), [...chosen].sort());
    assert.ok(Object.values(accepts).filter(Boolean).length >= 6, JSON.stringify(accepts));
  }
});

Then('each speaker answers its first invitation as its "accepts" says', function (this: Context) {
  const scenario = congressOf(setupOf(this));
  for (const seed of [1, 2, 3]) {
    const loaded = loadScenario(scenario, seed);
    const accepts = (loaded.variant as { accepts: Record<string, boolean> }).accepts;
    for (const [speaker, accepting] of Object.entries(accepts)) {
      const params = ((loaded.participants ?? []).find(({ name }) => name === speaker) as { params: Record<string, unknown> }).params;
      // Its rules, as the run starts them, from the replica's sequence for it.
      const { steps } = conversation(speakerRules.start(params, new Random(seed)), [["day 1 Monday 09:01", "From: organiser. Act: invite. session: 1. time: 10:00. fee: 0. travel_paid: false."]]);
      assert.deepEqual(
        calls(steps, "send_mail").map(({ act }) => act),
        [accepting ? "accept" : "decline"],
        `"${speaker}" in the replica of seed ${seed}`,
      );
    }
  }
});

congressChanges.push([
  /^"min_accepting" is 5 and the pool has 4 available speakers$/,
  (setup) => {
    changePools(setup.context, (pool) => (pool.speaker = pool.speaker.map((template, index) => ({ ...template, available: index < 4 }))));
    change(setup.context, (configuration) => (configuration.draw = stringify({ ...parse(configuration.draw as string), speaker: { count: 4, min_accepting: 5 } })));
  },
]);

// Speakers.
/** The organiser's turns that invite a speaker to a session at a time with a fee, then wait for its answer. */
const inviting = (context: Context, speaker: string, session: number, time: string, fee: number) =>
  organiserTurns(`call "send_mail" to "${speaker}" with the act "invite", session ${session}, time "${time}", fee ${fee} and travel_paid false, then wait 1 world hour, then "check_time"`, hourMsOf(context));

Given('"s1" accepted session 2 with fee 300 and answered "accept_if" to session 5 with fee 0', function (this: Context) {
  before(this, [...inviting(this, "s1", 2, "10:00", 300), ...inviting(this, "s1", 5, "14:00", 0)]);
});

Then('"s1"\'s "withdraw" mail names session 5 only, and "s1" still holds its acceptance of session 2', function (this: Context) {
  assert.equal(fieldsOf(sentWith(this, "s1", "accept")).session, 2);
  assert.equal(fieldsOf(sentWith(this, "s1", "accept_if")).session, 5);
  assert.equal(fieldsOf(sentWith(this, "s1", "withdraw")).sessions, "5");
  // Nothing after the acceptance answers session 2 otherwise.
  assert.ok(!sentBy(this, "s1").some((line) => ["decline", "withdraw"].includes(String(line.act)) && String(fieldsOf(line).sessions ?? fieldsOf(line).session).split(", ").includes("2")));
});

Given('"s4" accepted session 3, acknowledged its confirmation and cancelled at the perturbation "early_cancel"', function (this: Context) {
  before(this, [
    ...inviting(this, "s4", 3, "10:00", 0),
    ...organiserTurns('call "send_mail" to "s4" with the act "confirm", time "10:00", room "hall-a", length 45 and travel "none", then wait 1 world hour, then "check_time"', hourMsOf(this)),
  ]);
  change(this, (configuration) => ((configuration.perturbations as TomlTable).early_cancel = { between: ["day 1 12:00", "day 1 12:00"] }));
});

Given(
  'the organiser\'s scripted turns then send "s4" "ask_panel" for slot "16:00", "invite" to session 4 at "11:00", and "confirm" for session 3, then end',
  function (this: Context) {
    untilTime(this, "day 1 13:00");
    // The confirmation names another room, so it is no repeat of the first, which a repeat's answer would only recall.
    before(
      this,
      organiserTurns(
        'call "send_mail" to "s4" with the act "ask_panel" and slot "16:00", then "send_mail" to "s4" with the act "invite", session 4, time "11:00", fee 0 and travel_paid false, then "send_mail" to "s4" with the act "confirm", time "10:00", room "hall-b", length 45 and travel "none", then wait 1 world hour, then "check_time"',
        hourMsOf(this),
      ),
    );
  },
);

Then('"s4" answered "decline" to the panel and to session 4, and "not_available" to the confirmation', function (this: Context) {
  const cancelled = sentWith(this, "s4", "cancel");
  const after = sentBy(this, "s4").filter((line) => Number(line.atMs) > Number(cancelled.atMs));
  assert.deepEqual(
    after.map((line) => [line.act, fieldsOf(line)]),
    [
      ["decline", { slot: "16:00" }],
      ["decline", { session: 4 }],
      ["not_available", { what: "acceptance" }],
    ],
  );
});

Given(/^the organiser invites "(s\d)" to session 1 at "15:00" with fee 0 and travel_paid false$/, function (this: Context, speaker: string) {
  before(this, inviting(this, speaker, 1, "15:00", 0));
});

Then(/^"(s\d)" answered "accept_if" with the condition "(\w+)" and (.+)$/, function (this: Context, speaker: string, condition: string, needs: string) {
  const needed: Record<string, Record<string, unknown>> = {
    "the fee 300": { fee: 300 },
    'travel_paid true and from "north"': { travel_paid: true, from: "north" },
    'the time "before 12:00"': { time: "before 12:00" },
  };
  assert.deepEqual(fieldsOf(sentWith(this, speaker, "accept_if")), { session: 1, condition, ...needed[needs] });
});

// Venues.
Then('"v1"\'s "quote" gives the extras "early_access: 50" and "ramp: 200"', function (this: Context) {
  assert.deepEqual(String(fieldsOf(sentWith(this, "v1", "quote")).extras).split(/;\s*/), ["early_access: 50", "ramp: 200"]);
});

/** The organiser's turns that book "v1" for "day 26" with these rooms and accept its contract. */
const booking = (context: Context, rooms: string) =>
  organiserTurns(
    `call "send_mail" to "v1" with the act "book", date "day 26", rooms "${rooms}" and hours "08:00-18:00", then wait 1 world hour, then "send_mail" to "v1" with the act "accept_contract" and the contract's id, then wait 1 world hour, then "check_time"`,
    hourMsOf(context),
  );

Given('the organiser\'s confirmed contract with "v1" has only "hall-b", its smallest room, and the perturbation "change" of the kind "room_lost" fires', function (this: Context) {
  // "hall-b", 40 seats, has no free room of "v1" with fewer seats to move to (FR-CONGRESS-17).
  before(this, booking(this, "hall-b"));
  change(this, (configuration) => ((configuration.perturbations as TomlTable).change = { at: "day 1 12:00", kind: "room_lost" }));
});

Then('"v1" announced "price_change", and lost no room', function (this: Context) {
  sentWith(this, "v1", "confirmed");
  sentWith(this, "v1", "price_change");
  assert.equal(sentBy(this, "v1").filter((line) => line.act === "room_lost").length, 0);
});

Given(
  'the organiser\'s confirmed contract with "v1" has "hall-a" and "hall-b", whose rooms are indicative, and "rooms_allocated" moved "hall-b" to "annex"',
  function (this: Context) {
    // "annex", a room of "v1" no booking has, seats "hall-b"'s audience but not "hall-a"'s.
    changePools(this, (pool) => Object.assign(pool.venue[0], { indicative: true, rooms: [...(pool.venue[0].rooms as TomlTable[]), { id: "annex", seats: 50, equipment: [] }] }));
    change(this, (configuration) => {
      const city = parse(configuration.city as string);
      const [v1] = city.venues as TomlTable[];
      v1.rooms = [...(v1.rooms as TomlTable[]), { id: "annex", seats: 50 }];
      city.passages = [...(city.passages as TomlTable[]), { between: ["v1-entrance", "annex"], length: 1, step_free: true }];
      configuration.city = stringify(city);
      (configuration.perturbations as TomlTable).room_allocation = { at: "day 1 12:00" };
    });
    before(this, booking(this, "hall-a, hall-b"));
    untilTime(this, "day 1 13:00");
  },
);

Then('"v1" answered "unavailable"', function (this: Context) {
  assert.equal(fieldsOf(sentWith(this, "v1", "rooms_allocated")).allocation, "hall-a -> hall-a; hall-b -> annex");
  sentWith(this, "v1", "unavailable");
  assert.equal(sentBy(this, "v1").filter((line) => line.act === "contract_changed").length, 0);
});

Given('"v1" answered "quote" to the organiser\'s "ask_quote" for "day 26" and attendance 60 at "day 1 Monday 10:01"', function (this: Context) {
  // The calendar starts at 10:00, a world minute 100 ms of the run, so the quote's minute is exact.
  change(this, (configuration) => Object.assign(configuration.calendar as TomlTable, { start: "day 1 Monday 10:00", segments: [{ scale: 600 }] }));
  this.timeLimitMs = 2 * hourMsOf(this);
  before(this, organiserTurns('call "send_mail" to "v1" with the act "ask_quote", date "day 26" and attendance 60, then wait 1 world hour, then "check_time"', hourMsOf(this)));
});

Then('"v1" answered "already_sent" with the act "quote" and sent "day 1 Monday 10:01", and changed nothing else', function (this: Context) {
  const quote = sentWith(this, "v1", "quote");
  const { day, seconds } = quote.worldTime as { day: number; seconds: number };
  assert.deepEqual([day, Math.floor(seconds / 60)], [1, 10 * 60 + 1]);
  assert.deepEqual(fieldsOf(sentWith(this, "v1", "already_sent")), { act: "quote", sent: "day 1 Monday 10:01" });
  assert.deepEqual(
    sentBy(this, "v1").map((line) => line.act),
    ["quote", "already_sent"],
  );
});

/** Each scenario's step texts, so a step can see what the scenario goes on to do. */
const stepTexts = new WeakMap<Context, string[]>();
Before({ tags: "@FR-CONGRESS-11" }, function (this: Context, { pickle }) {
  stepTexts.set(
    this,
    pickle.steps.map(({ text }) => text),
  );
});

// Caterers' minimum.
Given('"c1" confirmed an order for 40 people, unless the scenario\'s message is the order', function (this: Context) {
  if ((stepTexts.get(this) ?? []).some((text) => text.includes('to "c1" with the act "order"'))) return;
  before(this, organiserTurns('call "send_mail" to "c1" with the act "order", counts "standard: 40", date "day 26" and venue "v1", then wait 1 world hour, then "check_time"', hourMsOf(this)));
});

Then(/^"c1" answered "(order_refused|numbers_refused)" with the reason "below_minimum" and the minimum 30$/, function (this: Context, act: string) {
  assert.deepEqual(fieldsOf(sentWith(this, "c1", act)), { reason: "below_minimum", minimum: 30 });
});

// Invoices.
Then('the call failed with the outcome "invalid_arguments", saying that only sponsors are invoiced, and took no time', function (this: Context) {
  const call = ranLines(this).find((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === "issue_invoice");
  assert.ok(call !== undefined, "the organiser made no issue_invoice call");
  assert.equal(call.outcome, "invalid_arguments");
  // The reason reaches the organiser's model as its call's result.
  const messages = modelOf(this, ORGANISER).received.at(-1) ?? [];
  assert.match(JSON.stringify(messages.filter((message) => message.role === "toolResult" && message.toolName === "issue_invoice").map((message) => message.content)), /only sponsors are invoiced/);
  assert.equal(call.durationMs ?? 0, 0);
  assert.equal(moneyLines(this, "invoice").filter((line) => line.from === ORGANISER).length, 0);
});

// Registrants.
Given("the registrant {string}, who needs a wheelchair, mailed the organiser a question about access", function (this: Context, id: string) {
  // Six people of the pool, a-1 to a-6, who do not register, and a-7, who registers on day 1 at 10:00 and was not asked.
  change(this, (configuration) => (configuration.attendees = stringify({ ...ATTENDEES, pool_factor: 0.12, fixed: [{ id, access: "wheelchair", between: ["day 1 10:00", "day 1 10:00"] }] })));
  before(this, [{ toolCalls: [{ name: "edit_ticket_page", arguments: { open: true, price: 10 } }] as never, delayMs: 0 }]);
  // Its question comes within a day of registering.
  untilTime(this, "day 2 11:00");
  this.timeLimitMs = 29 * hourMsOf(this);
});

/** The population's lines of the run. */
const populationLines = (context: Context) => ranLines(context).filter((line) => line.type === "population");

Then('the mail was delivered, the population recorded the answer, and "a-7"\'s access need is known to the organiser', function (this: Context) {
  const question = sentWith(this, "a-7", "question");
  assert.equal(fieldsOf(question).about, "access");
  const answer = sentWith(this, ORGANISER, "answer");
  assert.ok(ranLines(this).some((line) => line.type === "message_delivered" && line.id === answer.id), "the answer was not delivered");
  const recorded = populationLines(this).find((line) => line.event === "answer" && line.person === "a-7");
  assert.ok(recorded !== undefined, "the population recorded no answer");
  assert.deepEqual(recorded.known, { access: "wheelchair" });
});

Then('the directory says that registrants are mailed at their id with the act "answer"', function (this: Context) {
  assert.match(directoryOf(this), /^Registrants are mailed at their id with the act answer \(text\)\.$/m);
});

/** The directory as the organiser's system prompt gives it, for the replica of seed 1. */
function directoryOf(context: Context, seed = 1): string {
  const scenario = congressOf(setupOf(context));
  const withDirectory = { ...scenario, baseConfiguration: stringify({ ...parse(scenario.baseConfiguration ?? ""), knowledge: "{directory}" }) };
  return loadScenario(withDirectory, seed).systemPrompts.get(ORGANISER) ?? "";
}

// Announcements.
Given("the ticket page is open and nothing was announced", function (this: Context) {
  before(this, [{ toolCalls: [{ name: "edit_ticket_page", arguments: { open: true, price: 10 } }] as never, delayMs: 0 }]);
});

Then("registration counts as announced from that moment, and a promotion runs for 2 world days", function (this: Context) {
  const announced = ranLines(this).find((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === "announce");
  assert.equal(announced?.outcome, "success");
  const state = setupOf(this).loaded?.world.state as { population: { announced: boolean; promotions: { start: number; factor: number }[]; announcements: { at: number }[] } };
  assert.equal(state.population.announced, true);
  assert.deepEqual(
    state.population.promotions.map(({ start }) => start),
    state.population.announcements.map(({ at }) => at),
  );
});

// The directory.
Then("each directory lists each kind's acts once, then the venues, the speakers, the partner, the caterers, the sponsors and the agency in that order", function (this: Context) {
  for (const seed of [1, 2]) {
    const lines = directoryOf(this, seed).split("\n");
    const acts = lines.filter((line) => / takes /.test(line));
    const parties = lines.filter((line) => line.startsWith("- "));
    assert.equal(lines.indexOf(acts.at(-1) as string) < lines.indexOf(parties[0]), true);
    assert.equal(new Set(acts.map((line) => line.split(" ")[1])).size, acts.length);
    const kinds = parties.map((line) => (/^- [\w-]+: (\w+)/.exec(line) as RegExpExecArray)[1]);
    const order = ["venue", "speaker", "partner", "caterer", "sponsor", "agency"];
    // The partner is listed (FR-CONGRESS-15).
    assert.ok(kinds.includes("partner"), kinds.join(", "));
    assert.deepEqual(kinds, [...kinds].sort((one, other) => order.indexOf(one) - order.indexOf(other)), kinds.join(", "));
  }
});

Then("within each kind the parties are in an order drawn from the replica's seed", function (this: Context) {
  const speakersOf = (seed: number) => directoryOf(this, seed).split("\n").filter((line) => /^- s\d: speaker/.test(line)).map((line) => line.slice(2, 4));
  const orders = [1, 2, 3, 4, 5].map(speakersOf);
  for (const order of orders) assert.deepEqual([...order].sort(), ["s1", "s2", "s3", "s4"]);
  assert.ok(new Set(orders.map((order) => order.join())).size > 1, `every seed lists ${orders[0].join(", ")}`);
});
