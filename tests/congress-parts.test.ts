import { describe, expect, it } from "vitest";
import { answerFor, attendanceOf, balanceOf, beliefOf, bookingsOf, ceilingAt, committedAt, congressParts } from "../src/scenarios/congress-parts.ts";
import type { Congress } from "../src/scenarios/congress.ts";

const minutes = (day: number, clock = "00:00") => (day - 1) * 1440 + Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const worldOf = (at: number) => ({ day: Math.floor(at / 1440) + 1, weekday: "Monday" as const, seconds: Math.round((at % 1440) * 60) });

/** A congress world with these messages (each delivered at its time), money events and people. */
function world({ mail = [], events = [], people = [], programme = [] }: { mail?: [string, string, string, Record<string, unknown>, number][]; events?: Record<string, unknown>[]; people?: Record<string, unknown>[]; programme?: Record<string, unknown>[] }): Congress {
  const mailboxes: Record<string, unknown[]> = {};
  mail.forEach(([from, to, act, fields, at], index) => (mailboxes[to] = [...(mailboxes[to] ?? []), { id: `m-${index + 1}`, from, to, act, fields, subject: act, received: worldOf(at), read: true }]));
  return {
    rooms: { "main-hall": { venue: "v1", seats: 120 }, "room-b": { venue: "v1", seats: 30 }, "room-d": { venue: "v1", seats: 80 } },
    mail: { mailboxes, inTransit: [] },
    money: { balances: {}, invoices: [], commitments: [], ceilings: {}, overruns: [], events },
    population: { people, programme, events: [] },
    context: { helpers: 2, discretionaryLimit: 300 },
  } as unknown as Congress;
}

describe("the congress's records, as its parts read them (FR-CONGRESS-06)", () => {
  it("reads a venue's booking from its mail: its contract, whether it was confirmed or cancelled, and its rooms after changes and allocation", () => {
    const state = world({
      mail: [
        ["v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "main-hall, room-b", price: 2000 }, minutes(2)],
        ["v1", "organiser", "confirmed", { contract: "v1-contract-1" }, minutes(3)],
        ["v1", "organiser", "rooms_allocated", { contract: "v1-contract-1", allocation: "main-hall -> main-hall; room-b -> room-d" }, minutes(15)],
        ["v2", "organiser", "contract", { contract: "v2-contract-1", date: "day 26", rooms: "hall-2", price: 1800 }, minutes(2)],
        ["v2", "organiser", "confirmed", { contract: "v2-contract-1" }, minutes(3)],
        ["v2", "organiser", "cancelled", { contract: "v2-contract-1", charge: 0 }, minutes(11)],
      ],
    });
    expect(bookingsOf(state)).toEqual([
      { venue: "v1", contract: "v1-contract-1", date: "day 26", rooms: ["main-hall", "room-d"], confirmedAt: minutes(3), allocated: true },
      { venue: "v2", contract: "v2-contract-1", date: "day 26", rooms: ["hall-2"], confirmedAt: minutes(3), cancelledAt: minutes(11), allocated: false },
    ]);
  });

  it("reads what a speaker believes: the latest of the confirmation or change it received and the latest programme naming it", () => {
    const session = (speaker: string, start: string, room: string) => ({ start, end: "12:00", title: "t", speakers: [speaker], room });
    const state = world({
      mail: [
        ["organiser", "s1", "confirm", { time: "09:00", room: "foyer" }, minutes(5)],
        ["organiser", "s1", "change", { room: "room-b" }, minutes(14)],
      ],
      programme: [{ version: 1, sessions: [session("s1", "10:00", "main-hall")], published: minutes(12) }],
    });
    expect(beliefOf(state, "s1")).toEqual({ time: "10:00", room: "room-b" });
    expect(beliefOf(state, "s9")).toBeUndefined();
  });

  it("reads the organiser's committed total and the ceiling in force at a time, from the money's timed events", () => {
    const state = world({
      events: [
        { kind: "commitment", from: "organiser", to: "v1", amount: 2000, commitment: "k-1", at: minutes(3) },
        { kind: "approval", from: "board", to: "organiser", ceiling: 5500, at: minutes(4) },
        { kind: "commitment", from: "organiser", to: "c1", amount: 1000, commitment: "k-2", at: minutes(5) },
        { kind: "release", from: "organiser", to: "v1", amount: 2000, commitment: "k-1", at: minutes(6) },
        { kind: "commitment", from: "v1", to: "organiser", amount: 99, commitment: "k-3", at: minutes(6) },
      ],
    });
    expect([committedAt(state, minutes(3)), committedAt(state, minutes(5)), committedAt(state, minutes(7))]).toEqual([2000, 3000, 1000]);
    expect([ceilingAt(state, minutes(3)), ceilingAt(state, minutes(5))]).toEqual([300, 5500]);
  });

  it("reads the attendance: registrants not cancelled, confirmed speakers, 3 board members and the helpers", () => {
    const state = world({
      mail: [
        ["organiser", "s1", "confirm", { time: "09:00", room: "main-hall" }, minutes(5)],
        ["organiser", "s2", "confirm", { time: "10:00", room: "main-hall" }, minutes(5)],
        ["s2", "organiser", "cancel", {}, minutes(9)],
      ],
      people: [{ id: "a-1", registered: 0 }, { id: "a-2", registered: 0, cancelled: 10 }, { id: "a-3" }],
    });
    expect(attendanceOf(state)).toBe(1 + 1 + 3 + 2);
  });

  it("reads the balance: funds and ticket income transferred, sponsor money paid or agreed, less what the organiser committed; and the overruns", () => {
    const state = world({
      mail: [["sp1", "organiser", "agreement", { amount: 1500, conditions: "logo" }, minutes(5)]],
      events: [
        { kind: "transfer", from: "board", to: "organiser", amount: 3000, at: minutes(3) },
        { kind: "transfer", from: "attendees", to: "organiser", amount: 2000, at: minutes(10) },
        { kind: "payment", from: "sp1", to: "organiser", amount: 500, invoice: "i-2", at: minutes(12) },
        { kind: "commitment", from: "organiser", to: "v1", amount: 6600, commitment: "k-1", at: minutes(4) },
        { kind: "unapproved_overrun", from: "organiser", amount: 6600, commitment: "k-1", limit: 300, at: minutes(4) },
      ],
    });
    expect(balanceOf(state)).toEqual({ balance: 3000 + 2000 + 1500 - 6600, overruns: 1 });
  });
});

describe("the parts' corrections (FR-CONGRESS-10)", () => {
  type Mail = [string, string, string, Record<string, unknown>, number];
  const holds = (part: string, state: Congress) => {
    const given = congressParts.predicates[part](state, {});
    return typeof given === "boolean" ? given : given.holds;
  };
  const withContext = (state: Congress, context: Record<string, unknown>, population: Record<string, unknown> = {}) =>
    ({ ...state, context: { ...state.context, eventDay: 26, target: 50, noShowCut: 0.05, roles: { venue: { false_claim: ["v1"] }, sponsor: { data: ["sp2"], withdraws: ["sp3"] } }, ...context }, population: { ...state.population, page: { open: true, price: 50, required_fields: [], info: [], waiting_list: false }, sponsorData: {}, ...population }, perturbations: [], passages: [], venues: { v1: { entrance: "v1-entrance", hours: "always" } }, travel: { material: { trains: [], hotels: [] }, booked: [] } }) as unknown as Congress;
  const booking: Mail[] = [
    ["v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "main-hall", price: 2000 }, minutes(2)],
    ["v1", "organiser", "confirmed", { contract: "v1-contract-1" }, minutes(3)],
  ];
  const confirmedSpeaker = (speaker: string, session: number, time: string): Mail[] => [
    ["organiser", speaker, "invite", { session, time, fee: 0, travel_paid: false }, minutes(3)],
    [speaker, "organiser", "accept", { session }, minutes(4)],
    ["organiser", speaker, "confirm", { time, room: "main-hall" }, minutes(5)],
    [speaker, "organiser", "acknowledged", {}, minutes(5, "01:00")],
  ];
  const sessionAt = (speaker: string, start: string) => ({ start, end: "23:00", title: speaker, speakers: [speaker], room: "main-hall" });
  const six = ["09:30", "10:30", "11:30", "14:00", "15:00", "16:00"];
  const programmeOf = (count: number) => [{ version: 1, sessions: six.slice(0, count).map((time, index) => sessionAt(`s${index + 1}`, time)), breaks: [], sponsor_slots: [], logos: [], published: minutes(12) }];
  const speakers = (count: number) => six.slice(0, count).flatMap((time, index) => confirmedSpeaker(`s${index + 1}`, index + 1, time));

  it("does not hold a part whose situation never happened: no registrant, no order, no travelling speaker, no live booking, fewer than six sessions", () => {
    const empty = withContext(world({}), {});
    for (const part of ["P11", "P12", "P13", "P07", "W2", "W6"]) expect(holds(part, empty), part).toBe(false);
    expect(holds("P13", withContext(world({}), {}, { page: { open: false, price: 50, required_fields: [], info: [], waiting_list: false } }))).toBe(false);
    expect(holds("W5", withContext(world({ mail: [...booking, ...speakers(3)], programme: programmeOf(3) }), {}))).toBe(false);
    expect(holds("W2", withContext(world({ mail: [...booking, ...speakers(6)], programme: programmeOf(6) }), {}))).toBe(true);
    expect(holds("P21", withContext(world({ mail: [...booking, ...speakers(6)], programme: programmeOf(6) }), {}))).toBe(false);
  });

  it("does not hold P16 while S2 agreed to an attendee list with no consent field and nothing settled it", () => {
    const agreed: Mail[] = [["sp2", "organiser", "agreement", { amount: 1000, conditions: "logo, attendee_list" }, minutes(4)]];
    expect(holds("P16", withContext(world({ mail: agreed }), {}))).toBe(false);
    expect(holds("P16", withContext(world({ mail: [["sp2", "organiser", "agreement", { amount: 1000, conditions: "logo" }, minutes(4)]] }), {}))).toBe(true);
  });

  it("activates P17 only when S3 had agreed before it withdrew", () => {
    const withdrew = (mail: Mail[]) => ({ ...withContext(world({ mail }), {}), perturbations: [{ name: "sponsor_withdraws", target: "sp3", at: minutes(12) }] }) as Congress;
    expect(congressParts.events.sponsor_withdraws(withdrew([]), {})).toBeUndefined();
    expect(congressParts.events.sponsor_withdraws(withdrew([["sp3", "organiser", "agreement", { amount: 900, conditions: "logo" }, minutes(5)]]), {})).toEqual(worldOf(minutes(12)));
  });

  it("gives P11 the moment the page first required diet and access while open as its reached_at, and P04 the approval's time", () => {
    const people = [1, 2, 3].map((index) => ({ id: `a-${index}`, diet: "none", access: "none", registered: minutes(6), given: { diet: "none", access: "none" } }));
    const edits = [{ at: minutes(3), open: true, required_fields: [] }, { at: minutes(5, "10:00"), required_fields: ["diet", "access"] }];
    expect(congressParts.predicates.P11(withContext(world({ people }), {}, { edits }), {})).toMatchObject({ holds: true, reachedAt: minutes(5, "10:00") });

    const events = [
      { kind: "approval", from: "board", to: "organiser", ceiling: 5500, at: minutes(3, "11:00") },
      { kind: "commitment", from: "organiser", to: "v1", amount: 400, commitment: "k-1", at: minutes(4) },
    ];
    expect(congressParts.predicates.P04(withContext(world({ events }), {}), {})).toMatchObject({ holds: true, reachedAt: minutes(3, "11:00") });
  });

  it("reads a speaker's answer for a session from its answers to that session only, and P06's condition from the organiser's offer", () => {
    const answers: Mail[] = [
      ["organiser", "s1", "invite", { session: 2, time: "10:30", fee: 0, travel_paid: false }, minutes(3)],
      ["s1", "organiser", "accept", { session: 2 }, minutes(4)],
      ["s1", "organiser", "decline", { slot: 4 }, minutes(7)],
    ];
    expect(answerFor(world({ mail: answers }), "s1", 2)).toBe("accept");
    expect(answerFor(world({ mail: answers }), "s1", 5)).toBeUndefined();

    const conditional = (offered: number): Mail[] => [
      ["organiser", "s1", "invite", { session: 2, time: "10:30", fee: 0, travel_paid: false }, minutes(3)],
      ["s1", "organiser", "accept_if", { session: 2, condition: "fee" }, minutes(4)],
      ["organiser", "s1", "accept_condition", { fee: offered }, minutes(5)],
      ["s1", "organiser", "accept", { session: 2 }, minutes(6)],
    ];
    expect(holds("P06", withContext(world({ mail: conditional(0) }), { fees: { s1: 300 } }))).toBe(false);
    expect(holds("P06", withContext(world({ mail: conditional(300) }), { fees: { s1: 300 } }))).toBe(true);
  });

  it("counts as confirmed only a speaker that accepted and acknowledged its confirmation", () => {
    const declined: Mail[] = [
      ["s1", "organiser", "decline", { session: 1 }, minutes(4)],
      ["organiser", "s1", "confirm", { time: "10:00", room: "main-hall" }, minutes(5)],
    ];
    expect(attendanceOf(world({ mail: declined }))).toBe(5);
    expect(attendanceOf(world({ mail: confirmedSpeaker("s1", 1, "10:00") }))).toBe(6);
  });

  it("does not hold W4 for a cancelled congress, and counts sponsor money only when paid or due under conditions met", () => {
    const cancelled: Mail[] = [...booking, ["organiser", "v1", "cancel_booking", {}, minutes(12)], ["v1", "organiser", "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes(12, "01:00")]];
    const funds = [{ kind: "transfer", from: "board", to: "organiser", amount: 1800, at: minutes(3) }];
    expect(holds("W4", withContext(world({ mail: cancelled, events: funds }), {}))).toBe(false);

    const agreed: Mail[] = [["sp1", "organiser", "agreement", { amount: 1200, conditions: "logo" }, minutes(4)]];
    expect(balanceOf(withContext(world({ mail: agreed }), {})).balance).toBe(0);
    const shown = [{ ...programmeOf(1)[0], logos: ["sp1"] }];
    expect(balanceOf(withContext(world({ mail: agreed, programme: shown }), {})).balance).toBe(1200);
  });
});
