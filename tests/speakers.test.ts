import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import type { Perceived, RuleStep, Rules } from "../src/engine/participants.ts";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import type { Stimulus } from "../src/engine/stimuli.ts";
import { speakerRules } from "../src/scenarios/congress-parties.ts";
import { congressScenario } from "../src/scenarios/congress.ts";

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

describe("the congress's speakers and partner (FR-CONGRESS-04)", () => {
  const S1 = { id: "s1", title: "Soil life", draw: 1, fee: 0, home: "local", available: true, acceptance: 1, reply_minutes: [60, 60], pick_up: 1 };
  const P1 = { id: "p1", title: "The partner's survey", session: 3 };

  /** The congress with one speaker, "s1", a partner, "p1", and a board, changed as given. */
  function congress(changes: (configuration: TomlTable, pools: TomlTable) => void = () => {}): Scenario<unknown> {
    const configuration = parse(congressScenario.baseConfiguration);
    const pools: TomlTable = { topics: ["soil"], venue: [], speaker: [structuredClone(S1)], partner: [structuredClone(P1)], board: [{ id: "board", funds: 6000 }] };
    configuration.draw = stringify({ attendance: [50, 80], speaker: 1, partner: 1, board: 1 });
    changes(configuration, pools);
    configuration.pools = stringify(pools);
    return { ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) };
  }

  it("makes each chosen speaker and partner a participant, with the reply delay its template gives, and an account to commit and invoice from", () => {
    const loaded = loadScenario(congress(), 1);

    const s1 = loaded.participants?.find(({ name }) => name === "s1");
    expect(s1).toMatchObject({ decides: "rules", rules: "speaker", replyMinutes: [60, 60] });
    expect(s1?.decides === "rules" && s1.params).toMatchObject({ acceptance: 1, organiser: "organiser", event_day: 26 });
    expect(s1?.decides === "rules" && s1.params).not.toHaveProperty("reply_minutes");
    expect(s1?.tools).toEqual(expect.arrayContaining(["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "commit", "issue_invoice"]));
    expect(s1?.channels).toEqual(expect.arrayContaining(["mail_notice", "phone", "early_cancel", "late_cancel"]));
    expect(loaded.participants?.find(({ name }) => name === "p1")).toMatchObject({ decides: "rules", rules: "partner" });
    expect(loaded.money?.settings.accounts).toEqual(expect.arrayContaining([{ name: "s1", unlimited: true }]));
  });

  it("puts the board's mail about the partner's session in the organiser's mailbox at the calendar's start", () => {
    const loaded = loadScenario(congress(), 1);

    expect(loaded.mail?.settings.initial).toEqual([
      { id: "m-1", from: "board", to: "organiser", act: "partner_session", subject: "partner_session", fields: { speaker: "p1", session: 3 }, received: { day: 1, weekday: "Monday", seconds: 9 * 3600 }, read: false },
    ]);
  });

  it("refuses, naming it, a speaker template it cannot follow, a cancellation whose time it cannot read and a draw of more than one partner", () => {
    const refusing = (changing: (configuration: TomlTable, pools: TomlTable) => void) => () => loadScenario(congress(changing), 1);
    const s1 = (changing: (template: TomlTable) => void) => (_configuration: TomlTable, pools: TomlTable) => changing((pools.speaker as TomlTable[])[0]);

    expect(refusing(s1((template) => (template.acceptance = 1.2)))).toThrow(/"s1".*acceptance/);
    expect(refusing(s1((template) => (template.pick_up = 2)))).toThrow(/"s1".*pick_up/);
    expect(refusing(s1((template) => (template.draw = 4)))).toThrow(/"s1".*draw/);
    expect(refusing(s1((template) => (template.fee = -50)))).toThrow(/"s1".*fee/);
    expect(refusing(s1((template) => (template.condition = "lunch")))).toThrow(/"s1".*condition/);
    expect(refusing(s1((template) => (template.constraint = "evening")))).toThrow(/"s1".*constraint/);
    expect(refusing((configuration) => ((configuration.perturbations as TomlTable).late_cancel = { at: "Monday" }))).toThrow(/perturbations\.late_cancel/);
    expect(
      refusing((configuration, pools) => {
        pools.partner = [P1, { ...P1, id: "p2" }];
        configuration.draw = stringify({ attendance: [50, 80], speaker: 1, partner: 2, board: 1 });
      }),
    ).toThrow(/draw\.partner/);
  });
});
