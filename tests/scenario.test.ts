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

  it("applies the condition's change over the base configuration, keeping what the change does not set", () => {
    const loaded = loadScenario(
      { ...slotsScenario, baseConfiguration: "slots = 2\nlabel = 'base'\n" },
      { name: "four-slots", change: "slots = 4\n" },
    );

    expect(loaded.configuration).toEqual({ slots: 4, label: "base" });
    expect(loaded.world.state).toEqual([null, null, null, null]);
  });

  it.each([
    ["initialState", "initial state"],
    ["perception", "perception"],
    ["actions", "actions"],
    ["metrics", "metrics"],
    ["systemPrompt", "system prompt"],
    ["baseConfiguration", "base configuration"],
  ] as const)("refuses a scenario without its %s, with an error that names the %s", (property, part) => {
    const { [property]: _left, ...rest } = slotsScenario;

    expect(() => loadScenario(rest)).toThrow(`Scenario "slots" lacks its ${part}`);
  });
});
