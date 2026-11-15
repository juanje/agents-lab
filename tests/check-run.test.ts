import { describe, expect, it } from "vitest";
import { Random } from "../src/engine/random.ts";
import { venueRules } from "../src/scenarios/congress-parties.ts";
import * as parts from "../src/scenarios/congress-parts.ts";
import type { Congress } from "../src/scenarios/congress.ts";
import { calls, conversation, drive, notice, tools, venueChange } from "./fixtures/rules.ts";

// FR-CONGRESS-19: the corrections from E1's check run.

const { bookingsOf, congressParts } = parts;

/** The acts of the mail a rule set sent, in order. */
const mailed = (steps: ReturnType<typeof drive>) => calls(steps, "send_mail").map(({ act }) => act);

/** A venue of three rooms, "hall-a" (90 seats), "hall-b" (90) and "room-c" (30), at 2100 a day (900, 900 and 300 a room), whose mail is delivered in 1 world minute. */
const venue = (more: Record<string, unknown> = {}) => ({
  id: "v1",
  rooms: [{ id: "hall-a", seats: 90 }, { id: "hall-b", seats: 90 }, { id: "room-c", seats: 30 }],
  access_claim: "step-free",
  catering: "outside_free",
  price: 2100,
  extras: {},
  hold_days: 2,
  deposit_share: 0.25,
  deposit_due_days: 3,
  cancellation: [{ share: 0.5 }],
  pick_up: 1,
  organiser: "organiser",
  event_day: 26,
  floor_plan: [],
  perturbations: [],
  mail_delivery_minutes: [1, 1],
  ...more,
});

/** Its ledger: the contracts' commitments and their deposits paid. */
const ledger = () => ({
  commitments_recorded: [{ id: "k-1", for: "v1-contract-1" }, { id: "k-2", for: "v1-contract-2" }],
  invoices_issued: [{ id: "i-1", for: "deposit v1-contract-1", paid: true }, { id: "i-2", for: "deposit v1-contract-2", paid: true }],
});

/** A venue that took these messages from the organiser, each at its time, and answers more at later times. */
function venueWith(more: Record<string, unknown>, messages: [string, string][]) {
  const rules = venueRules.start(venue(more), new Random(1));
  const first = conversation(rules, messages.map(([time, message]) => [time, `From: organiser. ${message}`]), ledger);
  const answer = (time: string, message: string) => drive(rules, tools(() => `From: organiser. ${message}`, () => time, ledger), [[notice]], true);
  const change = (time: string, kind: string) => drive(rules, tools(() => "", () => time, ledger), [[venueChange(kind)]], true);
  const at = (time: string) => drive(rules, tools(() => "", () => time, ledger), [[]], true);
  return { first: first.steps, answer, change, at };
}

/** The messages that book "day 26" with these rooms and accept the contract of this number. */
const booking = (rooms: string, contract = 1, time = "day 1 Monday 09:0"): [string, string][] => [
  [`${time}1`, `Act: book. date: day 26. rooms: ${rooms}. hours: 08:00-18:00.`],
  [`${time}2`, `Act: accept_contract. contract: v1-contract-${contract}.`],
];

describe("a room loss moves the booking to an equal room when one is free (FR-CONGRESS-19)", () => {
  it("moves a one-room booking to a free room of as many seats, at the same price, mailing room_moved, and holds nothing", () => {
    const venueOf = venueWith({}, booking("hall-a"));
    const moved = venueOf.change("day 1 Monday 12:00", "room_lost");
    expect(calls(moved, "send_mail")).toEqual([{ to: "organiser", act: "room_moved", fields: { contract: "v1-contract-1", room: "hall-a", room_now: "hall-b" } }]);
    expect([...calls(moved, "commit"), ...calls(moved, "release")]).toEqual([]);
    expect(calls(venueOf.answer("day 1 Monday 13:00", "Act: change_booking. rooms: hall-b. hours: 08:00-18:00."), "send_mail")).toEqual([
      { to: "organiser", act: "contract_changed", fields: { contract: "v1-contract-1", rooms: "hall-b", hours: "08:00-18:00", price: 2100 } },
    ]);
    // Nothing lapses: no change was pending.
    expect(mailed(venueOf.at("day 5 Friday 12:00"))).toEqual([]);
  });

  it("moves it to the free room with the fewest seats of those with at least as many", () => {
    const rooms = [{ id: "hall-a", seats: 90 }, { id: "big", seats: 200 }, { id: "hall-b", seats: 120 }, { id: "room-c", seats: 30 }];
    const moved = venueWith({ rooms }, booking("hall-a")).change("day 1 Monday 12:00", "room_lost");
    expect(calls(moved, "send_mail")).toMatchObject([{ act: "room_moved", fields: { room: "hall-a", room_now: "hall-b" } }]);
  });

  it("moves a booking of several rooms too, keeping its price", () => {
    const venueOf = venueWith({}, booking("hall-a, room-c"));
    expect(calls(venueOf.change("day 1 Monday 12:00", "room_lost"), "send_mail")).toEqual([{ to: "organiser", act: "room_moved", fields: { contract: "v1-contract-1", room: "room-c", room_now: "hall-b" } }]);
    expect(calls(venueOf.answer("day 1 Monday 13:00", "Act: change_booking. rooms: hall-a, hall-b. hours: 08:00-18:00."), "send_mail")).toMatchObject([{ act: "contract_changed", fields: { price: 2100 } }]);
  });

  it("offers a smaller room, as before, when the rooms with as many seats are booked, by the organiser or by other customers", () => {
    const lost = (rooms: string, more: Record<string, unknown> = {}) => calls(venueWith(more, booking(rooms)).change("day 1 Monday 12:00", "room_lost"), "send_mail");
    expect(lost("hall-a, hall-b")).toMatchObject([{ act: "room_lost", fields: { room: "hall-b", offer: "smaller_room", smaller: "room-c" } }]);
    expect(lost("hall-a", { rooms_booked_by_others: ["hall-b"] })).toMatchObject([{ act: "room_lost", fields: { room: "hall-a", offer: "smaller_room", smaller: "room-c" } }]);
    expect(lost("room-c", { rooms_booked_by_others: ["hall-a", "hall-b"] }).map(({ act }) => act)).toEqual(["price_change"]);
  });

  it("never moves a booking to a room the date already lost", () => {
    // "hall-b" is lost to the allocation's rename; "room-c" is too small for "hall-b-allocated", seated as "hall-b".
    const venueOf = venueWith({ indicative: true, perturbations: [{ name: "room_allocation", at: "day 1 11:00" }] }, booking("hall-a, hall-b"));
    expect(calls(venueOf.at("day 1 Monday 11:00"), "send_mail")).toMatchObject([{ act: "rooms_allocated", fields: { allocation: "hall-a -> hall-a; hall-b -> hall-b-allocated" } }]);
    expect(calls(venueOf.change("day 1 Monday 12:00", "room_lost"), "send_mail")).toMatchObject([{ act: "room_lost", fields: { room: "hall-b-allocated", offer: "smaller_room", smaller: "room-c", cut: 900 } }]);
  });
});

describe("the parts read a moved room (FR-CONGRESS-19)", () => {
  it("takes the lost room out of the booking and the new room into it", () => {
    const message = (act: string, fields: Record<string, unknown>, day: number) => ({ id: `m-${act}`, from: "v1", to: "organiser", act, fields, subject: act, received: { day, weekday: "Monday", seconds: 0 }, read: true });
    const state = {
      mail: {
        mailboxes: {
          organiser: [
            message("contract", { contract: "v1-contract-1", date: "day 26", rooms: "hall-a, room-c", price: 2100 }, 2),
            message("confirmed", { contract: "v1-contract-1" }, 3),
            message("room_moved", { contract: "v1-contract-1", room: "hall-a", room_now: "hall-b" }, 8),
          ],
        },
        inTransit: [],
      },
      phone: { calls: [] },
    } as unknown as Congress;
    expect(bookingsOf(state)[0].rooms).toEqual(["hall-b", "room-c"]);
  });
});

describe("a cancelled contract is never the live one (FR-CONGRESS-19)", () => {
  /** A venue whose contract 1 the organiser accepted and cancelled on day 2, and whose contract 2 for the same day it accepted on day 3. */
  const rebooked = (more: Record<string, unknown> = {}) =>
    venueWith(more, [...booking("hall-a"), ["day 2 Tuesday 09:00", "Act: cancel_booking."], ...booking("hall-a", 2, "day 3 Wednesday 09:0")]);

  it("cancels the live contract, not the one already cancelled", () => {
    const venueOf = rebooked();
    expect(calls(venueOf.first, "send_mail").filter(({ act }) => act === "cancelled")).toMatchObject([{ fields: { contract: "v1-contract-1" } }]);
    const cancelled = venueOf.answer("day 4 Thursday 09:00", "Act: cancel_booking.");
    expect(calls(cancelled, "send_mail")).toMatchObject([{ act: "cancelled", fields: { contract: "v1-contract-2" } }]);
  });

  it("answers a cancel_booking naming a cancelled contract not_available, and keeps the live one and its date", () => {
    const venueOf = rebooked();
    expect(calls(venueOf.answer("day 4 Thursday 09:00", "Act: cancel_booking. contract: v1-contract-1."), "send_mail")).toEqual([{ to: "organiser", act: "not_available", fields: { what: "v1-contract-1" } }]);
    expect(calls(venueOf.answer("day 4 Thursday 10:00", "Act: hold. date: day 26."), "send_mail")).toEqual([{ to: "organiser", act: "unavailable", fields: { date: "day 26" } }]);
  });

  it("changes, extends and announces changes on the live contract", () => {
    expect(calls(rebooked().answer("day 4 Thursday 09:00", "Act: change_booking. rooms: hall-a, room-c. hours: 08:00-18:00."), "send_mail")).toMatchObject([{ act: "contract_changed", fields: { contract: "v1-contract-2" } }]);
    expect(calls(rebooked().change("day 4 Thursday 09:00", "price_change"), "send_mail")).toMatchObject([{ act: "price_change", fields: { contract: "v1-contract-2" } }]);
  });

  it("takes no answer to a change announced on a contract since cancelled", () => {
    const venueOf = venueWith({}, booking("hall-a, hall-b"));
    expect(mailed(venueOf.change("day 1 Monday 12:00", "price_change"))).toEqual(["price_change"]);
    expect(mailed(venueOf.answer("day 1 Monday 13:00", "Act: cancel_booking."))).toEqual(["cancelled"]);
    venueOf.answer("day 1 Monday 14:01", "Act: book. date: day 26. rooms: hall-a. hours: 08:00-18:00.");
    venueOf.answer("day 1 Monday 14:02", "Act: accept_contract. contract: v1-contract-2.");
    expect(calls(venueOf.answer("day 1 Monday 15:00", "Act: accept_change."), "send_mail")).toEqual([{ to: "organiser", act: "not_available", fields: { what: "change" } }]);
    // Nor does the change lapse on it.
    expect(mailed(venueOf.at("day 5 Friday 12:00"))).toEqual([]);
  });

  it("frees the date on a cancellation only when no other live contract of the organiser holds it", () => {
    // Contract 1's deposit unpaid: its reminder and its cancellation come after contract 2 holds the date.
    const unpaid = () => ({ commitments_recorded: [], invoices_issued: [{ id: "i-1", for: "deposit v1-contract-1", paid: false }, { id: "i-2", for: "deposit v1-contract-2", paid: true }] });
    const rules = venueRules.start(venue(), new Random(1));
    const clock = { time: "day 1 Monday 09:01" };
    const take = (time: string, message: string) => {
      clock.time = time;
      return drive(rules, tools(() => (message === "" ? "" : `From: organiser. ${message}`), () => clock.time, unpaid), message === "" ? [[]] : [[notice]], true);
    };
    drive(rules, tools(() => "", () => clock.time, unpaid));
    for (const [time, message] of [...booking("hall-a"), ["day 2 Tuesday 09:00", "Act: cancel_booking."], ...booking("hall-a", 2, "day 3 Wednesday 09:0")]) take(time, message);
    take("day 9 Tuesday 10:00", "");
    take("day 11 Thursday 10:00", "");
    expect(calls(take("day 12 Friday 10:00", "Act: hold. date: day 26."), "send_mail")).toEqual([{ to: "organiser", act: "unavailable", fields: { date: "day 26" } }]);
  });
});

describe("an allocated room keeps its price and seats (FR-CONGRESS-19)", () => {
  /** A venue whose contract for "hall-a" and "hall-b" at their prices, 1800, has its rooms allocated at 11:00. */
  function allocated(rooms?: { id: string; seats: number }[]) {
    const venueOf = venueWith({ indicative: true, perturbations: [{ name: "room_allocation", at: "day 1 11:00" }], ...(rooms === undefined ? {} : { rooms }) }, [
      ...booking("hall-a, hall-b, room-c"),
      ["day 1 Monday 09:03", "Act: change_booking. rooms: hall-a, hall-b. hours: 08:00-18:00."],
    ]);
    return { venueOf, allocation: calls(venueOf.at("day 1 Monday 11:00"), "send_mail") };
  }

  it("takes off the renamed room's price, the room it was allocated from, when it is dropped", () => {
    const { venueOf, allocation } = allocated();
    expect(allocation).toMatchObject([{ act: "rooms_allocated", fields: { allocation: "hall-a -> hall-a; hall-b -> hall-b-allocated" } }]);
    const changed = venueOf.answer("day 1 Monday 12:00", "Act: change_booking. rooms: hall-a. hours: 08:00-18:00.");
    expect(calls(changed, "send_mail")).toMatchObject([{ act: "contract_changed", fields: { rooms: "hall-a", price: 900 } }]);
  });

  it("prices a room it moved to as the room it was allocated from", () => {
    // Of 2520 a day for 330 seats, "annex" (120 seats) costs 916 and "hall-a", the room it was allocated from, 687.
    const rooms = [{ id: "hall-a", seats: 90 }, { id: "hall-b", seats: 90 }, { id: "room-c", seats: 30 }, { id: "annex", seats: 120 }];
    const venueOf = venueWith({ indicative: true, price: 2520, perturbations: [{ name: "room_allocation", at: "day 1 11:00" }], rooms }, booking("hall-a, hall-b"));
    expect(calls(venueOf.at("day 1 Monday 11:00"), "send_mail")).toMatchObject([{ act: "rooms_allocated", fields: { allocation: "hall-a -> annex; hall-b -> hall-b" } }]);
    const changed = venueOf.answer("day 1 Monday 12:00", "Act: change_booking. rooms: hall-b. hours: 08:00-18:00.");
    expect(calls(changed, "send_mail")).toMatchObject([{ act: "contract_changed", fields: { rooms: "hall-b", price: 2520 - 687 } }]);
  });

  it("gives the parts a renamed room's seats as its original's", () => {
    const seatsOf = (parts as Record<string, unknown>).seatsOf as ((state: Congress, room: string) => number) | undefined;
    expect(seatsOf, "the parts give no seats of a room").toBeTypeOf("function");
    const state = { rooms: { "hall-b": { venue: "v1", seats: 90 }, annex: { venue: "v1", seats: 120 } } } as unknown as Congress;
    expect([seatsOf?.(state, "hall-b-allocated"), seatsOf?.(state, "annex"), seatsOf?.(state, "nowhere")]).toEqual([90, 120, 0]);
  });
});

describe("a congress that does not happen holds nothing for its event (FR-CONGRESS-19)", () => {
  const TIMES = ["09:30", "10:30", "11:30", "14:00", "15:00", "16:00"];
  const SIX = ["s1", "s2", "s3", "s4", "s5", "s6"];
  const at = (day: number) => ({ day, weekday: "Monday", seconds: 0 });

  /** A congress with "v1"'s contract confirmed, its deposit paid, cancelled on a day when given, and six sessions in "main-hall" with confirmed speakers. */
  function congress(cancelledOn?: number): Congress {
    const mail: { from: string; to: string; act: string; fields: Record<string, unknown>; day: number }[] = [
      { from: "v1", to: "organiser", act: "contract", fields: { contract: "v1-contract-1", date: "day 26", rooms: "main-hall", price: 2000 }, day: 2 },
      { from: "v1", to: "organiser", act: "confirmed", fields: { contract: "v1-contract-1" }, day: 3 },
      ...(cancelledOn === undefined ? [] : [{ from: "v1", to: "organiser", act: "cancelled", fields: { contract: "v1-contract-1", charge: 0 }, day: cancelledOn }]),
      ...SIX.flatMap((speaker, index) => [
        { from: "organiser", to: speaker, act: "invite", fields: { session: index + 1, time: TIMES[index], fee: 0, travel_paid: false }, day: 3 },
        { from: speaker, to: "organiser", act: "accept", fields: { session: index + 1 }, day: 4 },
        { from: "organiser", to: speaker, act: "confirm", fields: { time: TIMES[index], room: "main-hall", length: 45, travel: "none" }, day: 5 },
        { from: speaker, to: "organiser", act: "acknowledged", fields: {}, day: 5 },
      ]),
    ];
    const mailboxes: Record<string, unknown[]> = {};
    mail.forEach(({ from, to, act, fields, day }, index) => (mailboxes[to] = [...(mailboxes[to] ?? []), { id: `m-${index + 1}`, from, to, act, fields, subject: act, received: at(day), read: true }]));
    const sessions = SIX.map((speaker, index) => ({ start: TIMES[index], end: "23:00", title: speaker, speakers: [speaker], room: "main-hall" }));
    return {
      rooms: { "main-hall": { venue: "v1", seats: 120 } },
      venues: { v1: { entrance: "v1-entrance", hours: "always" } },
      passages: [{ between: ["v1-entrance", "main-hall"], length: 1, step_free: true }],
      mail: { mailboxes, inTransit: [] },
      phone: { calls: [] },
      money: { balances: {}, invoices: [{ id: "i-1", from: "v1", to: "organiser", amount: 500, due: "day 6", for: "deposit v1-contract-1", paid: true }], commitments: [], ceilings: {}, overruns: [], events: [] },
      travel: { material: { stations: [], trains: [], hotels: [], sold_out_probability: 0 }, soldOutDraws: {}, booked: [] },
      population: { material: {}, eventDay: 26, referencePrice: 35, draws: {}, people: [], page: { open: true, price: 50, required_fields: [], info: [], waiting_list: false }, announced: true, promotions: [], programme: [{ version: 1, sessions, breaks: [], sponsor_slots: [], logos: [], published: 11 * 1440 }], sponsorData: {}, events: [], announcements: [], edits: [] },
      perturbations: [],
      visits: [],
      context: { eventDay: 26, helpers: 2, target: 50, endOfPreparation: 25 * 1440 + 390, roles: {}, noShowCut: 0.05, discretionaryLimit: 300, homes: {}, catering: {} },
    } as unknown as Congress;
  }

  const holds = (result: unknown) => (typeof result === "boolean" ? result : (result as { holds: boolean }).holds);
  const evaluated = (state: Congress) => Object.fromEntries(Object.entries(congressParts.predicates).map(([name, predicate]) => [name, predicate(state, { at: 25 * 1440 + 390 })]));

  it("holds no part or outcome evaluated at the end of preparation or later once the booking is cancelled, P04 aside", () => {
    const happening = evaluated(congress());
    // What held while the congress was to happen.
    expect(Object.keys(happening).filter((name) => holds(happening[name]))).toEqual(expect.arrayContaining(["P01", "P05", "P17", "P19", "W4", "W6"]));
    const cancelled = evaluated(congress(21));
    const atTheEvent = Object.keys(cancelled).filter((name) => !["P04", "within_budget", "P06", "P11"].includes(name));
    expect(atTheEvent.filter((name) => holds(cancelled[name]))).toEqual([]);
  });

  it("evaluates P04 and the parts evaluated before the end of preparation whatever happens", () => {
    const happening = evaluated(congress());
    const cancelled = evaluated(congress(21));
    for (const name of ["P04", "within_budget", "P06", "P11"]) expect(cancelled[name], name).toEqual(happening[name]);
  });

  it("holds no part at the event without six sessions in the latest programme, however the booking stands", () => {
    const state = congress();
    const population = state.population as NonNullable<Congress["population"]>;
    (population as { programme: unknown[] }).programme = [{ ...population.programme[0], sessions: population.programme[0].sessions.slice(0, 5) }];
    expect(holds(congressParts.predicates.P01(state, {}))).toBe(false);
  });
});
