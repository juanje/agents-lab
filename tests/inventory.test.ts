import { describe, expect, it } from "vitest";
import { readExperiment } from "../src/engine/experiment.ts";
import { inventory } from "../src/engine/inventory.ts";
import type { Scenario } from "../src/engine/scenario.ts";
import { type Slots, slotsScenario } from "./fixtures/slots.ts";

/** An experiment file over the slots test scenario, in TOML, with these conditions after its other fields. */
function experimentOf(conditions: readonly string[]) {
  return readExperiment(
    [
      'id = "e-test"',
      'scenario = "slots"',
      'models = ["scripted/one"]',
      "replicas = 1",
      "seed = 7",
      "[limits]",
      "time_limit_ms = 1000",
      "activations_per_agent = 3",
      "parallelism_limit = 2",
      "model_turn_timeout_ms = 500",
      ...conditions,
      "",
    ].join("\n"),
  );
}

/** The slots test scenario with agents "a" and "b", and these parts in place of its own. */
function slotsWith(parts: Partial<Scenario<Slots>> = {}): Scenario<Slots> {
  return { ...slotsScenario, baseConfiguration: slotsScenario.baseConfiguration.replace('agents = ["a"]', 'agents = ["a", "b"]'), ...parts };
}

describe("inventory", () => {
  it("gives each agent's rhythm, as the scenario describes it in each condition, and its system prompt", () => {
    const experiment = experimentOf(["[conditions.baseline]", "[conditions.slow]", "rhythm.interval_ms = 50"]);
    const scenario = slotsWith({ describeRhythm: (configuration, agent) => `"${agent}" waits ${(configuration.rhythm as { interval_ms: number }).interval_ms} ms.` });

    const listed = inventory(experiment, scenario);

    const agent = (name: string, intervalMs: number) =>
      [`#### Agent "${name}"`, "", `- Rhythm: "${name}" waits ${intervalMs} ms.`, "", "System prompt:", "", "```text", `You are agent "${name}", in a world of slots.`, "```", ""].join("\n");
    const baseline = listed.slice(listed.indexOf('## Condition "baseline"'), listed.indexOf('## Condition "slow"'));
    const slow = listed.slice(listed.indexOf('## Condition "slow"'));
    expect(baseline).toContain(["### Agents", "", agent("a", 0), agent("b", 0)].join("\n"));
    expect(slow).toContain(["### Agents", "", agent("a", 50), agent("b", 50)].join("\n"));
  });

  it("lists each tool with its kind, the description and parameters its agents see, its duration as the scenario describes it in each condition, and the text for each outcome", () => {
    const experiment = experimentOf(["[conditions.baseline]", "[conditions.crowded]", "slots.count = 5"]);
    const [look, take] = slotsScenario.tools;
    const texts = { success: "You took the slot.", slot_taken: "Someone holds that slot." };
    const scenario = slotsWith({
      tools: [look, { ...take, texts } as typeof take],
      describeDuration: (configuration, tool) => `"${tool}" takes ${(configuration.slots as { count: number }).count} ms.`,
    });

    const listed = inventory(experiment, scenario);

    const parameters = (tool: typeof look) => ["Parameters:", "", "```json", JSON.stringify(tool.parameters, null, 2), "```", ""];
    const tools = (count: number) =>
      [
        "### Tools",
        "",
        '#### Tool "look"',
        "",
        "- Kind: sensor",
        `- Duration: "look" takes ${count} ms.`,
        "",
        "Description:",
        "",
        "```text",
        look.description,
        "```",
        "",
        ...parameters(look),
        "Texts for each outcome:",
        "",
        "- success: the part of the world it senses",
        "- any other outcome: the outcome's name",
        "",
        '#### Tool "take"',
        "",
        "- Kind: effector",
        `- Duration: "take" takes ${count} ms.`,
        "",
        "Description:",
        "",
        "```text",
        take.description,
        "```",
        "",
        ...parameters(take),
        "Texts for each outcome:",
        "",
        "- success: You took the slot.",
        "- slot_taken: Someone holds that slot.",
        "- any other outcome: the outcome's name",
        "",
      ].join("\n");
    expect(listed.slice(listed.indexOf('## Condition "baseline"'), listed.indexOf('## Condition "crowded"'))).toContain(tools(3));
    expect(listed.slice(listed.indexOf('## Condition "crowded"'))).toContain(tools(5));
  });

  it("fences a system prompt that holds a fence with a longer one, so the prompt is given whole", () => {
    const experiment = experimentOf(["[conditions.baseline]"]);
    const scenario = slotsWith({ systemPrompt: () => "Answer like this:\n```\ndone\n```" });

    expect(inventory(experiment, scenario)).toContain("System prompt:\n\n````text\nAnswer like this:\n```\ndone\n```\n````\n");
  });
});
