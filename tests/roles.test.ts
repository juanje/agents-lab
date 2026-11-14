import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { congressScenario } from "../src/scenarios/congress.ts";

/** A venue template with its day price and one room of these seats. */
const venue = (id: string, price: number, seats: number, roles?: string[]) => ({ id, price, rooms: [{ id: `${id}-hall`, seats }], access_claim: "step-free", hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }], ...(roles === undefined ? {} : { roles }) });

/** The congress with these pools and draw, its city laying out each venue the pools have. */
function congress(pools: Record<string, TomlTable[]>, draw: TomlTable, changes: (configuration: TomlTable) => void = () => {}): Scenario<unknown> {
  const configuration = parse(congressScenario.baseConfiguration);
  const venues = (pools.venue ?? []).map(({ id }) => id as string);
  configuration.city = stringify({
    places: [{ id: "office" }],
    venues: venues.map((id) => ({ id, entrance: `${id}-entrance`, hours: "always", rooms: [{ id: `${id}-hall`, seats: 100 }] })),
    passages: venues.map((id) => ({ between: ["office", `${id}-entrance`], length: 10, step_free: true })),
  });
  (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
  configuration.pools = stringify({ topics: ["soil"], venue: [], board: [], speaker: [], partner: [], caterer: [], sponsor: [], agency: [], ...pools });
  configuration.draw = stringify({ attendance: [50, 50], ...draw });
  changes(configuration);
  return { ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) };
}

const VENUES = [venue("v1", 2000, 100, ["false_claim"]), venue("v2", 2000, 100, ["high_demand"]), venue("v3", 2000, 100), venue("v4", 2000, 100)];

describe("draws by role (FR-CONGRESS-01's addition)", () => {
  it("fills each role with distinct templates that carry it, then the count from templates with no role, and gives each role's templates in the variant", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const { variant } = loadScenario(congress({ venue: VENUES }, { venue: { count: 1, roles: { false_claim: 1, high_demand: 1 } } }), seed);
      expect((variant?.roles as Record<string, unknown>).venue).toEqual({ false_claim: ["v1"], high_demand: ["v2"] });
      const chosen = (variant?.chosen as Record<string, string[]>).venue;
      expect(chosen.slice(0, 2)).toEqual(["v1", "v2"]);
      expect(["v3", "v4"]).toContain(chosen[2]);
    }
  });

  it("fills a role from the variant's sequence, a template filling one role at most", () => {
    const both = ["s1", "s2", "s3"].map((id) => ({ id, fee: 0, available: true, acceptance: 1, roles: ["unavailable", "late"] }));
    const { variant } = loadScenario(congress({ speaker: both }, { speaker: { roles: { unavailable: 2, late: 1 } } }), 7);
    const { unavailable, late } = (variant?.roles as Record<string, Record<string, string[]>>).speaker;
    expect(new Set([...unavailable, ...late]).size).toBe(3);
    const again = loadScenario(congress({ speaker: both }, { speaker: { roles: { unavailable: 2, late: 1 } } }), 7).variant;
    expect(again?.roles).toEqual(variant?.roles);
  });

  it("prices the cheapest-fit role's venue at a share, drawn in cheapest_margin, of the cheapest other chosen venue whose rooms seat the target", () => {
    const pools = { venue: [venue("v1", 3000, 200, ["false_claim"]), venue("v2", 2000, 100), venue("v3", 1000, 30)] };
    for (let seed = 1; seed <= 10; seed += 1) {
      const loaded = loadScenario(congress(pools, { venue: { count: 2, roles: { false_claim: 1 }, cheapest_fit: "false_claim", cheapest_margin: [0.85, 0.95] } }), seed);
      const v1 = loaded.participants?.find(({ name }) => name === "v1");
      const price = v1?.decides === "rules" ? (v1.params.price as number) : 0;
      expect(price).toBeGreaterThanOrEqual(1700);
      expect(price).toBeLessThanOrEqual(1900);
    }
  });

  it("resolves a perturbation's for_role to the template that filled the role", () => {
    const sponsors = ["sp1", "sp2", "sp3"].map((id) => ({ id, amount: 500, conditions: ["logo"], pay_days: [2, 2], ...(id === "sp3" ? { roles: ["withdraws"] } : {}) }));
    const loaded = loadScenario(
      congress({ sponsor: sponsors }, { sponsor: { count: 1, roles: { withdraws: 1 } } }, (configuration) => ((configuration.perturbations as TomlTable).sponsor_withdraws = { at: "day 1 10:00", for_role: "withdraws" })),
      1,
    );
    const [component] = loaded.components;
    const cycle = component.cycle(new Random(1));
    const at = { day: 1, weekday: "Monday" as const, seconds: 10 * 3600 };
    expect(fired(cycle, {} as never, undefined, 0, at)).toEqual({ kind: "deliver", agent: "sp3", channel: "sponsor_withdraws", held: false });
  });
});

describe("the price gap (FR-CONGRESS-01's addition)", () => {
  it("sets the reference price to the cost-covering price over one plus the gap, and the similar events' prices to it × 0.8, 1 and 1.2", () => {
    const pools = {
      venue: [venue("v1", 2000, 60), venue("v2", 3000, 100), venue("v3", 500, 30)],
      caterer: [20, 30, 45].map((price, index) => ({ id: `c${index + 1}`, price_per_head: price, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }] })),
      speaker: [...[0, 50, 100, 100, 150, 200, 400].map((fee, index) => ({ id: `s${index + 1}`, fee, available: true, acceptance: 1 })), { id: "s8", fee: 0, available: false, acceptance: 1 }],
      board: [{ id: "board", funds: 1000 }],
      sponsor: [{ id: "sp1", amount: 600, conditions: ["logo"], pay_days: [2, 2] }, { id: "sp2", amount: 400, conditions: ["logo"], pay_days: [2, 2] }],
    };
    const similar = { events: [1, 2, 3].map((n) => ({ topic: "soil", name: `e${n}`, price: 100 * n, size: 50 * n })) };
    const loaded = loadScenario(
      congress(pools, { venue: 3, speaker: 8, caterer: 3, board: 1, sponsor: 2, price_gap: [0.5, 0.5] }, (configuration) => (configuration.similar_events = stringify(similar))),
      1,
    );
    // From a cheapest feasible plan (FR-CONGRESS-11): (2000 + 58 × 45 + 400 − 1000 − 1000) / 50.
    expect(loaded.variant).toMatchObject({ cost_covering_price: 60.2, price_gap: 0.5 });
    expect((loaded.variant as { reference_price: number }).reference_price).toBeCloseTo(60.2 / 1.5);
    expect((loaded.world.state as { similar: { name: string; price: number; size: number }[] }).similar.map(({ price }) => Math.round(price * 100) / 100)).toEqual([32.11, 40.13, 48.16]);
  });

  it("keeps the cost-covering price at least 1", () => {
    const loaded = loadScenario(congress({ venue: [venue("v1", 100, 60)], board: [{ id: "board", funds: 100000 }] }, { venue: 1, board: 1, price_gap: [0.25, 0.25] }), 1);
    expect(loaded.variant).toMatchObject({ cost_covering_price: 1, reference_price: 0.8 });
  });
});

describe("refusals of draws by role (FR-CONGRESS-01's addition)", () => {
  const refusing = (pools: Record<string, TomlTable[]>, draw: TomlTable, changes?: (configuration: TomlTable) => void) => () => loadScenario(congress(pools, draw, changes), 1);

  it("refuses, naming it, a role asked for more often than the pool carries it, a cheapest_margin or price_gap it cannot follow, and a for_role no draw fills", () => {
    expect(refusing({ venue: VENUES }, { venue: { roles: { false_claim: 2 } } })).toThrow(/role "false_claim".*1 template/);
    expect(refusing({ venue: VENUES }, { venue: { count: 1, cheapest_margin: [0.95, 0.85] } })).toThrow(/cheapest_margin.*two numbers/);
    expect(refusing({ venue: VENUES }, { venue: 1, price_gap: [0, 0.5] })).toThrow(/price_gap.*two numbers/);
    expect(refusing({ venue: VENUES }, { venue: 1 }, (configuration) => ((configuration.perturbations as TomlTable).change = { at: "day 2 10:00", for_role: "ghost" }))).toThrow(/for_role.*"ghost".*no draw fills/);
  });
});

/** A perturbation's next steps as it fires: it records itself, then delivers (FR-CONGRESS-06). */
function fired(cycle: { next: (...args: never[]) => unknown }, ...args: unknown[]): unknown {
  const recorded = (cycle.next as (...given: unknown[]) => { kind: string })(...args);
  if (recorded.kind !== "action") return recorded;
  const [state, , ...rest] = args;
  return (cycle.next as (...given: unknown[]) => unknown)(state, "success", ...rest);
}
