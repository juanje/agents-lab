import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import type { Perceived, RuleStep, Rules } from "../src/engine/participants.ts";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import type { Stimulus } from "../src/engine/stimuli.ts";
import { partnerRules, speakerRules } from "../src/scenarios/congress-parties.ts";
import { congressScenario } from "../src/scenarios/congress.ts";
import { resultOf, withRecord } from "./fixtures/rules.ts";

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
      const perceived: Perceived = { stimuli: [], result: resultOf(step.tool, outcome, text) };
      step = rules.next(perceived);
    }
  };
  if (!started) take(rules.atStart?.());
  for (const stimuli of wakes) take(rules.next({ stimuli: stimuli.map(withRecord) }));
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
    expect(answerTo(invite(), { home: "north-station", condition: "travel_paid" })).toEqual([{ to: "organiser", act: "accept_if", fields: { session: 2, condition: "travel_paid", travel_paid: true, from: "north-station" } }]);
    expect(answerTo(invite("10:00", 0, true), { home: "north-station", condition: "travel_paid" })).toEqual([{ to: "organiser", act: "accept", fields: { session: 2 } }]);
    expect(answerTo(invite("10:00", 100), { fee: 300, condition: "fee" })).toEqual([{ to: "organiser", act: "accept_if", fields: { session: 2, condition: "fee", fee: 300 } }]);
    expect(answerTo(invite("10:00", 300), { fee: 300, condition: "fee" })).toEqual([{ to: "organiser", act: "accept", fields: { session: 2 } }]);
    expect(answerTo(invite("12:00"), { condition: "morning_slot" })).toEqual([{ to: "organiser", act: "accept_if", fields: { session: 2, condition: "morning_slot", time: "before 12:00" } }]);
    // A constraint is hard, whatever the condition (FR-CONGRESS-07).
    expect(answerTo(invite("14:00", 100), { constraint: "morning", condition: "fee", fee: 100 })).toEqual([{ to: "organiser", act: "decline", fields: { session: 2 } }]);
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
    const pools: TomlTable = { topics: ["soil"], venue: [], speaker: [structuredClone(S1)], partner: [structuredClone(P1)], board: [{ id: "board", funds: 6000 }], caterer: [], sponsor: [], agency: [] };
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

  it("gives a venue none of the speakers' perturbations, nor the venue change, which is the world's (FR-CONGRESS-13)", () => {
    const loaded = loadScenario(
      congress((configuration, pools) => {
        configuration.city = stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "main-hall", seats: 120 }] }], passages: [{ between: ["office", "v1-entrance"], length: 40, step_free: true }] });
        (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
        pools.venue = [{ id: "v1", rooms: [{ id: "main-hall", seats: 120 }], access_claim: "step-free", price: 2000, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }] }];
        configuration.draw = stringify({ attendance: [50, 80], venue: 1, speaker: 1, partner: 1, board: 1 });
        configuration.perturbations = { early_cancel: { between: ["day 9 09:00", "day 9 12:00"] }, late_cancel: { at: "day 23 10:00" }, change: { at: "day 6 09:00" } };
      }),
      1,
    );
    const v1 = loaded.participants?.find(({ name }) => name === "v1");
    expect(v1?.decides === "rules" && (v1.params.perturbations as { name: string }[]).map(({ name }) => name)).toEqual([]);
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

describe("a speaker's answers after its invitation, and its outcome (FR-CONGRESS-04)", () => {
  /** A speaker that answers each message in turn, the next message given by `next`, from the time `time` gives. */
  function conversation(changes: Record<string, unknown>, messages: string[], seed = 1) {
    const rules = speakerRules.start(params(changes), new Random(seed));
    let index = 0;
    const steps: RuleStep[] = [];
    steps.push(...drive(rules, tools(() => messages[0])));
    for (index = 0; index < messages.length; index += 1) {
      const current = messages[index];
      steps.push(...drive(rules, tools(() => current), [[notice]], true));
    }
    return { rules, steps };
  }
  const calls = (steps: RuleStep[], tool: string) => steps.flatMap((step) => (step.kind === "call" && step.tool === tool ? [step.arguments] : []));
  const confirm = "From: organiser. Act: confirm. time: 10:00. room: main-hall. length: 45. travel: none.";

  it("turns an accept_if into accept when its condition is accepted, and into decline when it is not", () => {
    const accepted = conversation({ home: "north-station", condition: "travel_paid" }, [invite(), "From: organiser. Act: accept_condition. travel_paid: true."]);
    expect(mails(accepted.steps).map(({ act }) => act)).toEqual(["accept_if", "accept"]);
    expect(accepted.rules.outcome()).toMatchObject({ condition: "travel_paid", condition_met: true, answer: "accept" });

    const declined = conversation({ home: "north-station", condition: "travel_paid" }, [invite(), "From: organiser. Act: decline_condition."]);
    expect(mails(declined.steps).map(({ act }) => act)).toEqual(["accept_if", "decline"]);
  });

  it("turns an accept_if into accept only when its condition is then met, by the invitation's offer as accept_condition updates it; otherwise it asks again (FR-CONGRESS-09)", () => {
    const met = conversation({ fee: 300, condition: "fee" }, [invite("10:00", 0), "From: organiser. Act: accept_condition. fee: 300.", confirm]);
    expect(mails(met.steps).map(({ act }) => act)).toEqual(["accept_if", "accept", "acknowledged"]);
    expect(calls(met.steps, "commit")).toEqual([{ with: "organiser", amount: 300, for: "fee s1" }]);

    const unmet = conversation({ fee: 300, condition: "fee" }, [invite("10:00", 0), "From: organiser. Act: accept_condition."]);
    expect(mails(unmet.steps)).toEqual([
      { to: "organiser", act: "accept_if", fields: { session: 2, condition: "fee", fee: 300 } },
      { to: "organiser", act: "accept_if", fields: { session: 2, condition: "fee", fee: 300 } },
    ]);
    expect(unmet.rules.outcome()).toMatchObject({ condition_met: false, answer: "accept_if" });
  });

  it("draws whether it would accept once, at its first invitation, answers each session's invitation on its own, and ignores a second invitation to the same session (FR-CONGRESS-09)", () => {
    const at = (session: number, time: string) => `From: organiser. Act: invite. session: ${session}. time: ${time}. fee: 0. travel_paid: false.`;
    for (let seed = 1; seed <= 20; seed += 1) {
      const { steps } = conversation({ acceptance: 0.5 }, [at(2, "10:00"), at(5, "14:00"), at(2, "10:00")], seed);
      const answered = new Random(seed).next() < 0.5 ? "decline" : "accept";
      expect(mails(steps)).toEqual([
        { to: "organiser", act: answered, fields: { session: 2 } },
        { to: "organiser", act: answered, fields: { session: 5 } },
        // The same invitation again, after another reached it, is handled afresh (FR-CONGRESS-13): ignored.
      ]);
    }
  });

  it("acknowledges a confirmation and a change, and believes the time and room they give", () => {
    const { rules, steps } = conversation({}, [invite(), confirm, "From: organiser. Act: change. room: room-b."]);
    expect(mails(steps).map(({ act }) => act)).toEqual(["accept", "acknowledged", "acknowledged"]);
    expect(rules.outcome()).toMatchObject({ believes_time: "10:00", believes_room: "room-b" });
    expect(calls(steps, "commit")).toEqual([]);
  });

  it("commits its agreed fee when it first acknowledges, and claims it when its invitation is withdrawn, recording a broken agreement", () => {
    const { rules, steps } = conversation({ fee: 300, condition: "fee" }, [invite("10:00", 300), confirm, confirm.replace("main-hall", "room-b"), "From: organiser. Act: withdraw_invitation."]);
    expect(mails(steps).map(({ act }) => act)).toEqual(["accept", "acknowledged", "acknowledged", "withdrawn"]);
    expect(calls(steps, "commit")).toEqual([{ with: "organiser", amount: 300, for: "fee s1" }]);
    expect(calls(steps, "issue_invoice")).toEqual([{ to: "organiser", amount: 300, due: "day 1", for: "claim s1" }]);
    expect(rules.outcome()).toMatchObject({ broken_agreement: true, claim: 300 });
  });

  it("withdrawn before it accepted, it records no broken agreement and claims nothing", () => {
    const { rules, steps } = conversation({}, ["From: organiser. Act: withdraw_invitation."]);
    expect(mails(steps).map(({ act }) => act)).toEqual(["withdrawn"]);
    expect(rules.outcome()).toMatchObject({ broken_agreement: false, claim: 0 });
  });

  it("sends slides when asked with probability 0.8, and accepts a panel with probability 0.6 when available, from its own sequence", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const draws = new Random(seed);
      const slides = conversation({}, ["From: organiser. Act: ask_slides. by: day 5."], seed);
      expect(mails(slides.steps)).toEqual(draws.next() < 0.8 ? [{ to: "organiser", act: "slides", fields: { title: "Soil life" } }] : []);
      const panelDraws = new Random(seed);
      const panel = conversation({}, ["From: organiser. Act: ask_panel. slot: 4."], seed);
      expect(mails(panel.steps)[0].act).toBe(panelDraws.next() < 0.6 ? "accept" : "decline");
    }
    expect(mails(conversation({ available: false }, ["From: organiser. Act: ask_panel. slot: 4."]).steps)[0].act).toBe("decline");
    expect(mails(conversation({}, ["From: organiser. Act: ask_promote."]).steps)[0].act).toBe("promoting");
  });

  it("records its invitation, its answer, its condition, what it believes, and no cancellation or broken agreement", () => {
    const { rules } = conversation({}, [invite(), confirm]);
    expect(rules.outcome()).toEqual({
      invitation: JSON.stringify({ session: 2, time: "10:00", fee: 0, travel_paid: false }),
      answer: "accept",
      condition: "none",
      condition_met: false,
      believes_time: "10:00",
      believes_room: "main-hall",
      cancelled: false,
      broken_agreement: false,
      claim: 0,
    });
  });

  it("as the partner, accepts any session it is given, and takes only confirm, change and ask_slides besides", () => {
    const partner = partnerRules.start({ id: "p1", title: "Survey", session: 3, organiser: "organiser", event_day: 26 }, new Random(1));
    const steps = [
      ...drive(partner, tools(() => invite("15:00"))),
      ...drive(partner, tools(() => invite("15:00")), [[notice]], true),
      ...drive(partner, tools(() => confirm), [[notice]], true),
      ...drive(partner, tools(() => "From: organiser. Act: ask_panel. slot: 4."), [[notice]], true),
    ];
    expect(mails(steps).map(({ act }) => act)).toEqual(["accept", "acknowledged", "not_available"]);
    expect(partner.outcome()).toMatchObject({ believes_time: "10:00", believes_room: "main-hall" });
  });
});

describe("a speaker's own cycle and its cancellations (FR-CONGRESS-04)", () => {
  it("waits until day 19 on a condition not met, then mails withdraw", () => {
    const clock = { time: "day 2 Tuesday 10:01" };
    const rules = speakerRules.start(params({ home: "north-station", condition: "travel_paid" }), new Random(1));
    const answer = tools(() => invite(), () => clock.time);
    drive(rules, answer);
    const answered = drive(rules, answer, [[notice]], true);
    expect(mails(answered).map(({ act }) => act)).toEqual(["accept_if"]);
    expect(answered.at(-1)).toEqual({ kind: "wait", minutes: 18 * 1440 - (24 * 60 + 10 * 60 + 1) });

    clock.time = "day 19 Saturday 00:00";
    const after = drive(rules, answer, [[]], true);
    expect(mails(after)).toEqual([{ to: "organiser", act: "withdraw", fields: { sessions: "2", condition: "travel_paid" } }]);
    expect(rules.outcome()).toMatchObject({ answer: "withdraw", condition_met: false });
  });

  const illness = (channel: string): Stimulus => ({ channel, source: "illness", content: "You are ill and cannot give your session." });

  it("mails cancel when early_cancel reaches it", () => {
    const rules = speakerRules.start(params(), new Random(1));
    drive(rules, tools(() => ""));
    const steps = drive(rules, tools(() => ""), [[illness("early_cancel")]], true);
    expect(mails(steps)).toEqual([{ to: "organiser", act: "cancel", fields: {} }]);
    expect(rules.outcome()).toMatchObject({ cancelled: true });
  });

  it("calls the organiser to cancel when late_cancel reaches it, and mails cancel only when the call is not answered", () => {
    for (const [outcome, mailed] of [
      ["no_answer", true],
      ["busy", true],
      ["success", false],
    ] as const) {
      const rules = speakerRules.start(params(), new Random(1));
      const answer = (tool: string) => (tool === "call" ? { outcome, text: outcome === "success" ? "Answer from organiser. Act: noted." : `${outcome}: nobody answered` } : tools(() => "")(tool));
      drive(rules, answer);
      const steps = drive(rules, answer, [[illness("late_cancel")]], true);
      expect(steps.filter((step) => step.kind === "call" && step.tool === "call").map((step) => step.kind === "call" && step.arguments)).toEqual([{ to: "organiser", act: "cancel" }]);
      expect(mails(steps)).toEqual(mailed ? [{ to: "organiser", act: "cancel", fields: {} }] : []);
      expect(rules.outcome()).toMatchObject({ cancelled: true });
    }
  });
});

describe("the cancellations, perturbations that find their speaker in the world's mail (FR-CONGRESS-04)", () => {
  const speakers = ["s1", "s4"].map((id) => ({ id, title: id, draw: 1, fee: 0, home: "local", available: true, acceptance: 1 }));

  /** The early and late cancellations of a congress with the speakers "s1" and "s4", as loading gives them. */
  function cancellations(perturbations: TomlTable) {
    const configuration = parse(congressScenario.baseConfiguration);
    configuration.pools = stringify({ topics: ["soil"], venue: [], board: [], speaker: speakers, partner: [], caterer: [], sponsor: [], agency: [] });
    configuration.draw = stringify({ attendance: [50, 80], speaker: 2 });
    configuration.perturbations = perturbations;
    return loadScenario({ ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) }, 1).components;
  }

  /** The world's time "day <n> HH:MM" as the engine gives it, and in world minutes since day 1's midnight. */
  const at = (day: number, clock: string) => {
    const [hours, minutes] = clock.split(":").map(Number);
    return { day, weekday: "Monday" as const, seconds: hours * 3600 + minutes * 60 };
  };
  /** The organiser's confirm, received by a speaker at a time. */
  const confirmTo = (to: string, received: ReturnType<typeof at>) => ({ id: `m-${to}`, from: "organiser", to, act: "confirm", fields: {}, subject: "confirm", received, read: false });
  /** What a speaker that accepted and acknowledged its confirmation sent the organiser, received an hour after the time given (FR-CONGRESS-09). */
  const confirmedBy = (speaker: string, received: ReturnType<typeof at>) => [
    { id: `m-${speaker}-1`, from: speaker, to: "organiser", act: "accept", fields: { session: 2 }, subject: "accept", received: { ...received, seconds: received.seconds + 3600 }, read: false },
    { id: `m-${speaker}-2`, from: speaker, to: "organiser", act: "acknowledged", fields: {}, subject: "acknowledged", received: { ...received, seconds: received.seconds + 3600 }, read: false },
  ];
  /** A congress world with the mail and the phone given; the base calendar makes a world minute a second of the run. */
  const world = (mailboxes: Record<string, unknown[]>, calls: unknown[] = []) => ({ mail: { mailboxes, inTransit: [] }, phone: { calls } }) as never;

  it("are perturbation components, one for each declared, and none without one", () => {
    expect(cancellations({}).map(({ name }) => name)).toEqual([]);
    const both = cancellations({ early_cancel: { between: ["day 9 09:00", "day 9 12:00"] }, late_cancel: { at: "day 23 10:00" } });
    expect(both.map(({ name, kind }) => [name, kind])).toEqual([
      ["early_cancel", "perturbation"],
      ["late_cancel", "perturbation"],
    ]);
  });

  it("early_cancel waits until its time, drawn in its window, then delivers its illness, not held, to a speaker a confirm has reached", () => {
    const [early] = cancellations({ early_cancel: { between: ["day 9 09:00", "day 9 12:00"] } });
    const cycle = early.cycle(new Random(3));
    const waiting = cycle.next(world({}), undefined, 0, at(1, "09:00"));
    expect(waiting.kind).toBe("wait");
    const ms = (waiting as { ms: number }).ms;
    // Eight days and up to three hours, at a second of the run a world minute.
    expect(ms).toBeGreaterThanOrEqual(8 * 1440 * 1000);
    expect(ms).toBeLessThanOrEqual((8 * 1440 + 180) * 1000);

    const confirmed = world({ s4: [confirmTo("s4", at(2, "10:01"))], organiser: confirmedBy("s4", at(2, "10:01")) });
    expect(fired(cycle, confirmed, undefined, ms, at(9, "12:00"))).toEqual({ kind: "deliver", agent: "s4", channel: "early_cancel", held: false });
    expect(cycle.next(confirmed, undefined, ms, at(9, "12:00"))).toEqual({ kind: "end" });
  });

  it("early_cancel with no confirmed speaker at its time hits the next to be confirmed, two days after its confirm reached it", () => {
    const [early] = cancellations({ early_cancel: { between: ["day 9 09:00", "day 9 12:00"] } });
    const cycle = early.cycle(new Random(3));
    cycle.next(world({}), undefined, 0, at(1, "09:00"));
    expect(cycle.next(world({ s1: [], s4: [] }), undefined, 0, at(9, "12:00")).kind).toBe("wait");

    const confirmed = world({ s1: [confirmTo("s1", at(11, "10:01"))], organiser: confirmedBy("s1", at(11, "10:01")) });
    const waiting = cycle.next(confirmed, undefined, 0, at(11, "11:00"));
    // From 11:00 on day 11 to 10:01 on day 13.
    expect(waiting).toEqual({ kind: "wait", ms: (2 * 1440 - 59) * 1000 });
    expect(fired(cycle, confirmed, undefined, 0, at(13, "10:01"))).toEqual({ kind: "deliver", agent: "s1", channel: "early_cancel", held: false });
  });

  it("late_cancel hits a confirmed speaker who has not cancelled, and nobody when none is left", () => {
    const [late] = cancellations({ late_cancel: { at: "day 23 10:00" } });
    const s1Cancelled = { id: "m-9", from: "s1", to: "organiser", act: "cancel", fields: {}, subject: "cancel", received: at(9, "10:00"), read: false };
    const both = { s1: [confirmTo("s1", at(2, "10:01"))], s4: [confirmTo("s4", at(2, "10:01"))] };
    const acknowledged = [...confirmedBy("s1", at(2, "10:01")), ...confirmedBy("s4", at(2, "10:01"))];

    const cycle = late.cycle(new Random(3));
    expect(fired(cycle, world({ ...both, organiser: [...acknowledged, s1Cancelled] }), undefined, 0, at(23, "10:00"))).toEqual({ kind: "deliver", agent: "s4", channel: "late_cancel", held: false });

    const called = late.cycle(new Random(3));
    // An answered call: only an answered call passes its act (FR-CONGRESS-13).
    const s4Called = { id: "c-1", from: "s4", to: "organiser", act: "cancel", fields: {}, status: "ended", outcome: "answered", answer: { act: "noted", fields: {} }, endedAt: at(22, "10:00") };
    expect(called.next(world({ ...both, organiser: [...acknowledged, s1Cancelled] }, [s4Called]), undefined, 0, at(23, "10:00"))).toEqual({ kind: "end" });
  });

  it("choose only a speaker who accepted a session and acknowledged its confirmation, not one a confirm merely reached (FR-CONGRESS-09)", () => {
    const [early] = cancellations({ early_cancel: { between: ["day 9 09:00", "day 9 09:00"] } });
    const declinedThenConfirmed = [
      { id: "m-1", from: "s1", to: "organiser", act: "decline", fields: { session: 2 }, subject: "decline", received: at(2, "10:00"), read: false },
      { id: "m-2", from: "s1", to: "organiser", act: "not_available", fields: { what: "acceptance" }, subject: "not_available", received: at(2, "11:00"), read: false },
    ];
    const s1Confirm = { id: "m-3", from: "organiser", to: "s1", act: "confirm", fields: {}, subject: "confirm", received: at(2, "10:30"), read: false };
    const state = world({ s1: [s1Confirm], s4: [confirmTo("s4", at(3, "10:00"))], organiser: [...declinedThenConfirmed, ...confirmedBy("s4", at(3, "10:00"))] });

    for (let seed = 1; seed <= 10; seed += 1) {
      const cycle = early.cycle(new Random(seed));
      cycle.next(state, undefined, 0, at(1, "09:00"));
      expect(fired(cycle, state, undefined, 0, at(9, "09:00"))).toEqual({ kind: "deliver", agent: "s4", channel: "early_cancel", held: false });
    }
  });
});

/** A perturbation's next steps as it fires: it records itself, then delivers (FR-CONGRESS-06). */
function fired(cycle: { next: (...args: never[]) => unknown }, ...args: unknown[]): unknown {
  const recorded = (cycle.next as (...given: unknown[]) => { kind: string })(...args);
  if (recorded.kind !== "action") return recorded;
  const [state, , ...rest] = args;
  return (cycle.next as (...given: unknown[]) => unknown)(state, "success", ...rest);
}
