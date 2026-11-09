import { describe, expect, it } from "vitest";
import { act } from "../src/engine/actions.ts";
import { World } from "../src/engine/world.ts";
import { declaredActions, emptySlots } from "./fixtures/slots.ts";

describe("act", () => {
  it("applies the declared action an answer names, with its arguments, and its outcome is success", () => {
    const world = new World(emptySlots(3));

    const outcome = act(world, declaredActions, "a", "take 2");

    expect(outcome).toBe("success");
    expect(world.state).toEqual([null, "a", null]);
    expect(world.version).toBe(1);
  });
});
