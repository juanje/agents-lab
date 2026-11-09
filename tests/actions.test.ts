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

  it("applies nothing when an answer matches no declared action, and its outcome is unparsed", () => {
    const world = new World(emptySlots(3));

    const outcome = act(world, declaredActions, "a", "fly to slot 1");

    expect(outcome).toBe("unparsed");
    expect(world.state).toEqual([null, null, null]);
    expect(world.version).toBe(0);
  });

  it.each([
    ["an argument it cannot read", "take seven"],
    ["one argument more than it takes", "take 1 2"],
    ["one argument less than it takes", "take"],
  ])("applies nothing when an answer names a declared action with %s, and its outcome is invalid_arguments", (_, answer) => {
    const world = new World(emptySlots(3));

    const outcome = act(world, declaredActions, "a", answer);

    expect(outcome).toBe("invalid_arguments");
    expect(world.state).toEqual([null, null, null]);
    expect(world.version).toBe(0);
  });

  it("gives the action's declared failure reason as the outcome when its precondition does not hold", () => {
    const world = new World(emptySlots(3));
    act(world, declaredActions, "b", "take 2");

    const outcome = act(world, declaredActions, "a", "take 2");

    expect(outcome).toBe("slot_taken");
    expect(world.state).toEqual([null, "b", null]);
    expect(world.version).toBe(1);
  });
});
