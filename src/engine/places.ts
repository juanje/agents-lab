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

/** A space with these places and passages, holding no entity. */
export function layout(places: readonly string[], passages: readonly Passage[]): Places {
  return { places, passages, whereabouts: {} };
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

/** An entity in a place enters the passage towards a place one passage away. */
export const leave: Action<Places, { entity: string; towards: string }> = {
  precondition: () => ({ holds: true }),
  effect: (space, { entity, towards }) => {
    const from = (where(space, entity) as { place: string }).place;
    const passage = space.passages.find(({ between }) => between.includes(from) && between.includes(towards)) as Passage;
    return moved(space, entity, { passage: passage.between, towards });
  },
};

/** An entity in a passage reaches the place it was heading for. */
export const arrive: Action<Places, { entity: string }> = {
  precondition: () => ({ holds: true }),
  effect: (space, { entity }) => moved(space, entity, { place: (where(space, entity) as { towards: string }).towards }),
};

/** The space with an entity it holds somewhere else. */
function moved(space: Places, entity: string, to: Where): Places {
  return { ...space, whereabouts: { ...space.whereabouts, [entity]: to } };
}
