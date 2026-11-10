import { describe, expect, it } from "vitest";
import { loadScenario } from "../src/engine/scenario.ts";
import { START_HOLDER, slotsScenario } from "./fixtures/slots.ts";

describe("loadScenario", () => {
  it("builds the world's initial state from the scenario's base configuration", () => {
    const loaded = loadScenario({ ...slotsScenario, baseConfiguration: "[slots]\ncount = 2\nheld = 1\n" });

    expect(loaded.configuration).toEqual({ slots: { count: 2, held: 1 } });
    expect(loaded.world.state).toEqual([START_HOLDER, null]);
    expect(loaded.world.version).toBe(0);
    expect(loaded.scenario.actions).toBe(slotsScenario.actions);
  });

  it("applies the condition's change over the base configuration, keeping what the change does not set", () => {
    const loaded = loadScenario(
      { ...slotsScenario, baseConfiguration: "label = 'base'\nmode = 'plain'\n[slots]\ncount = 2\nheld = 0\n" },
      { name: "new-label", change: "label = 'changed'\n" },
    );

    expect(loaded.configuration).toEqual({ label: "changed", mode: "plain", slots: { count: 2, held: 0 } });
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
