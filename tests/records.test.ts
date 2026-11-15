import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { type Money, moneyTools, readMoney } from "../src/engine/money.ts";
import { readCalendar } from "../src/engine/calendar.ts";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import type { Tool } from "../src/engine/tools.ts";
import { type Congress, congressScenario } from "../src/scenarios/congress.ts";

const at = (day: number, clock = "09:00") => {
  const [hours, minutes] = clock.split(":").map(Number);
  return { day, weekday: "Monday" as const, seconds: hours * 3600 + minutes * 60 };
};
const minutes = (day: number, clock = "09:00") => (day - 1) * 1440 + Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

describe("every money event keeps the world time it applied (FR-CONGRESS-06)", () => {
  it("stamps the events an effector adds with its landing's world time, as world minutes since day 1's midnight", () => {
    const calendar = readCalendar({ start: "day 1 Monday 09:00", segments: [{ scale: 60 }] });
    const settings = readMoney({ discretionary_limit: 300, accounts: { a: { opening: 100 }, b: { opening: 0 } } } as never, calendar, ["a", "b"]);
    const keeper = { of: (state: { money: Money }) => state.money, with: (state: { money: Money }, money: Money) => ({ ...state, money }) };
    const transfer = moneyTools(settings, keeper).find(({ name }) => name === "transfer") as Tool<{ money: Money }> & { kind: "effector" };
    const state = { money: { balances: { a: 100, b: 0 }, invoices: [], commitments: [], ceilings: {}, overruns: [], events: [] } as Money };
    const after = transfer.action?.effect(state, { agent: "a", arguments: { to: "b", amount: 10, for: "x" }, atMs: 0, world: at(2, "10:30") } as never) as { money: Money };
    expect(after.money.events).toEqual([{ kind: "transfer", from: "a", to: "b", amount: 10, for: "x", at: minutes(2, "10:30") }]);
  });
});

/** The congress with a train, a hotel near "v1", the speakers "s1" and "s2", two helpers, and its preparation ending on day 26 at 06:30. */
function congress(changes: (configuration: TomlTable) => void = () => {}) {
  const configuration = parse(congressScenario.baseConfiguration);
  configuration.city = stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "main-hall", seats: 100 }] }], passages: [{ between: ["office", "v1-entrance"], length: 10, step_free: true }] });
  configuration.calendar = { start: "day 1 Monday 09:00", segments: [{ scale: 60, until: "day 26 06:30" }, { scale: 60 }], hours: { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } } };
  configuration.travel = stringify({ stations: ["north"], trains: [{ id: "t1", from: "north", arrives: "08:10", price: 40 }], hotels: [{ id: "h1", near: "v1", rooms: 5, price: 90 }], sold_out_probability: 0 });
  configuration.pools = stringify({ topics: ["soil"], venue: [{ id: "v1", rooms: [{ id: "main-hall", seats: 100 }], access_claim: "step-free", price: 2000, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }], roles: ["false_claim"] }], board: [], speaker: ["s1", "s2"].map((id) => ({ id, fee: 0, available: true, acceptance: 1 })), partner: [], caterer: [], sponsor: [], agency: [] });
  configuration.draw = stringify({ attendance: [50, 50], venue: { roles: { false_claim: 1 } }, speaker: 2 });
  configuration.helpers = 2;
  changes(configuration);
  return loadScenario({ ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) }, 1);
}
const tool = (name: string) => congressScenario.tools.find((each) => each.name === name) as never as { action: { effect: (state: unknown, call: unknown) => Congress } };

describe("the congress's records for its parts (FR-CONGRESS-06)", () => {
  it("keeps what its parts read: the event's day, the helpers, the target, the end of preparation, the roles, the no-show cut and the discretionary limit", () => {
    const state = congress().world.state as Congress;
    expect(state.context).toEqual({ eventDay: 26, helpers: 2, target: 50, endOfPreparation: minutes(26, "06:30"), roles: { venue: { false_claim: ["v1"] } }, noShowCut: 0.05, discretionaryLimit: 300, homes: {}, catering: { v1: {} }, ids: { speakers: expect.arrayContaining(["s1", "s2"]), sponsors: [] }, fees: { s1: 0, s2: 0 }, diets: {}, opening: 0, start: minutes(1, "09:00") });
  });

  it("stamps a travel booking and a programme version with their world times", () => {
    const state = { ...(congress().world.state as Congress), money: { balances: { organiser: 1000, travel: null }, invoices: [], commitments: [], ceilings: {}, overruns: [], events: [] } } as unknown as Congress;
    const booked = tool("book_travel").action.effect(state, { agent: "organiser", arguments: { option: "t1 day 26", traveller: "s2" }, atMs: 0, world: at(3) });
    expect(booked.travel.booked).toEqual([{ option: "t1 day 26", traveller: "s2", price: 40, at: minutes(3) }]);
    expect(booked.money.events.every(({ at: when }) => when === minutes(3))).toBe(true);
    const withPage = congress((configuration) => (configuration.attendees = stringify({ pool_factor: 1, base_per_day: 0, unannounced: 0, promotion_factor: 1, payment_fee_share: 0, cancel_share: 0, consent_share: 1, diets: { none: 1 } }))).world.state;
    const published = tool("publish_programme").action.effect(withPage, { agent: "organiser", arguments: { sessions: [{ start: "10:00", end: "10:45", title: "t", speakers: ["s1"], room: "main-hall" }] }, atMs: 0, world: at(12) });
    expect(published.population?.programme[0].published).toBe(minutes(12));
  });

  it("records each perturbation as it fires: its name, its target and its world time", () => {
    const loaded = congress((configuration) => ((configuration.perturbations as TomlTable).early_cancel = { between: ["day 9 09:00", "day 9 09:00"] }));
    const [early] = loaded.components;
    const cycle = early.cycle(new Random(1));
    const confirmed = { ...(loaded.world.state as Congress), mail: { mailboxes: { s1: [{ id: "m-0", from: "organiser", to: "s1", act: "confirm", fields: {}, subject: "confirm", received: at(2), read: false }], organiser: ["accept", "acknowledged"].map((act, index) => ({ id: `m-${index + 1}`, from: "s1", to: "organiser", act, fields: {}, subject: act, received: at(2), read: false })) }, inTransit: [] } } as unknown as Congress;
    const step = cycle.next(confirmed as never, undefined, 0, at(9)) as { kind: string; action: { effect: (state: Congress, landing: unknown) => Congress } };
    expect(step.kind).toBe("action");
    expect(step.action.effect(confirmed, { component: "early_cancel", atMs: 0, world: at(9) }).perturbations).toEqual([{ name: "early_cancel", target: "s1", at: minutes(9) }]);
    expect(cycle.next(confirmed as never, "success", 0, at(9))).toEqual({ kind: "deliver", agent: "s1", channel: "early_cancel", held: false });
  });
});

describe("the records only the congress's parts read (FR-CONGRESS-06)", () => {
  it("records the organiser's visits, announcements and ticket prices with their world times, and gives its parts", () => {
    const loaded = congress((configuration) => {
      configuration.attendees = stringify({ pool_factor: 1, base_per_day: 0, unannounced: 0, promotion_factor: 1, payment_fee_share: 0, cancel_share: 0, consent_share: 1, diets: { none: 1 } });
      configuration.pools = stringify({ ...parse(configuration.pools as string), caterer: [{ id: "c9", price_per_head: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], in_house_for: "v1", diets: { vegan: {}, gluten_free: { limit: 3 } } }] });
      configuration.pools = stringify({ ...parse(configuration.pools as string), venue: [{ ...(parse(configuration.pools as string).venue as TomlTable[])[0], catering: "in_house" }], speaker: [{ id: "s1", fee: 0, available: true, acceptance: 1, home: "north" }, { id: "s2", fee: 0, available: true, acceptance: 1, home: "local" }] });
      configuration.kinds = { ...(configuration.kinds as TomlTable) };
    });
    const state = loaded.world.state as Congress;
    expect(state.context).toMatchObject({ homes: { s1: "north" }, catering: { v1: { rule: "in_house", inHouse: "c9" } } });
    // Each caterer's diets with their limits, as D5 reads them (FR-CONGRESS-20).
    expect(state.context.diets).toEqual({ c9: { vegan: {}, gluten_free: { limit: 3 } } });
    const goTo = congressScenario.tools.find((each) => each.name === "go") as never as { start: { effect: (state: unknown, call: unknown) => Congress }; action: { effect: (state: unknown, call: unknown) => Congress } };
    const call = { agent: "organiser", arguments: { place: "v1-entrance" }, atMs: 0, world: at(2, "10:00") };
    // The organiser leaves the office as its walk starts, and arrives as it ends.
    const visited = goTo.action.effect(goTo.start.effect(state, call), call);
    expect(visited.visits).toEqual([{ place: "v1-entrance", at: minutes(2, "10:00") }]);
    const announced = tool("announce").action.effect(state, { agent: "organiser", arguments: { audience: "registrants", kind: "change" }, atMs: 0, world: at(3) });
    expect(announced.population?.announcements).toEqual([{ audience: "registrants", kind: "change", at: minutes(3) }]);
    const priced = tool("edit_ticket_page").action.effect(state, { agent: "organiser", arguments: { price: 40 }, atMs: 0, world: at(4) });
    expect(priced.population?.edits).toEqual([{ price: 40, at: minutes(4) }]);
    expect(congressScenario.parts).toBeDefined();
  });
});
