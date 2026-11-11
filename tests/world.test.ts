import { describe, expect, it } from "vitest";
import { World } from "../src/engine/world.ts";
import { type Slots, emptySlots, take } from "./fixtures/slots.ts";

describe("World.apply", () => {
  it("applies an action whose precondition holds, and its version grows by one", () => {
    const world = new World(emptySlots(3));

    const result = world.apply(take, { agent: "a", slot: 1 });

    expect(result).toEqual({ applied: true });
    expect(world.state).toEqual(["a", null, null]);
    expect(world.version).toBe(1);
  });

  it("applies nothing when the precondition does not hold, and fails with the action's reason", () => {
    const world = new World(emptySlots(3));
    world.apply(take, { agent: "b", slot: 2 });

    const result = world.apply(take, { agent: "a", slot: 2 });

    expect(result).toEqual({ applied: false, reason: "slot_taken" });
    expect(world.state).toEqual([null, "b", null]);
    expect(world.version).toBe(1);
  });
});

describe("World.watch", () => {
  it("tells a watcher each action applied, with the state before it and after it, and nothing of an action refused", () => {
    const world = new World(emptySlots(2));
    const seen: [Slots, Slots][] = [];
    world.watch((before, after) => seen.push([before, after]));

    world.apply(take, { agent: "a", slot: 1 });
    world.apply(take, { agent: "b", slot: 1 });

    expect(seen).toEqual([[[null, null], ["a", null]]]);
  });

  it("tells a watcher nothing once it stops watching", () => {
    const world = new World(emptySlots(2));
    const seen: Slots[] = [];
    const unwatch = world.watch((_before, after) => seen.push(after));

    unwatch();
    world.apply(take, { agent: "a", slot: 1 });

    expect(seen).toEqual([]);
  });
});
