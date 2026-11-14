import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { type Money, moneyTools, startingMoney, withCommitment, withRelease } from "../src/engine/money.ts";
import { type Phone, phoneTools } from "../src/engine/phone.ts";
import type { Effector, Sensor } from "../src/engine/tools.ts";
import * as parts from "../src/scenarios/congress-parts.ts";
import type { Congress } from "../src/scenarios/congress.ts";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { catererRules, venueRules } from "../src/scenarios/congress-parties.ts";
import { calls, conversation, drive, tools, venueChange } from "./fixtures/rules.ts";
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

describe("an answered call keeps when it ended (FR-CONGRESS-13, FR-PHONE-01)", () => {
  it("records the world time its answer_call lands as the call's end", () => {
    const settings = { lines: ["ana", "desk"], ringMinutes: 5, callMinutes: 4, ring: "{from}" };
    const keeper = { of: (state: { phone: Phone }) => state.phone, with: (_state: { phone: Phone }, phone: Phone) => ({ phone }) };
    const answer = phoneTools({ settings, keeper, acts: {}, inHours: () => true }).find(({ name }) => name === "answer_call") as Effector<{ phone: Phone }>;
    const connected: Phone = { calls: [{ id: "c-1", from: "ana", to: "desk", act: "ask", fields: {}, status: "connected", answer: { act: "yes", fields: {} } }] };
    const world = { day: 2, weekday: "Tuesday" as const, seconds: 36000 };
    const after = answer.action?.effect({ phone: connected }, { agent: "desk", arguments: { call: "c-1", act: "yes" }, atMs: 0, world }) as { phone: Phone };
    expect(after.phone.calls[0]).toMatchObject({ status: "ended", outcome: "answered", endedAt: world });
  });
});

describe("one record of acts, mail and phone (FR-CONGRESS-13)", () => {
  /** A world with a mail delivered, one in transit, an answered call and a call nobody answered. */
  const state = {
    mail: {
      mailboxes: { s1: [{ id: "m-1", from: "organiser", to: "s1", act: "invite", fields: { session: 1 }, subject: "invite", sent: { day: 1, weekday: "Monday", seconds: 32400 }, received: { day: 1, weekday: "Monday", seconds: 32460 }, read: true }] },
      inTransit: [{ id: "m-2", from: "s1", to: "organiser", act: "accept", fields: { session: 1 }, subject: "accept", sent: { day: 1, weekday: "Monday", seconds: 36000 } }],
    },
    phone: {
      calls: [
        { id: "c-1", from: "organiser", to: "s2", act: "invite", fields: { session: 2 }, status: "ended", outcome: "answered", answer: { act: "accept", fields: { session: 2 } }, endedAt: { day: 1, weekday: "Monday", seconds: 34200 } },
        { id: "c-2", from: "organiser", to: "s3", act: "invite", fields: { session: 3 }, status: "ended", outcome: "no_answer" },
      ],
    },
  } as unknown as Congress;

  it("gives each mail and each act of an answered call, the caller's and the answer, with its sender, receiver, act, fields, world time and channel, in the order of their times", () => {
    const actsOf = (parts as Record<string, unknown>).actsOf as (state: Congress) => Record<string, unknown>[];
    expect(actsOf).toBeTypeOf("function");
    expect(actsOf(state).map(({ from, to, act, fields, at, channel }) => ({ from, to, act, fields, at, channel }))).toEqual([
      { from: "organiser", to: "s1", act: "invite", fields: { session: 1 }, at: 541, channel: "mail" },
      { from: "organiser", to: "s2", act: "invite", fields: { session: 2 }, at: 570, channel: "phone" },
      { from: "s2", to: "organiser", act: "accept", fields: { session: 2 }, at: 570, channel: "phone" },
      { from: "s1", to: "organiser", act: "accept", fields: { session: 1 }, at: 600, channel: "mail" },
    ]);
  });

  it("reads orders confirmed on a call as orders", () => {
    const ordersOf = (parts as Record<string, unknown>).ordersOf as (state: Congress) => { caterer: string; counts: Record<string, number> }[];
    expect(ordersOf).toBeTypeOf("function");
    const ordered = {
      ...state,
      mail: { mailboxes: {}, inTransit: [] },
      phone: { calls: [{ id: "c-1", from: "organiser", to: "c1", act: "order", fields: { counts: "standard: 40", date: "day 26", venue: "v1" }, status: "ended", outcome: "answered", answer: { act: "order_confirmed", fields: { total: 40 } }, endedAt: { day: 1, weekday: "Monday", seconds: 34200 } }] },
    } as unknown as Congress;
    expect(ordersOf(ordered).map(({ caterer, counts }) => ({ caterer, counts }))).toEqual([{ caterer: "c1", counts: { none: 40 } }]);
  });
});

describe("the venue change, once per replica, to the live booking (FR-CONGRESS-13)", () => {
  const at = (day: number, clock = "10:00") => ({ day, weekday: "Monday" as const, seconds: Number(clock.slice(0, 2)) * 3600 + Number(clock.slice(3)) * 60 });
  /** The congress with "v1" and "v2" and the venue change at day 8 10:00. */
  const loaded = () =>
    loadScenario(
      congress({ venue: 2 }, (configuration) => {
        const pools = parse(configuration.pools as string);
        pools.venue = [...(pools.venue as TomlTable[]), { ...(pools.venue as TomlTable[])[0], id: "v2", rooms: [{ id: "hall-2", seats: 90 }], price: 2500 }];
        configuration.pools = stringify(pools);
        const city = parse(configuration.city as string);
        city.venues = [...(city.venues as TomlTable[]), { id: "v2", entrance: "v2-entrance", hours: "always", rooms: [{ id: "hall-2", seats: 90 }] }];
        city.passages = [...(city.passages as TomlTable[]), { between: ["office", "v2-entrance"], length: 5, step_free: true }, { between: ["v2-entrance", "hall-2"], length: 1, step_free: true }];
        configuration.city = stringify(city);
        (configuration.perturbations as TomlTable).change = { between: ["day 8 10:00", "day 8 10:00"] };
      }),
      1,
    );
  /** A venue's mail to the organiser, delivered at a world time. */
  const mail = (from: string, act: string, fields: Record<string, unknown>, day: number) => ({ id: `m-${from}-${act}`, from, to: "organiser", act, fields, subject: act, received: at(day), read: true });

  it("is a component that, at its drawn time, records itself for the venue holding the live booking and tells only that venue", () => {
    const congressLoaded = loaded();
    const component = congressLoaded.components.find(({ name }) => name === "change");
    expect(component).toBeDefined();
    const state = {
      ...(congressLoaded.world.state as Congress),
      mail: {
        mailboxes: {
          organiser: [
            mail("v1", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "hall-a" }, 2),
            mail("v1", "confirmed", { contract: "v1-contract-1" }, 2),
            mail("v1", "cancelled", { contract: "v1-contract-1", charge: 0 }, 4),
            mail("v2", "contract", { contract: "v2-contract-1", date: "day 26", rooms: "hall-2" }, 4),
            mail("v2", "confirmed", { contract: "v2-contract-1" }, 4),
          ],
        },
        inTransit: [],
      },
    } as unknown as Congress;
    const cycle = component?.cycle(new Random(1));
    const step = cycle?.next(state as never, undefined, 0, at(8)) as { kind: string; action: { effect: (state: Congress, landing: unknown) => Congress } };
    expect(step.kind).toBe("action");
    expect(step.action.effect(state, { component: "change", atMs: 0, world: at(8) }).perturbations).toEqual([{ name: "change", target: "v2", at: 7 * 1440 + 600 }]);
    expect(cycle?.next(state as never, "success", 0, at(8))).toMatchObject({ kind: "deliver", agent: "v2", channel: "venue_change", held: false });
    expect(cycle?.next(state as never, "success", 0, at(8))).toEqual({ kind: "end" });
  });

  it("does nothing with no live booking, and gives no venue a change of its own", () => {
    const congressLoaded = loaded();
    const cycle = congressLoaded.components.find(({ name }) => name === "change")?.cycle(new Random(1));
    expect(cycle?.next(congressLoaded.world.state as never, undefined, 0, at(8))).toEqual({ kind: "end" });
    for (const venue of ["v1", "v2"]) {
      const params = (congressLoaded.participants ?? []).find(({ name }) => name === venue) as unknown as { params: { perturbations: { name: string }[] } };
      expect(params.params.perturbations.map(({ name }) => name)).not.toContain("change");
    }
  });

  it("a venue announces a change of its booking when the change reaches it, and none at a time of its own", () => {
    const venue = { id: "v1", rooms: [{ id: "hall-a", seats: 80 }], access_claim: "step-free", price: 2000, extras: {}, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }], pick_up: 1, organiser: "organiser", event_day: 26, floor_plan: [], perturbations: [] };
    const rules = venueRules.start(venue, new Random(1));
    conversation(rules, [
      ["day 1 Monday 09:01", "From: organiser. Act: book. date: day 26. rooms: hall-a. hours: 08:00-18:00."],
      ["day 1 Monday 09:02", "From: organiser. Act: accept_contract. contract: v1-contract-1."],
    ]);
    const steps = drive(rules, tools(() => "", () => "day 8 Monday 10:00"), [[venueChange()]], true);
    expect(calls(steps, "send_mail").map(({ act }) => act)).toEqual(["price_change"]);
  });
});

describe("cancellations settle their money (FR-CONGRESS-13)", () => {
  const settings = { accounts: [{ name: "ana", opening: 1000 }, { name: "v1", unlimited: true as const, tools: ["void_invoice"] }], discretionaryLimit: 300, durations: {} };
  const keeper = { of: (state: { money: Money }) => state.money, with: (_state: { money: Money }, money: Money) => ({ money }) };
  const tool = (name: string) => moneyTools(settings, keeper).find((each) => each.name === name) as Effector<{ money: Money }>;
  const land = (state: { money: Money }, name: string, agent: string, args: Record<string, unknown>) => tool(name).action?.effect(state, { agent, arguments: args, atMs: 0 }) as { money: Money };
  const issued = () => land({ money: startingMoney(settings) }, "issue_invoice", "v1", { to: "ana", amount: 600, due: "day 4", for: "deposit v1-contract-1" });

  it("voids an unpaid invoice its issuer voids: no longer due, and its pay refused as invalid_arguments, saying it was voided, before it takes any time", () => {
    const voided = land(issued(), "void_invoice", "v1", { invoice: "i-1" });
    expect(voided.money.invoices[0]).toMatchObject({ id: "i-1", paid: false, voided: true });
    expect(voided.money.events.at(-1)).toMatchObject({ kind: "void", from: "v1", to: "ana", invoice: "i-1", amount: 600 });
    expect(voided.money.balances.ana).toBe(1000);
    expect(tool("pay").refuses?.(voided, { agent: "ana", arguments: { invoice: "i-1" } })).toEqual({ outcome: "invalid_arguments", reason: expect.stringContaining("voided") });
    const ledger = JSON.parse((moneyTools(settings, keeper).find(({ name }) => name === "ledger") as Sensor<{ money: Money }>).sense(voided, "ana", {}, 0));
    expect(ledger.invoices_to_pay).toEqual([]);
  });

  it("returns what was paid against an invoice its issuer voids to whom paid it", () => {
    const paid = land(issued(), "pay", "ana", { invoice: "i-1" });
    expect(paid.money.balances.ana).toBe(400);
    const voided = land(paid, "void_invoice", "v1", { invoice: "i-1" });
    expect(voided.money.balances.ana).toBe(1000);
    expect(voided.money.events.at(-1)).toMatchObject({ kind: "refund", from: "v1", to: "ana", invoice: "i-1", amount: 600 });
  });

  /** A party's ledger with one invoice it issued for a contract or an order. */
  const ledgerWith = (id: string, what: string, paid: boolean) => () => ({ invoices_issued: [{ id, to: "organiser", amount: 600, due: "day 4", for: what, paid }] });

  it("a venue voids its contract's invoices as the contract is cancelled, by either side", () => {
    const venue = { id: "v1", rooms: [{ id: "hall-a", seats: 80 }], access_claim: "step-free", price: 2000, extras: {}, hold_days: 2, deposit_share: 0.3, deposit_due_days: 3, cancellation: [{ more_than_days: 14, share: 0 }, { share: 0.5 }], pick_up: 1, organiser: "organiser", event_day: 26, floor_plan: [], perturbations: [] };
    const { steps } = conversation(
      venueRules.start(venue, new Random(1)),
      [
        ["day 1 Monday 09:01", "From: organiser. Act: book. date: day 26. rooms: hall-a. hours: 08:00-18:00."],
        ["day 1 Monday 09:02", "From: organiser. Act: accept_contract. contract: v1-contract-1."],
        ["day 1 Monday 10:00", "From: organiser. Act: cancel_booking."],
      ],
      ledgerWith("i-1", "deposit v1-contract-1", true),
    );
    expect(calls(steps, "void_invoice")).toEqual([{ invoice: "i-1" }]);
  });

  it("a caterer voids its order's invoices as the order is cancelled", () => {
    const caterer = { id: "c1", price_per_head: 30, diets: {}, minimum: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0 }], pick_up: 1, organiser: "organiser", event_day: 26 };
    const { steps } = conversation(
      catererRules.start(caterer, new Random(1)),
      [
        ["day 2 Tuesday 09:00", "From: organiser. Act: order. counts: standard: 40. date: day 26."],
        ["day 3 Wednesday 09:00", "From: organiser. Act: cancel_order."],
      ],
      ledgerWith("i-2", "deposit order c1", false),
    );
    expect(calls(steps, "void_invoice")).toEqual([{ invoice: "i-2" }]);
  });
});
