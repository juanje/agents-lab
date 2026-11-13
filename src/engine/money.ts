import type { TomlValue } from "smol-toml";
import type { Calendar } from "./calendar.ts";

/** A configuration's [money] (FR-MONEY-01), as the engine follows it. */
export interface MoneySettings {
  accounts: readonly ({ name: string; tools?: readonly string[] } & ({ opening: number } | { unlimited: true }))[];
  discretionaryLimit: number;
  durations: Readonly<Record<string, number>>;
}

/** Reads a configuration's [money] (FR-MONEY-01). */
export function readMoney(_value: TomlValue, _calendar: Calendar | undefined, _names: readonly string[], _durations: Readonly<Record<string, unknown>> = {}): MoneySettings {
  return { accounts: [], discretionaryLimit: 0, durations: {} };
}
