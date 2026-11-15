import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { congressParts } from "../src/scenarios/congress-parts.ts";
import { type Congress, congressScenario } from "../src/scenarios/congress.ts";
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
  state.mail = { ...state.mail, mailboxes: { ...state.mail.mailboxes, [to]: [...(state.mail.mailboxes[to] ?? []), { id: `m-${count + 1}`, from, to, act, fields, subject: act, received: worldTime(at), read: true } as never] } };
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

describe("D4 everyone_can_reach: every registrant with an access need reaches the programme's rooms, the catering area and the toilets (FR-CONGRESS-20)", () => {
  /** A live booking of "hall-a" with the programme there, 40 registrants and, when asked, a wheelchair user. */
  function congress({ wheelchair = true, booking = true } = {}): Congress {
    const state = world();
    if (booking) booked(state);
    sixConfirmed(state);
    published(state);
    registered(state, 40);
    if (wheelchair) registered(state, 1, { id: "a-wheelchair", access: "wheelchair", given: { diet: "none", access: "wheelchair" } });
    return state;
  }

  it("holds when no registrant has an access need, whatever the steps", () => expect(holds("everyone_can_reach", congress({ wheelchair: false }))).toBe(true));
  it("does not hold for a wheelchair user when the toilets are behind steps and no ramp was booked", () => expect(holds("everyone_can_reach", congress())).toBe(false));

  it("holds for a wheelchair user once the venue confirmed the extra ramp", () => {
    const state = congress();
    mail(state, "v1", "organiser", "extra_confirmed", { item: "ramp", price: 100 }, minutes("day 14"));
    expect(holds("everyone_can_reach", state)).toBe(true);
  });

  it("does not hold when the catering area is behind steps", () => {
    const state = congress();
    state.passages = state.passages.map((passage) => (passage.between.includes("v1-toilets") ? { ...passage, step_free: true } : passage));
    state.rooms["v1-catering"] = { venue: "v1" } as never;
    state.passages.push({ between: ["hall-a", "v1-catering"], length: 1, step_free: "2 steps" } as never);
    expect(holds("everyone_can_reach", state)).toBe(false);
    state.passages[3] = { ...state.passages[3], step_free: true };
    expect(holds("everyone_can_reach", state)).toBe(true);
  });

  it("does not hold for a wheelchair user with no live booking", () => expect(holds("everyone_can_reach", congress({ booking: false }))).toBe(false));
});

describe("D5 food_for_everyone: the live orders cover each diet's attendance, from caterers that serve it within their limits (FR-CONGRESS-20)", () => {
  /** A live booking, 50 registrants of whom 4 eat vegan and 3 gluten-free, six confirmed speakers and 2 helpers: 54 standard. */
  function congress(): Congress {
    const state = world();
    booked(state);
    registered(state, 43);
    registered(state, 4, { diet: "vegan" });
    registered(state, 3, { diet: "gluten_free" });
    sixConfirmed(state);
    published(state);
    return state;
  }

  it("holds when one caterer covers every diet", () => {
    const state = congress();
    ordered(state, "c2", "standard: 54; vegan: 4; gluten_free: 3");
    expect(holds("food_for_everyone", state)).toBe(true);
  });

  it("does not hold when a diet is missing", () => {
    const state = congress();
    ordered(state, "c2", "standard: 54; vegan: 4");
    expect(holds("food_for_everyone", state)).toBe(false);
  });

  it("holds when two orders cover the diets between them", () => {
    const state = congress();
    ordered(state, "c1", "standard: 54; vegan: 4");
    ordered(state, "c2", "gluten_free: 3", { at: minutes("day 10") });
    expect(holds("food_for_everyone", state)).toBe(true);
  });

  it("does not hold when the standard meals fall short of everyone else", () => {
    const state = congress();
    ordered(state, "c2", "standard: 50; vegan: 4; gluten_free: 3");
    expect(holds("food_for_everyone", state)).toBe(false);
  });

  it("counts a diet's meals only up to the caterer's limit", () => {
    const state = congress();
    ordered(state, "c1", "standard: 54; vegan: 4; gluten_free: 3");
    expect(holds("food_for_everyone", state)).toBe(false);
  });

  it("does not count meals of a diet the caterer does not serve", () => {
    const state = congress();
    registered(state, 1, { diet: "halal" });
    ordered(state, "c1", "standard: 54; vegan: 4; halal: 1");
    ordered(state, "c2", "gluten_free: 3", { at: minutes("day 10") });
    expect(holds("food_for_everyone", state)).toBe(false);
  });

  it("does not count an order for another day, nor a cancelled one", () => {
    const other = congress();
    ordered(other, "c2", "standard: 54; vegan: 4; gluten_free: 3", { date: "day 25" });
    expect(holds("food_for_everyone", other)).toBe(false);
    const cancelled = congress();
    ordered(cancelled, "c2", "standard: 54; vegan: 4; gluten_free: 3");
    mail(cancelled, "c2", "organiser", "cancelled", { charge: 0 }, minutes("day 15"));
    expect(holds("food_for_everyone", cancelled)).toBe(false);
  });

  describe("at a venue that keeps its catering", () => {
    /** "v1" in-house with its own caterer "c9", which serves every diet; 50 standard registrants and 4 vegan: 61 standard. */
    function inHouse(rule = "in_house"): Congress {
      const state = world();
      state.context = { ...state.context, catering: { v1: { rule, inHouse: "c9" } }, diets: { ...state.context.diets, c9: { vegan: {}, gluten_free: {} } } } as Congress["context"];
      booked(state);
      registered(state, 50);
      registered(state, 4, { diet: "vegan" });
      sixConfirmed(state);
      published(state);
      return state;
    }
    /** "v1"'s permit for outside meals of a diet. */
    const permit = (state: Congress, diet: string) => mail(state, "v1", "organiser", "extra_confirmed", { item: "outside_catering", price: 20, permit: "v1-permit-1", diet, attendance: 4 }, minutes("day 8"));

    it("holds for the venue's own caterer", () => {
      const state = inHouse();
      ordered(state, "c9", "standard: 61; vegan: 4");
      expect(holds("food_for_everyone", state)).toBe(true);
    });

    it("does not count an outside caterer's meals with no permit", () => {
      const state = inHouse();
      ordered(state, "c2", "standard: 61; vegan: 4");
      expect(holds("food_for_everyone", state)).toBe(false);
    });

    it("counts an outside caterer's meals of the diet the venue's permit names, and no others", () => {
      const state = inHouse();
      permit(state, "vegan");
      ordered(state, "c9", "standard: 61");
      ordered(state, "c2", "vegan: 4", { at: minutes("day 10"), more: { permit: "v1-permit-1" } });
      expect(holds("food_for_everyone", state)).toBe(true);
      const standard = inHouse();
      permit(standard, "vegan");
      ordered(standard, "c2", "standard: 61; vegan: 4", { more: { permit: "v1-permit-1" } });
      expect(holds("food_for_everyone", standard)).toBe(false);
    });

    it("does not count a permit the venue did not give", () => {
      const state = inHouse();
      ordered(state, "c9", "standard: 61");
      ordered(state, "c2", "vegan: 4", { at: minutes("day 10"), more: { permit: "v1-permit-7" } });
      expect(holds("food_for_everyone", state)).toBe(false);
    });

    it("counts every meal of an outside caterer with the permit of a venue that charges a fee", () => {
      const state = inHouse("outside_fee");
      mail(state, "v1", "organiser", "extra_confirmed", { item: "outside_catering", price: 200, permit: "v1-permit-1" }, minutes("day 8"));
      ordered(state, "c2", "standard: 61; vegan: 4", { more: { permit: "v1-permit-1" } });
      expect(holds("food_for_everyone", state)).toBe(true);
      const without = inHouse("outside_fee");
      ordered(without, "c2", "standard: 61; vegan: 4");
      expect(holds("food_for_everyone", without)).toBe(false);
    });
  });
});

describe("D7 programme_on_time: a full programme published by day 12 18:00, and every registrant believes the latest version (FR-CONGRESS-20)", () => {
  /** A programme of six sessions in "hall-a" published at a time, and 40 registrants who believe a version. */
  function congress(at: string, believes: number | null = 1): Congress {
    const state = world();
    sixConfirmed(state);
    published(state, "hall-a", minutes(at));
    registered(state, 40, believes === null ? {} : { believes });
    return state;
  }

  it("holds when published on day 12 at 17:00 and every registrant believes it", () => expect(holds("programme_on_time", congress("day 12 17:00"))).toBe(true));
  it("holds when published on day 12 at 18:00", () => expect(holds("programme_on_time", congress("day 12 18:00"))).toBe(true));
  it("does not hold when first published on day 13", () => expect(holds("programme_on_time", congress("day 13 09:00"))).toBe(false));
  it("does not hold when a registrant believes no version", () => expect(holds("programme_on_time", congress("day 12 17:00", null))).toBe(false));

  it("does not hold when a registrant believes an earlier version than the latest", () => {
    const state = congress("day 12 17:00");
    published(state, "hall-a", minutes("day 20"));
    expect(holds("programme_on_time", state)).toBe(false);
    for (const person of (state.population as NonNullable<Congress["population"]>).people) person.believes = 2;
    expect(holds("programme_on_time", state)).toBe(true);
  });

  it("does not count a programme by day 12 with fewer than six sessions, or a session with no speaker or room", () => {
    const five = world();
    published(five, "hall-a", minutes("day 10"), SIX.slice(0, 5));
    published(five, "hall-a", minutes("day 14"));
    registered(five, 40, { believes: 2 });
    expect(holds("programme_on_time", five)).toBe(false);
    const empty = world();
    published(empty, "hall-a", minutes("day 10"), [...SIX.slice(0, 5), ""]);
    const population = empty.population as NonNullable<Congress["population"]>;
    population.programme[0].sessions[5].speakers = [];
    registered(empty, 40, { believes: 1 });
    expect(holds("programme_on_time", empty)).toBe(false);
    const roomless = world();
    published(roomless, "", minutes("day 10"));
    registered(roomless, 40, { believes: 1 });
    expect(holds("programme_on_time", roomless)).toBe(false);
  });
});

describe("D8 sponsors_met: every sponsor that agreed and did not withdraw has its conditions met in the latest programme (FR-CONGRESS-20)", () => {
  /** "sp1"'s agreement with these conditions, if any, and the latest programme with these logos and slots. */
  function congress(conditions: string | undefined, more: Partial<Programme>): Congress {
    const state = world();
    if (conditions !== undefined) mail(state, "sp1", "organiser", "agreement", { amount: 1200, conditions }, minutes("day 6"));
    sixConfirmed(state);
    published(state, "hall-a", minutes("day 12"), SIX, more);
    return state;
  }
  const slot = (start: string) => ({ sponsor_slots: [{ sponsor: "sp1", start }] });

  it("holds when the logo shows and the slot is before 12:00", () => expect(holds("sponsors_met", congress("logo, morning_slot", { logos: ["sp1"], ...slot("11:15") }))).toBe(true));
  it("does not hold with no slot", () => expect(holds("sponsors_met", congress("logo, morning_slot", { logos: ["sp1"] }))).toBe(false));
  it("does not hold with a slot at 12:00", () => expect(holds("sponsors_met", congress("logo, morning_slot", { logos: ["sp1"], ...slot("12:00") }))).toBe(false));
  it("does not hold with no logo", () => expect(holds("sponsors_met", congress("logo", {}))).toBe(false));
  it("holds when no sponsor agreed", () => expect(holds("sponsors_met", congress(undefined, {}))).toBe(true));

  it("asks nothing of a sponsor that withdrew", () => {
    const state = congress("logo, morning_slot", {});
    mail(state, "sp1", "organiser", "withdraw", {}, minutes("day 15"));
    expect(holds("sponsors_met", state)).toBe(true);
  });
});

describe("D9 speakers_travel: every confirmed speaker whose travel the organiser agreed to pay arrives 30 minutes before its session (FR-CONGRESS-20)", () => {
  /**
   * "s8" in session 1 at 09:00 of the latest programme, confirmed, its travel agreed as asked: by its invitation, by an
   * accepted condition, or not at all; the other five confirmed and local.
   */
  function congress(agreed: "invitation" | "condition" | "no"): Congress {
    const state = world();
    mail(state, "organiser", "s8", "invite", { session: 1, time: "09:00", fee: 0, travel_paid: agreed === "invitation" }, minutes("day 3"));
    if (agreed === "condition") {
      mail(state, "s8", "organiser", "accept_if", { session: 1, condition: "travel_paid" }, minutes("day 3 12:00"));
      mail(state, "organiser", "s8", "accept_condition", { session: 1, travel_paid: true }, minutes("day 3 13:00"));
    }
    mail(state, "s8", "organiser", "accept", { session: 1 }, minutes("day 4"));
    mail(state, "organiser", "s8", "confirm", { time: "09:00", room: "hall-a" }, minutes("day 5"));
    mail(state, "s8", "organiser", "acknowledged", {}, minutes("day 5 01:00"));
    SIX.slice(1).forEach((speaker, index) => confirmedSpeaker(state, speaker, index + 2, TIMES[index + 1]));
    published(state, "hall-a", minutes("day 12"), ["s8", ...SIX.slice(1)]);
    (state.population as NonNullable<Congress["population"]>).programme[0].sessions[0].start = "09:00";
    return state;
  }
  /** Books a travel option for "s8". */
  const book = (state: Congress, option: string) => (state.travel = { ...state.travel, booked: [...state.travel.booked, { option, traveller: "s8", price: 40, at: minutes("day 15") }] });

  it("holds for a train that arrives 40 minutes before the session, agreed by an accepted condition", () => {
    const state = congress("condition");
    book(state, "t1 day 26");
    expect(holds("speakers_travel", state)).toBe(true);
  });

  it("does not hold with nothing booked", () => expect(holds("speakers_travel", congress("condition"))).toBe(false));
  it("does not hold with nothing booked when the invitation said travel_paid", () => expect(holds("speakers_travel", congress("invitation"))).toBe(false));
  it("holds with nothing booked when the organiser never agreed to pay", () => expect(holds("speakers_travel", congress("no"))).toBe(true));

  it("holds with a hotel for the night before, whatever the trains", () => {
    const state = congress("invitation");
    book(state, "h1 day 25");
    expect(holds("speakers_travel", state)).toBe(true);
  });

  it("does not hold for a train 20 minutes before the session, a train on another day, or a hotel for another night", () => {
    for (const option of ["t2 day 26", "t1 day 25", "h1 day 24"]) {
      const state = congress("invitation");
      book(state, option);
      expect(holds("speakers_travel", state), option).toBe(false);
    }
  });

  it("asks nothing of a local speaker, whatever its invitation said", () => {
    const state = congress("no");
    mail(state, "organiser", "s2", "invite", { session: 2, time: TIMES[1], fee: 0, travel_paid: true }, minutes("day 3 01:00"));
    expect(holds("speakers_travel", state)).toBe(true);
  });

  it("does not count a train from another station than the speaker's", () => {
    const state = congress("invitation");
    state.travel = { ...state.travel, material: { ...state.travel.material, trains: [...state.travel.material.trains, { id: "t9", from: "south", arrives: "08:00", price: 40 }] } };
    book(state, "t9 day 26");
    expect(holds("speakers_travel", state)).toBe(false);
  });

  it("asks nothing of a speaker not in the latest programme", () => {
    const state = congress("invitation");
    published(state, "hall-a", minutes("day 14"), ["s1", ...SIX.slice(1)]);
    expect(holds("speakers_travel", state)).toBe(true);
  });
});

describe("done: D0 to D9 all hold (FR-CONGRESS-20)", () => {
  /** A congress that meets every check: a booking, six confirmed speakers, a programme on time that everyone believes, 50 paying registrants and their food. */
  function congress(): Congress {
    const state = world();
    booked(state);
    sixConfirmed(state);
    published(state, "hall-a", minutes("day 12 17:00"));
    registered(state, 50, { believes: 1 });
    ordered(state, "c2", "standard: 61");
    return state;
  }

  it("holds when every check holds", () => expect(holds("done", congress())).toBe(true));

  it("does not hold when one check does not", () => {
    const state = congress();
    mail(state, "sp1", "organiser", "agreement", { amount: 1200, conditions: "logo" }, minutes("day 6"));
    expect(holds("sponsors_met", state)).toBe(false);
    expect(holds("done", state)).toBe(false);
  });

  it("does not hold once the booking is cancelled", () => {
    const state = congress();
    mail(state, "v1", "organiser", "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes("day 20"));
    expect(holds("done", state)).toBe(false);
  });
});

describe("the milestones give, through reached_at, when the organiser reached each step (FR-CONGRESS-20)", () => {
  it("venue_confirmed: a confirmed live booking for the event day, reached as it was confirmed", () => {
    const state = world();
    expect(holds("venue_confirmed", state)).toBe(false);
    booked(state, "hall-a", minutes("day 5 10:00"));
    expect(evaluated("venue_confirmed", state)).toEqual({ holds: true, reachedAt: minutes("day 5 10:00") });
    mail(state, "v1", "organiser", "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes("day 20"));
    expect(holds("venue_confirmed", state)).toBe(false);
  });

  it("caterer_ordered: a live order for the event day, reached as it was confirmed, or confirmed again after a cancellation", () => {
    const state = world();
    ordered(state, "c1", "standard: 61", { date: "day 25" });
    expect(holds("caterer_ordered", state)).toBe(false);
    ordered(state, "c2", "standard: 61", { at: minutes("day 9 11:00") });
    ordered(state, "c2", "standard: 62", { at: minutes("day 10 11:00") });
    expect(evaluated("caterer_ordered", state)).toEqual({ holds: true, reachedAt: minutes("day 9 11:00") });
    mail(state, "c2", "organiser", "cancelled", { charge: 0 }, minutes("day 11"));
    expect(holds("caterer_ordered", state)).toBe(false);
    ordered(state, "c2", "standard: 61", { at: minutes("day 12 11:00") });
    expect(evaluated("caterer_ordered", state)).toEqual({ holds: true, reachedAt: minutes("day 12 11:00") });
  });

  it("speakers_confirmed: six distinct confirmed speakers not out, reached as the sixth acknowledged", () => {
    const state = world();
    SIX.forEach((speaker, index) => confirmedSpeaker(state, speaker, index + 1, TIMES[index], { at: minutes(`day ${index + 3} 14:00`) }));
    expect(evaluated("speakers_confirmed", state)).toEqual({ holds: true, reachedAt: minutes("day 8 15:00") });
    mail(state, "s2", "organiser", "cancel", {}, minutes("day 14"));
    expect(holds("speakers_confirmed", state)).toBe(false);
  });

  it("speakers_confirmed does not count a speaker twice, nor one who has not acknowledged", () => {
    const state = world();
    SIX.slice(0, 5).forEach((speaker, index) => confirmedSpeaker(state, speaker, index + 1, TIMES[index]));
    confirmedSpeaker(state, "s1", 6, TIMES[5]);
    expect(holds("speakers_confirmed", state)).toBe(false);
    confirmedSpeaker(state, "s6", 6, TIMES[5], { at: minutes("day 9"), acknowledged: false });
    expect(holds("speakers_confirmed", state)).toBe(false);
    mail(state, "s6", "organiser", "acknowledged", {}, minutes("day 9 02:00"));
    expect(evaluated("speakers_confirmed", state)).toEqual({ holds: true, reachedAt: minutes("day 9 02:00") });
  });

  it("programme_published: the latest programme has six sessions, reached as the first of six was published", () => {
    const state = world();
    published(state, "hall-a", minutes("day 9"), SIX.slice(0, 5));
    expect(holds("programme_published", state)).toBe(false);
    published(state, "hall-a", minutes("day 11 16:00"));
    published(state, "hall-a", minutes("day 14"));
    expect(evaluated("programme_published", state)).toEqual({ holds: true, reachedAt: minutes("day 11 16:00") });
  });
});

describe("the on-time programme is a real one (FR-CONGRESS-22)", () => {
  /** "v1"'s contract for "hall-a" confirmed on day 6, and "s1" to "s6" each invited to its session on day 7 and accepting it on day 8. */
  function congress(): Congress {
    const state = world();
    booked(state, "hall-a", minutes("day 6"));
    SIX.forEach((speaker, index) => {
      mail(state, "organiser", speaker, "invite", { session: index + 1, time: TIMES[index], fee: 0, travel_paid: false }, minutes("day 7"));
      mail(state, speaker, "organiser", "accept", { session: index + 1 }, minutes("day 8"));
    });
    return state;
  }
  /** The registrants, each believing the latest version. */
  const believing = (state: Congress) => registered(state, 40, { believes: state.population?.programme.at(-1)?.version });

  it("reads the first version whose sessions name accepted speakers in rooms of a live booking when it was published", () => {
    const state = congress();
    published(state, "hall-a", minutes("day 3 10:00"));
    published(state, "hall-a", minutes("day 11 10:00"));
    believing(state);
    expect(evaluated("programme_published", state)).toEqual({ holds: true, reachedAt: minutes("day 11 10:00") });
    expect(holds("programme_on_time", state)).toBe(true);
  });

  it("does not count a version published before one of its speakers accepted its session", () => {
    const state = congress();
    // "s6" withdraws on day 8 after accepting, and accepts again on day 10.
    mail(state, "s6", "organiser", "decline", { session: 6 }, minutes("day 8 12:00"));
    mail(state, "s6", "organiser", "accept", { session: 6 }, minutes("day 10"));
    published(state, "hall-a", minutes("day 9 10:00"));
    published(state, "hall-a", minutes("day 11 10:00"));
    believing(state);
    expect(evaluated("programme_published", state)).toEqual({ holds: true, reachedAt: minutes("day 11 10:00") });
  });

  it("does not count a version whose room is not in a live booking, or published after the booking was cancelled", () => {
    const roomless = congress();
    published(roomless, "room-c", minutes("day 9 10:00"));
    published(roomless, "hall-a", minutes("day 11 10:00"));
    believing(roomless);
    expect(evaluated("programme_published", roomless)).toEqual({ holds: true, reachedAt: minutes("day 11 10:00") });
    const cancelled = congress();
    mail(cancelled, "v1", "organiser", "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes("day 9"));
    published(cancelled, "hall-a", minutes("day 10 10:00"));
    believing(cancelled);
    expect(holds("programme_published", cancelled)).toBe(false);
    expect(holds("programme_on_time", cancelled)).toBe(false);
  });

  it("is late when the first real version is published after day 12 18:00", () => {
    const state = world();
    published(state, "hall-a", minutes("day 3 10:00"));
    booked(state, "hall-a", minutes("day 13 10:00"));
    SIX.forEach((speaker, index) => {
      mail(state, "organiser", speaker, "invite", { session: index + 1, time: TIMES[index], fee: 0, travel_paid: false }, minutes("day 13 11:00"));
      mail(state, speaker, "organiser", "accept", { session: index + 1 }, minutes("day 13 12:00"));
    });
    published(state, "hall-a", minutes("day 14 10:00"));
    believing(state);
    expect(holds("programme_on_time", state)).toBe(false);
    expect(evaluated("programme_published", state)).toEqual({ holds: true, reachedAt: minutes("day 14 10:00") });
  });
});

describe("the plan counts every session: six speakers with no partner, five with one (FR-CONGRESS-20)", () => {
  /** A congress with one venue at 2000, a caterer at 30 a head, eight speakers whose fees rise by 100 from 0, the target 40 and 2 helpers, the plan's cost as the budget, and a partner when asked. */
  function congress(partner: boolean): Scenario<unknown> {
    const configuration = parse(congressScenario.baseConfiguration);
    const venue = { id: "v1", rooms: [{ id: "hall-a", seats: 80 }], access_claim: "step-free", price: 2000, extras: {}, hold_days: 2, deposit_share: 0.3, deposit_due_days: 3, cancellation: [{ share: 0.5 }] };
    const speakers = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `s${n + 1}`, fee: 100 * n, home: "local", available: true, acceptance: 1 }));
    const caterer = { id: "c1", price_per_head: 30, final_days: 7, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.3 }] };
    Object.assign(configuration, {
      city: stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "hall-a", seats: 80 }] }], passages: [{ between: ["office", "v1-entrance"], length: 5, step_free: true }, { between: ["v1-entrance", "hall-a"], length: 1, step_free: true }] }),
      pools: stringify({ topics: ["soil"], venue: [venue], board: [], speaker: speakers, partner: partner ? [{ id: "p1", title: "Partner's soil", session: 3, fee: 0, home: "local", available: true }] : [], caterer: [caterer], sponsor: [], agency: [] }),
      draw: stringify({ attendance: [40, 40], venue: 1, speaker: 8, caterer: 1, budget_over_plan: [1, 1], advance: [1000, 1000], ...(partner ? { partner: 1 } : {}) }),
      attendees: stringify({ pool_factor: 1, base_per_day: 0, unannounced: 0, promotion_factor: 1, payment_fee_share: 0, diets: { none: 1 }, access: { none: 1 } }),
      helpers: 2,
    });
    (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
    return { ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) };
  }

  it("takes the six lowest-fee accepting available speakers when no partner is drawn", () => {
    // 2000 + (40 + 6 + 2 + 3) × 30 + (0 + 100 + … + 500).
    expect((loadScenario(congress(false), 1).variant as Record<string, number>).plan_cost).toBe(2000 + 51 * 30 + 1500);
  });

  it("takes five when one partner is drawn", () => {
    // 2000 + (40 + 5 + 2 + 3) × 30 + (0 + 100 + … + 400).
    expect((loadScenario(congress(true), 1).variant as Record<string, number>).plan_cost).toBe(2000 + 50 * 30 + 1000);
  });
});
