import type { Scenario } from "../../src/engine/scenario.ts";
import type { Channel } from "../../src/engine/stimuli.ts";
import type { EffectorCall, Tool } from "../../src/engine/tools.ts";
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

/** A call of the effector "take" as the action "take" reads it: the calling agent, and the slot its arguments give. */
function takeCall({ agent, arguments: args }: EffectorCall) {
  return { agent, slot: args.slot as number };
}

/** What "look" gives for a slot. */
export type Seen = "empty" | "held";

/** The test world's tools: the sensor "look" and the effector "take <slot>". */
export const slotTools: readonly Tool<Slots>[] = [
  {
    kind: "sensor",
    name: "look",
    description: "See which slots are empty and which are held, from slot 1, as a JSON array.",
    parameters: { type: "object", properties: {} },
    durationMs: 0,
    sense: (slots) => JSON.stringify(slots.map((holder): Seen => (holder === null ? "empty" : "held"))),
  },
  {
    kind: "effector",
    name: "take",
    description: "Take an empty slot.",
    // Its schema does not forbid other arguments, so a call with one passes Pi's check and only the engine rejects it.
    parameters: { type: "object", properties: { slot: { type: "integer", minimum: 1 } }, required: ["slot"] },
    action: {
      precondition: (slots, call) => take.precondition(slots, takeCall(call)),
      effect: (slots, call) => take.effect(slots, takeCall(call)),
    },
  },
];

/** The test world's rhythm channel, which wakes each agent. */
export const rhythmChannel: Channel = { name: "rhythm", source: "rhythm", stimulus: "You wake up." };

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
  tools: slotTools,
  channels: [rhythmChannel],
  metrics: { held: (slots) => slots.filter((holder) => holder !== null).length },
  systemPrompt: "You are an agent in a world of slots.",
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
