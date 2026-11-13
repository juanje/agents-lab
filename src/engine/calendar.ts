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

/** A time of day as a calendar writes it, "HH:MM". */
const TIME = "(\\d{2}):(\\d{2})";

/** The seconds since midnight of a time of day, from its hours and minutes, or undefined when it is no time of day. */
function secondsOfDay(hours: string, minutes: string): number | undefined {
  const [h, m] = [Number(hours), Number(minutes)];
  return h < 24 && m < 60 ? h * 3600 + m * 60 : undefined;
}

/** A calendar's key that cannot be followed: an error that names it, its value and why. */
function refused(key: string, value: unknown, why: string): Error {
  return new Error(`The configuration's ${key} ${JSON.stringify(value) ?? "(none)"} cannot be followed: ${why}`);
}

/** The seconds since midnight of a key's "HH:MM", refused, naming the key, when it does not follow that format. */
function timeOfDay(value: unknown, key: string): number {
  const [, hours, minutes] = typeof value === "string" ? (new RegExp(`^${TIME}$`).exec(value) ?? []) : [];
  const seconds = hours === undefined ? undefined : secondsOfDay(hours, minutes);
  if (seconds === undefined) throw refused(key, value, 'it is not a time "HH:MM"');
  return seconds;
}

/** A weekday as a calendar names it, refused, naming the key, when it is not one of the seven English names. */
function weekdayOf(value: unknown, key: string): Weekday {
  if (!WEEKDAYS.includes(value as Weekday)) throw refused(key, value, `its weekday is not one of ${WEEKDAYS.join(", ")}`);
  return value as Weekday;
}

/**
 * The world seconds since day 1's midnight of a key written "day <n> HH:MM", or "day <n> <weekday> HH:MM" when it gives a
 * weekday, with that weekday; refused, naming the key, when it does not follow that format or its day is below 1.
 */
function dayTime(value: unknown, key: string, withWeekday: boolean): { since: number; weekday?: Weekday } {
  const format = withWeekday ? '"day <n> <weekday> HH:MM"' : '"day <n> HH:MM"';
  const pattern = new RegExp(`^day (\\d+) ${withWeekday ? "(\\S+) " : "()"}${TIME}$`);
  const [, day, weekday, hours, minutes] = typeof value === "string" ? (pattern.exec(value) ?? []) : [];
  const seconds = day === undefined ? undefined : secondsOfDay(hours, minutes);
  if (seconds === undefined) throw refused(key, value, `it does not follow ${format}`);
  if (Number(day) < 1) throw refused(key, value, "its day is below 1");
  const since = (Number(day) - 1) * DAY_SECONDS + seconds;
  return withWeekday ? { since, weekday: weekdayOf(weekday, key) } : { since };
}

/**
 * Reads a configuration's [calendar]; one that cannot be followed is refused, with an error that names the key: a start
 * or an until that does not follow its format, a weekday that is not one of the seven, a day below 1, a scale that is
 * not a positive number, an until at or before the start or the previous until, a segment without until that is not the
 * last, no segment, and hours whose from is not before their to, or whose days are empty or name an unknown weekday.
 */
export function readCalendar(value: TomlValue): Calendar {
  if (!isTable(value)) throw refused("calendar", value, "it is not a table");
  const { since: start, weekday } = dayTime(value.start, "calendar.start", true);
  const weekdayOfDayOne = WEEKDAYS.indexOf(weekday as Weekday) - Math.floor(start / DAY_SECONDS);
  const written = value.segments;
  if (!Array.isArray(written) || written.length === 0) throw refused("calendar.segments", written, "it declares no segment");
  let previous = { key: "calendar.start", since: start };
  const segments = written.map((segment, index): Segment => {
    const key = `calendar.segments[${index}]`;
    const { scale, until } = isTable(segment) ? segment : {};
    if (typeof scale !== "number" || !(scale > 0)) throw refused(`${key}.scale`, scale, "it is not a positive number");
    if (until === undefined) {
      if (index < written.length - 1) throw refused(`${key}.until`, until, "only the last segment may have no until");
      return { scale };
    }
    const { since } = dayTime(until, `${key}.until`, false);
    if (since <= previous.since) throw refused(`${key}.until`, until, `it is not after ${previous.key}`);
    previous = { key: `${key}.until`, since };
    return { scale, until: since };
  });
  const hours = Object.fromEntries(Object.entries(isTable(value.hours ?? {}) ? (value.hours ?? {}) : {}).map(([name, set]) => [name, hoursOf(set, `calendar.hours.${name}`)]));
  return { start, weekdayOfDayOne, segments, hours };
}

/**
 * A moment of the world's time a key writes "day <n> <weekday> HH:MM", by a calendar, and its world seconds since day 1's
 * midnight; refused, naming the key, when it does not follow that format. Its weekday is the calendar's for that day.
 */
export function readWorldTime(calendar: Calendar, value: unknown, key: string): { time: WorldTime; since: number } {
  const { since } = dayTime(value, key, true);
  return { time: worldTimeOf(calendar, since), since };
}

/** A named set of weekly hours, refused, naming its key, when its days are empty or unknown, or its from is not before its to. */
function hoursOf(value: TomlValue, key: string): Hours {
  const { days, from, to } = isTable(value) ? value : {};
  if (!Array.isArray(days) || days.length === 0) throw refused(key, value, "its days are empty");
  const weekdays = days.map((day) => weekdayOf(day, key));
  const [fromSeconds, toSeconds] = [timeOfDay(from, `${key}.from`), timeOfDay(to, `${key}.to`)];
  if (fromSeconds >= toSeconds) throw refused(key, value, "its from is not before its to");
  return { days: weekdays, from: fromSeconds, to: toSeconds };
}

/** Whether a TOML value is a table. */
function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
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

/**
 * Each segment of a calendar with where it begins and ends, in world seconds since day 1's midnight and in milliseconds
 * since the run started: one run second in a segment is its scale's world seconds, and the last lasts until the run ends.
 */
function spans({ start, segments }: Calendar): { scale: number; from: number; to: number; fromMs: number; toMs: number }[] {
  let from = start;
  let fromMs = 0;
  return segments.map(({ scale, until }) => {
    const to = until ?? Infinity;
    const toMs = fromMs + ((to - from) / scale) * 1000;
    const span = { scale, from, to, fromMs, toMs };
    [from, fromMs] = [to, toMs];
    return span;
  });
}

/** The world seconds since day 1's midnight at a moment of the run, in the segment that moment falls in. */
function worldSecondsAt(calendar: Calendar, sinceStartMs: number): number {
  const { scale, from, fromMs } = spans(calendar).find((span) => sinceStartMs < span.toMs) as ReturnType<typeof spans>[number];
  return from + ((sinceStartMs - fromMs) / 1000) * scale;
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

/**
 * The run milliseconds from a moment of the run until the first moment that is at least a duration in world seconds
 * later and, when hours are named, within them (FR-PARTICIPANT-01).
 */
export function reachedAfterMs(calendar: Calendar, fromMs: number, worldSeconds: number, hours?: string): number {
  let since = worldSecondsAt(calendar, fromMs) + worldSeconds;
  if (hours !== undefined) {
    const { within, next } = hoursAt(calendar, hours, worldTimeOf(calendar, since));
    if (!within) since = sinceDayOne(next);
  }
  return runMsAt(calendar, since) - fromMs;
}

/** The moment of the run, in milliseconds since it started, at which the world's time reaches world seconds since day 1's midnight. */
function runMsAt(calendar: Calendar, since: number): number {
  const { scale, from, fromMs } = spans(calendar).find((span) => since < span.to) as ReturnType<typeof spans>[number];
  return fromMs + ((since - from) / scale) * 1000;
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
  const segments = spans(calendar).map(({ scale, to, fromMs, toMs }) =>
    to === Infinity ? { scale, runTime: "until the run ends" } : { scale, until: `day ${dayOf(to)} ${clockOf(to)}`, runTime: `${toMs - fromMs} ms` },
  );
  const start = worldTimeOf(calendar, calendar.start);
  const hours = Object.fromEntries(Object.entries(calendar.hours).map(([name, { days, from, to }]) => [name, { days: [...days], from: clockOf(from), to: clockOf(to) }]));
  return { start: `day ${start.day} ${start.weekday} ${clockOf(calendar.start)}`, segments, hours };
}

/** A world time to the minute, as the world's parts tell it: "day <n> <weekday> HH:MM". */
export function worldTimeText({ day, weekday, seconds }: WorldTime): string {
  return `day ${day} ${weekday} ${clockOf(seconds)}`;
}

/** The world seconds since day 1's midnight of a world time, which orders world times. */
export function sinceDayOne({ day, seconds }: WorldTime): number {
  return (day - 1) * DAY_SECONDS + seconds;
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
