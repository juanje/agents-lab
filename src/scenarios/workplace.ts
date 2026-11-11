import { type TomlTable, type TomlValue, parse } from "smol-toml";
import { type Passage, type Places, layout, put } from "../engine/places.ts";
import type { Configuration, Scenario } from "../engine/scenario.ts";
import { Random } from "../engine/random.ts";
import { describeUniformRhythm, rhythmChannels, uniformRhythm } from "./rhythm.ts";

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

/** The configuration's texts the worker's system prompt joins, in order. */
const PROMPT_TEXTS = ["identity", "world_rules", "norms", "rules"] as const;

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

/** A situation as its text declares it: the places it can be in, and the things it brings. */
interface SituationText {
  places: string[];
  things?: ThingText[];
}

/** The TOML text the configuration gives under a key, as a table; a text that is not valid TOML is refused, naming the key. */
function textOf(configuration: Configuration, key: string): TomlTable {
  try {
    return parse(configuration[key] as string);
  } catch (error) {
    throw new Error(`the configuration's "${key}" is not valid TOML: ${(error as Error).message}`);
  }
}

/** Refuses a place the world does not declare, saying what names it (`naming`). */
function assertPlace(places: readonly string[], place: string, naming: string): void {
  if (!places.includes(place)) throw new Error(`${naming} the place "${place}", which the world does not declare`);
}

/** Refuses a thing inside a thing that is not among these, saying which. */
function assertContainerDeclared({ id, in: container }: ThingText, ids: ReadonlySet<string>): void {
  if (container !== undefined && !ids.has(container)) {
    throw new Error(`the thing "${id}" is inside the thing "${container}", which nothing declares`);
  }
}

/**
 * Every declared situation, chosen or not, checked against the world: each place it can be in is the world's, and each
 * of its things inside another is inside one of its own things or of the world's.
 */
function declaredSituations(configuration: Configuration, world: WorldText, places: readonly string[]): Record<string, SituationText> {
  const declared = (textOf(configuration, "situations").situations ?? {}) as unknown as Record<string, SituationText>;
  const worldIds = (world.things ?? []).map(({ id }) => id);
  for (const [id, situation] of Object.entries(declared)) {
    for (const place of situation.places) assertPlace(places, place, `the situation "${id}" can be in`);
    const ids = new Set([...worldIds, ...(situation.things ?? []).map((thing) => thing.id)]);
    for (const thing of situation.things ?? []) assertContainerDeclared(thing, ids);
  }
  return declared;
}

/**
 * The workplace's initial state, from the texts in the configuration. Each chosen situation is placed by its own
 * sequence, derived from the initial state's first draw and the situation's id, so its place depends only on the seed
 * and its id, whichever other situations are chosen. Anything a text names that it does not declare is refused before
 * the world exists, naming it.
 */
function initialState(configuration: Configuration, random: Random): Workplace {
  const situationsSeed = Math.floor(random.next() * 2 ** 32);
  const world = textOf(configuration, "world") as unknown as WorldText;
  const keys = textOf(configuration, "situation_keys");
  const places = world.places.map(({ name }) => name);
  const declared = declaredSituations(configuration, world, places);
  let space = layout(places, world.passages ?? []);
  space = put(space, WORKER, world.worker.place);
  const situations: Record<string, { place: string; keys: TomlTable }> = {};
  const held: ThingText[] = [...(world.things ?? [])];
  for (const id of configuration.chosen_situations as string[]) {
    if (!Object.hasOwn(declared, id)) throw new Error(`the chosen situation "${id}" is not declared`);
    const situation = declared[id];
    const draw = Random.derive(situationsSeed, `situation ${id}`).next();
    const place = situation.places[Math.floor(draw * situation.places.length)];
    situations[id] = { place, keys: (keys[id] ?? {}) as TomlTable };
    held.push(...(situation.things ?? []).map((thing) => (thing.in === undefined ? { ...thing, place } : thing)));
  }
  const things: Record<string, Thing> = {};
  for (const { id, name, text, properties, container, portable } of held) {
    if (Object.hasOwn(things, id)) throw new Error(`two things have the id "${id}"`);
    things[id] = { name, properties: properties ?? {}, ...(text === undefined ? {} : { text }), container: container ?? false, portable: portable ?? true };
  }
  const inside: Record<string, string> = {};
  for (const thing of held) {
    assertContainerDeclared(thing, new Set(Object.keys(things)));
    if (thing.in !== undefined) {
      if (!things[thing.in].container) throw new Error(`the thing "${thing.id}" is inside "${thing.in}", which is not a container`);
      inside[thing.id] = thing.in;
    } else {
      assertPlace(places, thing.place as string, `the thing "${thing.id}" is in`);
      space = put(space, thing.id, thing.place as string);
    }
  }
  const people: Record<string, Person> = {};
  for (const { id, name, description, place } of world.people ?? []) {
    people[id] = { name, description };
    space = put(space, id, place);
  }
  return { space, things, inside, people, situations };
}

/** The workplace scenario: one worker in a world of places, things and people that its configuration gives as texts in TOML. */
export const workplaceScenario: Partial<Scenario<Workplace>> = {
  name: "workplace",
  agents: () => [WORKER],
  initialState,
  // Its tools come with FR-WORKPLACE-02 and its metrics with FR-WORKPLACE-04.
  tools: [],
  metrics: {},
  channels: rhythmChannels,
  // The configured texts, in this order, each that holds something; nothing else, so the reserved keys never reach it.
  systemPrompt: (configuration) =>
    PROMPT_TEXTS.map((key) => configuration[key] as string)
      .filter((text) => text !== "")
      .join("\n\n"),
  rhythm: uniformRhythm,
  describeDuration: (_configuration, tool) => {
    throw new Error(`The workplace has no tool "${tool}"`);
  },
  describeRhythm: describeUniformRhythm,
  situations: (configuration) => configuration.chosen_situations as string[],
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
