import { type TomlTable, type TomlValue, parse } from "smol-toml";
import { type Passage, type Places, arrive, entitiesIn, entitiesInPassage, exits, layout, leave, put, where } from "../engine/places.ts";
import type { Configuration, Scenario } from "../engine/scenario.ts";
import { Random } from "../engine/random.ts";
import type { AgentCall, Effector, LastBy, Sensor, TargetAsSensed, Tool } from "../engine/tools.ts";
import type { Check } from "../engine/world.ts";
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

/** How long each of the worker's tools takes, as the configuration's `[durations]` gives it, in milliseconds. */
export interface Durations {
  look_ms: number;
  examine_ms: number;
  take_ms: number;
  put_ms: number;
  give_ms: number;
  ms_per_word: number;
  ms_per_length: number;
}

/**
 * What the configuration sets that the worker's tools read: the thing that is the book, the carry limit, the durations,
 * and the person who gave the task, to whom the notes go.
 */
export interface Settings {
  book: string;
  carryLimit: number;
  durations: Readonly<Durations>;
  taskGiver: string;
}

/** Something written in the world, with the moment it was written, by `performance.now()`. */
export interface Written {
  atMs: number;
}

/**
 * The workplace's state: its space, where the worker, the people and the things in a place are; each thing and each
 * person by its id; the container each thing inside one is in; who holds each thing someone holds; and each chosen
 * situation with the place the seed put it in and its reserved keys, which no tool or prompt gives the worker. It keeps
 * the book's entries and the notes to the person who gave the task, and the settings its tools read.
 */
export interface Workplace {
  space: Places;
  things: Readonly<Record<string, Thing>>;
  inside: Readonly<Record<string, string>>;
  held: Readonly<Record<string, string>>;
  people: Readonly<Record<string, Person>>;
  situations: Readonly<Record<string, { place: string; keys: TomlTable }>>;
  book: readonly (Written & { entry: string })[];
  notes: readonly (Written & { text: string; to: string })[];
  settings: Settings;
}

/** The worker, the workplace's one agent. */
const WORKER = "worker";

/** The channel of the person who gives the task: its source is that person, and it delivers their first message. */
const PERSON_CHANNEL = "person";

/** The configuration's texts the worker meets, in the order each place joins them. */
const TEXTS = ["identity", "world_rules", "norms", "rules", "task"] as const;

/** Where a text goes: the system prompt, or the first message of the person who gives the task. */
type Place = "system" | "person";

/** The places a text can go to. */
const PLACES: readonly Place[] = ["system", "person"];

/** The configuration's placement; one that names a text the workplace does not have, or no place, is refused, naming it. */
function placementOf(configuration: Configuration): Readonly<Record<string, Place>> {
  const placement = configuration.placement as Record<string, string>;
  for (const [text, place] of Object.entries(placement)) {
    if (!(TEXTS as readonly string[]).includes(text)) {
      throw new Error(`the configuration's "placement.${text}" names no text of the workplace; its texts are ${TEXTS.slice(0, -1).join(", ")} and ${TEXTS.at(-1)}`);
    }
    if (!(PLACES as readonly string[]).includes(place)) {
      throw new Error(`the configuration's "placement.${text}" is "${place}", which is no place; a text goes to "system" or "person"`);
    }
  }
  return placement as Record<string, Place>;
}

/** The configuration's texts placed in a place, in order, each that holds something, joined with a blank line between them. */
function textsIn(configuration: Configuration, place: Place): string {
  const placement = placementOf(configuration);
  return TEXTS.filter((key) => placement[key] === place)
    .map((key) => configuration[key] as string)
    .filter((text) => text !== "")
    .join("\n\n");
}

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
 * Every declared situation, chosen or not, checked against the world: each place it can be in is the world's, none of
 * its things gives its own place, and each of its things inside another is inside one of its own things or of the
 * world's.
 */
function declaredSituations(configuration: Configuration, world: WorldText, places: readonly string[]): Record<string, SituationText> {
  const declared = (textOf(configuration, "situations").situations ?? {}) as unknown as Record<string, SituationText>;
  const worldIds = (world.things ?? []).map(({ id }) => id);
  for (const [id, situation] of Object.entries(declared)) {
    for (const place of situation.places) assertPlace(places, place, `the situation "${id}" can be in`);
    const ids = new Set([...worldIds, ...(situation.things ?? []).map((thing) => thing.id)]);
    for (const thing of situation.things ?? []) {
      if (thing.place !== undefined) {
        throw new Error(`the thing "${thing.id}" of the situation "${id}" gives its own place "${thing.place}"; a situation's thing is in the situation's place`);
      }
      assertContainerDeclared(thing, ids);
    }
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
  for (const id of Object.keys(keys)) {
    if (!Object.hasOwn(declared, id)) throw new Error(`the configuration's "situation_keys" gives keys for the situation "${id}", which is not declared`);
  }
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
  const book = configuration.book as string;
  if (!Object.hasOwn(things, book)) throw new Error(`the configuration's "book" names "${book}", which is no thing of the world`);
  const settings = {
    book,
    carryLimit: configuration.carry_limit as number,
    durations: configuration.durations as unknown as Durations,
    taskGiver: configuration.task_giver as string,
  };
  return { space, things, inside, held: {}, people, situations, book: [], notes: [], settings };
}

/** The place the worker is in; the worker is in a passage only while a "go" is under way, when it calls nothing else. */
function hereOf({ space }: Workplace, agent: string): string {
  const at = where(space, agent);
  if (at === undefined || !("place" in at)) throw new Error(`the workplace holds "${agent}" in no place: ${JSON.stringify(at)}`);
  return at.place;
}

/** The thing a thing is ultimately inside, or the thing itself when it is inside none. */
function outermost({ inside }: Workplace, thing: string): string {
  return Object.hasOwn(inside, thing) ? outermost({ inside } as Workplace, inside[thing]) : thing;
}

/** Whether the space holds an entity in the place the worker is in. */
function besideWorker(state: Workplace, agent: string, entity: string): boolean {
  const at = where(state.space, entity);
  return at !== undefined && "place" in at && at.place === hereOf(state, agent);
}

/** Whether a thing is in the worker's place, or inside a container there. */
function isHere(state: Workplace, agent: string, thing: string): boolean {
  return Object.hasOwn(state.things, thing) && besideWorker(state, agent, outermost(state, thing));
}

/** Whether a thing is in the worker's hands, or inside a container it holds. */
function isHeld(state: Workplace, agent: string, thing: string): boolean {
  return Object.hasOwn(state.things, thing) && state.held[outermost(state, thing)] === agent;
}

/** Whether the worker can reach a thing: here, or in its hands. */
function isReachable(state: Workplace, agent: string, thing: string): boolean {
  return isHere(state, agent, thing) || isHeld(state, agent, thing);
}

/** The things someone holds, in the order they took them. */
function heldBy({ held }: Workplace, holder: string): string[] {
  return Object.entries(held)
    .filter(([, by]) => by === holder)
    .map(([thing]) => thing);
}

/** The number of words in a text. */
function words(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

/** A thing as look shows it: its id and name, and for a container, the things inside it. */
interface Shown {
  id: string;
  name: string;
  inside?: Shown[];
}

/** What look gives, as JSON. */
interface Seen {
  place: string;
  exits: { place: string; length: number }[];
  things: Shown[];
  people: { id: string; name: string }[];
  holding: Shown[];
  passages: { to: string; people: { id: string; name: string }[] }[];
}

/** A thing as look shows it. */
function shown(state: Workplace, thing: string): Shown {
  const { name, container } = state.things[thing];
  if (!container) return { id: thing, name };
  const inside = Object.keys(state.inside).filter((held) => state.inside[held] === thing);
  return { id: thing, name, inside: inside.map((held) => shown(state, held)) };
}

/** The people among these entities, as look shows them. */
function peopleAmong(state: Workplace, entities: readonly string[]): { id: string; name: string }[] {
  return entities.filter((entity) => Object.hasOwn(state.people, entity)).map((id) => ({ id, name: state.people[id].name }));
}

/** The text a sensor gives for a thing the worker cannot reach. */
const NOT_THERE = "It is not here.";

/** The thing a call's arguments name. */
const thingOf = (args: Readonly<Record<string, unknown>>): string => args.thing as string;

const THING_PARAMETERS = {
  type: "object",
  properties: { thing: { type: "string", description: "The thing's id, as look gives it." } },
  required: ["thing"],
};

/** "look": the worker's place as it sees it. */
const look: Sensor<Workplace> = {
  kind: "sensor",
  name: "look",
  description:
    "See where you are, as JSON: your place; its exits, each with its passage's length; the things in it, each with its id and name, and the things inside each container; the people in it; the things you hold; and who is in each passage that leaves it.",
  parameters: { type: "object", properties: {} },
  durationMs: (state) => state.settings.durations.look_ms,
  sense: (state, agent) => {
    const place = hereOf(state, agent);
    const here = entitiesIn(state.space, place);
    const seen: Seen = {
      place,
      exits: exits(state.space, place),
      things: here.filter((entity) => Object.hasOwn(state.things, entity)).map((thing) => shown(state, thing)),
      people: peopleAmong(state, here),
      holding: heldBy(state, agent).map((thing) => shown(state, thing)),
      passages: exits(state.space, place)
        .map(({ place: to }) => ({ to, people: peopleAmong(state, entitiesInPassage(state.space, place, to)) }))
        .filter(({ people }) => people.length > 0),
    };
    return JSON.stringify(seen);
  },
};

/** The text on a thing the worker can reach, or none. */
function textOn(state: Workplace, agent: string, thing: string): string | undefined {
  return isReachable(state, agent, thing) ? state.things[thing].text : undefined;
}

/** "read thing": the text on a thing in the worker's place, in a container there or in its hands. */
const read: Sensor<Workplace> = {
  kind: "sensor",
  name: "read",
  description: "Read what is written on a thing here or in your hands. The longer the text, the longer it takes.",
  parameters: THING_PARAMETERS,
  durationMs: (state, call) => {
    const { look_ms: lookMs, ms_per_word: msPerWord } = state.settings.durations;
    return Math.max(lookMs, msPerWord * words(textOn(state, call.agent, thingOf(call.arguments)) ?? ""));
  },
  sense: (state, agent, args) => {
    if (!isReachable(state, agent, thingOf(args))) return NOT_THERE;
    return textOn(state, agent, thingOf(args)) ?? "Nothing is written on it.";
  },
};

/** "examine thing": a thing's name and visible properties, as JSON. */
const examine: Sensor<Workplace> = {
  kind: "sensor",
  name: "examine",
  description: "Examine a thing here or in your hands: its name and visible properties, as JSON.",
  parameters: THING_PARAMETERS,
  durationMs: (state) => state.settings.durations.examine_ms,
  sense: (state, agent, args) => {
    const thing = thingOf(args);
    if (!isReachable(state, agent, thing)) return NOT_THERE;
    const { name, properties } = state.things[thing];
    return JSON.stringify({ name, properties });
  },
};

/**
 * The worker's last look, when it was taken where the worker is now, whatever it read or examined after it; otherwise
 * it shows nothing of a target.
 */
function lastLook(lastBy: LastBy, state: Workplace, agent: string): Seen | undefined {
  const sensing = lastBy(look.name);
  if (sensing === undefined) return undefined;
  const seen = JSON.parse(sensing.result) as Seen;
  return seen.place === hereOf(state, agent) ? seen : undefined;
}

/** Every thing a look shows, wherever: in the place, inside a container there, or in the worker's hands. */
function shownIds(seen: Seen): string[] {
  const ids = (things: readonly Shown[]): string[] => things.flatMap((thing) => [thing.id, ...ids(thing.inside ?? [])]);
  return ids([...seen.things, ...seen.holding]);
}

/** "free" when the worker's last look, taken where it is now, shows this thing; "not_sensed" otherwise. */
function thingAsSensed(lastBy: LastBy, state: Workplace, agent: string, thing: string | undefined): TargetAsSensed {
  const seen = lastLook(lastBy, state, agent);
  return seen !== undefined && thing !== undefined && shownIds(seen).includes(thing) ? "free" : "not_sensed";
}

/** A place that is not one passage away from the worker's (FR-SPACE-01's name for a target it cannot reach). */
export const INVALID_TARGET = "invalid_target";

/** The worker's own place. */
export const ALREADY_THERE = "already_there";

/** The passage's length from the worker's place to the place a call names, or none when no passage joins them. */
function lengthTo(state: Workplace, call: AgentCall): number | undefined {
  return exits(state.space, hereOf(state, call.agent)).find(({ place }) => place === call.arguments.place)?.length;
}

/** A call of "go" as the space's leave reads it. */
const leaving = ({ agent, arguments: args }: AgentCall) => ({ entity: agent, towards: args.place as string });

/**
 * "go place": the worker leaves when the call starts and arrives when it ends, taking the time per unit of the
 * passage's length (FR-SPACE-03). A place that is not one passage away, or its own, starts nothing and takes no time.
 */
const go: Effector<Workplace> = {
  kind: "effector",
  name: "go",
  description: "Go to a place one passage away, as look gives its exits. The longer the passage, the longer it takes.",
  parameters: { type: "object", properties: { place: { type: "string" } }, required: ["place"] },
  durationMs: (state, call) => state.settings.durations.ms_per_length * (lengthTo(state, call) ?? 0),
  start: {
    appliesTo: (state, call) => lengthTo(state, call) !== undefined,
    precondition: (state, call) => leave.precondition(state.space, leaving(call)),
    effect: (state, call) => ({ ...state, space: leave.effect(state.space, leaving(call)) }),
    describe: (state, call) => ({ left: hereOf(state, call.agent), towards: leaving(call).towards }),
  },
  action: {
    // A call that started is in the passage; one that did not names a place the worker cannot go to.
    precondition: (state, call) => {
      const at = where(state.space, call.agent);
      if (at !== undefined && "place" in at) return { holds: false, reason: at.place === call.arguments.place ? ALREADY_THERE : INVALID_TARGET };
      return arrive.precondition(state.space, { entity: call.agent });
    },
    effect: (state, call) => ({ ...state, space: arrive.effect(state.space, { entity: call.agent }) }),
  },
  texts: {
    success: "You have arrived.",
    [INVALID_TARGET]: "There is no passage from here to that place; you have not moved.",
    [ALREADY_THERE]: "You are already there; you have not moved.",
  },
  // Its target is the place, among the exits of the worker's last look.
  readTarget: (_sensing, call, state, lastBy) => {
    const seen = lastLook(lastBy, state, call.agent);
    if (seen === undefined) return "not_sensed";
    return seen.exits.some(({ place }) => place === call.arguments.place) ? "free" : "outside";
  },
};

/** Why a take, put, give or record fails. */
const NOT_HERE = "not_here";
const NOT_HELD = "not_held";
const NOT_PORTABLE = "not_portable";
const HANDS_FULL = "hands_full";
const ALREADY_HELD = "already_held";
const NOT_A_CONTAINER = "not_a_container";

/** The first of these checks that fails, in order, or none; a check runs only when those before it passed. */
function firstFailing(checks: readonly (readonly [() => boolean, string])[]): Check {
  const failing = checks.find(([fails]) => fails());
  return failing === undefined ? { holds: true } : { holds: false, reason: failing[1] };
}

/** The state with a thing in someone's hands, out of whatever place or container it was in. */
function intoHands(state: Workplace, thing: string, holder: string): Workplace {
  const { [thing]: _place, ...whereabouts } = state.space.whereabouts;
  const { [thing]: _container, ...inside } = state.inside;
  return { ...state, space: { ...state.space, whereabouts }, inside, held: { ...state.held, [thing]: holder } };
}

/** The state with a thing out of anyone's hands. */
function outOfHands(state: Workplace, thing: string): Workplace {
  const { [thing]: _holder, ...held } = state.held;
  return { ...state, held };
}

/** Effector durations that do not depend on the call. */
const fixed = (key: "take_ms" | "put_ms" | "give_ms") => (state: Workplace) => state.settings.durations[key];

/** "take thing": a thing in the worker's place, or in a container there, into its hands. */
const take: Effector<Workplace> = {
  kind: "effector",
  name: "take",
  description: "Take a thing here, or inside a container here, into your hands.",
  parameters: THING_PARAMETERS,
  durationMs: fixed("take_ms"),
  action: {
    precondition: (state, call) => {
      const thing = thingOf(call.arguments);
      return firstFailing([
        [() => state.held[thing] === call.agent, ALREADY_HELD],
        [() => !isHere(state, call.agent, thing), NOT_HERE],
        [() => !state.things[thing].portable, NOT_PORTABLE],
        [() => heldBy(state, call.agent).length >= state.settings.carryLimit, HANDS_FULL],
      ]);
    },
    effect: (state, call) => intoHands(state, thingOf(call.arguments), call.agent),
  },
  texts: {
    success: "You are holding it.",
    [NOT_HERE]: "It is not here; you have taken nothing.",
    [NOT_PORTABLE]: "It cannot be carried; you have taken nothing.",
    [HANDS_FULL]: "Your hands are full; you have taken nothing.",
    [ALREADY_HELD]: "You are already holding it.",
  },
  readTarget: (_sensing, call, state, lastBy) => thingAsSensed(lastBy, state, call.agent, thingOf(call.arguments)),
};

/** The container a call of "put" names, if any. */
const intoOf = (call: AgentCall): string | undefined => call.arguments.into as string | undefined;

/** "put thing [into]": a thing the worker holds into its place, or into a container there. */
const putDown: Effector<Workplace> = {
  kind: "effector",
  name: "put",
  description: "Put a thing you hold here, or into a container here.",
  parameters: {
    type: "object",
    properties: { thing: THING_PARAMETERS.properties.thing, into: { type: "string", description: "A container's id, as look gives it." } },
    required: ["thing"],
  },
  durationMs: fixed("put_ms"),
  action: {
    precondition: (state, call) => {
      const into = intoOf(call);
      return firstFailing([
        [() => state.held[thingOf(call.arguments)] !== call.agent, NOT_HELD],
        [() => into !== undefined && !isHere(state, call.agent, into), NOT_HERE],
        [() => into !== undefined && !state.things[into].container, NOT_A_CONTAINER],
      ]);
    },
    effect: (state, call) => {
      const thing = thingOf(call.arguments);
      const into = intoOf(call);
      const released = outOfHands(state, thing);
      if (into !== undefined) return { ...released, inside: { ...released.inside, [thing]: into } };
      return { ...released, space: put(released.space, thing, hereOf(state, call.agent)) };
    },
  },
  texts: {
    success: "You have put it there.",
    [NOT_HELD]: "You are not holding it; nothing has moved.",
    [NOT_HERE]: "That container is not here; you are still holding it.",
    [NOT_A_CONTAINER]: "Nothing can be put inside that; you are still holding it.",
  },
  readTarget: (_sensing, call, state, lastBy) => thingAsSensed(lastBy, state, call.agent, intoOf(call)),
};

/** "give thing person": a thing the worker holds to a person in its place, who then holds it. */
const give: Effector<Workplace> = {
  kind: "effector",
  name: "give",
  description: "Give a thing you hold to a person here.",
  parameters: {
    type: "object",
    properties: { thing: THING_PARAMETERS.properties.thing, person: { type: "string", description: "The person's id, as look gives it." } },
    required: ["thing", "person"],
  },
  durationMs: fixed("give_ms"),
  action: {
    precondition: (state, call) => {
      const person = call.arguments.person as string;
      return firstFailing([
        [() => state.held[thingOf(call.arguments)] !== call.agent, NOT_HELD],
        [() => !(Object.hasOwn(state.people, person) && besideWorker(state, call.agent, person)), NOT_HERE],
      ]);
    },
    effect: (state, call) => ({ ...state, held: { ...state.held, [thingOf(call.arguments)]: call.arguments.person as string } }),
  },
  texts: {
    success: "You have given it.",
    [NOT_HELD]: "You are not holding it; you have given nothing.",
    [NOT_HERE]: "That person is not here; you are still holding it.",
  },
  readTarget: (_sensing, call, state, lastBy) => {
    const seen = lastLook(lastBy, state, call.agent);
    return seen?.people.some(({ id }) => id === call.arguments.person) ? "free" : "not_sensed";
  },
};

/** "record entry": an entry in the workplace's book, with the moment it was written, where the book is. */
const record: Effector<Workplace> = {
  kind: "effector",
  name: "record",
  description: "Write an entry in the book. You must be where the book is. The longer the entry, the longer it takes.",
  parameters: { type: "object", properties: { entry: { type: "string" } }, required: ["entry"] },
  durationMs: (state, call) => state.settings.durations.ms_per_word * words(call.arguments.entry as string),
  action: {
    precondition: (state, call) => firstFailing([[() => !isReachable(state, call.agent, state.settings.book), NOT_HERE]]),
    effect: (state, call) => ({ ...state, book: [...state.book, { entry: call.arguments.entry as string, atMs: call.atMs }] }),
  },
  texts: { success: "It is in the book.", [NOT_HERE]: "The book is not here; nothing has been recorded." },
  // It has no target.
  readTarget: () => "not_sensed",
};

/** "note text": a note to the person who gave the task, kept in the world with the moment it was sent; it reaches no agent. */
const note: Effector<Workplace> = {
  kind: "effector",
  name: "note",
  description: "Send a note to the person who gave you the task. The longer the note, the longer it takes.",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  durationMs: (state, call) => state.settings.durations.ms_per_word * words(call.arguments.text as string),
  action: {
    precondition: () => ({ holds: true }),
    effect: (state, call) => ({
      ...state,
      notes: [...state.notes, { text: call.arguments.text as string, to: state.settings.taskGiver, atMs: call.atMs }],
    }),
  },
  texts: { success: "Your note has been sent." },
  // It has no target.
  readTarget: () => "not_sensed",
};

/** The worker's tools, in the order the SPEC gives them. */
const TOOLS: readonly Tool<Workplace>[] = [look, read, examine, go, take, putDown, give, record, note];

/** Each tool's duration as the inventory describes it, from the configuration's durations. */
function describeDuration(configuration: Configuration, tool: string): string {
  const durations = configuration.durations as unknown as Durations;
  const described: Record<string, string> = {
    look: `${durations.look_ms} ms.`,
    read: `${durations.ms_per_word} ms for each word of the text, at least ${durations.look_ms} ms.`,
    examine: `${durations.examine_ms} ms.`,
    go: `${durations.ms_per_length} ms for each unit of the passage's length; no time when there is no passage to that place.`,
    take: `${durations.take_ms} ms.`,
    put: `${durations.put_ms} ms.`,
    give: `${durations.give_ms} ms.`,
    record: `${durations.ms_per_word} ms for each word of the entry.`,
    note: `${durations.ms_per_word} ms for each word of the note.`,
  };
  if (!Object.hasOwn(described, tool)) throw new Error(`The workplace has no tool "${tool}"`);
  return described[tool];
}

/** The workplace scenario: one worker in a world of places, things and people that its configuration gives as texts in TOML. */
export const workplaceScenario: Scenario<Workplace> = {
  name: "workplace",
  agents: () => [WORKER],
  initialState,
  tools: TOOLS,
  // Its metrics come with FR-WORKPLACE-04.
  metrics: {},
  channels: (configuration) => [
    ...rhythmChannels(configuration),
    { name: PERSON_CHANNEL, source: configuration.task_giver as string, stimulus: textsIn(configuration, "person") },
  ],
  // The person's first message, when a text is placed there.
  firstStimuli: (configuration) => (textsIn(configuration, "person") === "" ? [] : [PERSON_CHANNEL]),
  // The texts placed in it; nothing else, so the reserved keys never reach it.
  systemPrompt: (configuration) => textsIn(configuration, "system"),
  rhythm: uniformRhythm,
  describeDuration,
  describeRhythm: describeUniformRhythm,
  situations: (configuration) => configuration.chosen_situations as string[],
  baseConfiguration: [
    'identity = "You work here."',
    'world_rules = ""',
    'norms = ""',
    'rules = ""',
    'task = ""',
    'task_giver = "The person in charge"',
    "world = '''",
    "[worker]",
    'place = "room"',
    "[[places]]",
    'name = "room"',
    "[[things]]",
    'id = "book"',
    'name = "a book"',
    'place = "room"',
    "portable = false",
    "'''",
    'situations = ""',
    'situation_keys = ""',
    "chosen_situations = []",
    'book = "book"',
    "carry_limit = 1",
    "[durations]",
    "look_ms = 100",
    "examine_ms = 100",
    "take_ms = 100",
    "put_ms = 100",
    "give_ms = 100",
    "ms_per_word = 50",
    "ms_per_length = 100",
    "[rhythm]",
    'source = "rhythm"',
    'text = "You wake up."',
    "min_ms = 0",
    "max_ms = 1000",
    "[placement]",
    'identity = "system"',
    'world_rules = "system"',
    'norms = "system"',
    'rules = "system"',
    'task = "person"',
    "",
  ].join("\n"),
};
