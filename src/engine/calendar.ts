import type { TomlTable, TomlValue } from "smol-toml";

/** The week's days, in order, as a calendar names them. */
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** The seconds in a day, at whose end the next day begins. */
const DAY_SECONDS = 24 * 3600;

/** A moment of the world's time (FR-CLOCK-03): its day number, its weekday and its whole seconds since midnight. */
export interface WorldTime {
  day: number;
  weekday: Weekday;
  seconds: number;
}

/** A duration in the world's time (FR-CLOCK-03), in world seconds: it takes the run time they span from when it starts. */
export interface WorldDuration {
  worldSeconds: number;
}

/**
 * A stretch of the world's time at one scale, in world seconds per second of the run, that ends where its `until` is, in
 * world seconds since day 1's midnight; the last segment has none and lasts until the run ends.
 */
interface Segment {
  scale: number;
  until?: number;
}

/** A configuration's [calendar] (FR-CLOCK-03): when the world's time starts, and its segments in order. */
export interface Calendar {
  /** When the agents can start, in world seconds since day 1's midnight, with the weekday of that day 1. */
  start: number;
  weekdayOfDayOne: number;
  segments: readonly Segment[];
}

/** The world seconds since day 1's midnight of a day number and a time "HH:MM". */
function worldSeconds(day: number, hours: number, minutes: number): number {
  return (day - 1) * DAY_SECONDS + hours * 3600 + minutes * 60;
}

/** Reads a configuration's [calendar]. */
export function readCalendar(value: TomlValue): Calendar {
  const table = value as TomlTable;
  const [, day, weekday, hours, minutes] = /^day (\d+) (\w+) (\d{2}):(\d{2})$/.exec(table.start as string) ?? [];
  const start = worldSeconds(Number(day), Number(hours), Number(minutes));
  const weekdayOfDayOne = WEEKDAYS.indexOf(weekday as Weekday) - (Number(day) - 1);
  const segments = (table.segments as TomlTable[]).map((segment) => {
    if (segment.until === undefined) return { scale: segment.scale as number };
    const [, untilDay, untilHours, untilMinutes] = /^day (\d+) (\d{2}):(\d{2})$/.exec(segment.until as string) ?? [];
    return { scale: segment.scale as number, until: worldSeconds(Number(untilDay), Number(untilHours), Number(untilMinutes)) };
  });
  return { start, weekdayOfDayOne, segments };
}

/** The world's time at a moment of the run, in milliseconds since it started, following the calendar segment by segment. */
export function worldTimeAt(calendar: Calendar, sinceStartMs: number): WorldTime {
  return worldTimeOf(calendar, worldSecondsAt(calendar, sinceStartMs));
}

/** The world seconds since day 1's midnight at a moment of the run: one run second in a segment is its scale's world seconds. */
function worldSecondsAt({ start, segments }: Calendar, sinceStartMs: number): number {
  let segmentStartMs = 0;
  let segmentStart = start;
  for (const { scale, until } of segments) {
    const segmentMs = until === undefined ? Infinity : ((until - segmentStart) / scale) * 1000;
    if (sinceStartMs < segmentStartMs + segmentMs) return segmentStart + ((sinceStartMs - segmentStartMs) / 1000) * scale;
    segmentStartMs += segmentMs;
    segmentStart = until as number;
  }
  throw new Error("the calendar's last segment ends, which only a segment that is not the last may do");
}

/** The world time of whole world seconds since day 1's midnight: days follow at midnight, weekdays follow the week. */
function worldTimeOf({ weekdayOfDayOne }: Calendar, since: number): WorldTime {
  const whole = Math.floor(since);
  const day = Math.floor(whole / DAY_SECONDS) + 1;
  const weekday = WEEKDAYS[(((weekdayOfDayOne + day - 1) % 7) + 7) % 7];
  return { day, weekday, seconds: whole % DAY_SECONDS };
}

/**
 * The run milliseconds a duration in world time takes from a moment of the run: the run time those world seconds span from
 * there, segment by segment.
 */
export function runMsFor(calendar: Calendar, fromMs: number, worldSeconds: number): number {
  return runMsAt(calendar, worldSecondsAt(calendar, fromMs) + worldSeconds) - fromMs;
}

/** The moment of the run, in milliseconds since it started, at which the world's time reaches world seconds since day 1's midnight. */
function runMsAt({ start, segments }: Calendar, since: number): number {
  let segmentStartMs = 0;
  let segmentStart = start;
  for (const { scale, until } of segments) {
    if (until === undefined || since < until) return segmentStartMs + ((since - segmentStart) / scale) * 1000;
    segmentStartMs += ((until - segmentStart) / scale) * 1000;
    segmentStart = until;
  }
  throw new Error("the calendar's last segment ends, which only a segment that is not the last may do");
}
