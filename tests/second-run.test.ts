import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { readCalendar } from "../src/engine/calendar.ts";
import { readMoney, startingMoney } from "../src/engine/money.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { Random } from "../src/engine/random.ts";
import { speakerRules, venueRules } from "../src/scenarios/congress-parties.ts";
import { congressScenario } from "../src/scenarios/congress.ts";
import { calls, conversation, drive, notice, tools } from "./fixtures/rules.ts";

// FR-CONGRESS-11: the world's corrections from E1's second technical run.

const calendar = readCalendar({ start: "day 1 Monday 09:00", segments: [{ scale: 6000 }] });

/** A congress with one venue and one speaker, the draw given, and any keys changed. */
function congress(draw: TomlTable = {}, changes: (configuration: TomlTable) => void = () => {}): Scenario<unknown> {
  const configuration = parse(congressScenario.baseConfiguration);
  const venue = { id: "v1", rooms: [{ id: "hall-a", seats: 80 }], access_claim: "step-free", price: 2000, extras: { ramp: 200 }, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }] };
  Object.assign(configuration, {
    city: stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "hall-a", seats: 80 }] }], passages: [{ between: ["office", "v1-entrance"], length: 5, step_free: true }, { between: ["v1-entrance", "hall-a"], length: 1, step_free: true }] }),
    pools: stringify({ topics: ["soil"], venue: [venue], board: [], speaker: [{ id: "s1", fee: 0, available: true, acceptance: 1 }], partner: [], caterer: [], sponsor: [], agency: [] }),
    draw: stringify({ attendance: [50, 50], venue: 1, speaker: 1, ...draw }),
  });
  (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
  changes(configuration);
  return { ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) };
}

describe("a money account's ceiling from the configuration (FR-CONGRESS-11, FR-MONEY-01)", () => {
  it("is in force from the start, and a negative one is refused, naming it", () => {
    const settings = readMoney({ discretionary_limit: 300, accounts: { ana: { opening: 1500, ceiling: 4000 } } } as never, calendar, ["ana"]);
    expect(startingMoney(settings).ceilings).toEqual({ ana: 4000 });
    expect(() => readMoney({ discretionary_limit: 300, accounts: { ana: { opening: 0, ceiling: -1 } } } as never, calendar, ["ana"])).toThrow(/money\.accounts\.ana\.ceiling/);
  });
});

describe("a fixed budget and an advance (FR-CONGRESS-11)", () => {
  it("draws each as a whole number between its two numbers, gives both in the variant, and opens the organiser's account with the advance and the budget as its ceiling", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const loaded = loadScenario(congress({ budget: [3000, 5000], advance: [1000, 2000] }), seed);
      const { budget, advance } = loaded.variant as { budget: number; advance: number };
      expect(Number.isInteger(budget) && budget >= 3000 && budget <= 5000).toBe(true);
      expect(Number.isInteger(advance) && advance >= 1000 && advance <= 2000).toBe(true);
      const money = (loaded.world.state as { money: { balances: Record<string, number>; ceilings: Record<string, number> } }).money;
      expect([money.balances.organiser, money.ceilings.organiser]).toEqual([advance, budget]);
    }
  });

  it("fills {budget} and {advance} in the texts, and refuses either, naming it and its text, when the draw gives none, and a range whose first number is above its second", () => {
    const loaded = loadScenario(congress({ budget: [4000, 4000], advance: [1500, 1500] }, (configuration) => (configuration.task = "Spend {budget}; you have {advance}.")), 1);
    expect(loaded.channels.find(({ name }) => name === "person")?.stimulus).toBe("Spend 4000; you have 1500.");
    expect(() => loadScenario(congress({}, (configuration) => (configuration.task = "Spend {budget}.")), 1)).toThrow(/task.*\{budget\}/);
    expect(() => loadScenario(congress({ budget: [4000, 4000] }, (configuration) => (configuration.limits = "You have {advance}.")), 1)).toThrow(/limits.*\{advance\}/);
    expect(() => loadScenario(congress({ budget: [5000, 3000] }), 1)).toThrow(/draw\.budget/);
    expect(() => loadScenario(congress({ advance: [2000, 1000] }), 1)).toThrow(/draw\.advance/);
  });
});

describe("no board drawn (FR-CONGRESS-11)", () => {
  it("has the partner's session mail come from the association, which has no mailbox and no line, at the calendar's start", () => {
    const loaded = loadScenario(
      congress({ partner: 1 }, (configuration) => {
        const pools = parse(configuration.pools as string);
        pools.partner = [{ id: "p1", session: 3, fee: 0, available: true }];
        configuration.pools = stringify(pools);
      }),
      1,
    );
    const mail = loaded.mail?.settings;
    expect(mail?.initial.map(({ from, to, act }) => ({ from, to, act }))).toEqual([{ from: "association", to: "organiser", act: "partner_session" }]);
    expect(mail?.mailboxes).not.toContain("association");
    expect(loaded.phone?.settings.lines).not.toContain("association");
  });
});

describe("speakers' acceptance drawn with the variant (FR-CONGRESS-11)", () => {
  /** A congress with twelve available speakers of acceptance 0.5, of which the draw takes 8 with min_accepting as given. */
  const twelve = (minAccepting: number, available = 12) =>
    congress({ speaker: { count: 8, min_accepting: minAccepting } }, (configuration) => {
      const pools = parse(configuration.pools as string);
      pools.speaker = Array.from({ length: 12 }, (_, index) => ({ id: `s${index + 1}`, fee: 0, available: index < available, acceptance: 0.5 }));
      configuration.pools = stringify(pools);
    });

  it("gives each chosen speaker's accepts in the variant and its parameters, and redraws the speakers until at least min_accepting available ones accept", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const loaded = loadScenario(twelve(6), seed);
      const { chosen, accepts } = loaded.variant as { chosen: Record<string, string[]>; accepts: Record<string, boolean> };
      expect(Object.keys(accepts).sort()).toEqual([...chosen.speaker].sort());
      expect(Object.values(accepts).filter(Boolean).length).toBeGreaterThanOrEqual(6);
      for (const id of chosen.speaker) expect(((loaded.participants ?? []).find(({ name }) => name === id) as { params: Record<string, unknown> }).params.accepts).toBe(accepts[id]);
    }
  });

  it("refuses a replica that finds too few accepting available speakers in 100 draws, naming draw.speaker.min_accepting", () => {
    expect(() => loadScenario(twelve(5, 4), 1)).toThrow(/draw\.speaker\.min_accepting/);
  });
});

describe("a speaker's answer from its drawn accepts (FR-CONGRESS-11)", () => {
  const invite = (accepts: boolean, acceptance: number) => {
    const rules = speakerRules.start({ id: "s1", fee: 0, available: true, acceptance, accepts, organiser: "organiser", event_day: 26 }, new Random(1));
    const { steps } = conversation(rules, [["day 1 Monday 09:01", "From: organiser. Act: invite. session: 1. time: 10:00. fee: 0. travel_paid: false."]]);
    return calls(steps, "send_mail").map(({ act }) => act);
  };

  it("answers its first invitation as its accepts says, whatever its acceptance", () => {
    expect(invite(false, 1)).toEqual(["decline"]);
    expect(invite(true, 0)).toEqual(["accept"]);
  });
});

describe("speakers' withdrawals, illness and conditions (FR-CONGRESS-11)", () => {
  const params = (changes: Record<string, unknown> = {}) => ({ id: "s1", fee: 300, home: "local", available: true, acceptance: 1, condition: "fee", organiser: "organiser", event_day: 26, ...changes });
  const invite = (session: number, fee: number, time = "10:00") => `From: organiser. Act: invite. session: ${session}. time: ${time}. fee: ${fee}. travel_paid: false.`;
  /** Its steps as one more message reaches it, read at a time, once it has started. */
  const then = (rules: ReturnType<typeof speakerRules.start>, time: string, message: string) => drive(rules, tools(() => message, () => time), [[notice]], true);

  it("withdraws at day 19 only the sessions still waiting on its condition, naming them, and keeps those it accepted", () => {
    const rules = speakerRules.start(params(), new Random(1));
    const { steps } = conversation(rules, [
      ["day 2 Tuesday 10:00", invite(2, 300)],
      ["day 2 Tuesday 11:00", invite(5, 0, "14:00")],
    ]);
    expect(calls(steps, "send_mail").map(({ act }) => act)).toEqual(["accept", "accept_if"]);
    const after = then(rules, "day 19 Friday 00:00", "From: organiser. Act: ask_promote.");
    const withdrawn = calls(after, "send_mail").filter(({ act }) => act === "withdraw");
    expect(withdrawn.map(({ fields }) => fields)).toEqual([{ sessions: "5", condition: "fee" }]);
    const confirmed = then(rules, "day 19 Friday 01:00", "From: organiser. Act: confirm. time: 10:00. room: hall-a. length: 45. travel: none.");
    expect(calls(confirmed, "send_mail").map(({ act }) => act)).toContain("acknowledged");
  });

  it("once ill, declines every invitation and panel, and answers a confirm or change with not_available", () => {
    const rules = speakerRules.start(params({ condition: undefined, fee: 0 }), new Random(1));
    conversation(rules, [["day 1 Monday 09:01", invite(3, 0)]]);
    drive(rules, tools(() => "", () => "day 1 Monday 12:00"), [[{ channel: "early_cancel", source: "illness", content: "You are ill and cannot give your session." }]], true);
    const steps = [
      ...then(rules, "day 1 Monday 13:00", "From: organiser. Act: ask_panel. slot: 16:00."),
      ...then(rules, "day 1 Monday 13:01", invite(4, 0, "11:00")),
      ...then(rules, "day 1 Monday 13:02", "From: organiser. Act: confirm. time: 10:00. room: hall-a. length: 45. travel: none."),
      ...then(rules, "day 1 Monday 13:03", "From: organiser. Act: change. time: 11:00."),
    ];
    expect(calls(steps, "send_mail").map(({ act }) => act)).toEqual(["decline", "decline", "not_available", "not_available"]);
  });

  it("states what its condition needs in its accept_if", () => {
    const answer = (changes: Record<string, unknown>, message: string) => calls(conversation(speakerRules.start(params(changes), new Random(1)), [["day 1 Monday 09:01", message]]).steps, "send_mail")[0]?.fields;
    expect(answer({}, invite(1, 0, "15:00"))).toEqual({ session: 1, condition: "fee", fee: 300 });
    expect(answer({ condition: "travel_paid", home: "north", fee: 0 }, invite(1, 0, "15:00"))).toEqual({ session: 1, condition: "travel_paid", travel_paid: true, from: "north" });
    expect(answer({ condition: "morning_slot", fee: 0 }, invite(1, 0, "15:00"))).toEqual({ session: 1, condition: "morning_slot", time: "before 12:00" });
  });
});

describe("venues' corrections (FR-CONGRESS-11)", () => {
  const venue = (changes: Record<string, unknown> = {}) => ({
    id: "v1",
    rooms: [
      { id: "hall-a", seats: 80 },
      { id: "hall-b", seats: 40 },
      { id: "annex", seats: 50 },
    ],
    access_claim: "step-free",
    price: 2000,
    extras: { early_access: 50, ramp: 200 },
    hold_days: 2,
    deposit_share: 0.25,
    deposit_due_days: 3,
    cancellation: [{ share: 0.5 }],
    pick_up: 1,
    organiser: "organiser",
    event_day: 26,
    floor_plan: [],
    perturbations: [],
    ...changes,
  });
  const mailed = (steps: ReturnType<typeof drive>) => calls(steps, "send_mail").map(({ act, fields }) => ({ act, fields }));
  const book = (rooms: string): [string, string] => ["day 1 Monday 09:01", `From: organiser. Act: book. date: day 26. rooms: ${rooms}. hours: 08:00-18:00.`];
  const accept: [string, string] = ["day 1 Monday 09:02", "From: organiser. Act: accept_contract. contract: v1-contract-1."];

  it("gives its extras with their prices in its quote", () => {
    const { steps } = conversation(venueRules.start(venue(), new Random(1)), [["day 1 Monday 09:01", "From: organiser. Act: ask_quote. date: day 26. attendance: 60."]]);
    expect(mailed(steps)[0].fields.extras).toBe("early_access: 50; ramp: 200");
  });

  it("raises its price instead of taking a room from a booking with one room", () => {
    const rules = venueRules.start(venue({ perturbations: [{ name: "change", kind: "room_lost", at: "day 1 12:00" }] }), new Random(1));
    conversation(rules, [book("hall-a"), accept]);
    const steps = drive(rules, tools(() => "", () => "day 1 Monday 12:00"), [[]], true);
    expect(mailed(steps).map(({ act }) => act)).toEqual(["price_change"]);
  });

  it("answers unavailable to a change of booking naming a room its allocation moved away", () => {
    const rules = venueRules.start(venue({ indicative: true, perturbations: [{ name: "room_allocation", at: "day 1 12:00" }] }), new Random(1));
    conversation(rules, [book("hall-a, hall-b"), accept]);
    const allocated = drive(rules, tools(() => "", () => "day 1 Monday 12:00"), [[]], true);
    expect(mailed(allocated)[0].fields.allocation).toBe("hall-a -> hall-a; hall-b -> annex");
    const steps = drive(rules, tools(() => "From: organiser. Act: change_booking. rooms: hall-a, hall-b, annex. hours: 08:00-18:00.", () => "day 1 Monday 13:00"), [[notice]], true);
    expect(mailed(steps).map(({ act }) => act)).toEqual(["unavailable"]);
  });

  it("answers a repeat of a message it answered already_sent, with the earlier answer's act and world time, and changes nothing", () => {
    const rules = venueRules.start(venue(), new Random(1));
    const ask = "From: organiser. Act: ask_quote. date: day 26. attendance: 60.";
    const { steps } = conversation(rules, [
      ["day 1 Monday 10:01", ask],
      ["day 1 Monday 11:01", ask],
    ]);
    expect(mailed(steps).map(({ act, fields }) => (act === "already_sent" ? { act, fields } : act))).toEqual(["quote", { act: "already_sent", fields: { act: "quote", sent: "day 1 Monday 10:01" } }]);
  });
});
