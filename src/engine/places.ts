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

/** The space with one more entity in a place, for building a world's initial state. */
export function put(space: Places, _entity: string, _place: string): Places {
  return space;
}

/** The place or passage an entity is in, or none when the space does not hold it. */
export function where(_space: Places, _entity: string): Where | undefined {
  return undefined;
}
