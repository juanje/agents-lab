import type { TomlTable, TomlValue } from "smol-toml";
import type { Calendar } from "./calendar.ts";

/** A configuration's [phone] (FR-PHONE-01), as the engine follows it. */
export interface PhoneSettings {
  /** The agents and participants that have a line, by name. */
  lines: readonly string[];
  /** How long a phone rings, in world minutes, before a call nobody answers ends. */
  ringMinutes: number;
  /** How long a call that connects lasts, in world minutes, before its words. */
  callMinutes: number;
  /** One world minute more per this many words of both texts of a call that connects, when given. */
  callWordsPerMinute?: number;
  /** The ring's text, with its placeholders. */
  ring: string;
}

/** The placeholders a ring's text may name. */
const RING_PLACEHOLDERS = ["from", "act", "fields", "text", "call"];

/** A key of the phone that cannot be followed: an error that names it, its value and why. */
function refused(key: string, value: unknown, why: string): Error {
  return new Error(`The configuration's ${key} ${JSON.stringify(value) ?? "(none)"} cannot be followed: ${why}`);
}

/** Whether a TOML value is a table. */
function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

/** A positive number of world minutes, refused, naming its key, otherwise. */
function positiveMinutes(table: TomlTable, key: string): number {
  const value = table[key];
  if (typeof value !== "number" || !(value > 0)) throw refused(`phone.${key}`, value, "it is not a positive number of world minutes");
  return value;
}

/**
 * Reads a configuration's [phone] (FR-PHONE-01); one that cannot be followed is refused, with an error that names the
 * key: no [calendar], a line for a name that is no agent or participant, ring_minutes or call_minutes that are not a
 * positive number, a negative call_words_per_minute, and a ring that names a placeholder other than {from}, {act},
 * {fields}, {text} and {call}.
 */
export function readPhone(value: TomlValue, calendar: Calendar | undefined, names: readonly string[]): PhoneSettings {
  if (calendar === undefined) throw new Error("The configuration's phone cannot be followed: its durations are world time, and the configuration declares no [calendar]");
  const table = isTable(value) ? value : {};
  const { lines = [], ring, call_words_per_minute: words } = table;
  if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) throw refused("phone.lines", lines, "it is not a list of names");
  const stranger = (lines as string[]).find((line) => !names.includes(line));
  if (stranger !== undefined) throw refused("phone.lines", lines, `"${stranger}" is no agent or participant`);
  if (typeof ring !== "string") throw refused("phone.ring", ring, "it is not a text");
  const unknown = [...ring.matchAll(/\{(\w+)\}/g)].find(([, name]) => !RING_PLACEHOLDERS.includes(name));
  if (unknown !== undefined) throw refused("phone.ring", ring, `it names ${unknown[0]}, which is none of {${RING_PLACEHOLDERS.join("}, {")}}`);
  if (words !== undefined && (typeof words !== "number" || !(words >= 0))) throw refused("phone.call_words_per_minute", words, "it is not a number of words of at least 0");
  return {
    lines: lines as string[],
    ringMinutes: positiveMinutes(table, "ring_minutes"),
    callMinutes: positiveMinutes(table, "call_minutes"),
    // No time per word at 0, as when it is not given.
    ...(typeof words === "number" && words > 0 ? { callWordsPerMinute: words } : {}),
    ring,
  };
}
