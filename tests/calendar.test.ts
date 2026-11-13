import { describe, expect, it } from "vitest";
import { hoursAt, reachedAfterMs, readCalendar, runMsFor, worldTimeAt } from "../src/engine/calendar.ts";

/** A calendar from Friday 17:00, at 600 world seconds per run second until 17:10, then at 300. */
const twoSegments = readCalendar({
  start: "day 1 Friday 17:00",
  segments: [{ scale: 600, until: "day 1 17:10" }, { scale: 300 }],
});

/** Seconds since midnight. */
const at = (hours: number, minutes: number, seconds = 0) => hours * 3600 + minutes * 60 + seconds;

describe("worldTimeAt", () => {
  it("gives the start when the run starts", () => {
    expect(worldTimeAt(twoSegments, 0)).toEqual({ day: 1, weekday: "Friday", seconds: at(17, 0) });
  });

  it("follows the first segment's scale within it, to the second", () => {
    expect(worldTimeAt(twoSegments, 250)).toEqual({ day: 1, weekday: "Friday", seconds: at(17, 2, 30) });
    expect(worldTimeAt(twoSegments, 251)).toEqual({ day: 1, weekday: "Friday", seconds: at(17, 2, 30) });
  });

  it("follows the next segment's scale from its first segment's until", () => {
    expect(worldTimeAt(twoSegments, 1000)).toEqual({ day: 1, weekday: "Friday", seconds: at(17, 10) });
    expect(worldTimeAt(twoSegments, 1500)).toEqual({ day: 1, weekday: "Friday", seconds: at(17, 12, 30) });
  });

  it("goes on to the next day at midnight, and to the week's next weekday", () => {
    const sunday = readCalendar({ start: "day 1 Sunday 23:58", segments: [{ scale: 600 }] });

    expect(worldTimeAt(sunday, 350)).toEqual({ day: 2, weekday: "Monday", seconds: at(0, 1, 30) });
  });
});

describe("readCalendar", () => {
  const valid = {
    start: "day 1 Friday 17:00",
    segments: [{ scale: 600, until: "day 1 17:10" }, { scale: 300 }],
    hours: { office: { days: ["Monday"], from: "09:00", to: "18:00" } },
  };
  /** The valid calendar with a change, as a configuration would give it. */
  const changed = (change: (calendar: any) => void) => {
    const calendar: any = structuredClone(valid);
    change(calendar);
    return () => readCalendar(calendar);
  };

  it("reads a calendar that can be followed", () => {
    expect(changed(() => {})).not.toThrow();
  });

  it.each([
    ["a start that does not follow its format", (c: any) => (c.start = "Friday 17:00"), "calendar.start"],
    ["a start at a time that is no time of day", (c: any) => (c.start = "day 1 Friday 24:00"), "calendar.start"],
    ["a weekday that is not one of the seven English names", (c: any) => (c.start = "day 1 Fri 17:00"), "calendar.start"],
    ["a day number below 1", (c: any) => (c.start = "day 0 Friday 17:00"), "calendar.start"],
    ["a scale that is not a positive number", (c: any) => (c.segments[0].scale = 0), "calendar.segments[0].scale"],
    ["a scale that is not a number", (c: any) => (c.segments[1].scale = "fast"), "calendar.segments[1].scale"],
    ["an until that does not follow its format", (c: any) => (c.segments[0].until = "17:10"), "calendar.segments[0].until"],
    ["an until at the start", (c: any) => (c.segments[0].until = "day 1 17:00"), "calendar.segments[0].until"],
    ["an until before the start", (c: any) => (c.segments[0].until = "day 1 16:00"), "calendar.segments[0].until"],
    [
      "an until at or before the previous segment's",
      (c: any) => (c.segments = [{ scale: 600, until: "day 1 17:10" }, { scale: 300, until: "day 1 17:10" }, { scale: 60 }]),
      "calendar.segments[1].until",
    ],
    ["a segment without until that is not the last", (c: any) => delete c.segments[0].until, "calendar.segments[0].until"],
    ["no segment", (c: any) => (c.segments = []), "calendar.segments"],
    ["no segments at all", (c: any) => delete c.segments, "calendar.segments"],
    ["hours whose from is not before their to", (c: any) => (c.hours.office.from = "18:00"), "calendar.hours.office"],
    ["hours whose days are empty", (c: any) => (c.hours.office.days = []), "calendar.hours.office"],
    ["hours that name an unknown weekday", (c: any) => (c.hours.office.days = ["Mon"]), "calendar.hours.office"],
    ["hours whose to does not follow its format", (c: any) => (c.hours.office.to = "6pm"), "calendar.hours.office"],
  ])("refuses %s, naming its key", (_what, change, key) => {
    expect(changed(change)).toThrow(key);
  });
});

describe("hoursAt", () => {
  const office = readCalendar({
    start: "day 1 Friday 17:00",
    segments: [{ scale: 600 }],
    hours: { office: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], from: "09:00", to: "18:00" } },
  });
  const nextMonday = { day: 4, weekday: "Monday", seconds: at(9, 0) } as const;

  it("is within the hours from their start, up to and not at their end, on their days", () => {
    expect(hoursAt(office, "office", { day: 1, weekday: "Friday", seconds: at(17, 30) })).toEqual({ within: true, next: nextMonday });
    expect(hoursAt(office, "office", { day: 1, weekday: "Friday", seconds: at(18, 0) })).toEqual({ within: false, next: nextMonday });
    expect(hoursAt(office, "office", { day: 4, weekday: "Monday", seconds: at(8, 59) })).toEqual({ within: false, next: nextMonday });
  });

  it("is not within them on a day they do not name", () => {
    expect(hoursAt(office, "office", { day: 2, weekday: "Saturday", seconds: at(10, 0) })).toEqual({ within: false, next: nextMonday });
  });

  it("gives as their next beginning the first after the time, so not one that begins at it", () => {
    expect(hoursAt(office, "office", nextMonday)).toEqual({ within: true, next: { day: 5, weekday: "Tuesday", seconds: at(9, 0) } });
  });

  it("refuses hours the calendar does not declare, naming them", () => {
    expect(() => hoursAt(office, "night", nextMonday)).toThrow('"night"');
  });
});

describe("runMsFor", () => {
  it("gives the run time a duration in world time spans from a moment, segment by segment", () => {
    // From 17:02:30, 15 world minutes end at 17:17:30: 450 world seconds in the first segment, 450 in the second.
    expect(runMsFor(twoSegments, 250, 900)).toBeCloseTo(750 + 1500, 6);
  });

  it("gives less run time for the same world duration in a faster segment", () => {
    expect(runMsFor(twoSegments, 0, 60)).toBeCloseTo(100, 6);
    expect(runMsFor(twoSegments, 1000, 60)).toBeCloseTo(200, 6);
  });
});

describe("reachedAfterMs (FR-PARTICIPANT-01)", () => {
  const office = readCalendar({
    start: "day 1 Friday 17:00",
    segments: [{ scale: 600 }],
    hours: { office: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], from: "09:00", to: "18:00" } },
  });

  it("gives the run time from a moment until a duration in world time has passed, without hours", () => {
    // At 17:04, ten world minutes (600 world seconds) later is 17:14: 1000 ms of the run at 100 ms a world minute.
    expect(reachedAfterMs(office, 400, 600)).toBeCloseTo(1000, 6);
  });

  it("gives the same within the hours, when the duration ends within them", () => {
    expect(reachedAfterMs(office, 400, 600, "office")).toBeCloseTo(1000, 6);
  });

  it("gives the run time until the hours next begin, when the duration ends outside them", () => {
    // At 17:54, ten world minutes later is 18:04, after the office closes: the first moment within it is Monday 09:00.
    const mondayMs = ((3 * 24 * 60 - 8 * 60) * 60 * 1000) / 600;
    expect(reachedAfterMs(office, 5400, 600, "office")).toBeCloseTo(mondayMs - 5400, 6);
  });
});
