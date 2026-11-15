import { describe, expect, it } from "vitest";
import { congressParts } from "../src/scenarios/congress-parts.ts";
import type { Congress } from "../src/scenarios/congress.ts";
import type { Person, Programme } from "../src/scenarios/population.ts";

// FR-CONGRESS-20: the E1 baseline's definition of done, read on world records built here.

/** World minutes of "day <n> [HH:MM]". */
const minutes = (text: string) => {
  const [, day, clock = "00:00"] = /^day (\d+)(?: (\d\d:\d\d))?$/.exec(text) as RegExpExecArray;
  return (Number(day) - 1) * 1440 + Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
};
const worldTime = (at: number) => ({ day: Math.floor(at / 1440) + 1, weekday: "Monday", seconds: Math.round((at % 1440) * 60) });

/** The end of preparation. */
const END = minutes("day 26 06:30");

const SIX = ["s1", "s2", "s3", "s4", "s5", "s6"];
const TIMES = ["09:30", "10:30", "11:30", "14:00", "15:00", "16:00"];

/**
 * A world with the venue "v1" ("hall-a" of 90 seats, step-free; "room-c" of 30; its toilets behind 3 steps), the target
 * 60, 2 helpers, the budget 8000, and the caterers "c1" (vegan, gluten-free up to 2) and "c2" (every diet).
 */
function world(): Congress {
  return {
    rooms: { "hall-a": { venue: "v1", seats: 90 }, "room-c": { venue: "v1", seats: 30 }, "v1-toilets": { venue: "v1" } },
    venues: { v1: { entrance: "v1-entrance", hours: "always" } },
    passages: [
      { between: ["v1-entrance", "hall-a"], length: 1, step_free: true },
      { between: ["v1-entrance", "room-c"], length: 1, step_free: true },
      { between: ["hall-a", "v1-toilets"], length: 1, step_free: "3 steps" },
    ],
    mail: { mailboxes: {}, inTransit: [] },
    phone: { calls: [] },
    money: { balances: {}, invoices: [], commitments: [], ceilings: {}, overruns: [], events: [] },
    travel: { material: { stations: ["north"], trains: [{ id: "t1", from: "north", arrives: "08:20", price: 40 }, { id: "t2", from: "north", arrives: "08:40", price: 30 }], hotels: [{ id: "h1", near: "v1", rooms: 5, price: 90 }], sold_out_probability: 0 }, soldOutDraws: {}, booked: [] },
    population: { material: {}, eventDay: 26, referencePrice: 35, draws: {}, people: [], page: { open: true, price: 50, required_fields: [], info: [], waiting_list: false }, announced: true, promotions: [], programme: [], sponsorData: {}, events: [], announcements: [], edits: [] },
    perturbations: [],
    visits: [],
    context: {
      eventDay: 26,
      helpers: 2,
      target: 60,
      endOfPreparation: END,
      roles: {},
      noShowCut: 0.05,
      discretionaryLimit: 300,
      homes: { s8: "north" },
      catering: { v1: { rule: "outside_free" } },
      diets: { c1: { vegan: {}, gluten_free: { limit: 2 } }, c2: { vegetarian: {}, vegan: {}, gluten_free: {}, halal: {} } },
      ceiling: 8000,
    },
  } as unknown as Congress;
}

/** Adds a mail, received at a world time. */
function mail(state: Congress, from: string, to: string, act: string, fields: Record<string, string | number | boolean>, at: number): void {
  const count = Object.values(state.mail.mailboxes).flat().length;
  state.mail.mailboxes[to] = [...(state.mail.mailboxes[to] ?? []), { id: `m-${count + 1}`, from, to, act, fields, subject: act, received: worldTime(at), read: true } as never];
}

/** "v1"'s contract for a day with these rooms, confirmed at a time. */
function booked(state: Congress, rooms = "hall-a", at = minutes("day 3"), date = "day 26"): void {
  mail(state, "v1", "organiser", "contract", { contract: "v1-contract-1", date, rooms, hours: "08:00-18:00", price: 2000 }, at - 60);
  mail(state, "v1", "organiser", "confirmed", { contract: "v1-contract-1" }, at);
}

/** A speaker who accepted a session at a time, and acknowledged the organiser's confirmation (or change) of its time and room at a time. */
function confirmedSpeaker(state: Congress, speaker: string, number: number, time: string, { room = "hall-a", act = "confirm", at = minutes("day 5"), travelPaid = false, acknowledged = true } = {}): void {
  mail(state, "organiser", speaker, "invite", { session: number, time, fee: 0, travel_paid: travelPaid }, minutes("day 3"));
  mail(state, speaker, "organiser", "accept", { session: number }, minutes("day 4"));
  mail(state, "organiser", speaker, act, { time, room, length: 45, travel: "none" }, at);
  if (acknowledged) mail(state, speaker, "organiser", "acknowledged", {}, at + 60);
}

/** The six speakers, confirmed for their sessions in a room. */
const sixConfirmed = (state: Congress, room = "hall-a") => SIX.forEach((speaker, index) => confirmedSpeaker(state, speaker, index + 1, TIMES[index], { room }));

/** A programme version of sessions in a room, one speaker each, published at a time. */
function published(state: Congress, room = "hall-a", at = minutes("day 12"), speakers = SIX, more: Partial<Programme> = {}): void {
  const population = state.population as NonNullable<Congress["population"]>;
  const sessions = speakers.map((speaker, index) => ({ start: TIMES[index], end: "23:00", title: speaker, speakers: [speaker], room }));
  population.programme = [...population.programme, { version: population.programme.length + 1, sessions, breaks: [], sponsor_slots: [], logos: [], published: at, ...more }];
}

/** So many registrants, as given. */
function registered(state: Congress, count: number, person: Partial<Person> = {}): void {
  const population = state.population as NonNullable<Congress["population"]>;
  const first = population.people.length;
  population.people = [
    ...population.people,
    ...Array.from({ length: count }, (_, index) => ({ id: `a-${first + index + 1}`, diet: "none", access: "none", pays: true, consents: true, no_show: false, registered: minutes("day 10"), given: { diet: "none", access: "none" }, ...person }) as Person),
  ];
}

/** An order to a caterer, with its counts, confirmed at a time. */
function ordered(state: Congress, caterer: string, counts: string, { at = minutes("day 9"), date = "day 26", more = {} as Record<string, string> } = {}): void {
  mail(state, "organiser", caterer, "order", { counts, date, venue: "v1", ...more }, at - 60);
  mail(state, caterer, "organiser", "order_confirmed", { counts, total: 0 }, at);
}

/** A predicate's result at the end of preparation. */
function evaluated(name: string, state: Congress): { holds: boolean; reachedAt?: number } {
  const predicate = congressParts.predicates[name];
  expect(predicate, `the congress provides no predicate "${name}"`).toBeDefined();
  const result = predicate(state, { at: END });
  return typeof result === "boolean" ? { holds: result } : result;
}
const holds = (name: string, state: Congress) => evaluated(name, state).holds;

describe("D1 attendance_in_range: paying registrants between 0.75 and 1.10 of the target (FR-CONGRESS-20)", () => {
  it.each([
    [44, false],
    [45, true],
    [66, true],
    [67, false],
  ])("%i paying of the target 60, with 3 who do not pay: %s", (paying, expected) => {
    const state = world();
    registered(state, paying);
    registered(state, 3, { pays: false });
    expect(holds("attendance_in_range", state)).toBe(expected);
  });

  it("does not count a registrant who cancelled", () => {
    const state = world();
    registered(state, 44);
    registered(state, 1, { cancelled: minutes("day 15") } as Partial<Person>);
    expect(holds("attendance_in_range", state)).toBe(false);
  });
});

describe("D0 can_be_held: a live booking for the event day, a programme of six sessions and a live order for the event day (FR-CONGRESS-20)", () => {
  /** The three, each as asked. */
  function congress({ booking = true, programme = true, order = true, orderDate = "day 26", sessions = SIX } = {}): Congress {
    const state = world();
    if (booking) booked(state);
    sixConfirmed(state);
    if (programme) published(state, "hall-a", minutes("day 12"), sessions);
    if (order) ordered(state, "c2", "standard: 61", { date: orderDate });
    return state;
  }

  it("holds with the three", () => expect(holds("can_be_held", congress())).toBe(true));
  it("does not hold with no live order", () => expect(holds("can_be_held", congress({ order: false }))).toBe(false));
  it("does not hold with an order for another day", () => expect(holds("can_be_held", congress({ orderDate: "day 25" }))).toBe(false));
  it("does not hold with no booking", () => expect(holds("can_be_held", congress({ booking: false }))).toBe(false));
  it("does not hold with five sessions", () => expect(holds("can_be_held", congress({ sessions: SIX.slice(0, 5) }))).toBe(false));
  it("does not hold with no programme", () => expect(holds("can_be_held", congress({ programme: false }))).toBe(false));

  it("does not hold when the order was cancelled", () => {
    const state = congress();
    mail(state, "c2", "organiser", "cancelled", { charge: 0 }, minutes("day 15"));
    expect(holds("can_be_held", state)).toBe(false);
  });

  it("does not hold when the only booking was cancelled", () => {
    const state = congress();
    mail(state, "v1", "organiser", "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes("day 20"));
    expect(holds("can_be_held", state)).toBe(false);
  });
});

describe("D2 sessions_have_speakers: six sessions, each with a confirmed speaker not out who believes its time and room (FR-CONGRESS-20)", () => {
  /** Six sessions in "hall-a" with a live booking. */
  function congress(): Congress {
    const state = world();
    booked(state);
    published(state);
    return state;
  }

  it("holds when each accepted and acknowledged a confirmation of its time and room", () => {
    const state = congress();
    sixConfirmed(state);
    expect(holds("sessions_have_speakers", state)).toBe(true);
  });

  it("holds for a speaker who acknowledged a change naming its time and room", () => {
    const state = congress();
    SIX.forEach((speaker, index) => confirmedSpeaker(state, speaker, index + 1, TIMES[index], { act: speaker === "s5" ? "change" : "confirm" }));
    expect(holds("sessions_have_speakers", state)).toBe(true);
  });

  it("does not hold when a speaker never acknowledged", () => {
    const state = congress();
    SIX.forEach((speaker, index) => confirmedSpeaker(state, speaker, index + 1, TIMES[index], { acknowledged: speaker !== "s6" }));
    expect(holds("sessions_have_speakers", state)).toBe(false);
  });

  it("does not hold when a speaker believes another time", () => {
    const state = congress();
    sixConfirmed(state);
    mail(state, "organiser", "s3", "confirm", { time: "11:00", room: "hall-a" }, minutes("day 13"));
    expect(holds("sessions_have_speakers", state)).toBe(false);
  });

  it("does not hold when a speaker believes another room", () => {
    const state = congress();
    sixConfirmed(state);
    mail(state, "organiser", "s3", "confirm", { time: TIMES[2], room: "room-c" }, minutes("day 13"));
    expect(holds("sessions_have_speakers", state)).toBe(false);
  });

  it("does not hold when a speaker cancelled", () => {
    const state = congress();
    sixConfirmed(state);
    mail(state, "s2", "organiser", "cancel", {}, minutes("day 14"));
    expect(holds("sessions_have_speakers", state)).toBe(false);
  });

  it("does not hold with five sessions", () => {
    const state = world();
    booked(state);
    sixConfirmed(state);
    published(state, "hall-a", minutes("day 12"), SIX.slice(0, 5));
    expect(holds("sessions_have_speakers", state)).toBe(false);
  });
});

describe("D3 everyone_fits: every room of the latest programme is in the live booking and seats the attendance (FR-CONGRESS-20)", () => {
  /** A live booking of these rooms, 70 registrants, six confirmed speakers, and the programme in a room: an attendance of 81. */
  function congress(booking: string | undefined, room: string, count = 70): Congress {
    const state = world();
    if (booking !== undefined) booked(state, booking);
    registered(state, count);
    sixConfirmed(state);
    published(state, room);
    return state;
  }

  it("holds for a booked room that seats the attendance", () => expect(holds("everyone_fits", congress("hall-a", "hall-a"))).toBe(true));
  it("does not hold for a room too small", () => expect(holds("everyone_fits", congress("hall-a, room-c", "room-c"))).toBe(false));
  it("does not hold for a room not in the booking", () => expect(holds("everyone_fits", congress("hall-a", "room-c", 10))).toBe(false));
  it("does not hold for an attendance above the seats", () => expect(holds("everyone_fits", congress("hall-a", "hall-a", 80))).toBe(false));
  it("does not hold with no live booking", () => expect(holds("everyone_fits", congress(undefined, "hall-a"))).toBe(false));
});
