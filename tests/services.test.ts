import { describe, expect, it } from "vitest";
import type { Perceived, RuleStep, Rules } from "../src/engine/participants.ts";
import { Random } from "../src/engine/random.ts";
import type { Stimulus } from "../src/engine/stimuli.ts";
import { catererRules } from "../src/scenarios/congress-parties.ts";

/** The mail notice of a message from the organiser. */
const notice: Stimulus = { channel: "mail_notice", source: "mail client", content: "New mail from organiser: x" };

type Answer = (tool: string, args: Record<string, unknown>) => { outcome?: string; text: string };

/**
 * Drives a rule set as the engine would, with no tools: each call's result is what `answer` gives for it, and each step
 * is kept. It wakes it at the start, unless it has started, then with each stimulus given; it stops at a wait.
 */
function drive(rules: Rules, answer: Answer, wakes: Stimulus[][] = [], started = false) {
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

/** A party's tools: the time, one message with this text, a ledger, and "Done." for anything else. */
function tools(message: () => string, time: () => string = () => "day 1 Monday 09:01", ledger: () => Record<string, unknown> = () => ({})): Answer {
  return (tool) => ({
    text:
      ({
        check_time: time(),
        check_mail: 'm-1: from organiser, subject "x", received day 1 Monday 09:01',
        read_mail: message(),
        ledger: JSON.stringify({ balance: "unlimited", invoices_to_pay: [], invoices_issued: [], commitments_bound: [], commitments_recorded: [], ...ledger() }),
      } as Record<string, string>)[tool] ?? "Done.",
  });
}

/** The calls of a tool among a rule set's steps. */
const calls = (steps: RuleStep[], tool: string) => steps.flatMap((step) => (step.kind === "call" && step.tool === tool ? [step.arguments] : []));

/** "c1"'s parameters, as FR-CONGRESS-05's Background gives its template, and what the world adds. */
const caterer = (changes: Record<string, unknown> = {}) => ({
  id: "c1",
  price_per_head: 30,
  diets: { vegan: {}, gluten_free: { limit: 5 } },
  minimum: 20,
  final_days: 7,
  deposit_share: 0.2,
  deposit_due_days: 3,
  cancellation: [{ share: 0.3 }],
  pick_up: 1,
  organiser: "organiser",
  event_day: 26,
  ...changes,
});

/** A caterer that answers each message in turn, each read at the time given beside it. */
function conversation(messages: [string, string][], ledger: () => Record<string, unknown> = () => ({})) {
  const rules = catererRules.start(caterer(), new Random(1));
  const clock = { time: "day 1 Monday 09:01" };
  const steps: RuleStep[] = [...drive(rules, tools(() => "", () => clock.time, ledger))];
  for (const [time, message] of messages) {
    clock.time = time;
    steps.push(...drive(rules, tools(() => message, () => clock.time, ledger), [[notice]], true));
  }
  return { rules, steps, clock };
}

const order = (counts: string) => `From: organiser. Act: order. counts: ${counts}. date: day 26.`;
const finals = (counts: string) => `From: organiser. Act: final_numbers. counts: ${counts}.`;

describe("the caterer's rules (FR-CONGRESS-05)", () => {
  it("quotes its price per head, its diets with their limits, its minimum, the final-numbers date, its deposit and its cancellation schedule", () => {
    const { steps } = conversation([["day 1 Monday 09:01", "From: organiser. Act: ask_quote. attendance: 60. diets: vegan, gluten_free."]]);
    expect(calls(steps, "send_mail")).toEqual([
      {
        to: "organiser",
        act: "quote",
        fields: { price_per_head: 30, diets: "vegan: no limit; gluten_free: 5", minimum: 20, final_numbers_by: "day 19", deposit_share: 0.2, deposit_due_days: 3, cancellation: "0 days or fewer: 0.3" },
      },
    ]);
  });

  it("confirms an order within its limits, commits its price and invoices the deposit; refuses one over a diet's limit or under its minimum", () => {
    const { steps } = conversation([["day 1 Monday 09:01", order("standard: 50; vegan: 6; gluten_free: 4")]]);
    expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "order_confirmed", fields: { total: 60, price: 1800 } }]);
    expect(calls(steps, "commit")).toEqual([{ with: "organiser", amount: 1800, for: "order c1" }]);
    expect(calls(steps, "issue_invoice")).toEqual([{ to: "organiser", amount: 360, due: "day 4", for: "deposit order c1" }]);

    expect(calls(conversation([["day 1 Monday 09:01", order("standard: 50; gluten_free: 9")]]).steps, "send_mail")).toEqual([{ to: "organiser", act: "order_refused", fields: { diet: "gluten_free" } }]);
    expect(calls(conversation([["day 1 Monday 09:01", order("standard: 10")]]).steps, "send_mail")).toEqual([{ to: "organiser", act: "order_refused", fields: { minimum: 20 } }]);
  });

  it("takes final numbers before their date, its commitment following the total; after it, an increase of at most 5% with a 10% surcharge, and nothing else", () => {
    const recorded = () => ({ commitments_recorded: [{ id: "k-1", for: "order c1", amount: 1800, released: false }] });
    const answered = (time: string, counts: string) => {
      const { steps } = conversation([["day 1 Monday 09:01", order("standard: 60")], [time, finals(counts)]], recorded);
      return { mails: calls(steps, "send_mail").slice(1), released: calls(steps, "release"), committed: calls(steps, "commit").slice(1) };
    };

    expect(answered("day 15 Monday 09:01", "standard: 70")).toEqual({ mails: [{ to: "organiser", act: "numbers_accepted", fields: { total: 70, price: 2100 } }], released: [{ commitment: "k-1" }], committed: [{ with: "organiser", amount: 2100, for: "order c1" }] });
    expect(answered("day 15 Monday 09:01", "standard: 55").committed).toEqual([{ with: "organiser", amount: 1650, for: "order c1" }]);
    expect(answered("day 21 Saturday 09:01", "standard: 63")).toEqual({ mails: [{ to: "organiser", act: "numbers_accepted", fields: { total: 63, price: 1899 } }], released: [{ commitment: "k-1" }], committed: [{ with: "organiser", amount: 1899, for: "order c1" }] });
    expect(answered("day 21 Saturday 09:01", "standard: 66")).toEqual({ mails: [{ to: "organiser", act: "numbers_refused", fields: { total: 66 } }], released: [], committed: [] });
    expect(answered("day 21 Saturday 09:01", "standard: 55").mails[0].act).toBe("numbers_refused");
    expect(answered("day 15 Monday 09:01", "standard: 50; gluten_free: 9").mails).toEqual([{ to: "organiser", act: "numbers_refused", fields: { diet: "gluten_free" } }]);
  });

  it("waits until five days before the event and invoices the balance, the price less the deposit", () => {
    const { rules, steps, clock } = conversation([["day 1 Monday 09:01", order("standard: 60")]]);
    expect(steps.at(-1)).toEqual({ kind: "wait", minutes: 20 * 1440 - (9 * 60 + 1) });
    clock.time = "day 21 Saturday 00:00";
    const balance = drive(rules, tools(() => "", () => clock.time), [[]], true);
    expect(calls(balance, "issue_invoice")).toEqual([{ to: "organiser", amount: 1440, due: "day 26", for: "balance order c1" }]);
  });

  it("cancels an order with its schedule's charge, releasing its commitment", () => {
    const recorded = () => ({ commitments_recorded: [{ id: "k-1", for: "order c1", amount: 1800, released: false }] });
    const { steps } = conversation([["day 1 Monday 09:01", order("standard: 60")], ["day 2 Tuesday 09:01", "From: organiser. Act: cancel_order."]], recorded);
    expect(calls(steps, "send_mail").at(-1)).toEqual({ to: "organiser", act: "cancelled", fields: { charge: 540 } });
    expect(calls(steps, "release")).toEqual([{ commitment: "k-1" }]);
    expect(calls(steps, "issue_invoice").at(-1)).toEqual({ to: "organiser", amount: 540, due: "day 2", for: "cancellation order c1" });
  });

  it("records its quote, its order, its final numbers, its surcharges and its invoices", () => {
    const { rules } = conversation([
      ["day 1 Monday 09:01", "From: organiser. Act: ask_quote. attendance: 60."],
      ["day 1 Monday 09:01", order("standard: 60")],
      ["day 21 Saturday 09:01", finals("standard: 63")],
    ]);
    expect(rules.outcome()).toEqual({ quotes: 1, order: "standard: 60", ordered: 60, final_numbers: "standard: 63", surcharges: 9, invoices_issued: 1, cancelled: false });
  });
});
