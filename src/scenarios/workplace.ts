import type { TomlTable, TomlValue } from "smol-toml";
import type { Places } from "../engine/places.ts";
import type { Scenario } from "../engine/scenario.ts";

/** A thing in the workplace, as anyone in its place sees it. */
export interface Thing {
  name: string;
  properties: Readonly<Record<string, TomlValue>>;
  /** What is written on it, if anything. */
  text?: string;
  container: boolean;
  portable: boolean;
}

/** A person in the workplace: an entity of its space, not an agent. */
export interface Person {
  name: string;
  description: string;
}

/**
 * The workplace's state: its space, where the worker, the people and the things in a place are; each thing and each
 * person by its id; the container each thing inside one is in; and each chosen situation with the place the seed put it
 * in and its reserved keys, which no tool or prompt gives the worker.
 */
export interface Workplace {
  space: Places;
  things: Readonly<Record<string, Thing>>;
  inside: Readonly<Record<string, string>>;
  people: Readonly<Record<string, Person>>;
  situations: Readonly<Record<string, { place: string; keys: TomlTable }>>;
}

/** The workplace scenario: one worker in a world of places, things and people that its configuration gives as texts in TOML. */
export const workplaceScenario: Partial<Scenario<Workplace>> = {
  name: "workplace",
  baseConfiguration: [
    'identity = "You work here."',
    'world_rules = ""',
    'norms = ""',
    'rules = ""',
    "world = '''",
    "[worker]",
    'place = "room"',
    "[[places]]",
    'name = "room"',
    "'''",
    'situations = ""',
    'situation_keys = ""',
    "chosen_situations = []",
    "[rhythm]",
    'source = "rhythm"',
    'text = "You wake up."',
    "min_ms = 0",
    "max_ms = 1000",
    "",
  ].join("\n"),
};
