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
  /** Each named set of weekly hours, by its name. */
  hours: Readonly<Record<string, Hours>>;
}

/** A named set of weekly hours: the weekdays they fall on, and when they begin and end, in seconds since midnight. */
interface Hours {
  days: readonly Weekday[];
  from: number;
  to: number;
}

/** The seconds since midnight of a time "HH:MM". */
function secondsOfDay(time: string): number {
  const [, hours, minutes] = /^(\d{2}):(\d{2})$/.exec(time) ?? [];
  return Number(hours) * 3600 + Number(minutes) * 60;
}

/** The world seconds since day 1's midnight of a day number and a time "HH:MM". */
function worldSeconds(day: number, time: string): number {
  return (day - 1) * DAY_SECONDS + secondsOfDay(time);
}

/** Reads a configuration's [calendar]. */
export function readCalendar(value: TomlValue): Calendar {
  const table = value as TomlTable;
  const [, day, weekday, time] = /^day (\d+) (\w+) (\d{2}:\d{2})$/.exec(table.start as string) ?? [];
  const start = worldSeconds(Number(day), time);
  const weekdayOfDayOne = WEEKDAYS.indexOf(weekday as Weekday) - (Number(day) - 1);
  const segments = (table.segments as TomlTable[]).map((segment) => {
    if (segment.until === undefined) return { scale: segment.scale as number };
    const [, untilDay, untilTime] = /^day (\d+) (\d{2}:\d{2})$/.exec(segment.until as string) ?? [];
    return { scale: segment.scale as number, until: worldSeconds(Number(untilDay), untilTime) };
  });
  const hours = Object.fromEntries(
    Object.entries((table.hours ?? {}) as Record<string, TomlTable>).map(([name, { days, from, to }]) => [
      name,
      { days: days as Weekday[], from: secondsOfDay(from as string), to: secondsOfDay(to as string) },
    ]),
  );
  return { start, weekdayOfDayOne, segments, hours };
}

/**
 * Whether a world time is within a calendar's named hours, from their start up to and not at their end, on a day they
 * fall on; and when they next begin after it, which is not a beginning at that very time.
 */
export function hoursAt(calendar: Calendar, name: string, time: WorldTime): { within: boolean; next: WorldTime } {
  if (!Object.hasOwn(calendar.hours, name)) throw new Error(`The calendar declares no hours "${name}"`);
  const { days, from, to } = calendar.hours[name];
  const weekdayIn = (days: number) => WEEKDAYS[(WEEKDAYS.indexOf(time.weekday) + days) % 7];
  const within = days.includes(time.weekday) && from <= time.seconds && time.seconds < to;
  // Hours with a day fall on it once a week at least, so their next beginning is within the next seven days.
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const weekday = weekdayIn(ahead);
    if (days.includes(weekday) && (ahead > 0 || from > time.seconds)) return { within, next: { day: time.day + ahead, weekday, seconds: from } };
  }
  throw new Error(`The calendar's hours "${name}" fall on no day`);
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

/** A calendar as the inventory gives it (FR-CLOCK-03): its start, each segment with its scale and run time, and its hours. */
export interface CalendarInventory {
  start: string;
  /** Each segment, in order, with the run time it takes ("<n> ms"), or "until the run ends" for the last. */
  segments: { scale: number; until?: string; runTime: string }[];
  hours: Record<string, { days: Weekday[]; from: string; to: string }>;
}

/** A calendar as the inventory gives it, in the formats a configuration writes it. */
export function calendarInventory(calendar: Calendar): CalendarInventory {
  let segmentStart = calendar.start;
  const segments = calendar.segments.map(({ scale, until }) => {
    if (until === undefined) return { scale, runTime: "until the run ends" };
    const runMs = ((until - segmentStart) / scale) * 1000;
    segmentStart = until;
    return { scale, until: `day ${dayOf(until)} ${clockOf(until)}`, runTime: `${runMs} ms` };
  });
  const start = worldTimeOf(calendar, calendar.start);
  const hours = Object.fromEntries(Object.entries(calendar.hours).map(([name, { days, from, to }]) => [name, { days: [...days], from: clockOf(from), to: clockOf(to) }]));
  return { start: `day ${start.day} ${start.weekday} ${clockOf(calendar.start)}`, segments, hours };
}

/** The day number of world seconds since day 1's midnight. */
function dayOf(since: number): number {
  return Math.floor(since / DAY_SECONDS) + 1;
}

/** The time of day "HH:MM" of world seconds since a midnight. */
function clockOf(since: number): string {
  const minutes = Math.floor((since % DAY_SECONDS) / 60);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;
}
