import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import type { WorldTime } from "../src/engine/calendar.ts";
import { type PartsProvided, PartsBook, readParts } from "../src/engine/parts.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { type Congress, congressScenario } from "../src/scenarios/congress.ts";

// FR-CONGRESS-18: the readings from FR-CONGRESS-17's build.

const on = (day: number, clock = "09:00"): WorldTime => {
  const [hours, minutes] = clock.split(":").map(Number);
  return { day, weekday: "Monday", seconds: hours * 3600 + minutes * 60 };
};

describe("a hotel keeps a room up to its own night (FR-CONGRESS-18)", () => {
  /** The congress with the hotels "h1" and "h2" near "v1", of 10 rooms each. */
  function initial(): Congress {
    const configuration = parse(congressScenario.baseConfiguration);
    configuration.city = stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "main-hall", seats: 120 }] }], passages: [{ between: ["office", "v1-entrance"], length: 40, step_free: true }] });
    (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
    configuration.travel = stringify({
      stations: ["north"],
      trains: [],
      hotels: [
        { id: "h1", near: "v1", rooms: 10, price: 90 },
        { id: "h2", near: "v1", rooms: 10, price: 90 },
      ],
      sold_out_probability: 0,
    });
    return loadScenario({ ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) }, 1).world.state as Congress;
  }
  const tool = (name: string) => congressScenario.tools.find((each) => each.name === name) as never as { sense: (...args: unknown[]) => string; action: { precondition: (...args: unknown[]) => { holds: boolean; reason?: string }; effect: (...args: unknown[]) => Congress } };
  const roomsLeft = (state: Congress, day: number, hotel = "h2") =>
    (JSON.parse(tool("travel_options").sense(state, "organiser", { from: "north", date: "day 26" }, 0, on(day))) as { hotels: { id: string; rooms_left: number }[] }).hotels.find(({ id }) => id === hotel)?.rooms_left;
  const booking = (option: string, traveller: string, day: number) => ({ agent: "organiser", arguments: { option, traveller }, atMs: 0, world: on(day) });

  it("its rooms left on a night are its rooms × days left / 14, rounded down, and never fewer than 1 up to and on that night's day", () => {
    const state = initial();
    expect([roomsLeft(state, 5), roomsLeft(state, 18), roomsLeft(state, 24), roomsLeft(state, 25)]).toEqual([10, 5, 1, 1]);
  });

  it("its rooms left are those less the rooms booked, never below 0, so its last room on its own night can be booked once", () => {
    const book = tool("book_travel").action;
    const call = booking("h2 day 25", "s1", 25);
    const initialState = initial();
    expect(book.precondition(initialState, call)).toEqual({ holds: true });
    const booked = book.effect(initialState, call);
    expect(roomsLeft(booked, 25)).toBe(0);
    expect(book.precondition(booked, booking("h2 day 25", "s2", 25)).holds).toBe(false);
    // Bookings made earlier, when more rooms were scarce, leave none below 0.
    const many = ["a", "b", "c"].reduce((state, traveller) => book.effect(state, booking("h2 day 25", traveller, 18)), initialState);
    expect(roomsLeft(many, 25)).toBe(0);
  });
});

describe("a refused act is no misapplication (FR-CONGRESS-18)", () => {
  interface Flags {
    flags: Record<string, boolean>;
  }
  const provided: PartsProvided<Flags> = {
    predicates: { flag_set: (state, params) => state.flags[String(params.flag)] === true },
    events: {},
    misapplications: { act_named: (act, params) => act.tool === params.tool },
  };

  it("a pattern matches only acts that took effect: one that failed with an outcome the tool names is never listed", () => {
    const parts = readParts([{ id: "p1", predicate: "flag_set", params: { flag: "door" }, activation: "always", evaluate_at: "day 1 18:00", misapplications: [{ pattern: "act_named", params: { tool: "send_mail" } }] }], provided, { participants: [] });
    const lines: Record<string, unknown>[] = [];
    const book = new PartsBook<Flags>({ parts, provided, agents: ["ana"], record: (line) => lines.push(line) });
    book.start({ flags: {} }, on(1));
    book.acted({ agent: "ana", tool: "send_mail", arguments: { to: "s1", act: "invite" }, world: on(1, "10:00"), outcome: "missing_field" });
    book.acted({ agent: "ana", tool: "send_mail", arguments: { to: "s9", act: "invite" }, world: on(1, "11:00"), outcome: "unknown_recipient" });
    book.acted({ agent: "ana", tool: "send_mail", arguments: { to: "s1", act: "dance" }, world: on(1, "12:00"), outcome: "act_not_taken" });
    book.acted({ agent: "ana", tool: "send_mail", arguments: { to: "s1", act: "invite" }, world: on(1, "13:00"), outcome: "success" });
    book.due({ flags: {} }, on(1, "18:00"));
    expect(lines[0]).toMatchObject({ part: "p1", misapplications: [{ tool: "send_mail", at: "day 1 13:00" }] });
    expect((lines[0] as { misapplications: unknown[] }).misapplications).toHaveLength(1);
  });
});
