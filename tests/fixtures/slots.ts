import type { ActionArgs, DeclaredAction } from "../../src/engine/actions.ts";
import type { Scenario } from "../../src/engine/scenario.ts";
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

/** Who holds the slots a configuration has held at the start. */
export const START_HOLDER = "start";

/**
 * The test world as a scenario. Its base configuration's [slots] table gives the number of slots and how many of them,
 * from slot 1, are held at the start.
 */
export const slotsScenario: Scenario<Slots> = {
  name: "slots",
  initialState: (configuration) => {
    const { count, held } = configuration.slots as { count: number; held: number };
    return Array.from({ length: count }, (_, index) => (index < held ? START_HOLDER : null));
  },
  perception: (slots) => slots.map((holder, index) => `slot ${index + 1}: ${holder ?? "empty"}`).join("\n"),
  actions: declaredActions,
  metrics: { held: (slots) => slots.filter((holder) => holder !== null).length },
  systemPrompt: "You can take an empty slot or wait.",
  baseConfiguration: "[slots]\ncount = 3\nheld = 0\n",
};

/** The name the placing scenario gives its n-th agent, from 1. */
export function placedAgent(n: number): string {
  return `agent ${n}`;
}

/**
 * The test world as a scenario that starts with agents on random empty slots. Its base configuration's [slots] table
 * gives the number of slots and of agents; each agent in turn takes an empty slot drawn from the replica's source.
 */
export const placingScenario: Scenario<Slots> = {
  ...slotsScenario,
  initialState: (configuration, random) => {
    const { count, agents } = configuration.slots as { count: number; agents: number };
    const slots: (string | null)[] = Array.from({ length: count }, () => null);
    for (let n = 1; n <= agents; n += 1) {
      const empty = slots.flatMap((holder, index) => (holder === null ? [index] : []));
      slots[empty[Math.floor(random.next() * empty.length)]] = placedAgent(n);
    }
    return slots;
  },
  baseConfiguration: "[slots]\ncount = 10\nagents = 3\n",
};
