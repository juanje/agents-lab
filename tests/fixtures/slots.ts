import type { Component } from "../../src/engine/components.ts";
import type { Random } from "../../src/engine/random.ts";
import type { Configuration, Scenario } from "../../src/engine/scenario.ts";
import type { Channel } from "../../src/engine/stimuli.ts";
import type { AgentCall, Tool } from "../../src/engine/tools.ts";
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
function takeCall({ agent, arguments: args }: AgentCall) {
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
    durationMs: () => 0,
    sense: (slots) => JSON.stringify(slots.map((holder): Seen => (holder === null ? "empty" : "held"))),
  },
  {
    kind: "effector",
    name: "take",
    description: "Take an empty slot.",
    // Its schema does not forbid other arguments, so a call with one passes Pi's check and only the engine rejects it.
    parameters: { type: "object", properties: { slot: { type: "integer", minimum: 1 } }, required: ["slot"] },
    durationMs: () => 0,
    action: {
      precondition: (slots, call) => take.precondition(slots, takeCall(call)),
      effect: (slots, call) => take.effect(slots, takeCall(call)),
    },
    // Its target is the slot it names, as "look" last showed it.
    readTarget: (sensing, call) => {
      if (sensing?.tool !== "look") return "not_sensed";
      const seen = (JSON.parse(sensing.result) as Seen[])[takeCall(call).slot - 1];
      return seen === undefined ? "not_sensed" : seen === "held" ? "held" : "free";
    },
  },
];

/** The test world's rhythm channel, which wakes each agent. */
export const rhythmChannel: Channel = { name: "rhythm", source: "rhythm", stimulus: "You wake up." };

/**
 * A test world as a scenario without a configuration: the state it starts from, its tools and its agents, who are told
 * they are agents `where` (for example, "on a grid") and wake through the rhythm channel at once.
 */
export function testWorldScenario<State>(name: string, where: string, start: State, tools: readonly Tool<State>[], agents: readonly string[]): Scenario<State> {
  return {
    name,
    agents: () => agents,
    initialState: () => start,
    tools,
    channels: () => [rhythmChannel],
    metrics: {},
    systemPrompt: () => `You are an agent ${where}.`,
    // Its agents wake at once: a test that needs another rhythm gives it.
    rhythm: () => () => 0,
    describeDuration: () => "As each tool gives it.",
    describeRhythm: () => "No wait before any activation.",
    baseConfiguration: "",
  };
}

/** The rhythm channel's source and text, as the slots test scenario's configuration gives them in its [rhythm] table. */
export function rhythmOf(configuration: Configuration): { source: string; text: string } {
  const { source, text } = configuration.rhythm as { source: string; text: string };
  return { source, text };
}

/** Who holds the slots a configuration has held at the start. */
export const START_HOLDER = "start";

/**
 * The test world as a scenario. Its base configuration names its agents, and its [slots] table gives the number of
 * slots, how many of them, from slot 1, are held at the start, keys that the scenario reads but no agent meets, as
 * a held-out material would give them (FR-EXPERIMENT-04), and take_ms, a number no part of the scenario reads, which a
 * change common to every condition can set beside the slot count (FR-EXPERIMENT-02).
 */
export const slotsScenario: Scenario<Slots> = {
  name: "slots",
  agents: (configuration) => configuration.agents as string[],
  initialState: (configuration) => {
    const { count, held } = configuration.slots as { count: number; held: number };
    return Array.from({ length: count }, (_, index) => (index < held ? START_HOLDER : null));
  },
  tools: slotTools,
  channels: (configuration) => {
    const { source, text } = rhythmOf(configuration);
    return [{ name: "rhythm", source, stimulus: text }];
  },
  metrics: { held: (slots) => slots.filter((holder) => holder !== null).length },
  // Every agent waits the interval its configuration's [rhythm] table gives.
  rhythm: (configuration) => {
    const intervalMs = (configuration.rhythm as { interval_ms: number }).interval_ms;
    return () => intervalMs;
  },
  // Its tools take no time.
  describeDuration: () => "0 ms.",
  describeRhythm: (configuration) => `Every agent waits ${(configuration.rhythm as { interval_ms: number }).interval_ms} ms before each activation.`,
  // It names the agent it describes, quoted, so each agent's prompt can be told from another's.
  systemPrompt: (_configuration, agent) => `You are agent "${agent}", in a world of slots.`,
  // Its [rhythm] table gives the rhythm channel's source and text, the same as the test world's rhythm channel, and
  // the interval each agent waits before each activation.
  baseConfiguration: [
    'agents = ["a"]',
    "[slots]",
    "count = 3",
    "held = 0",
    'keys = ""',
    "take_ms = 0",
    "[rhythm]",
    `source = ${JSON.stringify(rhythmChannel.source)}`,
    `text = ${JSON.stringify(rhythmChannel.stimulus)}`,
    "interval_ms = 0",
    "",
  ].join("\n"),
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
  agents: (configuration) =>
    Array.from({ length: (configuration.slots as { agents: number }).agents }, (_, index) => placedAgent(index + 1)),
  // Its base configuration does not give the rhythm channel or its interval, so it declares the test world's and no wait.
  channels: () => [rhythmChannel],
  rhythm: () => () => 0,
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

/** A draw of whole milliseconds from a range, both ends included, from a random sequence. */
export function drawBetween(minMs: number, maxMs: number): (random: Random) => number {
  return (random) => minMs + Math.floor(random.next() * (maxMs - minMs + 1));
}

/**
 * A component of the test world whose cycle waits a number of milliseconds it draws, then fills a slot with a thing,
 * an action that takes its duration and fails with "slot_taken" when the slot is held when it lands, then ends.
 */
export function filler(
  name: string,
  { slot, thing, waitMs, actionMs, kind = "world" }: { slot: number; thing: string; waitMs: (random: Random) => number; actionMs: number; kind?: Component<Slots>["kind"] },
): Component<Slots> {
  return {
    name,
    kind,
    description: `Waits, then fills slot ${slot} with "${thing}" in ${actionMs} ms, then ends.`,
    cycle: (random) => {
      let steps = 0;
      return {
        next: () => {
          steps += 1;
          if (steps === 1) return { kind: "wait", ms: waitMs(random) };
          if (steps === 2) {
            return {
              kind: "action",
              name: `fill slot ${slot} with "${thing}"`,
              durationMs: actionMs,
              // The thing holds the slot as an agent would, by its name.
              action: { precondition: (slots) => take.precondition(slots, { agent: thing, slot }), effect: (slots) => take.effect(slots, { agent: thing, slot }) },
            };
          }
          return { kind: "end" };
        },
      };
    },
  };
}
