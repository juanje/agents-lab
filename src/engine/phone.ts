import type { TomlValue } from "smol-toml";
import type { Calendar } from "./calendar.ts";

/** A configuration's [phone] (FR-PHONE-01), as the engine follows it. */
export interface PhoneSettings {
  /** The agents and participants that have a line, by name. */
  lines: readonly string[];
  ringMinutes: number;
  callMinutes: number;
  callWordsPerMinute?: number;
  /** The ring's text, with its placeholders. */
  ring: string;
}

/** Reads a configuration's [phone] (FR-PHONE-01). */
export function readPhone(_value: TomlValue, _calendar: Calendar | undefined, _names: readonly string[]): PhoneSettings {
  return { lines: [], ringMinutes: 0, callMinutes: 0, ring: "" };
}
