import { describe, expect, it } from "vitest";
import type { Perceived, RuleStep, Rules } from "../src/engine/participants.ts";
import { Random } from "../src/engine/random.ts";
import type { Stimulus } from "../src/engine/stimuli.ts";
import { speakerRules } from "../src/scenarios/congress-parties.ts";

/** A speaker's parameters as the congress gives its rule set: its template and what the world adds. */
const params = (changes: Record<string, unknown> = {}) => ({
  id: "s1",
  title: "Soil life",
  draw: 1,
  fee: 0,
  home: "local",
  available: true,
  acceptance: 1,
  pick_up: 1,
  organiser: "organiser",
  event_day: 26,
  ...changes,
});

/** The mail notice of a message from the organiser. */
const notice: Stimulus = { channel: "mail_notice", source: "mail client", content: "New mail from organiser: x" };

/**
 * Drives a rule set as the engine would, with no tools: each call's result is what `answer` gives for it, and each step
 * is kept. It wakes it at the start, unless it has started, then with each stimulus given; a wait ends at once.
 */
function drive(rules: Rules, answer: (tool: string, args: Record<string, unknown>) => { outcome?: string; text: string }, wakes: Stimulus[][] = [], started = false) {
  const steps: RuleStep[] = [];
  const take = (first: RuleStep | undefined) => {
    let step = first;
    for (let guard = 0; step !== undefined && step.kind !== "end" && guard < 200; guard += 1) {
      steps.push(step);
      if (step.kind === "wait") break;
      const { outcome = "success", text } = answer(step.tool, step.arguments);
      const perceived: Perceived = { stimuli: [], result: { tool: step.tool, outcome, text } };
      step = rules.next(perceived);
    }
  };
  if (!started) take(rules.atStart?.());
  for (const stimuli of wakes) take(rules.next({ stimuli }));
  return steps;
}

/** A speaker's tools: the time, one message from the organiser with this text, and "Done." for anything else. */
function tools(message: () => string, time = () => "day 1 Monday 09:01") {
  return (tool: string) => ({
    text:
      ({
        check_time: time(),
        check_mail: 'm-1: from organiser, subject "x", received day 1 Monday 09:01',
        read_mail: message(),
      } as Record<string, string>)[tool] ?? "Done.",
  });
}

/** The mails a rule set sent among its steps. */
const mails = (steps: RuleStep[]) => steps.flatMap((step) => (step.kind === "call" && step.tool === "send_mail" ? [step.arguments] : []));

/** A speaker's answer to one message from the organiser. */
function answerTo(message: string, changes: Record<string, unknown> = {}, seed = 1) {
  return mails(drive(speakerRules.start(params(changes), new Random(seed)), tools(() => message), [[notice]]));
}

const invite = (time = "10:00", fee = 0, travel = false) => `From: organiser. Act: invite. session: 2. time: ${time}. fee: ${fee}. travel_paid: ${travel}.`;

describe("a speaker's answer to an invitation (FR-CONGRESS-04)", () => {
  it("accepts an invitation that meets everything it asks", () => {
    expect(answerTo(invite())).toEqual([{ to: "organiser", act: "accept", fields: { session: 2 } }]);
  });

  it("declines when it is not available, or when the time breaks its constraint and it has no condition", () => {
    expect(answerTo(invite(), { available: false })).toEqual([{ to: "organiser", act: "decline", fields: { session: 2 } }]);
    expect(answerTo(invite("14:00"), { constraint: "morning" })).toEqual([{ to: "organiser", act: "decline", fields: { session: 2 } }]);
    expect(answerTo(invite("10:00"), { constraint: "afternoon" })).toEqual([{ to: "organiser", act: "decline", fields: { session: 2 } }]);
    expect(answerTo(invite("10:00"), { constraint: "morning" })).toEqual([{ to: "organiser", act: "accept", fields: { session: 2 } }]);
  });

  it("asks for its condition when the invitation does not meet it", () => {
    expect(answerTo(invite(), { home: "north-station", condition: "travel_paid" })).toEqual([{ to: "organiser", act: "accept_if", fields: { session: 2, condition: "travel_paid" } }]);
    expect(answerTo(invite("10:00", 0, true), { home: "north-station", condition: "travel_paid" })).toEqual([{ to: "organiser", act: "accept", fields: { session: 2 } }]);
    expect(answerTo(invite("10:00", 100), { fee: 300, condition: "fee" })).toEqual([{ to: "organiser", act: "accept_if", fields: { session: 2, condition: "fee" } }]);
    expect(answerTo(invite("10:00", 300), { fee: 300, condition: "fee" })).toEqual([{ to: "organiser", act: "accept", fields: { session: 2 } }]);
    expect(answerTo(invite("12:00"), { condition: "morning_slot" })).toEqual([{ to: "organiser", act: "accept_if", fields: { session: 2, condition: "morning_slot" } }]);
    // A time that breaks its constraint, from a speaker with a condition, is met by its condition.
    expect(answerTo(invite("14:00", 100), { constraint: "morning", condition: "fee", fee: 100 })).toEqual([{ to: "organiser", act: "accept_if", fields: { session: 2, condition: "fee" } }]);
  });

  it("declines with the probability its acceptance leaves, from the first draw of its own sequence", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const declines = new Random(seed).next() < 0.5;
      expect(answerTo(invite(), { acceptance: 0.5 }, seed)[0].act).toBe(declines ? "decline" : "accept");
    }
  });
});
