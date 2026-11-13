import { describe, expect, it } from "vitest";
import { attendanceOf, balanceOf, beliefOf, bookingsOf, ceilingAt, committedAt } from "../src/scenarios/congress-parts.ts";
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
