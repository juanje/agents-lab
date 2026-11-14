import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { loadScenario } from "../../src/engine/scenario.ts";
import type { Context } from "../support/context.ts";
import { change, congressChanges, congressOf, hourMsOf, organiserTurns, setupOf } from "./congress.steps.ts";
import { before, changePools, fieldsOf, moneyLines, ranLines, sentBy, sentWith } from "./congress-parties.steps.ts";
import { V1, setUpCorrectionsCongress } from "./run-corrections.steps.ts";

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
