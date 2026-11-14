import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { startingMoney, withCommitment, withRelease } from "../src/engine/money.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { congressScenario } from "../src/scenarios/congress.ts";

// FR-CONGRESS-13: the world's corrections from E1's third technical run.

/** A congress with one venue and five speakers, the draw given, and any keys changed. */
function congress(draw: TomlTable = {}, changes: (configuration: TomlTable) => void = () => {}): Scenario<unknown> {
  const configuration = parse(congressScenario.baseConfiguration);
  const venue = { id: "v1", rooms: [{ id: "hall-a", seats: 80 }], access_claim: "step-free", price: 2000, extras: { ramp: 200 }, hold_days: 2, deposit_share: 0.3, deposit_due_days: 3, cancellation: [{ share: 0.5 }] };
  const speakers = [1, 2, 3, 4, 5].map((n) => ({ id: `s${n}`, fee: 0, home: "local", available: true, acceptance: 1 }));
  const caterer = { id: "c1", price_per_head: 30, final_days: 7, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.3 }] };
  Object.assign(configuration, {
    city: stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "hall-a", seats: 80 }] }], passages: [{ between: ["office", "v1-entrance"], length: 5, step_free: true }, { between: ["v1-entrance", "hall-a"], length: 1, step_free: true }] }),
    pools: stringify({ topics: ["soil"], venue: [venue], board: [], speaker: speakers, partner: [], caterer: [caterer], sponsor: [{ id: "sp1", amount: 1000, conditions: ["logo"], pay_days: [2, 2] }], agency: [] }),
    draw: stringify({ attendance: [40, 40], venue: 1, speaker: 5, caterer: 1, sponsor: 1, ...draw }),
    attendees: stringify({ pool_factor: 1, base_per_day: 0, unannounced: 0, promotion_factor: 1, payment_fee_share: 0.04, diets: { none: 1 }, access: { none: 1 } }),
    helpers: 2,
  });
  (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
  changes(configuration);
  return { ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) };
}

describe("the money drawn from the cheapest feasible plan (FR-CONGRESS-13)", () => {
  const plan = { budget_over_plan: [1.1, 1.1], advance_over_deposits: [1.2, 1.2], break_even_share: [0.75, 0.75] };

  it("gives the plan's cost and early deposits, a budget and an advance as shares of them, and the reference price at which the plan breaks even", () => {
    const variant = loadScenario(congress(plan), 1).variant as Record<string, number>;
    // cost: 2000 + (40 + 5 + 2 + 3) × 30; deposits: 0.3 × 2000 + 0.25 × 1500; budget 1.1 × 3500; advance 1.2 × 975.
    expect(variant).toMatchObject({ plan_cost: 3500, early_deposits: 975, budget: 3850, advance: 1170, cost_covering_price: 33.25 });
    // At n = 30: (2000 + 40 × 30 − 1170 − 1000) / (30 × 0.96).
    expect(variant.reference_price).toBeCloseTo(1030 / 28.8, 10);
  });

  it("counts the ramp in the venue's cost and its deposit when the venue's interior has steps, and rounds the shares to whole numbers", () => {
    const variant = loadScenario(
      congress({ budget_over_plan: [1.15, 1.15], advance_over_deposits: [1.01, 1.01] }, (configuration) => {
        const city = parse(configuration.city as string);
        city.passages = (city.passages as TomlTable[]).map((passage) => ((passage.between as string[]).includes("hall-a") ? { ...passage, step_free: "3 steps" } : passage));
        configuration.city = stringify(city);
      }),
      1,
    ).variant as Record<string, number>;
    // cost 3700; deposits 0.3 × 2200 + 375 = 1035.
    expect(variant).toMatchObject({ plan_cost: 3700, early_deposits: 1035, budget: Math.round(3700 * 1.15), advance: Math.round(1035 * 1.01) });
  });

  it("refuses a key given beside the one it replaces, naming the second, and a range outside its bounds", () => {
    expect(() => loadScenario(congress({ budget: [4000, 4000], budget_over_plan: [1.1, 1.2] }), 1)).toThrow(/draw\.budget_over_plan/);
    expect(() => loadScenario(congress({ advance: [1500, 1500], advance_over_deposits: [1, 1.2] }), 1)).toThrow(/draw\.advance_over_deposits/);
    expect(() => loadScenario(congress({ price_gap: [0.5, 0.5], break_even_share: [0.7, 0.8] }), 1)).toThrow(/draw\.break_even_share/);
    expect(() => loadScenario(congress({ budget_over_plan: [0.9, 1.2] }), 1)).toThrow(/draw\.budget_over_plan/);
    expect(() => loadScenario(congress({ advance_over_deposits: [0.5, 1] }), 1)).toThrow(/draw\.advance_over_deposits/);
    expect(() => loadScenario(congress({ break_even_share: [0.7, 1.2] }), 1)).toThrow(/draw\.break_even_share/);
    expect(() => loadScenario(congress({ budget_over_plan: [1.3, 1.2] }), 1)).toThrow(/draw\.budget_over_plan/);
  });
});

describe("overruns only at a new high (FR-CONGRESS-13, FR-MONEY-01)", () => {
  it("adds an unapproved overrun only when a commitment takes the committed total above the limit and above every total before", () => {
    let money = startingMoney({ accounts: [{ name: "ana", opening: 0, ceiling: 4000 }, { name: "v1", unlimited: true }], discretionaryLimit: 300, durations: {} });
    const commit = (amount: number) => (money = withCommitment(money, { by: "v1", with: "ana", amount, for: "x" }, 300));
    commit(3500);
    commit(900);
    money = withRelease(money, "k-2");
    commit(900);
    commit(200);
    expect(money.events.filter(({ kind }) => kind === "unapproved_overrun").map(({ amount }) => amount)).toEqual([4400, 4600]);
    expect(money.overruns.map(({ committed }) => committed)).toEqual([4400, 4600]);
  });
});
