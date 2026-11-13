import type { Perceived, RuleStep, Rules } from "../../src/engine/participants.ts";
import type { Stimulus } from "../../src/engine/stimuli.ts";

/** The mail notice of a message from the organiser. */
export const notice: Stimulus = { channel: "mail_notice", source: "mail client", content: "New mail from organiser: x" };

/** What a rule set's tools answer to each call: an outcome (success by default) and a text. */
export type ToolAnswer = (tool: string, args: Record<string, unknown>) => { outcome?: string; text: string };

/**
 * Drives a rule set as the engine would, with no tools: each call's result is what `answer` gives for it, and each step
 * is kept. It wakes it at the start, unless it has started, then with each stimulus given; it stops at a wait.
 */
export function drive(rules: Rules, answer: ToolAnswer, wakes: Stimulus[][] = [], started = false): RuleStep[] {
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
export function tools(message: () => string, time: () => string = () => "day 1 Monday 09:01", ledger: () => Record<string, unknown> = () => ({})): ToolAnswer {
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

/** The calls of a tool among a rule set's steps, with their arguments. */
export const calls = (steps: RuleStep[], tool: string) => steps.flatMap((step) => (step.kind === "call" && step.tool === tool ? [step.arguments] : []));

/** A rule set that answers each message in turn, each read at the time given beside it, after starting at the first time. */
export function conversation(rules: Rules, messages: [string, string][], ledger: () => Record<string, unknown> = () => ({})) {
  const clock = { time: messages[0]?.[0] ?? "day 1 Monday 09:01" };
  const steps: RuleStep[] = [...drive(rules, tools(() => "", () => clock.time, ledger))];
  for (const [time, message] of messages) {
    clock.time = time;
    steps.push(...drive(rules, tools(() => message, () => clock.time, ledger), [[notice]], true));
  }
  return { steps, clock };
}
