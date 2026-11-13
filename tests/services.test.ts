import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import type { Perceived, RuleStep, Rules } from "../src/engine/participants.ts";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import type { Stimulus } from "../src/engine/stimuli.ts";
import { agencyRules, catererRules, sponsorRules } from "../src/scenarios/congress-parties.ts";
import { congressScenario } from "../src/scenarios/congress.ts";

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
    expect(rules.outcome()).toEqual({ quotes: 1, order: "standard: 60", ordered: 60, final_numbers: "standard: 63", surcharges: 9, invoices_issued: 2, cancelled: false });
  });
});

describe("the interpreter agency's rules (FR-CONGRESS-05)", () => {
  const agency = () => agencyRules.start({ id: "a1", price: 400, notice_days: 7, pick_up: 1, organiser: "organiser", event_day: 26 }, new Random(1));
  const answering = (time: string, messages: string[]) => {
    const rules = agency();
    const steps: RuleStep[] = [...drive(rules, tools(() => "", () => time))];
    for (const message of messages) steps.push(...drive(rules, tools(() => message, () => time), [[notice]], true));
    return { rules, steps };
  };

  it("quotes its price and notice, books a date at least its notice away with a commitment, and cancels a booking, releasing it", () => {
    expect(calls(answering("day 1 Monday 09:01", ["From: organiser. Act: ask_quote. date: day 26."]).steps, "send_mail")).toEqual([{ to: "organiser", act: "quote", fields: { price: 400, notice_days: 7 } }]);

    const booked = answering("day 19 Friday 09:01", ["From: organiser. Act: book. date: day 26."]);
    expect(calls(booked.steps, "send_mail")).toEqual([{ to: "organiser", act: "booked", fields: { date: "day 26", price: 400 } }]);
    expect(calls(booked.steps, "commit")).toEqual([{ with: "organiser", amount: 400, for: "interpreting a1" }]);
    expect(booked.rules.outcome()).toEqual({ booked: "day 26", cancelled: false });

    expect(calls(answering("day 20 Saturday 09:01", ["From: organiser. Act: book. date: day 26."]).steps, "send_mail")).toEqual([{ to: "organiser", act: "unavailable", fields: { date: "day 26" } }]);
  });

  it("cancels a booking, releasing its commitment", () => {
    const rules = agency();
    const ledger = () => ({ commitments_recorded: [{ id: "k-1", for: "interpreting a1", amount: 400, released: false }] });
    drive(rules, tools(() => "", undefined, ledger));
    drive(rules, tools(() => "From: organiser. Act: book. date: day 26.", undefined, ledger), [[notice]], true);
    const cancelled = drive(rules, tools(() => "From: organiser. Act: cancel.", undefined, ledger), [[notice]], true);
    expect(calls(cancelled, "send_mail")).toEqual([{ to: "organiser", act: "cancelled", fields: { date: "day 26" } }]);
    expect(calls(cancelled, "release")).toEqual([{ commitment: "k-1" }]);
    expect(rules.outcome()).toEqual({ booked: "none", cancelled: true });
  });
});

describe("the sponsor's answers (FR-CONGRESS-05)", () => {
  const sp1 = { id: "sp1", amount: 1200, conditions: ["logo", "morning_slot"], insists: ["morning_slot"], counter_acceptance: 0.5, pay_days: [2, 2], pick_up: 1, organiser: "organiser" };
  const answering = (messages: string[], changes: Record<string, unknown> = {}, seed = 1) => {
    const rules = sponsorRules.start({ ...sp1, ...changes }, new Random(seed));
    const steps: RuleStep[] = [...drive(rules, tools(() => ""))];
    for (const message of messages) steps.push(...drive(rules, tools(() => message), [[notice]], true));
    return { rules, mails: calls(steps, "send_mail") };
  };

  it("states its amount, its conditions and its payment terms, and agrees to its own conditions", () => {
    const { mails, rules } = answering(["From: organiser. Act: ask_conditions.", "From: organiser. Act: accept_sponsorship. conditions: logo, morning_slot."]);
    expect(mails).toEqual([
      { to: "organiser", act: "conditions", fields: { amount: 1200, conditions: "logo, morning_slot", pay_days: "2 to 2" } },
      { to: "organiser", act: "agreement", fields: { amount: 1200, conditions: "logo, morning_slot" } },
    ]);
    expect(rules.outcome()).toEqual({ conditions: "logo, morning_slot", agreement: "logo, morning_slot", paid: 0, withdrew: false });
  });

  it("refuses a counter that drops what it insists on, and takes one that keeps it with its counter_acceptance, from its own sequence, or withdraws", () => {
    expect(answering(["From: organiser. Act: counter. conditions: logo."]).mails).toEqual([{ to: "organiser", act: "refused", fields: { missing: "morning_slot" } }]);
    // An acceptance of conditions not its own is a counter.
    expect(answering(["From: organiser. Act: accept_sponsorship. conditions: logo."]).mails[0].act).toBe("refused");
    for (let seed = 1; seed <= 20; seed += 1) {
      const takes = new Random(seed).next() < 0.5;
      const { mails, rules } = answering(["From: organiser. Act: counter. conditions: morning_slot, table."], {}, seed);
      expect(mails).toEqual([takes ? { to: "organiser", act: "agreement", fields: { amount: 1200, conditions: "morning_slot, table" } } : { to: "organiser", act: "withdraw", fields: {} }]);
      expect(rules.outcome()).toMatchObject({ agreement: takes ? "morning_slot, table" : "none", withdrew: !takes });
    }
  });

  it("acknowledges an attendee list and evidence", () => {
    expect(answering(["From: organiser. Act: send_attendee_list. list: a1, a2.", "From: organiser. Act: send_evidence."]).mails.map(({ act }) => act)).toEqual(["received", "acknowledged"]);
  });

  it("withdraws when sponsor_withdraws reaches it", () => {
    const rules = sponsorRules.start(sp1, new Random(1));
    drive(rules, tools(() => ""));
    drive(rules, tools(() => "From: organiser. Act: accept_sponsorship. conditions: logo, morning_slot."), [[notice]], true);
    const steps = drive(rules, tools(() => ""), [[{ channel: "sponsor_withdraws", source: "board meeting", content: "Your board withdraws the sponsorship." }]], true);
    expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "withdraw", fields: {} }]);
    expect(rules.outcome()).toMatchObject({ withdrew: true });
  });
});

describe("the congress's caterers, sponsors, agency and their perturbation (FR-CONGRESS-05)", () => {
  const C1 = { id: "c1", price_per_head: 30, diets: { gluten_free: { limit: 5 } }, minimum: 20, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }] };
  const SP2 = { id: "sp2", amount: 1000, conditions: ["logo"], insists: [], counter_acceptance: 1, pay_days: [2, 2] };
  const V1 = { id: "v1", rooms: [{ id: "main-hall", seats: 120 }], access_claim: "step-free", price: 2000, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }] };

  /** The congress with "v1", the caterer "c1", the sponsor "sp2" and the agency "a1", changed as given. */
  function congress(changes: (configuration: TomlTable, pools: Record<string, TomlTable[]>) => void = () => {}): Scenario<unknown> {
    const configuration = parse(congressScenario.baseConfiguration);
    configuration.city = stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "main-hall", seats: 120 }] }], passages: [{ between: ["office", "v1-entrance"], length: 40, step_free: true }] });
    (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
    const pools: Record<string, TomlTable[]> = { venue: [structuredClone(V1)], board: [], speaker: [], partner: [], caterer: [structuredClone(C1)], sponsor: [structuredClone(SP2)], agency: [{ id: "a1", price: 400, notice_days: 7 }] };
    configuration.draw = stringify({ attendance: [50, 80], venue: 1, caterer: 1, sponsor: 1, agency: 1 });
    changes(configuration, pools);
    configuration.pools = stringify({ topics: ["soil"], ...pools });
    return { ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) };
  }
  const participant = (scenario: Scenario<unknown>, name: string) => loadScenario(scenario, 1).participants?.find((each) => each.name === name);

  it("makes each chosen caterer, sponsor and agency a participant; a sponsor's account opens at its amount", () => {
    const loaded = loadScenario(congress(), 1);
    expect(participant(congress(), "c1")).toMatchObject({ decides: "rules", rules: "caterer" });
    expect(participant(congress(), "sp2")).toMatchObject({ decides: "rules", rules: "sponsor", channels: expect.arrayContaining(["sponsor_withdraws", "invoice_notice"]) });
    expect(loaded.channels).toContainEqual({ name: "invoice_notice", source: "money", stimulus: "New invoice from {from}: {for}" });
    expect(participant(congress(), "a1")).toMatchObject({ decides: "rules", rules: "agency" });
    expect(loaded.money?.settings.accounts).toEqual(expect.arrayContaining([{ name: "c1", unlimited: true }, { name: "sp2", opening: 1000 }, { name: "a1", unlimited: true }, { name: "travel", unlimited: true }]));
  });

  it("adds the in-house caterer of each chosen venue, which the draw does not choose", () => {
    const scenario = congress((_configuration, pools) => pools.caterer.unshift({ ...structuredClone(C1), id: "c9", in_house_for: "v1" }));
    for (let seed = 1; seed <= 5; seed += 1) {
      const loaded = loadScenario(scenario, seed);
      expect((loaded.variant?.chosen as Record<string, string[]>).caterer).toEqual(["c1"]);
      expect(loaded.participants?.map(({ name }) => name)).toEqual(expect.arrayContaining(["c1", "c9"]));
    }
  });

  it("gives the reference price, the median of the similar events of the drawn topic, in the variant", () => {
    const scenario = congress((configuration) => {
      configuration.similar_events = stringify({ events: [60, 120, 80].map((price, index) => ({ topic: "soil", name: `e${index}`, price, size: 100 })) });
    });
    expect(loadScenario(scenario, 1).variant?.reference_price).toBe(80);
  });

  it("makes sponsor_withdraws a perturbation component that delivers to its sponsor, not held, at a time drawn in its window", () => {
    const scenario = congress((configuration) => ((configuration.perturbations as TomlTable).sponsor_withdraws = { between: ["day 10 09:00", "day 10 12:00"], for: "sp2" }));
    const [component] = loadScenario(scenario, 1).components;
    expect([component.name, component.kind]).toEqual(["sponsor_withdraws", "perturbation"]);
    const cycle = component.cycle(new Random(2));
    const waiting = cycle.next({} as never, undefined, 0, { day: 1, weekday: "Monday", seconds: 9 * 3600 });
    const ms = (waiting as { ms: number }).ms;
    expect(ms).toBeGreaterThanOrEqual(9 * 1440 * 1000);
    expect(ms).toBeLessThanOrEqual((9 * 1440 + 180) * 1000);
    expect(cycle.next({} as never, undefined, ms, { day: 10, weekday: "Wednesday", seconds: 12 * 3600 })).toEqual({ kind: "deliver", agent: "sp2", channel: "sponsor_withdraws", held: false });
    expect(cycle.next({} as never, undefined, ms, { day: 10, weekday: "Wednesday", seconds: 12 * 3600 })).toEqual({ kind: "end" });
  });

  it("refuses, naming it, a caterer, sponsor, in-house caterer, travel or sponsor_withdraws it cannot follow", () => {
    const refusing = (changing: (configuration: TomlTable, pools: Record<string, TomlTable[]>) => void) => () => loadScenario(congress(changing), 1);
    expect(refusing((_c, pools) => (pools.caterer[0].price_per_head = -1))).toThrow(/"c1".*price_per_head/);
    expect(refusing((_c, pools) => (pools.caterer[0].diets = { gluten_free: { limit: -1 } }))).toThrow(/"c1".*diets/);
    expect(refusing((_c, pools) => (pools.caterer[0].minimum = -1))).toThrow(/"c1".*minimum/);
    expect(refusing((_c, pools) => (pools.caterer[0].final_days = 0))).toThrow(/"c1".*final_days/);
    expect(refusing((_c, pools) => (pools.sponsor[0].amount = -1))).toThrow(/"sp2".*amount/);
    expect(refusing((_c, pools) => (pools.sponsor[0].conditions = ["free_coffee"]))).toThrow(/"sp2".*conditions/);
    expect(refusing((_c, pools) => (pools.sponsor[0].insists = ["passes"]))).toThrow(/"sp2".*insists/);
    expect(refusing((_c, pools) => (pools.sponsor[0].counter_acceptance = 2))).toThrow(/"sp2".*counter_acceptance/);
    expect(refusing((_c, pools) => (pools.sponsor[0].pay_days = [5, 2]))).toThrow(/"sp2".*pay_days/);
    expect(refusing((_c, pools) => pools.caterer.push({ ...structuredClone(C1), id: "c9", in_house_for: "v9" }))).toThrow(/"c9".*in_house_for/);
    expect(refusing((configuration) => (configuration.travel = stringify({ stations: ["north"], trains: [{ id: "t9", from: "moon", arrives: "08:10", price: 40 }], hotels: [] })))).toThrow(/travel/);
    expect(refusing((configuration) => (configuration.travel = stringify({ stations: ["north"], trains: [], hotels: [{ id: "h1", near: "v9", rooms: 2, price: 90 }] })))).toThrow(/travel/);
    expect(refusing((configuration) => ((configuration.perturbations as TomlTable).sponsor_withdraws = { between: ["day 10 09:00", "day 10 12:00"], for: "c1" }))).toThrow(/perturbations\.sponsor_withdraws/);
  });
});

describe("travel and similar events, services the organiser uses as tools (FR-CONGRESS-05)", () => {
  /** The congress with a train "t1" from "north" and a hotel "h1" near "v1", and three similar events of "soil". */
  function loaded(soldOut = 0) {
    const configuration = parse(congressScenario.baseConfiguration);
    configuration.city = stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "main-hall", seats: 120 }] }], passages: [{ between: ["office", "v1-entrance"], length: 40, step_free: true }] });
    (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
    configuration.travel = stringify({ stations: ["north"], trains: [{ id: "t1", from: "north", arrives: "08:10", price: 40 }], hotels: [{ id: "h1", near: "v1", rooms: 1, price: 90 }], sold_out_probability: soldOut });
    configuration.similar_events = stringify({ events: [{ topic: "soil", name: "Soil Days", price: 60, size: 80 }, { topic: "rivers", name: "River Week", price: 300, size: 50 }] });
    configuration.pools = stringify({ ...parse(configuration.pools as string), topics: ["soil"] });
    const scenario = loadScenario({ ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) }, 1);
    return { initial: scenario.world.state };
  }
  const tool = (name: string) => congressScenario.tools.find((each) => each.name === name) as never as { sense: (...args: unknown[]) => string; action: { precondition: (...args: unknown[]) => { holds: boolean; reason?: string }; effect: (...args: unknown[]) => unknown } };
  const on = (day: number) => ({ day, weekday: "Monday" as const, seconds: 9 * 3600 });

  it("travel_options gives the trains from a station on a date, their price rising in the last two weeks, and the hotels with rooms the night before", () => {
    const { initial } = loaded();
    const options = (day: number) => JSON.parse(tool("travel_options").sense(initial, "organiser", { from: "north", date: "day 26" }, 0, on(day)));
    expect(options(5)).toEqual({ trains: [{ id: "t1", option: "t1 day 26", arrives: "08:10", price: 40, sold_out: false }], hotels: [{ id: "h1", near: "v1", option: "h1 day 25", rooms_left: 1, price: 90 }] });
    expect(options(19).trains[0].price).toBe(56);
    expect(options(26).trains[0].price).toBe(72);
  });

  it("a train sells out in the last two days with the material's probability", () => {
    const { initial } = loaded(1);
    const soldOut = (day: number) => JSON.parse(tool("travel_options").sense(initial, "organiser", { from: "north", date: "day 26" }, 0, on(day))).trains[0].sold_out;
    expect([soldOut(23), soldOut(24)]).toEqual([false, true]);
  });

  it("book_travel books an option and the travel's account invoices the organiser for it; an unknown option or one sold out fails", () => {
    const { initial } = loaded();
    const book = tool("book_travel");
    const call = (option: string, day = 1) => ({ agent: "organiser", arguments: { option, traveller: "s2" }, atMs: 0, world: on(day) });
    expect(book.action.precondition(initial, call("t1 day 26"))).toEqual({ holds: true });
    const after = book.action.effect(initial, call("t1 day 26")) as { money: { invoices: unknown[] }; travel: { booked: unknown[] } };
    expect(after.money.invoices).toEqual([{ id: "i-1", from: "travel", to: "organiser", amount: 40, due: "day 1", for: "t1 day 26 s2", paid: false }]);
    expect(after.travel.booked).toEqual([{ option: "t1 day 26", traveller: "s2", price: 40 }]);
    expect(book.action.precondition(initial, call("t9 day 26"))).toEqual({ holds: false, reason: "no_such_option" });
    const hotelBooked = book.action.effect(initial, call("h1 day 25"));
    expect(book.action.precondition(hotelBooked, call("h1 day 25"))).toEqual({ holds: false, reason: "sold_out" });
    expect(book.action.precondition(loaded(1).initial, call("t1 day 26", 25))).toEqual({ holds: false, reason: "sold_out" });
  });

  it("similar_events lists the similar congresses of the drawn topic, with their prices and sizes", () => {
    const { initial } = loaded();
    expect(JSON.parse(tool("similar_events").sense(initial, "organiser", {}, 0, on(1)))).toEqual([{ name: "Soil Days", price: 60, size: 80 }]);
  });
});

describe("the sponsor's payments (FR-CONGRESS-05)", () => {
  const sp1 = { id: "sp1", amount: 1200, conditions: ["logo", "morning_slot"], insists: ["morning_slot"], pay_days: [1, 3], pick_up: 1, organiser: "organiser" };
  const invoiceNotice: Stimulus = { channel: "invoice_notice", source: "organiser", content: "New invoice from organiser: sponsorship" };
  const invoices = (...each: { id: string; amount: number; paid?: boolean }[]) => () => ({ invoices_to_pay: each.map(({ id, amount, paid = false }) => ({ id, from: "organiser", amount, due: "day 10", for: "sponsorship", paid })) });

  /** A sponsor that has agreed, then is told of the invoices given, at the times given. */
  function agreed(ledger: () => Record<string, unknown>, seed = 1, changes: Record<string, unknown> = {}) {
    const rules = sponsorRules.start({ ...sp1, ...changes }, new Random(seed));
    const clock = { time: "day 2 Tuesday 10:00" };
    const answer = (message: string) => tools(() => message, () => clock.time, ledger);
    drive(rules, answer(""));
    drive(rules, answer("From: organiser. Act: accept_sponsorship. conditions: logo, morning_slot."), [[notice]], true);
    return { rules, clock, answer };
  }

  it("reads its ledger when an invoice notice reaches it, and pays an invoice from the organiser, within its amount, pay_days after, drawn from its own sequence", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const { rules, clock, answer } = agreed(invoices({ id: "i-1", amount: 1200 }), seed);
      const waiting = drive(rules, answer(""), [[invoiceNotice]], true);
      const draws = new Random(seed);
      const days = 1 + draws.next() * 2;
      expect(waiting.at(-1)).toEqual({ kind: "wait", minutes: days * 1440 });
      clock.time = "day 6 Saturday 10:00";
      const paying = drive(rules, answer(""), [[]], true);
      expect(calls(paying, "pay")).toEqual([{ invoice: "i-1" }]);
      expect(rules.outcome()).toMatchObject({ paid: 1200 });
    }
  });

  it("pays nothing beyond its amount, nothing already paid, and nothing without an agreement or after it withdrew", () => {
    const over = agreed(invoices({ id: "i-1", amount: 1500 }, { id: "i-2", amount: 800, paid: true }));
    expect(calls(drive(over.rules, over.answer(""), [[invoiceNotice]], true), "pay")).toEqual([]);
    // No payment set: its only wait is for the programme's check on day 19 (FR-POPULATION-01).
    expect(drive(over.rules, over.answer(""), [[invoiceNotice]], true).filter((step) => step.kind === "wait" && step.minutes < 10 * 1440)).toEqual([]);

    const twice = agreed(invoices({ id: "i-1", amount: 600 }));
    drive(twice.rules, twice.answer(""), [[invoiceNotice]], true);
    drive(twice.rules, twice.answer(""), [[invoiceNotice]], true);
    twice.clock.time = "day 6 Saturday 10:00";
    expect(calls(drive(twice.rules, twice.answer(""), [[]], true), "pay")).toEqual([{ invoice: "i-1" }]);

    const unagreed = sponsorRules.start(sp1, new Random(1));
    drive(unagreed, tools(() => ""));
    expect(drive(unagreed, tools(() => "", undefined, invoices({ id: "i-1", amount: 100 })), [[invoiceNotice]], true).filter((step) => step.kind === "wait" || (step.kind === "call" && step.tool === "pay"))).toEqual([]);

    const withdrawn = agreed(invoices({ id: "i-1", amount: 1200 }));
    drive(withdrawn.rules, withdrawn.answer(""), [[invoiceNotice]], true);
    drive(withdrawn.rules, withdrawn.answer(""), [[{ channel: "sponsor_withdraws", source: "the sponsor's board", content: "x" }]], true);
    withdrawn.clock.time = "day 6 Saturday 10:00";
    expect(calls(drive(withdrawn.rules, withdrawn.answer(""), [[]], true), "pay")).toEqual([]);
  });
});
