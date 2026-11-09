import { describe, expect, it } from "vitest";
import { World } from "../src/engine/world.ts";
import { emptySlots, take } from "./fixtures/slots.ts";

describe("World.apply", () => {
  it("applies an action whose precondition holds, and its version grows by one", () => {
    const world = new World(emptySlots(3));

    const result = world.apply(take, { agent: "a", slot: 1 });

    expect(result).toEqual({ applied: true });
    expect(world.state).toEqual(["a", null, null]);
    expect(world.version).toBe(1);
  });
});
