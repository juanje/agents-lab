import { describe, expect, it } from "vitest";
import { ChangesSinceSensing } from "../src/engine/changes.ts";
import { RunClock } from "../src/engine/clock.ts";
import { type Component, type ComponentAction, type Step, runComponent } from "../src/engine/components.ts";
import { Random } from "../src/engine/random.ts";
import { World } from "../src/engine/world.ts";
import { type Slots, emptySlots, filler, holder } from "./fixtures/slots.ts";

/** Runs a component in a world until its cycle ends or the signal aborts, giving the actions it recorded and the changes it applied. */
async function runIn(component: Component<Slots>, world: World<Slots>, runEnd = new AbortController().signal) {
  const actions: ComponentAction[] = [];
  const changes = new ChangesSinceSensing();
  changes.sensed("a");
  const clock = new RunClock();
  clock.start();
  await runComponent(component, { world, random: new Random(1), runEnd, changes, clock, record: (action) => actions.push(action) });
  return { actions, changes };
}

/** A component whose cycle takes these steps in order, keeping the outcome it is given before each choice, then ends. */
function stepping(steps: readonly Step<Slots>[], given: (string | undefined)[]): Component<Slots> {
  return {
    name: "stepper",
    kind: "world",
    description: "Takes its steps.",
    cycle: () => {
      let index = 0;
      return {
        next: (_state, outcome) => {
          given.push(outcome);
          return steps[index++] ?? { kind: "end" };
        },
      };
    },
  };
}

describe("runComponent", () => {
  it("waits, then changes the world through the arbiter once its action's duration has passed, and records the action", async () => {
    const world = new World(emptySlots(3));
    const porter = filler("porter", { slot: 2, thing: "crate", waitMs: () => 20, actionMs: 30 });
    const startedAtMs = performance.now();

    const { actions } = await runIn(porter, world);

    expect(holder(world.state, 2)).toBe("crate");
    expect(world.version).toBe(1);
    expect(actions).toEqual([{ component: "porter", action: 'fill slot 2 with "crate"', startedAtMs: expect.any(Number), endedAtMs: expect.any(Number), outcome: "success" }]);
    expect(actions[0].startedAtMs - startedAtMs).toBeGreaterThanOrEqual(20);
    expect(actions[0].endedAtMs - actions[0].startedAtMs).toBeGreaterThanOrEqual(30);
  });

  it("checks its action when it lands, and gives its cycle the outcome before it chooses again", async () => {
    const world = new World(emptySlots(3));
    const given: (string | undefined)[] = [];
    const fill = (thing: string): Step<Slots> => ({
      kind: "action",
      name: `fill slot 1 with "${thing}"`,
      durationMs: 0,
      action: { precondition: (slots) => (slots[0] === null ? { holds: true } : { holds: false, reason: "slot_taken" }), effect: (slots) => [thing, ...slots.slice(1)] },
    });

    const { actions } = await runIn(stepping([fill("crate"), fill("box"), { kind: "wait", ms: 0 }], given), world);

    expect(actions.map((action) => action.outcome)).toEqual(["success", "slot_taken"]);
    expect(holder(world.state, 1)).toBe("crate");
    // Before its first step, nothing; after each action, its outcome; after a wait, nothing.
    expect(given).toEqual([undefined, "success", "slot_taken", undefined]);
  });

  it("counts each change it applies among the changes since sensing, by its name", async () => {
    const porter = filler("porter", { slot: 2, thing: "crate", waitMs: () => 0, actionMs: 0 });

    const { changes } = await runIn(porter, new World(emptySlots(3)));

    expect(changes.appliedBy("a")).toEqual(["porter"]);
  });

  it("records an action still running when the run ends as cut off, applies nothing and chooses no other step", async () => {
    const world = new World(emptySlots(3));
    const given: (string | undefined)[] = [];
    const runEnd = new AbortController();
    const fill: Step<Slots> = { kind: "action", name: "fill", durationMs: 200, action: { precondition: () => ({ holds: true }), effect: () => ["crate", null, null] } };
    setTimeout(() => runEnd.abort(), 20);

    const { actions } = await runIn(stepping([fill, fill], given), world, runEnd.signal);

    expect(actions.map((action) => action.outcome)).toEqual(["cut_off"]);
    expect(actions[0].endedAtMs - actions[0].startedAtMs).toBeLessThan(200);
    expect(world.version).toBe(0);
    expect(given).toEqual([undefined]);
  });

  it("gives its cycle the time since the run started each time it chooses a step", async () => {
    const given: number[] = [];
    const steps: Step<Slots>[] = [{ kind: "wait", ms: 30 }, { kind: "end" }];
    const timed: Component<Slots> = {
      name: "timed",
      kind: "world",
      description: "Waits, then ends.",
      cycle: () => ({
        next: (_state, _outcome, sinceStartMs) => {
          given.push(sinceStartMs);
          return steps[given.length - 1];
        },
      }),
    };

    await runIn(timed, new World(emptySlots(3)));

    expect(given).toHaveLength(2);
    expect(given[0]).toBeLessThan(5);
    expect(given[1]).toBeGreaterThanOrEqual(30);
  });

  it("applies its action's start through the arbiter as the action starts, counted by its name, before the action lands", async () => {
    const world = new World(emptySlots(3));
    const seen: (string | null)[] = [];
    const steps: Step<Slots>[] = [
      {
        kind: "action",
        name: "carry",
        durationMs: 30,
        start: { precondition: () => ({ holds: true }), effect: (slots) => ["carrying", ...slots.slice(1)] },
        action: { precondition: () => ({ holds: true }), effect: (slots) => [null, "crate", ...slots.slice(2)] },
      },
    ];
    let index = 0;
    const carrier: Component<Slots> = { name: "carrier", kind: "world", description: "Carries a crate.", cycle: () => ({ next: () => steps[index++] ?? { kind: "end" } }) };
    setTimeout(() => seen.push(holder(world.state, 1)), 15);

    const { actions, changes } = await runIn(carrier, world);

    expect(seen).toEqual(["carrying"]);
    expect(world.state).toEqual([null, "crate", null]);
    expect(world.version).toBe(2);
    expect(changes.appliedBy("a")).toEqual(["carrier", "carrier"]);
    expect(actions.map((action) => action.outcome)).toEqual(["success"]);
  });
});
