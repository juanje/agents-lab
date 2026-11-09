import type { Action } from "../../src/engine/world.ts";

/** A test world of numbered slots, from 1; each is empty (null) or held by one agent. */
export type Slots = readonly (string | null)[];

export function emptySlots(count: number): Slots {
  return Array.from({ length: count }, () => null);
}

export function holder(slots: Slots, slot: number): string | null {
  return slots[slot - 1];
}

export const SLOT_TAKEN = "slot_taken";

/** "take" puts an agent in a slot, only if that slot is empty. */
export const take: Action<Slots, { agent: string; slot: number }> = {
  precondition: (slots, { slot }) =>
    holder(slots, slot) === null ? { holds: true } : { holds: false, reason: SLOT_TAKEN },
  effect: (slots, { agent, slot }) => slots.map((current, index) => (index === slot - 1 ? agent : current)),
};
