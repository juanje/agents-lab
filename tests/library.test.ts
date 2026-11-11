import { describe, expect, it } from "vitest";
import { scenarioLibrary } from "../src/scenarios/library.ts";
import { neighbourhoodScenario } from "../src/scenarios/neighbourhood.ts";
import { workplaceScenario } from "../src/scenarios/workplace.ts";

describe("the scenario library", () => {
  it("gives each of its scenarios by the scenario's name", () => {
    expect([...scenarioLibrary]).toEqual([
      ["neighbourhood", neighbourhoodScenario],
      ["workplace", workplaceScenario],
    ]);
    for (const [name, scenario] of scenarioLibrary) expect(scenario.name).toBe(name);
  });
});
