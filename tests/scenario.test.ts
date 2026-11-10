import { describe, expect, it } from "vitest";
import { loadScenario } from "../src/engine/scenario.ts";
import { slotsScenario } from "./fixtures/slots.ts";

describe("loadScenario", () => {
  it("builds the world's initial state from the scenario's base configuration", () => {
    const loaded = loadScenario({ ...slotsScenario, baseConfiguration: "slots = 2\n" });

    expect(loaded.configuration).toEqual({ slots: 2 });
    expect(loaded.world.state).toEqual([null, null]);
    expect(loaded.world.version).toBe(0);
    expect(loaded.scenario.actions).toBe(slotsScenario.actions);
  });
});
