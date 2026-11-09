import type { ActionArgs, DeclaredAction } from "../../src/engine/actions.ts";
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

/** A slot number is a positive integer written in digits; any other text is not one. */
function readSlot(text: string): number | undefined {
  return /^[1-9][0-9]*$/.test(text) ? Number(text) : undefined;
}

/** The test world's declared actions: "take <slot>" and "wait". */
export const declaredActions: readonly DeclaredAction<Slots, ActionArgs>[] = [
  {
    name: "take",
    description: "Take an empty slot.",
    arguments: [{ name: "slot", read: readSlot }],
    failureReasons: [SLOT_TAKEN],
    ...take,
  },
  {
    name: "wait",
    description: "Do nothing this time.",
    arguments: [],
    failureReasons: [],
    precondition: () => ({ holds: true }),
    effect: (slots) => slots,
  },
];
