import { describe, expect, it } from "vitest";
import { hoursAt, readCalendar, runMsFor, worldTimeAt } from "../src/engine/calendar.ts";

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

describe("hoursAt", () => {
  const office = readCalendar({
    start: "day 1 Friday 17:00",
    segments: [{ scale: 600 }],
    hours: { office: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], from: "09:00", to: "18:00" } },
  });
  const nextMonday = { day: 4, weekday: "Monday", seconds: at(9, 0) };

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
