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
