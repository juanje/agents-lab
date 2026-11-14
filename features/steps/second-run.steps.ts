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
