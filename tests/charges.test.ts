import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import type { Money } from "../src/engine/money.ts";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import type { Stimulus } from "../src/engine/stimuli.ts";
import { catererRules, speakerRules, sponsorRules, venueRules } from "../src/scenarios/congress-parties.ts";
import { congressScenario } from "../src/scenarios/congress.ts";
import { calls, conversation, drive, tools } from "./fixtures/rules.ts";

const DAY = "day 1 Monday 09:01";
const on = (day: number, clock = "09:00") => {
  const [hours, minutes] = clock.split(":").map(Number);
  return { day, weekday: "Monday" as const, seconds: hours * 3600 + minutes * 60 };
};

/** The congress with the train "t1" (40) and the hotel "h1" near "v1" (14 rooms, 90), the speaker "s2", and the discretionary limit 300. */
function congress(changes: (configuration: TomlTable) => void = () => {}): Scenario<unknown> {
  const configuration = parse(congressScenario.baseConfiguration);
  configuration.city = stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "hall", seats: 100 }] }], passages: [{ between: ["office", "v1-entrance"], length: 10, step_free: true }] });
  (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
  configuration.travel = stringify({ stations: ["north"], trains: [{ id: "t1", from: "north", arrives: "08:10", price: 40 }], hotels: [{ id: "h1", near: "v1", rooms: 14, price: 90 }], sold_out_probability: 0 });
  configuration.pools = stringify({ topics: ["soil"], venue: [], board: [], speaker: [{ id: "s2", fee: 0, available: true, acceptance: 1 }], partner: [], caterer: [], sponsor: [], agency: [] });
  configuration.draw = stringify({ attendance: [50, 50], speaker: 1 });
  changes(configuration);
  return { ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) };
}

const tool = (name: string) => congressScenario.tools.find((each) => each.name === name) as never as { sense: (...args: unknown[]) => string; action: { effect: (...args: unknown[]) => unknown } };
type World = { money: Money; travel: { booked: { option: string; traveller: string }[] } };
const withMoney = (state: unknown, money: Partial<Money> = {}) => ({ ...(state as object), money: { balances: { organiser: 5000, travel: null }, invoices: [], commitments: [], ceilings: {}, overruns: [], events: [], ...money } }) as unknown as World;

describe("every charge a commitment (FR-CONGRESS-05's addition)", () => {
  it("book_travel has the travel's account commit the price with the organiser before it invoices it, so it counts toward overruns", () => {
    const state = withMoney(loadScenario(congress(), 1).world.state, { ceilings: { organiser: 30 } });
    const after = tool("book_travel").action.effect(state, { agent: "organiser", arguments: { option: "t1 day 26", traveller: "s2" }, atMs: 0, world: on(1) }) as World;
    expect(after.money.events.map(({ kind }) => kind)).toEqual(["commitment", "unapproved_overrun", "invoice"]);
    expect(after.money.commitments).toEqual([{ id: "k-1", by: "travel", with: "organiser", amount: 40, for: "t1 day 26 s2", released: false }]);
    expect(after.money.overruns).toEqual([{ commitment: "k-1", account: "organiser", committed: 40, limit: 30 }]);
  });

  it("a caterer commits a cancellation's charge as it invoices it", () => {
    const rules = catererRules.start({ id: "c1", price_per_head: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], organiser: "organiser", event_day: 26 }, new Random(1));
    const { steps } = conversation(rules, [[DAY, "From: organiser. Act: order. counts: standard: 60. date: day 26."], [DAY, "From: organiser. Act: cancel_order."]], () => ({ commitments_recorded: [{ id: "k-1", for: "order c1", amount: 1800 }] }));
    const after = steps.slice(steps.findIndex((step) => step.kind === "call" && step.tool === "release"));
    expect(after.flatMap((step) => (step.kind === "call" && ["release", "commit", "issue_invoice"].includes(step.tool) ? [[step.tool, step.arguments]] : []))).toEqual([
      ["release", { commitment: "k-1" }],
      ["commit", { with: "organiser", amount: 540, for: "cancellation order c1" }],
      ["issue_invoice", { to: "organiser", amount: 540, due: "day 1", for: "cancellation order c1" }],
    ]);
  });

  it("a venue commits a cancellation's charge as it invoices it", () => {
    const venue = { id: "v1", rooms: [{ id: "hall", seats: 100 }], access_claim: "step-free", price: 2000, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }], organiser: "organiser", event_day: 26, floor_plan: [], perturbations: [] };
    const { steps } = conversation(venueRules.start(venue, new Random(1)), [
      [DAY, "From: organiser. Act: book. date: day 26. rooms: hall. hours: 08:00-18:00."],
      [DAY, "From: organiser. Act: accept_contract. contract: v1-contract-1."],
      [DAY, "From: organiser. Act: cancel_booking."],
    ]);
    expect(calls(steps, "commit").at(-1)).toEqual({ with: "organiser", amount: 1000, for: "cancellation v1-contract-1" });
    expect(calls(steps, "issue_invoice").at(-1)).toEqual({ to: "organiser", amount: 1000, due: "day 1", for: "cancellation v1-contract-1" });
  });
});

describe("hotels and the overbooked night (FR-CONGRESS-05's addition)", () => {
  it("leaves rooms × days left / 14 of a hotel, rounded down, in the last 14 days before a night, less those booked", () => {
    const state = loadScenario(congress(), 1).world.state;
    const left = (day: number) => JSON.parse(tool("travel_options").sense(state, "organiser", { from: "north", date: "day 26" }, 0, on(day))).hotels[0].rooms_left;
    expect([left(5), left(11), left(18), left(24)]).toEqual([14, 14, 7, 1]);
  });

  it("hotel_overbooks is a perturbation component that, at its time, cancels the rooms booked for the night before the event, releasing their commitments, and tells each traveller it hits, not held", () => {
    const loaded = loadScenario(congress((configuration) => ((configuration.perturbations as TomlTable).hotel_overbooks = { at: "day 25 21:00" })), 1);
    const [component] = loaded.components;
    expect([component.name, component.kind]).toEqual(["hotel_overbooks", "perturbation"]);
    const booked = tool("book_travel").action.effect(withMoney(loaded.world.state), { agent: "organiser", arguments: { option: "h1 day 25", traveller: "s2" }, atMs: 0, world: on(1) }) as World;
    const cycle = component.cycle(new Random(1));
    expect(cycle.next(booked as never, undefined, 0, on(25, "20:00")).kind).toBe("wait");
    const step = cycle.next(booked as never, undefined, 0, on(25, "21:00")) as { kind: string; action: { precondition: (...args: unknown[]) => unknown; effect: (...args: unknown[]) => World } };
    expect(step.kind).toBe("action");
    const after = step.action.effect(booked, { component: "hotel_overbooks", atMs: 0, world: on(25, "21:00") });
    expect(after.travel.booked).toEqual([]);
    expect(after.money.commitments[0].released).toBe(true);
    expect(after.money.events.at(-1)).toMatchObject({ kind: "release", from: "organiser", to: "travel", amount: 90 });
    expect(cycle.next(after as never, "success", 0, on(25, "21:00"))).toEqual({ kind: "deliver", agent: "s2", channel: "hotel_overbooks", held: false });
    expect(cycle.next(after as never, undefined, 0, on(25, "21:00"))).toEqual({ kind: "end" });
  });

  it("a speaker the overbooking hits calls the organiser with no_room, and mails it when the call is not answered", () => {
    const overbooked: Stimulus = { channel: "hotel_overbooks", source: "hotel", content: "Your hotel room is cancelled: the hotel is overbooked." };
    for (const [outcome, mailed] of [
      ["no_answer", true],
      ["success", false],
    ] as const) {
      const rules = speakerRules.start({ id: "s2", fee: 0, available: true, acceptance: 1, organiser: "organiser", event_day: 26 }, new Random(1));
      const answer = (name: string, args: Record<string, unknown>) => (name === "call" ? { outcome, text: "x" } : tools(() => "")(name, args));
      drive(rules, answer);
      const steps = drive(rules, answer, [[overbooked]], true);
      expect(calls(steps, "call")).toEqual([{ to: "organiser", act: "no_room" }]);
      expect(calls(steps, "send_mail")).toEqual(mailed ? [{ to: "organiser", act: "no_room", fields: {} }] : []);
    }
  });
});

describe("a sponsor's dispute and the consented list (FR-CONGRESS-05's addition)", () => {
  const sp1 = { id: "sp1", amount: 1200, conditions: ["logo", "morning_slot"], insists: [], counter_acceptance: 1, pay_days: [2, 2], organiser: "organiser" };

  it("disputes an invoice above its agreed amount, with the amount it agreed, and pays nothing", () => {
    const rules = sponsorRules.start(sp1, new Random(1));
    const ledger = () => ({ invoices_to_pay: [{ id: "i-1", from: "organiser", amount: 1500, due: "day 10", for: "sponsorship", paid: false }] });
    conversation(rules, [[DAY, "From: organiser. Act: accept_sponsorship. conditions: logo, morning_slot."]], ledger);
    const steps = drive(rules, tools(() => "", undefined, ledger), [[{ channel: "invoice_notice", source: "organiser", content: "New invoice" }]], true);
    expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "invoice_disputed", fields: { invoice: "i-1", amount: 1200 } }]);
    expect(steps.some((step) => step.kind === "wait")).toBe(false);
  });

  it("takes a counter with the condition consented_list", () => {
    const { steps } = conversation(sponsorRules.start(sp1, new Random(1)), [[DAY, "From: organiser. Act: counter. conditions: logo, consented_list."]]);
    expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "agreement", fields: { amount: 1200, conditions: "logo, consented_list" } }]);
  });

  it("is a condition a sponsor template may give", () => {
    const configuration = (template: TomlTable) => congress((each) => (each.pools = stringify({ ...parse(each.pools as string), sponsor: [template] })));
    expect(() => loadScenario(configuration({ id: "sp9", amount: 100, conditions: ["consented_list"], pay_days: [1, 2] }), 1)).not.toThrow();
  });
});
