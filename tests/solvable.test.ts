import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RuleSet } from "../src/engine/participants.ts";
import { Random } from "../src/engine/random.ts";
import { run } from "../src/engine/run.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import * as parties from "../src/scenarios/congress-parties.ts";
import { postScenario } from "./fixtures/post.ts";
import { drive, tools } from "./fixtures/rules.ts";

// FR-CONGRESS-21: a replica the organiser can complete, in more than one way.

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** World minutes as a party reads them, "day <n> <weekday> HH:MM", day 1 a Monday. */
const timeText = (at: number, _weekdayOfDayOne = 0) => {
  const day = Math.floor(at / 1440);
  const within = Math.floor(at - day * 1440);
  const two = (value: number) => String(value).padStart(2, "0");
  return `day ${day + 1} ${WEEKDAYS[day % 7]} ${two(Math.floor(within / 60))}:${two(within % 60)}`;
};

/** World minutes of "day <n> HH:MM". */
const minutes = (text: string) => {
  const [, day, clock] = /^day (\d+) (\d\d:\d\d)$/.exec(text) as RegExpExecArray;
  return (Number(day) - 1) * 1440 + Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
};

describe("a rule set's sequences of its own (FR-CONGRESS-21)", () => {
  it("gives a rule set, beside its own sequence, a sequence for each purpose, from the seed and '<purpose> of <name>'", async () => {
    const drawn: number[] = [];
    const ruleSet: RuleSet = {
      start: (_params, _random, ...more: unknown[]) => {
        const sequence = more[0] as ((purpose: string) => Random) | undefined;
        if (sequence !== undefined) drawn.push(sequence("enquiries").next(), sequence("enquiries").next());
        return { next: () => ({ kind: "end" }), outcome: () => ({}) };
      },
    };
    const base = postScenario.baseConfiguration.replace('agents = ["ana", "ben"]', 'agents = ["ana"]');
    const scenario: Scenario<unknown> = { ...(postScenario as Scenario<unknown>), ruleSets: { echo: ruleSet }, baseConfiguration: `${base}\n[participants.desk]\ndecides = "rules"\nrules = "echo"\ntools = ["check_mail"]\nchannels = []\n` };
    const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));
    await run(loadScenario(scenario, 7), [{ name: "ana", model: new ScriptedModel([{ text: "Done.", delayMs: 0 }]), activations: 1 }], 7, { modelTurnTimeoutMs: 10_000, thinkingLevel: "off", compaction: { enabled: false }, parallelismLimit: 4, timeLimitMs: 2_000, logDirectory });
    // Each purpose's sequence starts afresh, the same each time it is asked for.
    const expected = Random.derive(7, "enquiries of desk").next();
    expect(drawn).toEqual([expected, expected]);
  });
});

describe("a venue's other customers, on a sequence of their own (FR-CONGRESS-21)", () => {
  const otherCustomers = (parties as Record<string, unknown>).otherCustomers as ((random: Random, from: number, rate: number) => Iterator<{ at: number; books: boolean }>) | undefined;

  it("gives each enquiry's time, an interval drawn at the rate a day after the one before, and whether it books, drawn after it", () => {
    expect(otherCustomers).toBeTypeOf("function");
    const enquiries = (otherCustomers as NonNullable<typeof otherCustomers>)(Random.derive(3, "enquiries of v1"), minutes("day 1 09:00"), 2);
    const random = Random.derive(3, "enquiries of v1");
    let at = minutes("day 1 09:00");
    for (let count = 0; count < 5; count += 1) {
      at += (-Math.log(1 - random.next()) / 2) * 1440;
      expect(enquiries.next().value).toEqual({ at, books: random.next() < 0.5 });
    }
  });

  /** A venue of one room whose other customers enquire twice a day, its event day free. */
  const venue = { id: "v1", rooms: [{ id: "hall-a", seats: 90 }], access_claim: "step-free", catering: "outside_free", price: 2000, extras: {}, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }], pick_up: 1, organiser: "organiser", event_day: 26, floor_plan: [], perturbations: [], mail_delivery_minutes: [1, 1], enquiries_per_day: 2 };

  /** The enquiries a venue records, started with its own sequence and the sequences for purposes of a seed, when it reads each time late by some minutes. */
  function recorded(ownSeed: number, late: number): { at: string; event: string }[] {
    const rules = venueRulesStart(ownSeed);
    let now = minutes("day 1 09:00");
    const time = () => timeText(now, 0);
    const steps = drive(rules, tools(() => "", time));
    for (let wakes = 0; wakes < 6; wakes += 1) {
      const wait = [...steps].reverse().find((step) => step.kind === "wait");
      if (wait === undefined || wait.kind !== "wait") break;
      now += wait.minutes + late;
      steps.push(...drive(rules, tools(() => "", time), [[]], true));
    }
    return (JSON.parse(String(rules.outcome().history)) as { at: string; event: string }[]).filter(({ event }) => event === "enquiry" || event === "booked_by_other" || event === "left_free");
  }
  const venueRulesStart = (ownSeed: number) => (parties.venueRules.start as (params: unknown, random: Random, sequence: (purpose: string) => Random) => ReturnType<RuleSet["start"]>)(venue, new Random(ownSeed), (purpose) => Random.derive(5, `${purpose} of v1`));

  it("records each enquiry at its drawn time, and whether it books, whatever its own sequence and however late it reads the time", () => {
    const onTime = recorded(1, 0);
    expect(onTime.filter(({ event }) => event === "enquiry").length).toBeGreaterThan(0);
    expect(recorded(2, 0)).toEqual(onTime);
    const late = recorded(1, 30);
    const both = Math.min(late.length, onTime.length);
    expect(both).toBeGreaterThan(2);
    expect(late.slice(0, both)).toEqual(onTime.slice(0, both));
    // The first enquiry is at the first interval drawn from "enquiries of v1".
    const first = (-Math.log(1 - Random.derive(5, "enquiries of v1").next()) / 2) * 1440;
    expect(onTime[0]).toEqual({ at: timeText(minutes("day 1 09:00") + first, 0), event: "enquiry", date: "day 26" });
  });

  it("counts its other customers from the run's start, starts_at, however late it first reads the time", () => {
    const rules = (parties.venueRules.start as (params: unknown, random: Random, sequence: (purpose: string) => Random) => ReturnType<RuleSet["start"]>)({ ...venue, starts_at: minutes("day 1 09:00") }, new Random(1), (purpose) => Random.derive(5, `${purpose} of v1`));
    const steps = drive(rules, tools(() => "", () => "day 1 Monday 09:05"));
    const first = (-Math.log(1 - Random.derive(5, "enquiries of v1").next()) / 2) * 1440;
    const wait = [...steps].reverse().find((step) => step.kind === "wait");
    expect(wait).toEqual({ kind: "wait", minutes: minutes("day 1 09:00") + first - minutes("day 1 09:05") });
  });
});

/** The solvability module's plans of an input, or undefined while there is none. */
async function plansOfModule(): Promise<((input: unknown) => Solved) | undefined> {
  const loaded = (await import("../src/scenarios/solvability.ts").catch(() => ({}))) as Record<string, unknown>;
  return loaded.plansOf as ((input: unknown) => Solved) | undefined;
}

/** What the check gives: its plans, the counts of each check on its own, and the global solutions. */
interface Solved {
  plans: { venue: string; room: string; ramp: boolean; orders: { caterer: string; counts: Record<string, number>; permits: { diet?: string; price: number }[] }[]; speakers: { id: string; session: string; fee: number; train?: string; hotel?: string }[]; price: number; cost: number }[];
  counts: Record<string, number>;
  solutions: number;
  venues: string[];
  cheapest?: { cost: number; venue: string };
}

/**
 * A replica's parties: one venue "v1" (room "hall" of 90 seats, 2000 a day, step-free, outside catering free), eight
 * plain local speakers with a draw of 1, the caterer "c1" (30 a head, every diet), a target of 50, 2 helpers, a budget
 * of 20000, a reference price of 40 and a demand of a pool of twice the target at 0.2 a day.
 */
function input(change: (given: Record<string, any>) => void = () => {}): Record<string, any> {
  const given: Record<string, any> = {
    seed: 1,
    target: 50,
    helpers: 2,
    budget: 20000,
    eventDay: 26,
    startsAt: minutes("day 1 09:00"),
    endOfPreparation: minutes("day 26 06:30"),
    referencePrice: 40,
    venues: [{ id: "v1", price: 2000, rooms: [{ id: "hall", seats: 90 }], extras: {}, catering: "outside_free", entrance: "v1-entrance", interior: [{ between: ["v1-entrance", "hall"], step_free: true }] }],
    caterers: [{ id: "c1", price_per_head: 30, diets: { vegan: {}, gluten_free: {} } }],
    speakers: Array.from({ length: 8 }, (_, index) => ({ id: `s${index + 1}`, fee: 0, home: "local", available: true, accepts: true, draw: 1 })),
    sponsorMorning: false,
    partners: 0,
    trains: [],
    hotels: [],
    attendees: { pool_factor: 2, base_per_day: 0.2, unannounced: 0.5, promotion_factor: 1, payment_fee_share: 0, cancel_share: 0, consent_share: 1, pay_share: 1, diets: { none: 1 }, access: { none: 1 }, fixed: [] },
  };
  change(given);
  return given;
}

describe("the solvability check's plans (FR-CONGRESS-21)", () => {
  it("gives the plans that meet every check: a venue's room, its orders, six speakers and a price, within the budget", async () => {
    const plansOf = await plansOfModule();
    expect(plansOf).toBeTypeOf("function");
    const solved = (plansOf as NonNullable<typeof plansOf>)(input());
    // Six of eight speakers: 28 sets, one venue room, one order.
    expect(solved.solutions).toBe(28);
    expect(solved.venues).toEqual(["v1"]);
    const [plan] = solved.plans;
    // 2000 for its one room, and (50 + 6 + 3 + 2) × 30 for the food.
    expect(plan).toMatchObject({ venue: "v1", room: "hall", ramp: false, orders: [{ caterer: "c1", counts: { standard: 61 }, permits: [] }], cost: 2000 + 61 * 30 });
    expect(plan.speakers).toHaveLength(6);
    expect(solved.cheapest).toEqual({ cost: 2000 + 61 * 30, venue: "v1" });
    for (const check of ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"]) expect(solved.counts[check], check).toBeGreaterThan(0);
  });

  it("gives each plan the highest whole price at which the expected paying registrants reach 0.75 of the target, and none when even the lowest does not", async () => {
    const plansOf = (await plansOfModule()) as NonNullable<Awaited<ReturnType<typeof plansOfModule>>>;
    const [plan] = plansOf(input()).plans;
    expect(plan.price).toBeGreaterThan(40);
    const low = plansOf(input((given) => (given.attendees.base_per_day = 0.001)));
    expect(low.solutions).toBe(0);
    expect(low.counts.D1).toBe(0);
  });

  it("leaves out a room that does not seat the target, the six speakers, the 3 members and the helpers", async () => {
    const plansOf = (await plansOfModule()) as NonNullable<Awaited<ReturnType<typeof plansOfModule>>>;
    const solved = plansOf(input((given) => (given.venues[0].rooms = [{ id: "hall", seats: 60 }, { id: "big", seats: 61 }])));
    expect(new Set(solved.plans.map(({ room }) => room))).toEqual(new Set(["big"]));
    // Its price is its share of the day's by seats.
    expect(solved.plans[0].cost).toBe(Math.round((2000 * 61) / 121) + 61 * 30);
  });

  it("leaves out a venue its other customers book before day 7 18:00, or that is booked by others on the event day", async () => {
    const plansOf = (await plansOfModule()) as NonNullable<Awaited<ReturnType<typeof plansOfModule>>>;
    expect(plansOf(input((given) => (given.venues[0].booked_by_others = ["day 26"]))).counts.D0).toBe(0);
    // A seed whose first booking enquiry, at 0.5 a day, comes before day 7 18:00, and one whose comes after.
    const booking = (seed: number) => {
      const random = Random.derive(seed, "enquiries of v1");
      let at = minutes("day 1 09:00");
      for (;;) {
        at += (-Math.log(1 - random.next()) / 0.5) * 1440;
        if (random.next() < 0.5) return at;
      }
    };
    const early = [...Array(50).keys()].map((n) => n + 1).find((seed) => booking(seed) < minutes("day 7 18:00")) as number;
    const late = [...Array(50).keys()].map((n) => n + 1).find((seed) => booking(seed) > minutes("day 7 18:00")) as number;
    expect(plansOf(input((given) => Object.assign(given, { seed: early }, { venues: [{ ...given.venues[0], enquiries_per_day: 0.5 }] }))).counts.D0).toBe(0);
    expect(plansOf(input((given) => Object.assign(given, { seed: late }, { venues: [{ ...given.venues[0], enquiries_per_day: 0.5 }] }))).counts.D0).toBe(1);
  });

  it("books the ramp when an attendee has an access need and the room, the toilets or the catering area is behind steps; none without the extra", async () => {
    const plansOf = (await plansOfModule()) as NonNullable<Awaited<ReturnType<typeof plansOfModule>>>;
    const stepped = (given: Record<string, any>) => {
      given.venues[0].rooms.push({ id: "v1-toilets", seats: 0 });
      given.venues[0].interior.push({ between: ["hall", "v1-toilets"], step_free: "3 steps" });
    };
    expect(plansOf(input(stepped)).plans.every(({ ramp }) => !ramp)).toBe(true);
    const wheelchair = (given: Record<string, any>) => {
      stepped(given);
      given.attendees.fixed = [{ id: "a-wheelchair", access: "wheelchair", between: ["day 9 00:00", "day 17 23:59"] }];
    };
    expect(plansOf(input(wheelchair)).counts.D4).toBe(0);
    const withRamp = plansOf(
      input((given) => {
        wheelchair(given);
        given.venues[0].extras = { ramp: 100 };
      }),
    );
    expect(withRamp.plans.length).toBeGreaterThan(0);
    expect(withRamp.plans.every(({ ramp, cost }) => ramp && cost === 2000 + 100 + 61 * 30)).toBe(true);
  });

  it("covers each diet, the target × its share rounded up, with a second caterer for what the first cannot serve within its limits", async () => {
    const plansOf = (await plansOfModule()) as NonNullable<Awaited<ReturnType<typeof plansOfModule>>>;
    const diets = (given: Record<string, any>) => {
      given.attendees.diets = { none: 0.9, gluten_free: 0.1 };
      given.caterers = [
        { id: "c1", price_per_head: 30, diets: { gluten_free: { limit: 2 } } },
        { id: "c2", price_per_head: 40, diets: { gluten_free: {} } },
      ];
    };
    const solved = plansOf(input(diets));
    const orders = new Set(solved.plans.map(({ orders: each }) => JSON.stringify(each.map(({ caterer, counts }) => [caterer, counts]))));
    // 5 gluten-free of 61: c2 alone, or c1 with 2 and c2 with 3.
    expect(orders).toEqual(new Set([JSON.stringify([["c2", { standard: 56, gluten_free: 5 }]]), JSON.stringify([["c1", { standard: 56, gluten_free: 2 }], ["c2", { gluten_free: 3 }]])]));
    // A caterer's minimum leaves out a second order below it.
    const minimum = plansOf(input((given) => (diets(given), (given.caterers[1].minimum = 10))));
    expect(minimum.plans.every(({ orders: each }) => each.length === 1)).toBe(true);
  });

  it("at an in_house venue, takes its own caterer, and an outside order with the venue's permit for a diet its caterer serves only in part", async () => {
    const plansOf = (await plansOfModule()) as NonNullable<Awaited<ReturnType<typeof plansOfModule>>>;
    const solved = plansOf(
      input((given) => {
        given.target = 70;
        given.attendees.diets = { none: 0.9, gluten_free: 0.1 };
        Object.assign(given.venues[0], { catering: "in_house", outside_diet_fee_per_head: 3 });
        given.caterers = [
          { id: "c1", price_per_head: 30, diets: { gluten_free: {} } },
          { id: "c9", price_per_head: 25, diets: { gluten_free: { limit: 5 } }, in_house_for: "v1" },
        ];
      }),
    );
    expect(solved.plans.length).toBeGreaterThan(0);
    for (const { orders } of solved.plans) {
      expect(orders).toEqual([
        { caterer: "c9", counts: { standard: 74, gluten_free: 5 }, permits: [] },
        { caterer: "c1", counts: { gluten_free: 2 }, permits: [{ diet: "gluten_free", price: 6 }] },
      ]);
    }
  });

  it("at an outside_fee venue, pays the venue's fee a head with its permit for an outside caterer, and none for its own", async () => {
    const plansOf = (await plansOfModule()) as NonNullable<Awaited<ReturnType<typeof plansOfModule>>>;
    const solved = plansOf(input((given) => Object.assign(given.venues[0], { catering: "outside_fee", outside_fee_per_head: 2 })));
    expect(solved.plans[0].orders).toEqual([{ caterer: "c1", counts: { standard: 61 }, permits: [{ price: 122 }] }]);
    expect(solved.plans[0].cost).toBe(2000 + 61 * 30 + 122);
  });

  it("pays a fee condition's fee and a travel_paid speaker's cheapest train in time, gives a morning_slot speaker a morning session, and books a hotel when no train is in time", async () => {
    const plansOf = (await plansOfModule()) as NonNullable<Awaited<ReturnType<typeof plansOfModule>>>;
    const solved = plansOf(
      input((given) => {
        given.speakers = [
          { id: "s1", fee: 300, condition: "fee", home: "local", available: true, accepts: true, draw: 1 },
          { id: "s2", fee: 0, condition: "travel_paid", home: "north", available: true, accepts: true, draw: 1 },
          { id: "s3", fee: 0, condition: "morning_slot", home: "local", available: true, accepts: true, draw: 1 },
          { id: "s4", fee: 0, home: "south", available: true, accepts: true, draw: 1 },
          ...[5, 6].map((n) => ({ id: `s${n}`, fee: 0, home: "local", available: true, accepts: true, draw: 1 })),
          { id: "s7", fee: 0, home: "local", available: false, accepts: true, draw: 1 },
          { id: "s8", fee: 0, home: "local", available: true, accepts: false, draw: 1 },
        ];
        given.trains = [{ id: "t1", from: "north", arrives: "08:20", price: 40 }, { id: "t2", from: "north", arrives: "12:00", price: 25 }, { id: "t3", from: "south", arrives: "18:00", price: 10 }];
        given.hotels = [{ id: "h1", near: "v1", price: 90 }];
      }),
    );
    // The six available accepting speakers, once.
    expect(solved.solutions).toBe(1);
    const [plan] = solved.plans;
    const of = (id: string) => plan.speakers.find((speaker) => speaker.id === id);
    expect(of("s1")?.fee).toBe(300);
    expect(of("s2")?.train).toBe("t2");
    expect(String(of("s3")?.session) < "12:00").toBe(true);
    // No train from "south" arrives in time: a hotel for the night before, which the plan pays.
    expect(of("s4")?.hotel).toBe("h1");
    expect(plan.cost).toBe(2000 + 61 * 30 + 300 + 25 + 90);
  });

  it("leaves out a plan whose commitments pass the budget", async () => {
    const plansOf = (await plansOfModule()) as NonNullable<Awaited<ReturnType<typeof plansOfModule>>>;
    const solved = plansOf(input((given) => (given.budget = 2000 + 61 * 30 - 1)));
    expect(solved.solutions).toBe(0);
    expect(solved.counts.D6).toBe(0);
    expect(solved.counts.D5).toBeGreaterThan(0);
  });
});
