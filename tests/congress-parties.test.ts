import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import type { Perceived, RuleStep, Rules } from "../src/engine/participants.ts";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import type { Stimulus } from "../src/engine/stimuli.ts";
import { boardRules, venueRules } from "../src/scenarios/congress-parties.ts";
import { congressScenario } from "../src/scenarios/congress.ts";

/** "v1"'s template, as FR-CONGRESS-02's Background gives it. */
const V1 = {
  id: "v1",
  rooms: [
    { id: "main-hall", seats: 120, equipment: ["projector"] },
    { id: "room-b", seats: 40, equipment: [] },
  ],
  access_claim: "step-free access throughout",
  catering: "approved caterers only",
  opening: "doors open one hour before",
  price: 2000,
  extras: { ramp: 150 },
  hold_days: 2,
  deposit_share: 0.25,
  deposit_due_days: 3,
  cancellation: [{ more_than_days: 14, share: 0.1 }, { share: 0.5 }],
  indicative: true,
  enquiries_per_day: 0,
  pick_up: 1,
};

/** "v1"'s parameters as the congress gives its rule set: its template and what the world adds. */
const params = (changes: Record<string, unknown> = {}) => ({
  ...structuredClone(V1),
  organiser: "organiser",
  event_day: 26,
  floor_plan: [
    { between: ["v1-entrance", "foyer"], step_free: true },
    { between: ["foyer", "room-b"], step_free: "3 steps" },
  ],
  perturbations: [],
  ...changes,
});

/**
 * Drives a rule set as the engine would, with no tools: each call's result is what `answers` gives for it (by default
 * "Done."), and each step is kept. It wakes it at the start, unless it has started, then with each stimulus given; a wait ends at once.
 */
function drive(rules: Rules, answers: (tool: string, args: Record<string, unknown>) => string, wakes: Stimulus[][] = [], started = false) {
  const steps: RuleStep[] = [];
  const take = (first: RuleStep | undefined) => {
    let step = first;
    for (let guard = 0; step !== undefined && step.kind !== "end" && guard < 200; guard += 1) {
      steps.push(step);
      const perceived: Perceived = step.kind === "call" ? { stimuli: [], result: { tool: step.tool, outcome: "success", text: answers(step.tool, step.arguments) } } : { stimuli: [] };
      step = rules.next(perceived);
    }
  };
  if (!started) take(rules.atStart?.());
  for (const stimuli of wakes) take(rules.next({ stimuli }));
  return steps;
}

/** The mail notice of a message from the organiser. */
const notice: Stimulus = { channel: "mail_notice", source: "mail client", content: "New mail from organiser: ask" };

/** What the venue's tools answer: the time, one message in the mailbox, its text, and an empty ledger. */
function venueTools(message: string, time = "day 1 Monday 09:01") {
  return (tool: string) =>
    ({
      check_time: time,
      check_mail: 'm-1: from organiser, subject "x", received day 1 Monday 09:01',
      read_mail: message,
      ledger: JSON.stringify({ balance: "unlimited", invoices_to_pay: [], invoices_issued: [], commitments_bound: [], commitments_recorded: [] }),
    })[tool] ?? "Done.";
}

/** The mails a rule set sent among its steps. */
const mails = (steps: RuleStep[]) => steps.flatMap((step) => (step.kind === "call" && step.tool === "send_mail" ? [step.arguments] : []));

describe("the venue's rules (FR-CONGRESS-02)", () => {
  it("answers ask_quote with a quote: rooms, its access claim, price, hold days, deposit, cancellation schedule and indicative rooms", () => {
    const steps = drive(venueRules.start(params(), new Random(1)), venueTools("From: organiser. Act: ask_quote. date: day 26. attendance: 60."), [[notice]]);

    expect(mails(steps)).toEqual([
      {
        to: "organiser",
        act: "quote",
        fields: {
          rooms: "main-hall: 120 seats, projector; room-b: 40 seats",
          access: "step-free access throughout",
          catering: "approved caterers only",
          price: 2000,
          hold_days: 2,
          deposit_share: 0.25,
          deposit_due_days: 3,
          cancellation: "more than 14 days: 0.1; 14 days or fewer: 0.5",
          opening: "doors open one hour before",
          indicative: true,
        },
      },
    ]);
  });

  it("gives the floor plan with each interior passage's true step_free, and answers what it does not have as not_available", () => {
    const plan = drive(venueRules.start(params(), new Random(1)), venueTools("From: organiser. Act: request_document. kind: floor_plan."), [[notice]]);
    expect(mails(plan)[0]).toEqual({ to: "organiser", act: "document", fields: { kind: "floor_plan", content: "v1-entrance to foyer: step-free; foyer to room-b: 3 steps" } });

    const unknown = drive(venueRules.start(params(), new Random(1)), venueTools("From: organiser. Act: accept_contract. contract: x-1."), [[notice]]);
    expect(mails(unknown)).toEqual([{ to: "organiser", act: "not_available", fields: { what: "x-1" } }]);
  });

  it("holds a free date until hold_days later and waits until then; a date others booked is unavailable", () => {
    const steps = drive(venueRules.start(params(), new Random(1)), venueTools("From: organiser. Act: hold. date: day 26."), [[notice]]);
    expect(mails(steps)).toEqual([{ to: "organiser", act: "held", fields: { date: "day 26", until: "day 3 Wednesday 09:01" } }]);
    // Its clock stands still here, so it keeps waiting until the hold's end.
    expect(steps).toContainEqual({ kind: "wait", minutes: 2 * 1440 });

    const taken = drive(venueRules.start(params({ booked_by_others: ["day 26"] }), new Random(1)), venueTools("From: organiser. Act: ask_quote. date: day 26. attendance: 60."), [[notice]]);
    expect(mails(taken)).toEqual([{ to: "organiser", act: "unavailable", fields: { date: "day 26" } }]);
  });

  it("offers a contract for a booking, and on its acceptance confirms, commits the price and invoices the deposit", () => {
    const rules = venueRules.start(params(), new Random(1));
    const answers = { message: "From: organiser. Act: book. date: day 26. rooms: main-hall. hours: 08:00-18:00." };
    const steps = drive(rules, (tool) => (tool === "read_mail" ? answers.message : venueTools("")(tool)) as string, [[notice]]);
    expect(mails(steps)[0]).toMatchObject({ to: "organiser", act: "contract", fields: { contract: "v1-contract-1", date: "day 26", rooms: "main-hall", hours: "08:00-18:00", price: 2000 } });

    answers.message = "From: organiser. Act: accept_contract. contract: v1-contract-1.";
    const accepted = drive(rules, (tool) => (tool === "read_mail" ? answers.message : venueTools("")(tool)) as string, [[notice]], true);
    const calls = accepted.flatMap((step) => (step.kind === "call" && ["send_mail", "commit", "issue_invoice"].includes(step.tool) ? [[step.tool, step.arguments]] : []));
    expect(calls).toEqual([
      ["send_mail", { to: "organiser", act: "confirmed", fields: { contract: "v1-contract-1" } }],
      ["commit", { with: "organiser", amount: 2000, for: "v1-contract-1" }],
      ["issue_invoice", { to: "organiser", amount: 500, due: "day 4", for: "deposit v1-contract-1" }],
    ]);
  });

  it("answers a ring it picks up with answer_call, with the answer it would mail, and does not pick up at pick_up 0", () => {
    const ring: Stimulus = { channel: "phone", source: "organiser", content: "organiser calls (c-1): ask_quote. date: day 26. attendance: 60. " };
    const picked = drive(venueRules.start(params(), new Random(1)), venueTools(""), [[ring]]);
    const answered = picked.find((step) => step.kind === "call" && step.tool === "answer_call");
    expect(answered).toMatchObject({ arguments: { call: "c-1", act: "quote", fields: { price: 2000 } } });

    const ignored = drive(venueRules.start(params({ pick_up: 0 }), new Random(1)), venueTools(""), [[ring]]);
    expect(ignored.some((step) => step.kind === "call" && step.tool === "answer_call")).toBe(false);
  });
});

describe("the board's rules (FR-CONGRESS-02)", () => {
  const board = { id: "board", funds: 6000, reserve: 1000, organiser: "organiser" };
  const tools = (message: string) => (tool: string) => (tool === "read_mail" ? message : tool === "check_mail" ? 'm-1: from organiser, subject "x", received day 1 Monday 09:01' : "Done.");

  it("approves a budget within its funds: sets the ceiling to costs and contingency, transfers the funds asked, and says so", () => {
    const steps = drive(boardRules.start(board, new Random(1)), tools("From: organiser. Act: submit_budget. costs: 5000. income: 3000. contingency: 500. funds_requested: 2500."), [[notice]]);

    const calls = steps.flatMap((step) => (step.kind === "call" && ["approve", "transfer", "send_mail"].includes(step.tool) ? [[step.tool, step.arguments]] : []));
    expect(calls).toEqual([
      ["send_mail", { to: "organiser", act: "budget_approved", fields: { ceiling: 5500, funds: 2500 } }],
      ["approve", { account: "organiser", ceiling: 5500 }],
      ["transfer", { to: "organiser", amount: 2500, for: "budget" }],
    ]);
  });

  it("counters a budget above its funds with the funds it can give, and approves an extra amount only within its reserve", () => {
    const countered = drive(boardRules.start(board, new Random(1)), tools("From: organiser. Act: submit_budget. costs: 9000. income: 1000. contingency: 500. funds_requested: 8000."), [[notice]]);
    expect(mails(countered)).toEqual([{ to: "organiser", act: "budget_countered", fields: { funds: 6000 } }]);

    // Over a budget it approved, since before one it refuses with no_budget (FR-CONGRESS-07).
    const rules = boardRules.start(board, new Random(1));
    drive(rules, tools("From: organiser. Act: submit_budget. costs: 5000. income: 3000. contingency: 500. funds_requested: 2500."), [[notice]]);
    const refused = drive(rules, tools("From: organiser. Act: request_approval. amount: 1200. reason: ramp."), [[notice]], true);
    expect(mails(refused)).toEqual([{ to: "organiser", act: "refused", fields: { amount: 1200 } }]);
  });
});

describe("the congress's base configuration and its parties (FR-CONGRESS-02)", () => {
  /** The congress with one venue, "v1", in a city that has it, and a board. */
  function congress(changes: (configuration: TomlTable) => void = () => {}): Scenario<unknown> {
    const configuration = parse(congressScenario.baseConfiguration);
    Object.assign(configuration, {
      city: stringify({
        places: [{ id: "office" }],
        venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "foyer" }, { id: "main-hall", seats: 120 }, { id: "room-b", seats: 40 }] }],
        passages: [
          { between: ["office", "v1-entrance"], length: 40, step_free: true },
          { between: ["v1-entrance", "foyer"], length: 1, step_free: true },
          { between: ["foyer", "room-b"], length: 1, step_free: "3 steps" },
        ],
      }),
      pools: stringify({ topics: ["soil"], venue: [V1 as unknown as TomlTable], board: [{ id: "board", funds: 6000, reserve: 1000 }], speaker: [], partner: [], caterer: [], sponsor: [], agency: [] }),
      draw: stringify({ attendance: [50, 80], venue: 1, board: 1 }),
    });
    (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
    changes(configuration);
    return { ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) };
  }

  it("declares the mail, the phone, the money and the kinds venue and board, so a condition can change them", () => {
    const loaded = loadScenario(congress(), 1, { name: "slower", change: stringify({ mail: { delivery_minutes: [2, 2] }, kinds: { venue: { reply_minutes: [10, 20] } } }) });

    expect(loaded.mail?.settings.deliveryMinutes).toEqual([2, 2]);
    expect(loaded.phone?.settings.lines).toEqual(["organiser", "v1", "board"]);
    const v1 = loaded.participants?.find(({ name }) => name === "v1");
    expect(v1).toMatchObject({ decides: "rules", rules: "venue", replyMinutes: [10, 20] });
    expect(v1?.decides === "rules" && v1.params).toMatchObject({ price: 2000, event_day: 26, floor_plan: [{ between: ["v1-entrance", "foyer"], step_free: true }, { between: ["foyer", "room-b"], step_free: "3 steps" }] });
    expect(loaded.money?.settings.accounts).toEqual([
      // The world's travel account (FR-CONGRESS-05).
      { name: "travel", unlimited: true },
      // The attendees' (FR-POPULATION-01).
      { name: "attendees", unlimited: true },
      { name: "organiser", opening: 0, tools: ["ledger", "pay", "issue_invoice"] },
      { name: "v1", unlimited: true },
      { name: "board", opening: 6000 },
    ]);
  });

  it("refuses, naming it, a pool venue the city lacks, a venue template it cannot follow, a perturbation it cannot follow and a board without funds", () => {
    const refusing = (changing: (configuration: TomlTable) => void) => () => loadScenario(congress(changing), 1);
    const changingPools = (changing: (pools: { venue: TomlTable[]; board: TomlTable[] }) => void) => (configuration: TomlTable) => {
      const pools = parse(configuration.pools as string) as unknown as { venue: TomlTable[]; board: TomlTable[] };
      changing(pools);
      configuration.pools = stringify(pools as unknown as TomlTable);
    };

    expect(refusing(changingPools((pools) => pools.venue.push({ ...(V1 as unknown as TomlTable), id: "v9" })))).toThrow(/"v9"/);
    expect(refusing(changingPools((pools) => delete pools.venue[0].price))).toThrow(/"v1".*price/);
    expect(refusing(changingPools((pools) => (pools.venue[0].deposit_share = 1.5)))).toThrow(/"v1".*deposit_share/);
    expect(refusing(changingPools((pools) => (pools.venue[0].cancellation = [{ share: 2 }])))).toThrow(/"v1".*cancellation/);
    expect(refusing(changingPools((pools) => (pools.venue[0].pick_up = -0.1)))).toThrow(/"v1".*pick_up/);
    expect(refusing(changingPools((pools) => delete pools.board[0].funds))).toThrow(/"board".*funds/);
    expect(refusing((configuration) => ((configuration.perturbations as TomlTable).change = { between: ["day 6 09:00", "day 6 10:00"], for: "board" }))).toThrow(/perturbations\.change/);
    expect(refusing((configuration) => ((configuration.perturbations as TomlTable).room_allocation = { at: "Monday" }))).toThrow(/perturbations\.room_allocation/);
  });
});
