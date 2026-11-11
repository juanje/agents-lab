import type { Action } from "./world.ts";

/** A passage between two places, which can be crossed both ways, and its length. */
export interface Passage {
  between: readonly [string, string];
  length: number;
}

/** Where an entity is: in a place, or in the passage between two places, heading for one of them. */
export type Where = { place: string } | { passage: readonly [string, string]; towards: string };

/** A space of named places connected by passages, and where each entity it holds is (FR-SPACE-03). */
export interface Places {
  places: readonly string[];
  passages: readonly Passage[];
  /** Where each entity the space holds is, by its name. */
  whereabouts: Readonly<Record<string, Where>>;
}

/**
 * A space with these places and passages, holding no entity. A passage that names a place the layout does not declare,
 * whose length is not greater than zero, or that joins two places an earlier passage joins, is refused with an error
 * that names it.
 */
export function layout(places: readonly string[], passages: readonly Passage[]): Places {
  const space = { places, passages, whereabouts: {} };
  passages.forEach(({ between, length }, index) => {
    const where = `cannot lay out a passage between "${between[0]}" and "${between[1]}"`;
    for (const place of between) assertPlace(space, place, where);
    if (!(length > 0)) throw new Error(`${where}: its length ${length} is not greater than zero`);
    const earlier = passages.slice(0, index).find((passage) => joins(passage.between, ...between));
    if (earlier !== undefined) {
      throw new Error(`${where}: a passage already joins the places "${earlier.between[0]}" and "${earlier.between[1]}"`);
    }
  });
  return space;
}

/** Refuses a place the space does not declare, saying what was attempted (`where`). */
function assertPlace(space: Places, place: string, where: string): void {
  if (!space.places.includes(place)) throw new Error(`${where}: the space has no place "${place}"`);
}

/**
 * The space with one more entity in a place, for building a world's initial state. Once the world runs, entities
 * change places only through the arbiter, with `leave` and `arrive`.
 */
export function put(space: Places, entity: string, place: string): Places {
  assertPlace(space, place, `cannot put entity "${entity}" in place "${place}"`);
  return { ...space, whereabouts: { ...space.whereabouts, [entity]: { place } } };
}

/** The place or passage an entity is in, or none when the space does not hold it. */
export function where(space: Places, entity: string): Where | undefined {
  return Object.hasOwn(space.whereabouts, entity) ? space.whereabouts[entity] : undefined;
}

/** A place one passage away, with the passage's length. */
export interface Exit {
  place: string;
  length: number;
}

/** The places one passage away from a place, each with the passage's length, in the order the passages are declared. */
export function exits(space: Places, place: string): Exit[] {
  return space.passages.flatMap(({ between: [one, other], length }) =>
    one === place ? [{ place: other, length }] : other === place ? [{ place: one, length }] : [],
  );
}

/** The entities in a place, in the order the space first held them. */
export function entitiesIn(space: Places, place: string): string[] {
  return Object.entries(space.whereabouts)
    .filter(([, at]) => "place" in at && at.place === place)
    .map(([entity]) => entity);
}

/**
 * Where an entity that leaves its place towards another is then: in the passage between them. A leave of an entity the
 * space does not hold, or not in a place, or towards a place that is unknown or not one passage away, is refused with an
 * error that names the entity or the place.
 */
function leaving(space: Places, { entity, towards }: { entity: string; towards: string }): Where {
  const where = `entity "${entity}" cannot leave towards place "${towards}"`;
  const from = whereHeld(space, entity, where);
  if (!("place" in from)) throw new Error(`${where}: it is in the passage between "${from.passage[0]}" and "${from.passage[1]}", not in a place`);
  assertPlace(space, towards, where);
  const passage = space.passages.find(({ between }) => joins(between, from.place, towards));
  if (passage === undefined) throw new Error(`${where}: place "${towards}" is not one passage away from place "${from.place}"`);
  return { passage: passage.between, towards };
}

/**
 * Where an entity in a passage is once it arrives: the place it was heading for. An arrive of an entity that is not in
 * a passage is refused with an error that names it.
 */
function arriving(space: Places, entity: string): Where {
  const where = `entity "${entity}" cannot arrive`;
  const from = whereHeld(space, entity, where);
  if (!("passage" in from)) throw new Error(`${where}: it is in place "${from.place}", not in a passage`);
  return { place: from.towards };
}

/** Where an entity is, refusing one the space does not hold, saying what was attempted (`attempt`). */
function whereHeld(space: Places, entity: string, attempt: string): Where {
  const at = where(space, entity);
  if (at === undefined) throw new Error(`${attempt}: the space holds no entity "${entity}"`);
  return at;
}

// A leave or an arrive the space cannot make is a defect in the scenario that asks for it, not an agent's choice, so it
// is refused before the world changes rather than recorded as an outcome (FR-SPACE-03).

/** An entity in a place enters the passage towards a place one passage away. */
export const leave: Action<Places, { entity: string; towards: string }> = {
  precondition: (space, args) => {
    leaving(space, args);
    return { holds: true };
  },
  effect: (space, args) => moved(space, args.entity, leaving(space, args)),
};

/** An entity in a passage reaches the place it was heading for. */
export const arrive: Action<Places, { entity: string }> = {
  precondition: (space, { entity }) => {
    arriving(space, entity);
    return { holds: true };
  },
  effect: (space, { entity }) => moved(space, entity, arriving(space, entity)),
};

/** The space with an entity it holds somewhere else. */
function moved(space: Places, entity: string, to: Where): Places {
  return { ...space, whereabouts: { ...space.whereabouts, [entity]: to } };
}

/**
 * The entities an entity can see, besides itself: from a place, those in that place and in the passages that leave it;
 * from a passage, those in that passage and in the two places it joins.
 */
export function inSight(space: Places, entity: string): string[] {
  const from = where(space, entity);
  if (from === undefined) throw new Error(`cannot tell what entity "${entity}" sees: the space holds no entity "${entity}"`);
  const seen = (at: Where) =>
    "place" in from
      ? "place" in at
        ? at.place === from.place
        : at.passage.includes(from.place)
      : "place" in at
        ? from.passage.includes(at.place)
        : joins(at.passage, ...from.passage);
  return Object.entries(space.whereabouts)
    .filter(([other, at]) => other !== entity && seen(at))
    .map(([other]) => other);
}

/** The entities in the passage between two places, whichever way they are named, in the order the space first held them. */
export function entitiesInPassage(space: Places, one: string, other: string): string[] {
  return Object.entries(space.whereabouts)
    .filter(([, at]) => "passage" in at && joins(at.passage, one, other))
    .map(([entity]) => entity);
}

/** Whether a passage's two places are these two, whichever way they are named. */
function joins(between: readonly [string, string], one: string, other: string): boolean {
  return (between[0] === one && between[1] === other) || (between[0] === other && between[1] === one);
}
