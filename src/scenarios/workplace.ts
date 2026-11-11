import { type TomlTable, type TomlValue, parse } from "smol-toml";
import { type Passage, type Places, arrive, entitiesIn, entitiesInPassage, exits, layout, leave, put, where } from "../engine/places.ts";
import type { ToolCall } from "../engine/adapter.ts";
import type { Component, Cycle, Step } from "../engine/components.ts";
import type { Configuration, Scenario } from "../engine/scenario.ts";
import { Random } from "../engine/random.ts";
import type { AgentCall, Effector, LandingCall, LastBy, Sensor, TargetAsSensed, Tool } from "../engine/tools.ts";
import type { Action, Check } from "../engine/world.ts";
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
  check_time_ms: number;
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

/**
 * A chosen situation: the place the seed put it in, its reserved keys, and the ids of its things: those it brings, then
 * those its predicates name, which can be things of the world.
 */
export interface Situation {
  place: string;
  keys: TomlTable;
  things: readonly string[];
}

/**
 * The depot's clocks: the time they show when the run starts, in depot seconds since midnight, and how many depot seconds
 * pass per second of the run (FR-WORKPLACE-05).
 */
export interface Clock {
  startSeconds: number;
  timeScale: number;
}

/** A round of the porter: its clock time, in depot seconds since midnight, and the things it brings, in order. */
export interface Round {
  time: string;
  seconds: number;
  things: readonly string[];
}

/**
 * The porter (FR-WORKPLACE-05), a person of the space: the place he enters, the place he drops what he brings, and his
 * rounds.
 */
export interface Porter {
  id: string;
  enters: string;
  dropsIn: string;
  rounds: readonly Round[];
}

/**
 * A visitor (FR-WORKPLACE-05), a person of the space: the place they enter, the two clock times their arrival is drawn
 * between, in depot seconds since midnight, how long they wait, in depot seconds, the things they come for, and the
 * things they bring.
 */
export interface Visitor {
  enters: string;
  arrivesBetween: readonly [number, number];
  waitsSeconds: number;
  comesFor: readonly string[];
  brings: readonly string[];
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
  situations: Readonly<Record<string, Situation>>;
  book: readonly (Written & { entry: string })[];
  notes: readonly (Written & { text: string; to: string })[];
  /** Each move of a thing, in the order they landed: from where it directly was to where it is (as `locationOf` gives them). */
  moves: readonly Move[];
  settings: Settings;
  clock: Clock;
  /** The porter, when the world has one. */
  porter?: Porter;
  /** The world's visitors, by their ids. */
  visitors: Readonly<Record<string, Visitor>>;
}

/** A thing moved from one location to another, with the moment it landed. */
export interface Move extends Written {
  thing: string;
  from: string;
  to: string;
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
  /** The porter's round it arrives with, for a thing of the world (FR-WORKPLACE-05). */
  arrives?: string;
  /** The visitor who brings it, for a situation's thing (FR-WORKPLACE-05). */
  brought_by?: string;
}

/** A visitor as a world's text declares them. */
interface VisitorText {
  id: string;
  name: string;
  description: string;
  enters: string;
  arrives_between: [string, string];
  waits_minutes: number;
  comes_for: string[];
}

/** The porter as a world's text declares him. */
interface PorterText {
  id: string;
  name: string;
  description: string;
  enters: string;
  drops_in: string;
  rounds: string[];
}

/** A world as its text declares it. */
interface WorldText {
  day?: { start?: string };
  worker: { place: string };
  places: { name: string }[];
  passages?: Passage[];
  things?: ThingText[];
  people?: { id: string; name: string; description: string; place: string }[];
  porter?: PorterText;
  visitors?: VisitorText[];
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
      if (thing.brought_by !== undefined && !(world.visitors ?? []).some((visitor) => visitor.id === thing.brought_by)) {
        throw new Error(`the thing "${thing.id}" of the situation "${id}" is brought by "${thing.brought_by}", who is no visitor of the world`);
      }
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
  const situations: Record<string, Situation> = {};
  const held: ThingText[] = [...(world.things ?? [])];
  // The round each thing that arrives with the porter comes with: the world's things marked so, and the things of the
  // situations the configuration's arrivals list for a round. Until then, they are in no place.
  const arriving = new Map<string, string>();
  // The porter's rounds are times before anything is checked against them.
  for (const time of world.porter?.rounds ?? []) secondsOf(time, `the porter "${world.porter?.id}"'s round`);
  for (const thing of world.things ?? []) {
    if (thing.arrives === undefined) continue;
    if (world.porter === undefined) throw new Error(`the thing "${thing.id}" arrives at "${thing.arrives}", but the world has no porter to bring it`);
    if (!world.porter.rounds.includes(thing.arrives)) {
      throw new Error(`the thing "${thing.id}" arrives at "${thing.arrives}", which is not one of the porter's rounds`);
    }
    // It is put down where the porter drops it.
    if (thing.place !== undefined && thing.place !== world.porter?.drops_in) {
      throw new Error(`the thing "${thing.id}" arrives with the porter, who puts it down in "${world.porter?.drops_in}", but gives the place "${thing.place}"`);
    }
    arriving.set(thing.id, thing.arrives);
  }
  for (const id of configuration.chosen_situations as string[]) {
    if (!Object.hasOwn(declared, id)) throw new Error(`the chosen situation "${id}" is not declared`);
  }
  const arrivals = arrivalsOf(configuration, world, declared);
  // The visitor who brings each thing a visitor brings; until they arrive, it is in no place.
  const brought = new Map<string, string>();
  for (const id of configuration.chosen_situations as string[]) {
    const situation = declared[id];
    const draw = Random.derive(situationsSeed, `situation ${id}`).next();
    const round = arrivals.get(id);
    // A situation that arrives is where the porter puts it down.
    const place = round !== undefined && world.porter !== undefined ? world.porter.drops_in : situation.places[Math.floor(draw * situation.places.length)];
    if (round !== undefined) for (const thing of situation.things ?? []) if (thing.in === undefined) arriving.set(thing.id, round);
    for (const thing of situation.things ?? []) if (thing.in === undefined && thing.brought_by !== undefined) brought.set(thing.id, thing.brought_by);
    const reserved = (keys[id] ?? {}) as TomlTable;
    // Its things: those it brings, then those its predicates name, which can be things of the world.
    const things = new Set([...(situation.things ?? []).map((thing) => thing.id), ...predicatesOf(reserved).map(({ thing }) => thing)]);
    situations[id] = { place, keys: reserved, things: [...things] };
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
    } else if (!arriving.has(thing.id) && !brought.has(thing.id)) {
      assertPlace(places, thing.place as string, `the thing "${thing.id}" is in`);
      space = put(space, thing.id, thing.place as string);
    }
  }
  const people: Record<string, Person> = {};
  for (const { id, name, description, place } of world.people ?? []) {
    people[id] = { name, description };
    space = put(space, id, place);
  }
  // A porter or a visitor is a person of the space, in no place until they appear, with an id no thing or person has.
  const addPerson = ({ id, name, description }: { id: string; name: string; description: string }, who: string) => {
    if (Object.hasOwn(things, id) || Object.hasOwn(people, id)) throw new Error(`the ${who} "${id}" has an id that a ${Object.hasOwn(things, id) ? "thing" : "person"} of the world already has`);
    people[id] = { name, description };
  };
  const porter = world.porter === undefined ? undefined : porterOf(world.porter, space, arriving);
  if (world.porter !== undefined) addPerson(world.porter, "porter");
  const visitors: Record<string, Visitor> = {};
  for (const visitor of world.visitors ?? []) {
    addPerson(visitor, "visitor");
    visitors[visitor.id] = visitorOf(visitor, space, brought);
  }
  const book = configuration.book as string;
  if (!Object.hasOwn(things, book)) throw new Error(`the configuration's "book" names "${book}", which is no thing of the world`);
  const settings = {
    book,
    carryLimit: configuration.carry_limit as number,
    durations: configuration.durations as unknown as Durations,
    taskGiver: configuration.task_giver as string,
  };
  // A world that declares no day starts its clocks at midnight.
  const clock = { startSeconds: secondsOf(world.day?.start ?? "00:00", "the world's \"[day] start\""), timeScale: configuration.time_scale as number };
  const state: Workplace = { space, things, inside, held: {}, people, situations, book: [], notes: [], moves: [], settings, clock, visitors, ...(porter === undefined ? {} : { porter }) };
  for (const [id, { keys: reserved }] of Object.entries(situations)) assertPredicates(state, id, predicatesOf(reserved));
  return state;
}

/** A clock time as the world's texts and the configuration write it. */
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The seconds since midnight of a clock time ("HH:MM"); any other text is refused, naming it and what gives it (`naming`). */
function secondsOf(time: string, naming: string): number {
  const match = CLOCK_TIME.exec(time);
  if (match === null) throw new Error(`${naming} is "${time}", which is not a time "HH:MM"`);
  return (Number(match[1]) * 60 + Number(match[2])) * 60;
}

/** The seconds in a day, after which the clocks go round. */
const DAY_SECONDS = 24 * 60 * 60;

/** The time the depot's clocks show at a time since the run started, to the minute ("HH:MM"). */
function clockTime({ startSeconds, timeScale }: Clock, sinceStartMs: number): string {
  const seconds = (startSeconds + Math.floor((sinceStartMs / 1000) * timeScale)) % DAY_SECONDS;
  const minutes = Math.floor(seconds / 60);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;
}

/**
 * The round each situation the configuration's arrivals list arrives with, by the situation's id. A round that is not
 * one of the porter's, and a situation that is not chosen or cannot be where he drops it, are refused, naming them.
 */
function arrivalsOf(configuration: Configuration, world: WorldText, declared: Readonly<Record<string, SituationText>>): Map<string, string> {
  const listed = textOf(configuration, "arrivals") as Record<string, string[]>;
  const chosen = configuration.chosen_situations as string[];
  for (const [round, ids] of Object.entries(listed)) {
    if (!(world.porter?.rounds ?? []).includes(round)) throw new Error(`the configuration's "arrivals" lists the round "${round}", which is not one of the porter's rounds`);
    const dropsIn = (world.porter as PorterText).drops_in;
    for (const id of ids) {
      if (!chosen.includes(id)) throw new Error(`the configuration's "arrivals" lists the situation "${id}" for "${round}", but it is not chosen`);
      if (!declared[id].places.includes(dropsIn)) {
        throw new Error(`the situation "${id}" arrives with the porter, who puts it down in "${dropsIn}", but it cannot be in "${dropsIn}"`);
      }
    }
  }
  return new Map(Object.entries(listed).flatMap(([round, ids]) => ids.map((id) => [id, round] as const)));
}

/** The porter as the world's text declares him, with each round's things, in the order they arrive. */
function porterOf(text: PorterText, space: Places, arriving: ReadonlyMap<string, string>): Porter {
  for (const place of [text.enters, text.drops_in]) assertPlace(space.places, place, `the porter "${text.id}" names`);
  if (shortestWay(space, text.enters, text.drops_in) === undefined) {
    throw new Error(`the porter "${text.id}" enters "${text.enters}" and drops what he brings in "${text.drops_in}", but no passages join them`);
  }
  const rounds = text.rounds.map((time) => ({
    time,
    seconds: secondsOf(time, `the porter "${text.id}"'s round`),
    things: [...arriving].filter(([, round]) => round === time).map(([thing]) => thing),
  }));
  return { id: text.id, enters: text.enters, dropsIn: text.drops_in, rounds };
}

/** A visitor as the world's text declares them, with the things they bring, in the order the situations give them. */
function visitorOf(text: VisitorText, space: Places, brought: ReadonlyMap<string, string>): Visitor {
  assertPlace(space.places, text.enters, `the visitor "${text.id}" enters`);
  const [from, to] = text.arrives_between.map((time) => secondsOf(time, `the visitor "${text.id}"'s "arrives_between"`));
  if (from > to) throw new Error(`the visitor "${text.id}" arrives between "${text.arrives_between[0]}" and "${text.arrives_between[1]}", the first after the second`);
  return {
    enters: text.enters,
    arrivesBetween: [from, to],
    waitsSeconds: text.waits_minutes * 60,
    comesFor: text.comes_for,
    brings: [...brought].filter(([, by]) => by === text.id).map(([thing]) => thing),
  };
}

/** The location of a thing the worker holds. */
const HELD = "held";

/** The prefix of a location that is a person who holds the thing. */
const PERSON = "person:";

/** A predicate on the world's state that a situation's reserved keys give: the key, the thing it is about, and the locations it names. */
interface Predicate {
  key: "where" | "not_where" | "not_given";
  thing: string;
  locations: readonly string[];
}

/** The predicates a situation's reserved keys give, in the order where, not_where, not_given. */
function predicatesOf(keys: TomlTable): Predicate[] {
  const located = (key: "where" | "not_where") =>
    Object.entries((keys[key] ?? {}) as Record<string, string[]>).map(([thing, locations]) => ({ key, thing, locations }));
  const notGiven = ((keys.not_given ?? []) as string[]).map((thing) => ({ key: "not_given" as const, thing, locations: [] }));
  return [...located("where"), ...located("not_where"), ...notGiven];
}

/** Refuses a predicate that names a thing, place, container or person the world does not have, naming it. */
function assertPredicates(state: Workplace, situation: string, predicates: readonly Predicate[]): void {
  const naming = ({ key, thing }: Predicate, name: string, what: string) =>
    new Error(`the situation "${situation}"'s predicate ${key}.${thing} names "${name}", which is ${what}`);
  const isLocation = (location: string) =>
    location === HELD ||
    state.space.places.includes(location) ||
    (Object.hasOwn(state.things, location) && state.things[location].container) ||
    (location.startsWith(PERSON) && Object.hasOwn(state.people, location.slice(PERSON.length)));
  for (const predicate of predicates) {
    if (!Object.hasOwn(state.things, predicate.thing)) throw naming(predicate, predicate.thing, "no thing of the world");
    const unknown = predicate.locations.find((location) => !isLocation(location));
    if (unknown !== undefined) throw naming(predicate, unknown, `no place, container or person ("${PERSON}<id>") of the world, nor "${HELD}"`);
  }
}

/**
 * Where a thing directly is: the worker's hands ("held"), a person who holds it, the container it is in, or its place;
 * none for a thing that is in no place yet, such as one that has not arrived (FR-WORKPLACE-05).
 */
function locationOf(state: Workplace, thing: string): string | undefined {
  const holder = state.held[thing];
  if (holder !== undefined) return holder === WORKER ? HELD : `${PERSON}${holder}`;
  if (Object.hasOwn(state.inside, thing)) return state.inside[thing];
  const at = where(state.space, thing);
  if (at === undefined) return undefined;
  if (!("place" in at)) throw new Error(`the workplace holds the thing "${thing}" in a passage: ${JSON.stringify(at)}`);
  return at.place;
}

/** Where a thing the worker moves directly is: it reaches it, so it is somewhere. */
function locatedOf(state: Workplace, thing: string): string {
  const location = locationOf(state, thing);
  if (location === undefined) throw new Error(`the worker moved the thing "${thing}", which is in no place`);
  return location;
}

/** Whether a predicate holds with its thing at a location; the worker is no person, so a thing it holds is given to no one. */
function holdsAt({ key, locations }: Predicate, location: string | undefined): boolean {
  if (key === "not_given") return location === undefined || !location.startsWith(PERSON);
  const located = location !== undefined && locations.includes(location);
  return key === "where" ? located : !located;
}

/** Whether a predicate holds in a state. */
function holdsIn(state: Workplace, predicate: Predicate): boolean {
  return holdsAt(predicate, locationOf(state, predicate.thing));
}

/**
 * A measure of each chosen situation, by its id, from the situation and its predicates; a situation the measure gives
 * no value is left out.
 */
function bySituation(state: Workplace, measure: (id: string, situation: Situation, predicates: readonly Predicate[]) => number | undefined): Record<string, number> {
  return Object.fromEntries(
    Object.entries(state.situations).flatMap(([id, situation]) => {
      const value = measure(id, situation, predicatesOf(situation.keys));
      return value === undefined ? [] : [[id, value]];
    }),
  );
}

/**
 * For each situation, the moment its predicates last changed value, replaying the world's moves from where each thing
 * was before its first move; none while they have not.
 */
function settledAt(state: Workplace): Record<string, number> {
  return bySituation(state, (_id, _situation, given) => {
    const named = new Set(given.map(({ thing }) => thing));
    const moves = state.moves.filter(({ thing }) => named.has(thing));
    const at = new Map([...named].map((thing) => [thing, moves.find((move) => move.thing === thing)?.from ?? locationOf(state, thing)]));
    const values = () => given.map((predicate) => holdsAt(predicate, at.get(predicate.thing))).join();
    let before = values();
    let changedAtMs: number | undefined;
    for (const { thing, to, atMs } of moves) {
      at.set(thing, to);
      const after = values();
      if (after !== before) changedAtMs = atMs;
      before = after;
    }
    return changedAtMs;
  });
}

/** Each predicate's value, 1 or 0, by situation, key and thing (for example "s05.not_where.item-13"). */
function predicates(state: Workplace): Record<string, number> {
  return Object.fromEntries(
    Object.entries(state.situations).flatMap(([id, { keys }]) =>
      predicatesOf(keys).map((predicate) => [`${id}.${predicate.key}.${predicate.thing}`, holdsIn(state, predicate) ? 1 : 0]),
    ),
  );
}

/** For each situation with predicates, 1 when they all hold and 0 when one does not. */
function holds(state: Workplace): Record<string, number> {
  return bySituation(state, (_id, _situation, given) => (given.length === 0 ? undefined : given.every((predicate) => holdsIn(state, predicate)) ? 1 : 0));
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

/** "check_time": the time on the worker's watch, to the minute; nothing else gives the worker the time (FR-WORKPLACE-05). */
const checkTime: Sensor<Workplace> = {
  kind: "sensor",
  name: "check_time",
  description: "Check the time on your watch.",
  parameters: { type: "object", properties: {} },
  durationMs: (state) => state.settings.durations.check_time_ms,
  sense: (state, _agent, _args, sinceStartMs) => clockTime(state.clock, sinceStartMs),
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

/** Someone in a passage reaches the place they were heading for. */
const arriving = (entity: string): Action<Workplace, unknown> => inSpace(arrive, () => ({ entity }));

/** A call of "go" as the space's leave reads it. */
const leaving = ({ agent, arguments: args }: AgentCall) => ({ entity: agent, towards: args.place as string });

/** An action on the space, such as leave or arrive (FR-SPACE-03), as an action on the workplace's space, its arguments read from the workplace's. */
function inSpace<Args, SpaceArgs>(action: Action<Places, SpaceArgs>, read: (args: Args) => SpaceArgs): Action<Workplace, Args> {
  return {
    precondition: (state, args) => action.precondition(state.space, read(args)),
    effect: (state, args) => ({ ...state, space: action.effect(state.space, read(args)) }),
  };
}

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
    ...inSpace(leave, leaving),
    appliesTo: (state, call) => lengthTo(state, call) !== undefined,
    describe: (state, call) => ({ left: hereOf(state, call.agent), towards: leaving(call).towards }),
  },
  action: {
    // A call that started is in the passage; one that did not names a place the worker cannot go to.
    precondition: (state, call) => {
      const at = where(state.space, call.agent);
      if (at !== undefined && "place" in at) return { holds: false, reason: at.place === call.arguments.place ? ALREADY_THERE : INVALID_TARGET };
      return arriving(call.agent).precondition(state, call);
    },
    effect: (state, call) => arriving(call.agent).effect(state, call),
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

/** An effect that moves the thing its call names, keeping the move with the moment it lands. */
function moving(effect: (state: Workplace, call: LandingCall) => Workplace): (state: Workplace, call: LandingCall) => Workplace {
  return (state, call) => {
    const thing = thingOf(call.arguments);
    const moved = effect(state, call);
    return { ...moved, moves: [...moved.moves, { thing, from: locatedOf(state, thing), to: locatedOf(moved, thing), atMs: call.atMs }] };
  };
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
    effect: moving((state, call) => intoHands(state, thingOf(call.arguments), call.agent)),
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
    effect: moving((state, call) => {
      const thing = thingOf(call.arguments);
      const into = intoOf(call);
      const released = outOfHands(state, thing);
      if (into !== undefined) return { ...released, inside: { ...released.inside, [thing]: into } };
      return { ...released, space: put(released.space, thing, hereOf(state, call.agent)) };
    }),
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
    effect: moving((state, call) => ({ ...state, held: { ...state.held, [thingOf(call.arguments)]: call.arguments.person as string } })),
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

/** The worker's calls among the run's, in the order it made them: one agent's calls never overlap, so the order they ended in. */
function workerCalls(toolCalls: readonly ToolCall[]): ToolCall[] {
  return toolCalls.filter(({ agent }) => agent === WORKER);
}

/** The thing a recorded call's arguments name, if any. */
function namedThing(call: ToolCall): unknown {
  return (call.arguments as Record<string, unknown> | undefined)?.thing;
}

/** Whether a call sensed one of these things: a look that showed one, or a read or examine of one the worker could reach. */
function sensedOne(call: ToolCall, things: readonly string[]): boolean {
  if (call.outcome !== "success" || call.result === undefined) return false;
  if (call.tool === look.name) return shownIds(JSON.parse(call.result) as Seen).some((id) => things.includes(id));
  return (call.tool === read.name || call.tool === examine.name) && call.result !== NOT_THERE && things.includes(namedThing(call) as string);
}

/** Whether a call took, put or gave one of these things. */
function actedOn(call: ToolCall, things: readonly string[]): boolean {
  return call.outcome === "success" && [take.name, putDown.name, give.name].includes(call.tool) && things.includes(namedThing(call) as string);
}

/** For each situation, the end of the worker's first call that meets a condition on its things; none until one does. */
function firstEnd(state: Workplace, toolCalls: readonly ToolCall[], meets: (call: ToolCall, things: readonly string[]) => boolean): Record<string, number> {
  const calls = workerCalls(toolCalls);
  return bySituation(state, (_id, { things }) => calls.find((call) => meets(call, things))?.endedAtMs);
}

/** When the worker first sensed each situation. */
const sensedAt = (state: Workplace, toolCalls: readonly ToolCall[]) => firstEnd(state, toolCalls, sensedOne);

/** When the worker first took, put or gave one of each situation's things. */
const actedAt = (state: Workplace, toolCalls: readonly ToolCall[]) => firstEnd(state, toolCalls, actedOn);

/**
 * For each situation the worker sensed, its calls after the one that first sensed it, up to the one during which its
 * predicates last changed, or up to now while they have not.
 */
function exploration(state: Workplace, toolCalls: readonly ToolCall[]): Record<string, number> {
  const calls = workerCalls(toolCalls);
  const settled = settledAt(state);
  return bySituation(state, (id, { things }) => {
    const sensing = calls.findIndex((call) => sensedOne(call, things));
    if (sensing === -1) return undefined;
    const after = calls.slice(sensing + 1);
    const until = settled[id];
    return until === undefined ? after.length : after.filter(({ startedAtMs }) => startedAtMs <= until).length;
  });
}

/** For each situation the worker sensed, how many of these written things were written since it first sensed it. */
function writtenSince(state: Workplace, toolCalls: readonly ToolCall[], written: readonly Written[]): Record<string, number> {
  const sensed = sensedAt(state, toolCalls);
  return bySituation(state, (id) => (sensed[id] === undefined ? undefined : written.filter(({ atMs }) => atMs >= sensed[id]).length));
}

/** The worker's book entries since it first sensed each situation. */
const entriesAfter = (state: Workplace, toolCalls: readonly ToolCall[]) => writtenSince(state, toolCalls, state.book);

/** The worker's notes since it first sensed each situation. */
const notesAfter = (state: Workplace, toolCalls: readonly ToolCall[]) => writtenSince(state, toolCalls, state.notes);

/** The world and the run's time as a component's cycle chooses its next step. */
interface Now {
  state: Workplace;
  sinceStartMs: number;
}

/**
 * A component's cycle from the steps it takes in order, each chosen once the step before has ended, reading the world and
 * the run's time as they are then; it ends when its steps do.
 */
function cycleOf(steps: (now: () => Now) => Generator<Step<Workplace>, void, void>): Cycle<Workplace> {
  let now: Now | undefined;
  const taken = steps(() => now as Now);
  return {
    next: (state, _outcome, sinceStartMs) => {
      now = { state, sinceStartMs };
      const step = taken.next();
      return step.done === true ? { kind: "end" } : step.value;
    },
  };
}

/** The time since the run started at which the depot's clocks show a clock time, in depot seconds since midnight. */
function runMsAt({ startSeconds, timeScale }: Clock, seconds: number): number {
  return ((seconds - startSeconds) / timeScale) * 1000;
}

/** A wait until the depot's clocks show a time, or none when they already have. */
function* waitUntil(now: () => Now, seconds: number): Generator<Step<Workplace>, void, void> {
  const left = runMsAt(now().state.clock, seconds) - now().sinceStartMs;
  if (left > 0) yield { kind: "wait", ms: left };
}

/** An action that holds whenever it lands, with this effect. */
const always = (effect: (state: Workplace) => Workplace): Action<Workplace, unknown> => ({ precondition: () => ({ holds: true }), effect });

/** Things as an action's name lists them: "crate", "box", or nothing. */
const listed = (things: readonly string[]): string => (things.length === 0 ? "nothing" : things.map((thing) => `"${thing}"`).join(", "));

/** Someone appears in a place, holding some things. */
function appearing(person: string, place: string, things: readonly string[]): Action<Workplace, unknown> {
  return always((state) => ({ ...state, space: put(state.space, person, place), held: { ...state.held, ...Object.fromEntries(things.map((thing) => [thing, person])) } }));
}

/** Someone leaves the space, keeping what they hold. */
function leavingTheSpace(person: string): Action<Workplace, unknown> {
  return always((state) => {
    const { [person]: _gone, ...whereabouts } = state.space.whereabouts;
    return { ...state, space: { ...state.space, whereabouts } };
  });
}

/** Someone appears in a place with some things, which they put down there. */
function appearingWith(person: string, place: string, things: readonly string[]): Action<Workplace, unknown> {
  return always((state) => things.reduce((changed, thing) => ({ ...changed, space: put(changed.space, thing, place) }), { ...state, space: put(state.space, person, place) }));
}

/** Things someone holds are put down in a place. */
function puttingDown(things: readonly string[], place: string): Action<Workplace, unknown> {
  return always((state) => things.reduce((changed, thing) => ({ ...outOfHands(changed, thing), space: put(changed.space, thing, place) }), state));
}

/**
 * The places someone walks through from one place to another by the shortest way through the passages, each with the
 * passage's length, in order; none when no way joins them. Of two ways as short, the one by passages declared first.
 */
function shortestWay(space: Places, from: string, to: string): { place: string; length: number }[] | undefined {
  const distance = new Map<string, number>([[from, 0]]);
  const before = new Map<string, { place: string; length: number }>();
  const done = new Set<string>();
  for (;;) {
    const open = [...distance].filter(([place]) => !done.has(place));
    if (open.length === 0) return undefined;
    const [here, far] = open.reduce((nearest, each) => (each[1] < nearest[1] ? each : nearest));
    if (here === to) break;
    done.add(here);
    for (const { place, length } of exits(space, here)) {
      if (far + length < (distance.get(place) ?? Infinity)) {
        distance.set(place, far + length);
        before.set(place, { place: here, length });
      }
    }
  }
  const way: { place: string; length: number }[] = [];
  for (let place = to; place !== from; place = (before.get(place) as { place: string }).place) way.unshift({ place, length: (before.get(place) as { length: number }).length });
  return way;
}

/** Someone walks a way, one passage at a time: they leave as each crossing starts and arrive as it ends (FR-SPACE-03). */
function* walking(person: string, way: readonly { place: string; length: number }[], now: () => Now): Generator<Step<Workplace>, void, void> {
  for (const { place, length } of way) {
    yield {
      kind: "action",
      name: `walk to "${place}"`,
      durationMs: now().state.settings.durations.ms_per_length * length,
      start: inSpace(leave, () => ({ entity: person, towards: place })),
      action: arriving(person),
    };
  }
}

/**
 * The porter's cycle: at each round's time he appears where he enters, carrying that round's arrivals, walks to where he
 * drops them by the shortest way, puts them down, walks back and leaves.
 */
function* porterSteps(now: () => Now): Generator<Step<Workplace>, void, void> {
  const porter = now().state.porter as Porter;
  // A porter with no way between them is refused as the world is built.
  const there = shortestWay(now().state.space, porter.enters, porter.dropsIn) as { place: string; length: number }[];
  const back = shortestWay(now().state.space, porter.dropsIn, porter.enters) as { place: string; length: number }[];
  for (const { seconds, things } of porter.rounds) {
    yield* waitUntil(now, seconds);
    yield { kind: "action", name: `appear in "${porter.enters}" carrying ${listed(things)}`, durationMs: 0, action: appearing(porter.id, porter.enters, things) };
    yield* walking(porter.id, there, now);
    const putMs = now().state.settings.durations.put_ms;
    yield { kind: "action", name: `put down ${listed(things)} in "${porter.dropsIn}"`, durationMs: putMs, action: puttingDown(things, porter.dropsIn) };
    yield* walking(porter.id, back, now);
    yield { kind: "action", name: "leave", durationMs: 0, action: leavingTheSpace(porter.id) };
  }
}

/**
 * A visitor's cycle: once, at a time drawn between the two times they arrive between from their own sequence, they
 * appear where they enter with what they bring and put it down; they wait there, noticing what they hold each depot
 * second, and leave once they hold every thing they came for, or once their wait has run out.
 */
function visitorSteps(id: string, random: Random): (now: () => Now) => Generator<Step<Workplace>, void, void> {
  const draw = random.next();
  return function* (now) {
    const { enters, arrivesBetween: [from, to], waitsSeconds, comesFor, brings } = now().state.visitors[id];
    yield* waitUntil(now, from + draw * (to - from));
    yield { kind: "action", name: `appear in "${enters}" bringing ${listed(brings)}`, durationMs: 0, action: appearingWith(id, enters, brings) };
    const { clock } = now().state;
    const leavesAtMs = now().sinceStartMs + (waitsSeconds / clock.timeScale) * 1000;
    const depotSecondMs = 1000 / clock.timeScale;
    while (!comesFor.every((thing) => now().state.held[thing] === id) && now().sinceStartMs < leavesAtMs) {
      yield { kind: "wait", ms: Math.min(depotSecondMs, leavesAtMs - now().sinceStartMs) };
    }
    yield { kind: "action", name: "leave", durationMs: 0, action: leavingTheSpace(id) };
  };
}

/** The workplace's components: the porter, when the world has one, and each visitor (FR-WORKPLACE-05). */
function components(configuration: Configuration): Component<Workplace>[] {
  const world = textOf(configuration, "world") as unknown as WorldText;
  const porter = (text: PorterText): Component<Workplace> => ({
    name: text.id,
    kind: "world",
    description: `The porter: at each round (${text.rounds.join(", ")}) he appears in "${text.enters}" carrying that round's arrivals, walks to "${text.drops_in}" by the shortest way, puts them down there, walks back and leaves.`,
    cycle: () => cycleOf(porterSteps),
  });
  const visitor = (text: VisitorText): Component<Workplace> => ({
    name: text.id,
    kind: "world",
    description: `A visitor: once, at a time drawn between ${text.arrives_between.join(" and ")}, appears in "${text.enters}" with what they bring and puts it down; leaves once they hold ${listed(text.comes_for)}, or after ${text.waits_minutes} minutes.`,
    cycle: (random) => cycleOf(visitorSteps(text.id, random)),
  });
  return [...(world.porter === undefined ? [] : [porter(world.porter)]), ...(world.visitors ?? []).map(visitor)];
}

/** The worker's tools, in the order the SPEC gives them: its sensors, then its effectors. */
const TOOLS: readonly Tool<Workplace>[] = [look, read, examine, checkTime, go, take, putDown, give, record, note];

/** Each tool's duration as the inventory describes it, from the configuration's durations. */
function describeDuration(configuration: Configuration, tool: string): string {
  const durations = configuration.durations as unknown as Durations;
  const described: Record<string, string> = {
    look: `${durations.look_ms} ms.`,
    read: `${durations.ms_per_word} ms for each word of the text, at least ${durations.look_ms} ms.`,
    examine: `${durations.examine_ms} ms.`,
    check_time: `${durations.check_time_ms} ms.`,
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
  metrics: { holds, predicates, sensed_at_ms: sensedAt, acted_at_ms: actedAt, settled_at_ms: settledAt, exploration, entries_after: entriesAfter, notes_after: notesAfter },
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
  components,
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
    "time_scale = 1",
    'arrivals = ""',
    "[durations]",
    "look_ms = 100",
    "examine_ms = 100",
    "check_time_ms = 100",
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
