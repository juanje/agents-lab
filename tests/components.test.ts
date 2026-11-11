import { describe, expect, it } from "vitest";
import { ChangesSinceSensing } from "../src/engine/changes.ts";
import { type Component, type ComponentAction, type Step, runComponent } from "../src/engine/components.ts";
import { Random } from "../src/engine/random.ts";
import { World } from "../src/engine/world.ts";
import { type Slots, emptySlots, filler, holder } from "./fixtures/slots.ts";

/** Runs a component in a world until its cycle ends or the signal aborts, giving the actions it recorded and the changes it applied. */
async function runIn(component: Component<Slots>, world: World<Slots>, runEnd = new AbortController().signal) {
  const actions: ComponentAction[] = [];
  const changes = new ChangesSinceSensing();
  changes.sensed("a");
  await runComponent(component, { world, random: new Random(1), runEnd, changes, record: (action) => actions.push(action) });
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
});
