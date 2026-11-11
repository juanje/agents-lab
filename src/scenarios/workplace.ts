import { type TomlTable, type TomlValue, parse } from "smol-toml";
import { type Passage, type Places, layout, put } from "../engine/places.ts";
import type { Configuration, Scenario } from "../engine/scenario.ts";
import { Random } from "../engine/random.ts";
import { RHYTHM_CHANNEL } from "../engine/stimuli.ts";

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

/**
 * The workplace's initial state, from the texts in the configuration. Each chosen situation is placed by its own
 * sequence, derived from the initial state's first draw and the situation's id, so its place depends only on the seed
 * and its id, whichever other situations are chosen.
 */
function initialState(configuration: Configuration, random: Random): Workplace {
  const situationsSeed = Math.floor(random.next() * 2 ** 32);
  const world = parse(configuration.world as string) as unknown as WorldText;
  const declared = parse(configuration.situations as string) as unknown as { situations?: Record<string, SituationText> };
  const keys = parse(configuration.situation_keys as string);
  let space = layout(
    world.places.map(({ name }) => name),
    world.passages ?? [],
  );
  space = put(space, WORKER, world.worker.place);
  const situations: Record<string, { place: string; keys: TomlTable }> = {};
  const placed: (ThingText & { place?: string })[] = [...(world.things ?? [])];
  for (const id of configuration.chosen_situations as string[]) {
    const situation = (declared.situations ?? {})[id];
    const draw = Random.derive(situationsSeed, `situation ${id}`).next();
    const place = situation.places[Math.floor(draw * situation.places.length)];
    situations[id] = { place, keys: (keys[id] ?? {}) as TomlTable };
    placed.push(...(situation.things ?? []).map((thing) => (thing.in === undefined ? { ...thing, place } : thing)));
  }
  const things: Record<string, Thing> = {};
  const inside: Record<string, string> = {};
  for (const { id, name, place, in: container, text, properties, container: isContainer, portable } of placed) {
    things[id] = { name, properties: properties ?? {}, ...(text === undefined ? {} : { text }), container: isContainer ?? false, portable: portable ?? true };
    if (container !== undefined) inside[id] = container;
    else space = put(space, id, place as string);
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
  channels: (configuration) => {
    const { source, text } = configuration.rhythm as { source: string; text: string };
    return [{ name: RHYTHM_CHANNEL, source, stimulus: text }];
  },
  // The configured texts, in this order, each that holds something; nothing else, so the reserved keys never reach it.
  systemPrompt: (configuration) =>
    PROMPT_TEXTS.map((key) => configuration[key] as string)
      .filter((text) => text !== "")
      .join("\n\n"),
  rhythm: (configuration) => {
    const { min_ms: minMs, max_ms: maxMs } = configuration.rhythm as { min_ms: number; max_ms: number };
    return (random) => minMs + random.next() * (maxMs - minMs);
  },
  describeDuration: (_configuration, tool) => {
    throw new Error(`The workplace has no tool "${tool}"`);
  },
  describeRhythm: (configuration) => {
    const { min_ms: minMs, max_ms: maxMs } = configuration.rhythm as { min_ms: number; max_ms: number };
    return `An interval drawn uniformly between ${minMs} and ${maxMs} ms before each activation.`;
  },
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
