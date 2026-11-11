import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import { Random } from "../src/engine/random.ts";
import type { Configuration, Scenario } from "../src/engine/scenario.ts";
import { type Workplace, workplaceScenario } from "../src/scenarios/workplace.ts";

const scenario = workplaceScenario as Scenario<Workplace>;

/** The workplace's base configuration with these values over it. */
function configuration(values: Configuration): Configuration {
  return { ...parse(scenario.baseConfiguration), ...values };
}

const WORLD = `
[worker]
place = "hall"

[[places]]
name = "hall"
[[places]]
name = "office"

[[passages]]
between = ["hall", "office"]
length = 3

[[things]]
id = "sign"
name = "a sign"
place = "hall"
text = "Quiet, please."
portable = false

[[things]]
id = "cupboard"
name = "a cupboard"
place = "office"
container = true

[[things]]
id = "key"
name = "a small key"
in = "cupboard"
properties = { metal = "brass" }

[[people]]
id = "ana"
name = "Ana"
description = "A visitor."
place = "office"
`;

describe("the workplace scenario", () => {
  it("builds its places, passages, things and people from the world's text, with the worker in its place", () => {
    const state = scenario.initialState(configuration({ world: WORLD }), new Random(1));

    expect(state.space.places).toEqual(["hall", "office"]);
    expect(state.space.passages).toEqual([{ between: ["hall", "office"], length: 3 }]);
    expect(state.space.whereabouts).toEqual({
      worker: { place: "hall" },
      sign: { place: "hall" },
      cupboard: { place: "office" },
      ana: { place: "office" },
    });
    expect(state.things).toEqual({
      sign: { name: "a sign", properties: {}, text: "Quiet, please.", container: false, portable: false },
      cupboard: { name: "a cupboard", properties: {}, container: true, portable: true },
      key: { name: "a small key", properties: { metal: "brass" }, container: false, portable: true },
    });
    expect(state.inside).toEqual({ key: "cupboard" });
    expect(state.people).toEqual({ ana: { name: "Ana", description: "A visitor." } });
  });

  it("has one agent, the worker", () => {
    expect(scenario.agents(configuration({ world: WORLD }))).toEqual(["worker"]);
  });

  it("wakes the worker by the rhythm channel, with the configured source and text", () => {
    const rhythm = { source: "a bell", text: "The bell rings.", min_ms: 0, max_ms: 10 };

    expect(scenario.channels(configuration({ rhythm }))).toEqual([{ name: "rhythm", source: "a bell", stimulus: "The bell rings." }]);
  });

  it("draws each of the worker's intervals uniformly between the configured bounds", () => {
    const rhythm = scenario.rhythm(configuration({ rhythm: { source: "", text: "", min_ms: 100, max_ms: 200 } }), "worker");
    const random = { next: () => 0.25 } as Random;

    expect(rhythm(random)).toBe(125);
  });

  it("joins identity, world rules, norms and rules into the system prompt, in that order, skipping empty ones", () => {
    const texts = { identity: "I.", world_rules: "W.", norms: "", rules: "R." };

    expect(scenario.systemPrompt(configuration(texts), "worker")).toBe("I.\n\nW.\n\nR.");
    expect(scenario.systemPrompt(configuration({ ...texts, norms: "N." }), "worker")).toBe("I.\n\nW.\n\nN.\n\nR.");
  });

  it("has no tools and no metrics yet", () => {
    expect({ tools: scenario.tools, metrics: scenario.metrics }).toEqual({ tools: [], metrics: {} });
  });
});
