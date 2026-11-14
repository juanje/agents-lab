import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { readCalendar } from "../src/engine/calendar.ts";
import { readMoney, startingMoney } from "../src/engine/money.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { Random } from "../src/engine/random.ts";
import type { Tool } from "../src/engine/tools.ts";
import { catererRules, speakerRules, venueRules } from "../src/scenarios/congress-parties.ts";
import { type Population, type PopulationWorld, populationComponent, populationTools } from "../src/scenarios/population.ts";
import { answerFor } from "../src/scenarios/congress-parts.ts";
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
  const mailed = (steps: ReturnType<typeof drive>): { act: unknown; fields: Record<string, unknown> }[] => calls(steps, "send_mail").map(({ act, fields }) => ({ act, fields: fields as Record<string, unknown> }));
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

describe("caterers, invoices, registrants, promotions and the directory (FR-CONGRESS-11)", () => {
  const caterer = { id: "c1", price_per_head: 30, diets: {}, minimum: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], pick_up: 1, organiser: "organiser", event_day: 26 };

  it("a caterer refuses an order or final numbers below its minimum, saying so", () => {
    const answers = (messages: string[]) =>
      calls(conversation(catererRules.start(caterer, new Random(1)), messages.map((message): [string, string] => ["day 2 Tuesday 09:00", message])).steps, "send_mail").map(({ act, fields }) => ({ act, fields }));
    expect(answers(["From: organiser. Act: order. counts: standard: 20. date: day 26."])).toEqual([{ act: "order_refused", fields: { reason: "below_minimum", minimum: 30 } }]);
    expect(answers(["From: organiser. Act: order. counts: standard: 40. date: day 26.", "From: organiser. Act: final_numbers. counts: standard: 25."]).at(-1)).toEqual({ act: "numbers_refused", fields: { reason: "below_minimum", minimum: 30 } });
  });

  it("refuses the organiser's invoice to a party that is no sponsor as invalid_arguments, and no other party's", () => {
    const state = { context: { ids: { speakers: ["s1"], sponsors: ["sp1"] } } } as never;
    const invoice = (agent: string, to: string) => congressScenario.refuses?.(state, { agent, arguments: { to, amount: 500, due: "day 20", for: "deposit" } }, "issue_invoice");
    expect(invoice("organiser", "v1")).toEqual({ outcome: "invalid_arguments", reason: expect.stringContaining("only sponsors are invoiced") });
    expect(invoice("organiser", "sp1")).toBeUndefined();
    expect(invoice("v1", "organiser")).toBeUndefined();
  });

  it("gives every registrant a mailbox that takes the act answer, and says so in the directory", () => {
    const loaded = loadScenario(
      congress({}, (configuration) => {
        configuration.attendees = stringify({ pool_factor: 0.1, base_per_day: 0, unannounced: 0, promotion_factor: 1, payment_fee_share: 0, cancel_share: 0, consent_share: 1, diets: { none: 1 }, access: { none: 1 }, fixed: [{ id: "f-1", between: ["day 1 10:00", "day 1 10:00"] }], group: { size: [2, 3], diet: "vegan", between: ["day 2 10:00", "day 2 10:00"] } });
        configuration.knowledge = "{directory}";
      }),
      1,
    );
    const mail = loaded.mail?.settings;
    // Five of the pool, the fixed person, and up to three of the group after them.
    for (const id of ["a-1", "a-5", "f-1", "a-7", "a-9"]) {
      expect(mail?.mailboxes).toContain(id);
      expect(mail?.acts[id]).toEqual({ answer: ["text"] });
    }
    expect(loaded.systemPrompts.get("organiser")).toMatch(/^Registrants are mailed at their id with the act answer \(text\)\.$/m);
  });

  it("lists the drawn parties grouped by kind, venues, speakers, caterers, sponsors and agency, each kind in an order drawn from the seed", () => {
    const orderOf = (seed: number) => {
      const loaded = loadScenario(
        congress({ speaker: 6, caterer: 1 }, (configuration) => {
          const pools = parse(configuration.pools as string);
          pools.speaker = ["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => ({ id, fee: 0, available: true, acceptance: 1 }));
          pools.caterer = [{ id: "c1", price_per_head: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }] }];
          configuration.pools = stringify(pools);
          configuration.knowledge = "{directory}";
        }),
        seed,
      );
      return [...(loaded.systemPrompts.get("organiser") ?? "").matchAll(/^- ([\w-]+):/gm)].map(([, id]) => id);
    };
    const orders = [1, 2, 3, 4].map(orderOf);
    for (const order of orders) {
      expect(order[0]).toBe("v1");
      expect([...order.slice(1, 7)].sort()).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
      expect(order[7]).toBe("c1");
    }
    expect(new Set(orders.map((order) => order.join())).size).toBeGreaterThan(1);
  });
});

describe("the population's answers and promotions (FR-CONGRESS-11)", () => {
  const material = { pool_factor: 1, base_per_day: 0, unannounced: 0, promotion_factor: 2, payment_fee_share: 0, cancel_share: 0, consent_share: 1, pay_share: 1, no_show_share: 0, diets: { none: 1 }, access: { none: 1 }, fixed: [] };
  const at = (day: number, clock = "09:00") => ({ day, weekday: "Monday" as const, seconds: Number(clock.slice(0, 2)) * 3600 + Number(clock.slice(3)) * 60 });
  const message = (id: string, from: string, to: string, act: string, fields: Record<string, unknown>, received: ReturnType<typeof at>) => ({ id, from, to, act, fields, subject: act, received, read: false });
  const world = (mail: ReturnType<typeof message>[]): PopulationWorld => ({
    population: {
      material,
      eventDay: 26,
      referencePrice: 50,
      draws: {},
      people: [{ id: "a-7", diet: "none", access: "wheelchair", pays: true, consents: true, no_show: false, registered: 600, given: {} }],
      page: { open: true, price: 10, required_fields: [], info: [], waiting_list: false },
      announced: false,
      promotions: [],
      programme: [],
      sponsorData: {},
      events: [],
    },
    money: { balances: {}, invoices: [], commitments: [], ceilings: {}, overruns: [], events: [] } as never,
    mail: { mailboxes: { organiser: mail.filter(({ to }) => to === "organiser"), "a-7": mail.filter(({ to }) => to === "a-7") }, inTransit: [] } as never,
  });

  it("records the organiser's answer to a registrant, and an answer to a question about access makes that need known", () => {
    const state = world([message("m-1", "a-7", "organiser", "question", { about: "access" }, at(1, "11:00")), message("m-2", "organiser", "a-7", "answer", { text: "There is a ramp." }, at(1, "12:00"))]);
    const cycle = populationComponent<PopulationWorld>({ organiser: "organiser", target: 50, msFor: () => 1 }).cycle(new Random(1));
    let current = state;
    for (let guard = 0; guard < 5; guard += 1) {
      const step = cycle.next(current, undefined, 0, at(1, "13:00"));
      if (step.kind !== "action") break;
      current = step.action.effect(current, { world: at(1, "13:00") } as never);
    }
    const population = current.population as Population;
    expect(population.people[0].given).toEqual({ access: "wheelchair" });
    expect(population.events?.filter(({ event }) => event === "answer")).toEqual([{ event: "answer", person: "a-7", known: { access: "wheelchair" }, worldTime: at(1, "13:00") }]);
  });

  it("counts a promotion to the association's list while the page is open as registration_open", () => {
    const tool = populationTools<PopulationWorld>({ organiser: "organiser" }).find(({ name }) => name === "announce") as Tool<PopulationWorld> & { kind: "effector" };
    const after = tool.action?.effect(world([]), { agent: "organiser", arguments: { audience: "association_list", kind: "promotion" }, world: at(2) } as never) as PopulationWorld;
    expect((after.population as Population).announced).toBe(true);
    expect((after.population as Population).promotions).toHaveLength(1);
  });
});

describe("the price gap from a cheapest feasible plan (FR-CONGRESS-11)", () => {
  /** FR-CONGRESS-01's gap scenario, with the venue's interior step-free or through steps. */
  const plan = (interior: true | string) =>
    congress({ venue: 1, speaker: 7, caterer: 2, agency: 1, sponsor: { count: 2, roles: { withdraws: 1 } }, advance: [3000, 3000], budget: [5000, 5000], price_gap: [0.6, 0.6] }, (configuration) => {
      const pools = parse(configuration.pools as string);
      pools.speaker = [0, 50, 100, 150, 200, 400].map((fee, index) => ({ id: `s${index + 1}`, fee, home: index === 1 ? "north" : "local", available: true, acceptance: 1 }));
      // Not available, and available but not accepting: neither counts, whatever its fee.
      (pools.speaker as TomlTable[]).push({ id: "s7", fee: 0, available: false, acceptance: 1 });
      pools.caterer = [25, 30].map((price, index) => ({ id: `c${index + 1}`, price_per_head: price, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }] }));
      pools.agency = [{ id: "a1", price: 460, notice_days: 7 }];
      pools.sponsor = [600, 400, 500].map((amount, index) => ({ id: `sp${index + 1}`, amount, conditions: ["logo"], pay_days: [2, 2], ...(index === 2 ? { roles: ["withdraws"] } : {}) }));
      configuration.pools = stringify(pools);
      configuration.helpers = 2;
      configuration.travel = stringify({ stations: ["north"], trains: [{ id: "t1", from: "north", arrives: "08:30", price: 40 }, { id: "t2", from: "north", arrives: "09:00", price: 60 }], hotels: [], sold_out_probability: 0 });
      const city = parse(configuration.city as string);
      city.passages = (city.passages as TomlTable[]).map((passage) => ((passage.between as string[]).includes("hall-a") ? { ...passage, step_free: interior } : passage));
      configuration.city = stringify(city);
    });

  it("prices the cheapest venue that seats the target, its ramp when its interior has steps, the attendance at the highest price per head, the agency, five speakers' fees and trains, less the advance and the sponsors that stay", () => {
    expect(loadScenario(plan(true), 1).variant).toMatchObject({ cost_covering_price: 16, reference_price: 10, price_gap: 0.6, budget: 5000, advance: 3000 });
    expect(loadScenario(plan("3 steps"), 1).variant).toMatchObject({ cost_covering_price: 20, reference_price: 12.5 });
  });
});

describe("a withdrawal's sessions, as the parts read them (FR-CONGRESS-11)", () => {
  it("counts a withdraw for each session it names, and for no other", () => {
    const received = (at: number) => ({ day: 1, weekday: "Monday" as const, seconds: at * 60 });
    const message = (act: string, fields: Record<string, unknown>, at: number) => ({ id: `m-${at}`, from: "s1", to: "organiser", act, fields, subject: act, received: received(at), read: true });
    const state = { mail: { mailboxes: { organiser: [message("accept", { session: 2 }, 1), message("accept_if", { session: 5, condition: "fee" }, 2), message("withdraw", { sessions: "5", condition: "fee" }, 3)] }, inTransit: [] } } as never;
    expect([answerFor(state, "s1", 2), answerFor(state, "s1", 5)]).toEqual(["accept", "withdraw"]);
  });
});

describe("a speaker's acceptance, its own (FR-CONGRESS-11, FR-CONGRESS-04)", () => {
  it("is the same for a speaker whatever other speakers the pool has", () => {
    const acceptsOf = (count: number) => {
      const loaded = loadScenario(
        congress({ speaker: count }, (configuration) => {
          const pools = parse(configuration.pools as string);
          pools.speaker = Array.from({ length: count }, (_, index) => ({ id: `s${index + 1}`, fee: 0, available: true, acceptance: 0.5 }));
          configuration.pools = stringify(pools);
        }),
        42,
      );
      return (loaded.variant as { accepts: Record<string, boolean> }).accepts;
    };
    for (const count of [6, 7, 9]) expect(Object.entries(acceptsOf(count)).filter(([id]) => id <= "s5").sort()).toEqual(Object.entries(acceptsOf(5)).sort());
  });
});
