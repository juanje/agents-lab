import { describe, expect, it } from "vitest";
import { readCalendar, runMsFor, worldTimeAt } from "../src/engine/calendar.ts";

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
