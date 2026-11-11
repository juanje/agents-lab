import { type TomlTable, type TomlValue, parse } from "smol-toml";
import { type Passage, type Places, layout, put } from "../engine/places.ts";
import type { Configuration, Scenario } from "../engine/scenario.ts";

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

/** The worker, the workplace's one agent. */
const WORKER = "worker";

/** A thing as a world's text declares it: where it is, in a place or inside a container, and what it is. */
interface ThingText {
  id: string;
  name: string;
  place?: string;
  in?: string;
  text?: string;
  properties?: TomlTable;
  container?: boolean;
  portable?: boolean;
}

/** A world as its text declares it. */
interface WorldText {
  worker: { place: string };
  places: { name: string }[];
  passages?: Passage[];
  things?: ThingText[];
  people?: { id: string; name: string; description: string; place: string }[];
}

/** The workplace's initial state, from the world's text in the configuration. */
function initialState(configuration: Configuration): Workplace {
  const world = parse(configuration.world as string) as unknown as WorldText;
  let space = layout(
    world.places.map(({ name }) => name),
    world.passages ?? [],
  );
  space = put(space, WORKER, world.worker.place);
  const things: Record<string, Thing> = {};
  const inside: Record<string, string> = {};
  for (const { id, name, place, in: container, text, properties, container: isContainer, portable } of world.things ?? []) {
    things[id] = { name, properties: properties ?? {}, ...(text === undefined ? {} : { text }), container: isContainer ?? false, portable: portable ?? true };
    if (container !== undefined) inside[id] = container;
    else space = put(space, id, place as string);
  }
  const people: Record<string, Person> = {};
  for (const { id, name, description, place } of world.people ?? []) {
    people[id] = { name, description };
    space = put(space, id, place);
  }
  return { space, things, inside, people, situations: {} };
}

/** The workplace scenario: one worker in a world of places, things and people that its configuration gives as texts in TOML. */
export const workplaceScenario: Partial<Scenario<Workplace>> = {
  name: "workplace",
  initialState,
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
