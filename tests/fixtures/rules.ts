import type { Perceived, RuleStep, Rules } from "../../src/engine/participants.ts";
import type { Stimulus } from "../../src/engine/stimuli.ts";

/** A field's text in a fixture as a value: a number, a truth value, or the text. */
function valueOf(text: string): string | number | boolean {
  if (text === "true" || text === "false") return text === "true";
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
}

/** The fields a fixture writes as "<name>: <value>." one after another. */
function fieldsOf(text: string): Record<string, string | number | boolean> {
  return Object.fromEntries([...text.matchAll(/(\w+): (.*?)\.(?= \w+: | ?$)/g)].map(([, name, value]) => [name, valueOf(value)]));
}

/**
 * The world's record of a message a fixture writes as read_mail renders it, "From: <sender>. Act: <act>.", then its
 * fields: a fixture's shorthand for the record the engine gives a rule set beside the text (FR-CONGRESS-09).
 */
export function messageRecord(text: string): Record<string, unknown> | undefined {
  const [, from, act, rest = ""] = /^From: (.+?)\. Act: (\w+)\.\s*(.*)$/.exec(text) ?? [];
  return from === undefined ? undefined : { from, act, fields: fieldsOf(rest) };
}

/** A ring a fixture writes as the congress's ring text, with the world's record of its call beside it, as the phone delivers it (FR-CONGRESS-09). */
export function withRecord(stimulus: Stimulus): Stimulus {
  if (stimulus.channel !== "phone" || stimulus.record !== undefined) return stimulus;
  const [, from, call, act, rest = ""] = /^(\S+) calls \((c-\d+)\): (\w+)\.\s*(.*)$/.exec(stimulus.content) ?? [];
  return from === undefined ? stimulus : { ...stimulus, record: { from, call, act, fields: fieldsOf(rest.trim()) } };
}

/** What a rule set perceives of a call's result: read_mail's gives the world's record of the message, written in a fixture as its text or given beside it. */
export function resultOf(tool: string, outcome: string, text: string, record?: Record<string, unknown>): NonNullable<Perceived["result"]> {
  const kept = record ?? (tool === "read_mail" ? messageRecord(text) : undefined);
  return { tool, outcome, text, ...(kept === undefined ? {} : { record: kept }) };
}

/** The mail notice of a message from the organiser. */
export const notice: Stimulus = { channel: "mail_notice", source: "mail client", content: "New mail from organiser: x" };

/** What a rule set's tools answer to each call: an outcome (success by default) and a text. */
export type ToolAnswer = (tool: string, args: Record<string, unknown>) => { outcome?: string; text: string; record?: Record<string, unknown> };

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
      const { outcome = "success", text, record } = answer(step.tool, step.arguments);
      const perceived: Perceived = { stimuli: [], result: resultOf(step.tool, outcome, text, record) };
      step = rules.next(perceived);
    }
  };
  if (!started) take(rules.atStart?.());
  for (const stimuli of wakes) take(rules.next({ stimuli: stimuli.map(withRecord) }));
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
