import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import type { RuleSet, RuleStep } from "../../src/engine/participants.ts";
import type { Context } from "../support/context.ts";
import { change, congressChanges } from "./congress.steps.ts";
import { changePools, moneyLines } from "./congress-parties.steps.ts";
import { CITY, V1 } from "./run-corrections.steps.ts";
import { drawnVariant } from "./roles.steps.ts";

// FR-CONGRESS-13: the world's corrections from E1's third technical run, on FR-CONGRESS-09's congress with a fixed
// budget, no board, and the venues "v1" and "v2".

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The literal text of a step, as a regular expression that matches it alone. */
const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** The venue "v2" of the Background: one room, "hall-2", dearer than "v1". */
const V2: TomlTable = { ...structuredClone(V1), id: "v2", rooms: [{ id: "hall-2", seats: 90, equipment: [] }], price: 2500 };

/** The speakers of the Background. */
const SPEAKERS: TomlTable[] = [
  { id: "s1", title: "Soil life", draw: 1, fee: 300, home: "local", available: true, acceptance: 1, condition: "fee", pick_up: 1 },
  { id: "s2", title: "Soil water", draw: 1, fee: 0, home: "local", available: true, acceptance: 1, pick_up: 1 },
];

/** The caterer and the sponsor of the Background. */
const C1: TomlTable = { id: "c1", price_per_head: 30, diets: { vegan: {} }, minimum: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], pick_up: 1 };
const SP1: TomlTable = { id: "sp1", amount: 1200, conditions: ["logo"], insists: [], pay_days: [2, 2], pick_up: 1 };

/** The Background's draw: no board, a budget and an advance, both venues, both speakers, the caterer and the sponsor. */
const DRAW = { attendance: [50, 50], budget: [4000, 4000], advance: [1500, 1500], venue: 2, speaker: 2, caterer: 1, sponsor: 1 };

Given(
  literal(
    'the draw gives no board, "budget" [4000, 4000] and "advance" [1500, 1500], and the variant draws the venues "v1" (rooms "hall-a" and "hall-b") and "v2", the speakers "s1" (acceptance 1, condition "fee", fee 300) and "s2" (acceptance 1, no condition), the caterer "c1" (minimum 30) and the sponsor "sp1"',
  ),
  function (this: Context) {
    changePools(this, (pool) => {
      pool.venue = [structuredClone(V1), structuredClone(V2)];
      pool.speaker = structuredClone(SPEAKERS);
      pool.caterer = [structuredClone(C1)];
      pool.sponsor = [structuredClone(SP1)];
    });
    change(this, (configuration) => {
      configuration.draw = stringify(DRAW);
      const city = structuredClone(CITY) as unknown as { venues: TomlTable[]; passages: TomlTable[] };
      city.venues.push({ id: "v2", entrance: "v2-entrance", hours: "always", rooms: [{ id: "hall-2", seats: 90 }] });
      city.passages.push({ between: ["office", "v2-entrance"], length: 30, step_free: true }, { between: ["v2-entrance", "hall-2"], length: 1, step_free: true });
      configuration.city = stringify(city as unknown as TomlTable);
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

// The money drawn from the cheapest feasible plan.
Given(
  'the draw gives "budget_over_plan" [1.1, 1.1], "advance_over_deposits" [1.2, 1.2] and "break_even_share" [0.75, 0.75] instead of "budget", "advance" and "price_gap", and the target attendance 40',
  function (this: Context) {
    changeDraw(this, (draw) => {
      delete draw.budget;
      delete draw.advance;
      Object.assign(draw, { attendance: [40, 40], budget_over_plan: [1.1, 1.1], advance_over_deposits: [1.2, 1.2], break_even_share: [0.75, 0.75] });
    });
  },
);

Given(
  'the plan\'s venue costs 2000 with no ramp and "deposit_share" 0.3, its caterer charges 30 a head with "deposit_share" 0.25, its five speakers have no fee and no train, there is no agency, "helpers" is 2, the staying sponsors give 1000, and the attendees\' "payment_fee_share" is 0.04',
  function (this: Context) {
    changePools(this, (pool) => {
      Object.assign(pool.venue[0], { price: 2000, deposit_share: 0.3 });
      pool.caterer = [{ ...structuredClone(C1), deposit_share: 0.25 }];
      pool.speaker = [1, 2, 3, 4, 5].map((n) => ({ id: `s${n}`, title: `Talk ${n}`, draw: 1, fee: 0, home: "local", available: true, acceptance: 1, pick_up: 1 }));
      pool.sponsor = [{ ...structuredClone(SP1), amount: 1000 }];
    });
    changeDraw(this, (draw) => (draw.speaker = 5));
    change(this, (configuration) => {
      configuration.helpers = 2;
      configuration.attendees = stringify({ ...parse(configuration.attendees as string), payment_fee_share: 0.04 });
    });
  },
);

Then(
  "the variant line gives the plan's cost {int}, its early deposits {int}, the budget {int}, the advance {int} and the reference price {float}",
  function (this: Context, cost: number, deposits: number, budget: number, advance: number, reference: number) {
    const variant = drawnVariant(this);
    assert.deepEqual(
      { cost: variant.plan_cost, deposits: variant.early_deposits, budget: variant.budget, advance: variant.advance, reference: Math.round((variant.reference_price as number) * 100) / 100 },
      { cost, deposits, budget, advance, reference },
    );
    // The cost-covering price stands beside it: (3500 − 1170 − 1000) / 40.
    assert.equal(variant.cost_covering_price, 33.25);
  },
);

// The refusals: a key beside the one it replaces, and a range outside its bounds.
for (const [replaced, key, range] of [
  ["budget", "budget_over_plan", [1.1, 1.2]],
  ["advance", "advance_over_deposits", [1, 1.2]],
  ["price_gap", "break_even_share", [0.7, 0.8]],
  [undefined, "budget_over_plan", [0.9, 1.2]],
  [undefined, "advance_over_deposits", [0.5, 1]],
  [undefined, "break_even_share", [0.7, 1.2]],
] as const) {
  const written = `the draw gives ${replaced === undefined ? "" : `both "${replaced}" and `}"${key}" [${range.join(", ")}]`;
  congressChanges.push([
    literal(written),
    (setup) =>
      changeDraw(setup.context, (draw) => {
        // The Background's draw gives the budget and the advance: a range alone stands in place of what it replaces.
        if (replaced === undefined && key !== "break_even_share") delete draw[key === "budget_over_plan" ? "budget" : "advance"];
        if (replaced === "price_gap") draw.price_gap = [0.5, 0.5];
        draw[key] = [...range];
      }),
  ]);
}

// Overruns.
Given("the organiser's account has the ceiling {int}", function (this: Context, ceiling: number) {
  // The budget of the Background is the organiser's ceiling from the start.
  assert.equal(ceiling, 4000);
});

/** A rule set that commits from the organiser's account, and releases, as a list of money steps says, then ends. */
function committing(steps: readonly ({ commit: number; for: string } | { release: number })[]): RuleSet {
  return {
    start: () => {
      const queue = [...steps];
      const next = (): RuleStep => {
        const step = queue.shift();
        if (step === undefined) return { kind: "end" };
        if ("commit" in step) return { kind: "call", tool: "commit", arguments: { with: ORGANISER, amount: step.commit, for: step.for } };
        // Its commitments are numbered in the order recorded: k-1 onwards.
        return { kind: "call", tool: "release", arguments: { commitment: `k-${step.release}` } };
      };
      return { atStart: next, next, outcome: () => ({}) };
    },
  };
}

Given(
  'the world commits 3500 for "v1", then 900 for "c1", then releases "c1"\'s 900 and commits 900 for "c1" again, then commits 200 for "c1"',
  function (this: Context) {
    const steps = [{ commit: 3500, for: "v1" }, { commit: 900, for: "c1" }, { release: 2 }, { commit: 900, for: "c1" }, { commit: 200, for: "c1" }];
    // The sponsor's template is decided by this rule set, which has the tools commit and release.
    this.libraryScenario = { ...this.libraryScenario, ruleSets: { ...this.libraryScenario.ruleSets, committing: committing(steps) } };
    change(this, (configuration) => {
      const kinds = configuration.kinds as TomlTable;
      kinds.sponsor = { ...(kinds.sponsor as TomlTable), rules: "committing", tools: ["check_time", "commit", "release"], channels: [] };
    });
  },
);

Then('the money records two "unapproved_overrun": one with the committed total 4400 and one with the committed total 4600', function (this: Context) {
  const overruns = moneyLines(this, "unapproved_overrun");
  assert.deepEqual(
    overruns.map((line) => line.amount),
    [4400, 4600],
  );
});
