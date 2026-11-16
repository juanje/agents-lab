import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import type { Stimulus } from "../src/engine/stimuli.ts";
import { boardRules, catererRules, speakerRules, venueRules } from "../src/scenarios/congress-parties.ts";
import { congressScenario } from "../src/scenarios/congress.ts";
import { type ToolAnswer, calls, conversation, drive, notice, tools, venueChange } from "./fixtures/rules.ts";

/** "v1"'s parameters: main-hall (120 seats) and room-b (40), the day price 2000, and what the world adds. */
const venue = (changes: Record<string, unknown> = {}) => ({
  id: "v1",
  rooms: [
    { id: "main-hall", seats: 120, equipment: ["projector"] },
    { id: "room-b", seats: 40, equipment: [] },
  ],
  access_claim: "step-free",
  catering: "outside_fee",
  outside_fee_per_head: 5,
  price: 2000,
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

const DAY = "day 1 Monday 09:01";
const book = (rooms: string) => [DAY, `From: organiser. Act: book. date: day 26. rooms: ${rooms}. hours: 08:00-18:00.`] as [string, string];
const accept: [string, string] = [DAY, "From: organiser. Act: accept_contract. contract: v1-contract-1."];
const mailed = (steps: ReturnType<typeof conversation>["steps"]) => calls(steps, "send_mail").map(({ act, fields }) => ({ act, fields }));
const committed = (k: string, amount: number, what: string) => () => ({ commitments_recorded: [{ id: k, with: "organiser", amount, for: what }] });

describe("a venue's catering rule, rooms and lost rooms (FR-CONGRESS-07)", () => {
  it("quotes outside catering at its fee per head and gives a permit as an extra, committing the fee; an in-house venue gives none", () => {
    const { steps } = conversation(venueRules.start(venue(), new Random(1)), [
      book("main-hall"),
      accept,
      [DAY, "From: organiser. Act: request_extra. item: outside_catering. attendance: 40."],
      [DAY, "From: organiser. Act: accept_extra. item: outside_catering."],
    ]);
    expect(mailed(steps).slice(2)).toEqual([
      { act: "extra_quote", fields: { item: "outside_catering", price: 200 } },
      { act: "extra_confirmed", fields: { item: "outside_catering", price: 200, permit: "v1-permit-1" } },
    ]);
    expect(calls(steps, "commit").at(-1)).toEqual({ with: "organiser", amount: 200, for: "v1-contract-1 extra outside_catering" });

    const inHouse = conversation(venueRules.start(venue({ catering: "in_house" }), new Random(1)), [book("main-hall"), accept, [DAY, "From: organiser. Act: request_extra. item: outside_catering. attendance: 40."]]);
    // With the reason FR-CONGRESS-25 adds when no diet is named.
    expect(mailed(inHouse.steps).at(-1)).toEqual({ act: "not_available", fields: { what: "outside_catering", reason: "name a diet our caterer cannot serve in full" } });
  });

  it("changes a booking's rooms, its price following each room's share of the day price by seats, committing the difference", () => {
    const { steps } = conversation(venueRules.start(venue(), new Random(1)), [book("main-hall"), accept, [DAY, "From: organiser. Act: change_booking. rooms: main-hall, room-b. hours: 08:00-18:00."]]);
    expect(mailed(steps).at(-1)).toEqual({ act: "contract_changed", fields: { contract: "v1-contract-1", rooms: "main-hall, room-b", hours: "08:00-18:00", price: 2500 } });
    expect(calls(steps, "commit").at(-1)).toEqual({ with: "organiser", amount: 500, for: "v1-contract-1 change" });

    const dropped = conversation(venueRules.start(venue(), new Random(1)), [book("main-hall, room-b"), accept, [DAY, "From: organiser. Act: change_booking. rooms: main-hall. hours: 08:00-18:00."]], committed("k-1", 2000, "v1-contract-1"));
    expect(mailed(dropped.steps).at(-1)?.fields).toMatchObject({ price: 1500 });
    expect(calls(dropped.steps, "release")).toEqual([{ commitment: "k-1" }]);
    expect(calls(dropped.steps, "commit").at(-1)).toEqual({ with: "organiser", amount: 1500, for: "v1-contract-1" });

    const unknown = conversation(venueRules.start(venue(), new Random(1)), [book("main-hall"), accept, [DAY, "From: organiser. Act: change_booking. rooms: ballroom. hours: 08:00-18:00."]]);
    // An unknown room is named, without the date (FR-CONGRESS-23).
    expect(mailed(unknown.steps).at(-1)).toEqual({ act: "unavailable", fields: { room: "ballroom" } });
  });

  it("quotes an extra room, the smallest free one with the seats asked, or none", () => {
    const { steps } = conversation(venueRules.start(venue(), new Random(1)), [book("main-hall"), accept, [DAY, "From: organiser. Act: request_extra. item: room. seats: 30."], [DAY, "From: organiser. Act: request_extra. item: room. seats: 200."]]);
    expect(mailed(steps).slice(2)).toEqual([
      { act: "extra_quote", fields: { item: "room", room: "room-b", price: 500 } },
      { act: "not_available", fields: { what: "room" } },
    ]);
  });

  it("after a lost room offers its largest free smaller room and a cut of the lost room's price, and takes the option chosen", () => {
    const rooms = [
      { id: "main-hall", seats: 150, equipment: [] },
      { id: "room-b", seats: 30, equipment: [] },
      { id: "room-c", seats: 20, equipment: [] },
    ];
    const lost = (option: string) => {
      const rules = venueRules.start(venue({ rooms }), new Random(1));
      const first = conversation(rules, [book("main-hall, room-b"), accept]);
      first.clock.time = "day 1 Monday 12:00";
      const changed = drive(rules, tools(() => "", () => first.clock.time), [[venueChange("room_lost")]], true);
      const chosen = drive(rules, tools(() => `From: organiser. Act: accept_change. option: ${option}.`, () => first.clock.time, committed("k-1", 2000, "v1-contract-1")), [[notice]], true);
      return { changed: calls(changed, "send_mail"), chosen };
    };
    const smaller = lost("smaller_room");
    // With answer_by, 72 world hours after the mail is delivered, here at once (FR-CONGRESS-16).
    expect(smaller.changed).toEqual([{ to: "organiser", act: "room_lost", fields: { contract: "v1-contract-1", room: "room-b", offer: "smaller_room", smaller: "room-c", cut: 300, answer_by: "day 4 Thursday 12:00" } }]);
    expect(calls(smaller.chosen, "send_mail")).toEqual([{ to: "organiser", act: "confirmed", fields: { contract: "v1-contract-1", price: 2000, rooms: "main-hall, room-c" } }]);
    const cut = lost("price_cut");
    expect(calls(cut.chosen, "send_mail")).toEqual([{ to: "organiser", act: "confirmed", fields: { contract: "v1-contract-1", price: 1700, rooms: "main-hall" } }]);
    expect(calls(cut.chosen, "release")).toEqual([{ commitment: "k-1" }]);
    expect(calls(cut.chosen, "commit")).toEqual([{ with: "organiser", amount: 1700, for: "v1-contract-1" }]);
  });
});

describe("a caterer at a venue with a catering rule (FR-CONGRESS-07)", () => {
  const caterer = (changes: Record<string, unknown> = {}) =>
    catererRules.start(
      {
        id: "c1",
        price_per_head: 30,
        minimum: 20,
        final_days: 7,
        deposit_share: 0.2,
        deposit_due_days: 3,
        cancellation: [{ share: 0.3 }],
        organiser: "organiser",
        event_day: 26,
        venues: { v1: { catering: "in_house" }, v2: { catering: "outside_fee" }, v3: { catering: "outside_free" } },
        ...changes,
      },
      new Random(1),
    );
  const order = (venueId: string, permit = "") => `From: organiser. Act: order. counts: standard: 40. date: day 26. venue: ${venueId}.${permit}`;
  // read_permit gives "v2-permit-1" as "v2" gave it (FR-CONGRESS-22).
  const answer = (rules: ReturnType<typeof caterer>, message: string) => {
    const permits: ToolAnswer = (tool, args) => (tool === "read_permit" && args.permit === "v2-permit-1" ? { text: JSON.stringify({ permit: "v2-permit-1", venue: "v2" }) } : tools(() => message)(tool, args));
    drive(rules, tools(() => ""));
    return mailed(drive(rules, permits, [[notice]], true))[0];
  };

  it("refuses an order for a venue that asks for a permit unless it gives one, or it is the venue's in-house caterer", () => {
    // With the venue and what it needs, as FR-CONGRESS-25 adds them.
    expect(answer(caterer(), order("v1"))).toMatchObject({ act: "order_refused", fields: { reason: "venue_requires_permit", venue: "v1" } });
    expect(answer(caterer(), order("v2"))).toMatchObject({ act: "order_refused", fields: { reason: "venue_requires_permit", venue: "v2" } });
    expect(answer(caterer(), order("v2", " permit: v2-permit-1.")).act).toBe("order_confirmed");
    expect(answer(caterer(), order("v3")).act).toBe("order_confirmed");
    expect(answer(caterer({ id: "c9", in_house_for: "v1" }), order("v1")).act).toBe("order_confirmed");
  });
});

describe("a venue's bookings and lost rooms (FR-CONGRESS-09)", () => {
  it("answers a second book from a customer that holds a contract for that date with contract_held and that contract's id", () => {
    const { steps } = conversation(venueRules.start(venue(), new Random(1)), [book("main-hall"), book("main-hall, room-b")]);
    expect(mailed(steps).at(-1)).toEqual({ act: "contract_held", fields: { contract: "v1-contract-1", date: "day 26" } });
  });

  /** A booking with these rooms, accepted, and the room_lost change at noon: what the venue mailed at noon, and then. */
  function losing(rooms: string, then: [string, string][] = [], changes: Record<string, unknown> = {}) {
    const rules = venueRules.start(venue(changes), new Random(1));
    const first = conversation(rules, [book(rooms), accept]);
    first.clock.time = "day 1 Monday 12:00";
    const changed = drive(rules, tools(() => "", () => first.clock.time), [[venueChange("room_lost")]], true);
    const later = then.flatMap(([time, message]) => {
      first.clock.time = time;
      return drive(rules, tools(() => message, () => first.clock.time), [[notice]], true);
    });
    return { changed: calls(changed, "send_mail"), later: calls(later, "send_mail") };
  }

  it("takes a room only from a booking with more than one; the lost room stays unavailable for that date", () => {
    // A booking of its smallest room only, with "main-hall" booked by another customer, has its price raised instead
    // (FR-CONGRESS-11, FR-CONGRESS-17, FR-CONGRESS-19).
    expect(losing("room-b", [], { rooms_booked_by_others: ["main-hall"] }).changed.map(({ act }) => act)).toEqual(["price_change"]);

    // The change answered first: a pending change holds the booking (FR-CONGRESS-16).
    const { changed, later } = losing("main-hall, room-b", [
      ["day 1 Monday 12:30", "From: organiser. Act: accept_change. option: price_cut."],
      ["day 1 Monday 13:00", "From: organiser. Act: change_booking. rooms: main-hall. hours: 08:00-18:00."],
      ["day 1 Monday 14:00", "From: organiser. Act: change_booking. rooms: main-hall, room-b. hours: 08:00-18:00."],
    ]);
    expect(changed).toMatchObject([{ act: "room_lost", fields: { room: "room-b", cut: 500 } }]);
    expect(later.map(({ act }) => act)).toEqual(["confirmed", "contract_changed", "unavailable"]);
  });
});

describe("a party's own mail within its hours (FR-CONGRESS-09)", () => {
  it("sends its own mail, such as a perturbation's notice, at the first moment within its hours", () => {
    const OFFICE = { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], from: "09:00", to: "17:00" };
    const rules = venueRules.start(venue({ keeps: OFFICE }), new Random(1));
    const first = conversation(rules, [book("main-hall"), accept]);
    first.clock.time = "day 3 Wednesday 23:00";
    const night = drive(rules, tools(() => "", () => first.clock.time), [[venueChange("price_change")]], true);
    expect(calls(night, "send_mail")).toEqual([]);
    expect(night.at(-1)).toEqual({ kind: "wait", minutes: 600 });

    first.clock.time = "day 4 Thursday 09:00";
    const morning = drive(rules, tools(() => "", () => first.clock.time), [[]], true);
    expect(calls(morning, "send_mail").map(({ act }) => act)).toEqual(["price_change"]);
  });
});

describe("a party's answers to repeated mail (FR-CONGRESS-09)", () => {
  it("gives no second answer to a message that repeats one it answered, with the same act and fields", () => {
    const board = () => boardRules.start({ id: "board", funds: 6000, reserve: 1000, organiser: "organiser" }, new Random(1));
    const report = (text: string): [string, string] => [DAY, `From: organiser. Act: report. note: ${text}.`];

    // A repeat is answered already_sent, with the first answer's act and time (FR-CONGRESS-11).
    expect(mailed(conversation(board(), [report("a"), report("a")]).steps)).toEqual([
      { act: "acknowledged", fields: {} },
      { act: "already_sent", fields: { act: "acknowledged", sent: "day 1 Monday 09:01" } },
    ]);
    expect(mailed(conversation(board(), [report("a"), report("b")]).steps)).toEqual([
      { act: "acknowledged", fields: {} },
      { act: "acknowledged", fields: {} },
    ]);
  });
});

describe("the board before a budget (FR-CONGRESS-07)", () => {
  it("refuses a request for approval while no budget is approved, with the reason no_budget", () => {
    const { steps } = conversation(boardRules.start({ id: "board", funds: 6000, reserve: 1000, organiser: "organiser" }, new Random(1)), [[DAY, "From: organiser. Act: request_approval. amount: 400. reason: interpreter."]]);
    expect(mailed(steps)).toEqual([{ act: "refused", fields: { amount: 400, reason: "no_budget", reserve: 1000 } }]);
  });
});

describe("a speaker's hard constraint and its confirmations (FR-CONGRESS-07)", () => {
  const speaker = (changes: Record<string, unknown> = {}) => speakerRules.start({ id: "s6", title: "Soil law", fee: 300, home: "local", available: true, acceptance: 1, organiser: "organiser", event_day: 26, ...changes }, new Random(1));
  const invite = (time: string, fee: number) => `From: organiser. Act: invite. session: 4. time: ${time}. fee: ${fee}. travel_paid: false.`;
  const confirm = "From: organiser. Act: confirm. time: 10:00. room: main-hall. length: 45. travel: none.";

  it("declines an invitation that breaks its constraint, whatever its condition", () => {
    expect(mailed(conversation(speaker({ constraint: "morning", condition: "fee" }), [[DAY, invite("14:00", 300)]]).steps)).toEqual([{ act: "decline", fields: { session: 4 } }]);
  });

  it("answers a confirmation before it has accepted, or while its condition is unmet, with not_available acceptance, and believes nothing", () => {
    const before = speaker();
    expect(mailed(conversation(before, [[DAY, confirm]]).steps)).toEqual([{ act: "not_available", fields: { what: "acceptance" } }]);
    expect(before.outcome()).toMatchObject({ believes_time: "none", believes_room: "none" });
    const unmet = speaker({ condition: "fee" });
    expect(mailed(conversation(unmet, [[DAY, invite("10:00", 100)], [DAY, confirm]]).steps).map(({ act }) => act)).toEqual(["accept_if", "not_available"]);
  });
});

describe("a missed call returned (FR-CONGRESS-07)", () => {
  const ring: Stimulus = { channel: "phone", source: "organiser", content: "organiser calls (c-1): ask_quote. date: day 26. attendance: 60. " };

  it("a party that does not pick up calls back with probability 0.5, from its own sequence, within its reply delay, with missed_call; answered, it answers the original act by mail", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const draws = new Random(seed);
      const picksUp = draws.next() < 0.5;
      const callsBack = !picksUp && draws.next() < 0.5;
      const after = 5 + draws.next() * 60;
      const rules = venueRules.start(venue({ pick_up: 0.5, call_back_minutes: [5, 65] }), new Random(seed));
      const clock = { time: DAY };
      drive(rules, tools(() => "", () => clock.time));
      const missed = drive(rules, tools(() => "", () => clock.time), [[ring]], true);
      if (picksUp || !callsBack) {
        expect(missed.some((step) => step.kind === "wait")).toBe(false);
        continue;
      }
      expect(missed.at(-1)).toEqual({ kind: "wait", minutes: after });
      clock.time = "day 1 Monday 11:00";
      const back = drive(rules, (tool, args) => (tool === "call" ? { text: "Answer from organiser. Act: noted." } : tools(() => "", () => clock.time)(tool, args)), [[]], true);
      expect(calls(back, "call")).toEqual([{ to: "organiser", act: "missed_call" }]);
      expect(calls(back, "send_mail")[0]).toMatchObject({ to: "organiser", act: "quote" });
    }
  });
});

describe("what the congress gives its parties for FR-CONGRESS-07", () => {
  /** The congress with "v1" (in-house catering) and "v2", the caterer "c1", and the venues' reply delay. */
  function loaded() {
    const configuration = parse(congressScenario.baseConfiguration);
    configuration.city = stringify({
      places: [{ id: "office" }],
      venues: ["v1", "v2"].map((id) => ({ id, entrance: `${id}-entrance`, hours: "always", rooms: [{ id: `${id}-hall`, seats: 120 }] })),
      passages: ["v1", "v2"].map((id) => ({ between: ["office", `${id}-entrance`], length: 40, step_free: true })),
    });
    (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
    const template = { rooms: [{ id: "hall", seats: 120 }], access_claim: "step-free", price: 2000, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }] };
    configuration.pools = stringify({
      topics: ["soil"],
      venue: [{ id: "v1", ...template, catering: "in_house", reply_minutes: [10, 30] }, { id: "v2", ...template, catering: "outside_fee", outside_fee_per_head: 5 }],
      board: [],
      speaker: [],
      partner: [],
      caterer: [{ id: "c1", price_per_head: 30, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }] }],
      sponsor: [],
      agency: [],
    });
    configuration.draw = stringify({ attendance: [50, 80], venue: 2, caterer: 1 });
    return loadScenario({ ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) }, 1);
  }
  const paramsOf = (name: string) => {
    const participant = loaded().participants?.find((each) => each.name === name);
    return participant?.decides === "rules" ? participant.params : {};
  };

  it("gives every party its own id, by which it names what it commits and invoices", () => {
    expect(paramsOf("c1").id).toBe("c1");
    expect(paramsOf("v1").id).toBe("v1");
  });

  it("gives a caterer each chosen venue's catering rule", () => {
    expect(paramsOf("c1").venues).toEqual({ v1: { catering: "in_house" }, v2: { catering: "outside_fee" } });
  });

  it("gives each party the minutes it calls a missed ring back within: from the ring's end to its reply delay after it", () => {
    // A world minute after the ring ends, so as not to find the caller's line still busy.
    expect(paramsOf("v1").call_back_minutes).toEqual([6, 36]);
    expect(paramsOf("v2").call_back_minutes).toEqual([6, 6]);
  });
});

describe("the away factor on the web tools (FR-CONGRESS-07)", () => {
  it("lengthens travel_options and similar_events by away_factor for the organiser away from the office", () => {
    const at = (place: string) => {
      const configuration = parse(congressScenario.baseConfiguration);
      configuration.city = stringify({ places: [{ id: "office" }, { id: "station" }], passages: [{ between: ["office", "station"], length: 10, step_free: true }] });
      configuration.organiser_place = place;
      configuration.away_factor = 1.5;
      Object.assign(configuration.durations as TomlTable, { travel_options: 2, similar_events: 4 });
      return loadScenario({ ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) }, 1).world.state;
    };
    const duration = (state: unknown, tool: string) => (congressScenario.tools.find((each) => each.name === tool) as { durationMs: (...args: unknown[]) => unknown }).durationMs(state, { agent: "organiser", arguments: {} });
    expect([duration(at("office"), "travel_options"), duration(at("office"), "similar_events")]).toEqual([{ worldSeconds: 120 }, { worldSeconds: 240 }]);
    expect([duration(at("station"), "travel_options"), duration(at("station"), "similar_events")]).toEqual([{ worldSeconds: 180 }, { worldSeconds: 360 }]);
  });
});

describe("the parties' phones (FR-CONGRESS-07)", () => {
  it("gives every party's kind the tool call, to call a missed ring back", () => {
    const kinds = parse(congressScenario.baseConfiguration).kinds as Record<string, { tools: string[] }>;
    for (const [kind, { tools: declared }] of Object.entries(kinds)) expect(declared, kind).toContain("call");
  });
});
