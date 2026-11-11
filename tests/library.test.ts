import { describe, expect, it } from "vitest";
import { scenarioLibrary } from "../src/scenarios/library.ts";
import { neighbourhoodScenario } from "../src/scenarios/neighbourhood.ts";

describe("the scenario library", () => {
  it("gives each of its scenarios by the scenario's name", () => {
    expect([...scenarioLibrary]).toEqual([["neighbourhood", neighbourhoodScenario]]);
    for (const [name, scenario] of scenarioLibrary) expect(scenario.name).toBe(name);
  });
});
