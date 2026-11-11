import { describe, expect, it } from "vitest";
import { readExperiment } from "../src/engine/experiment.ts";
import { inventory, inventoryMarkdown } from "../src/engine/inventory.ts";
import type { Scenario } from "../src/engine/scenario.ts";
import { type Slots, slotsScenario } from "./fixtures/slots.ts";

/** An experiment file over the slots test scenario, in TOML, with these conditions after its other fields. */
function experimentOf(conditions: readonly string[]) {
  return readExperiment(
    [
      'id = "e-test"',
      'scenario = "slots"',
      'models = ["scripted/one"]',
      'thinking_level = "off"',
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

/** The inventory of an experiment over a scenario, printed as Markdown. */
function printed(experiment: ReturnType<typeof experimentOf>, scenario: Scenario<Slots>): string {
  return inventoryMarkdown(inventory(experiment, scenario));
}

describe("inventory", () => {
  it("is data: for each condition, its agents, tools, channels, what the engine does not provide, the outcomes the engine gives, and the model and limits", () => {
    const [look, take] = slotsScenario.tools;
    const texts = { success: "You took the slot.", slot_taken: "Someone holds that slot." };
    const scenario = slotsWith({ tools: [look, { ...take, texts } as typeof take] });

    const listed = inventory(experimentOf(["[conditions.baseline]", "[conditions.crowded]", "slots.count = 5"]), scenario);

    const condition = (name: string) => ({
      condition: name,
      agents: ["a", "b"].map((agent) => ({
        name: agent,
        rhythm: "Every agent waits 0 ms before each activation.",
        systemPrompt: `You are agent "${agent}", in a world of slots.`,
      })),
      tools: [
        {
          name: "look",
          kind: "sensor",
          description: look.description,
          parameters: look.parameters,
          duration: "0 ms.",
          effort: "none",
          texts: { success: "the part of the world it senses" },
          otherOutcomes: "the outcome's name",
        },
        {
          name: "take",
          kind: "effector",
          description: take.description,
          parameters: take.parameters,
          duration: "0 ms.",
          effort: "none",
          texts,
          otherOutcomes: "the outcome's name",
        },
      ],
      engineOutcomes: {
        invalid_arguments: "the harness's explanation of the arguments it rejects",
        unknown_tool: "the harness's explanation: Tool <name> not found",
        cut_off: "the outcome's name",
      },
      channels: [{ name: "rhythm", source: "rhythm", delivers: "You wake up." }],
      energyModel: "none",
      environmentProcesses: "none",
      informationSpeed: "Every sensor and channel is instant.",
      models: ["scripted/one"],
      limits: { activationsPerAgent: 3, timeLimitMs: 1000, parallelismLimit: 2, modelTurnTimeoutMs: 500 },
    });
    expect(listed).toEqual({ experiment: "e-test", scenario: "slots", conditions: [condition("baseline"), condition("crowded")] });
    // As data, it goes into a log line whole.
    expect(JSON.parse(JSON.stringify(listed))).toEqual(listed);
  });

  it("gives each agent's rhythm, as the scenario describes it in each condition, and its system prompt", () => {
    const experiment = experimentOf(["[conditions.baseline]", "[conditions.slow]", "rhythm.interval_ms = 50"]);
    const scenario = slotsWith({ describeRhythm: (configuration, agent) => `"${agent}" waits ${(configuration.rhythm as { interval_ms: number }).interval_ms} ms.` });

    const listed = printed(experiment, scenario);

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

    const listed = printed(experiment, scenario);

    const parameters = (tool: typeof look) => ["Parameters:", "", "```json", JSON.stringify(tool.parameters, null, 2), "```", ""];
    const tools = (count: number) =>
      [
        "### Tools",
        "",
        '#### Tool "look"',
        "",
        "- Kind: sensor",
        `- Duration: "look" takes ${count} ms.`,
        "- Effort: none",
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
        "- Effort: none",
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

  it("lists each stimulus channel with its source and what it delivers, as the scenario declares them in each condition", () => {
    const experiment = experimentOf(["[conditions.baseline]", "[conditions.loud]", 'rhythm.text = "Wake up!"']);

    const listed = printed(experiment, slotsWith());

    const channels = (text: string) => ["### Stimulus channels", "", '#### Channel "rhythm"', "", "- Source: rhythm", "", "Delivers:", "", "```text", text, "```", ""].join("\n");
    expect(listed.slice(listed.indexOf('## Condition "baseline"'), listed.indexOf('## Condition "loud"'))).toContain(channels("You wake up."));
    expect(listed.slice(listed.indexOf('## Condition "loud"'))).toContain(channels("Wake up!"));
  });

  it("gives the experiment's models and limits in each condition", () => {
    const listed = printed(experimentOf(["[conditions.baseline]"]), slotsWith());

    expect(listed).toContain(
      [
        "### Model and limits",
        "",
        "- Models: scripted/one",
        "- Activations per agent: 3",
        "- Time limit: 1000 ms",
        "- Parallelism limit: 2",
        "- Model turn timeout: 500 ms",
        "",
      ].join("\n"),
    );
  });

  it("lists the energy model and the environment processes as none, and every sensor and channel as instant, in each condition", () => {
    const listed = printed(experimentOf(["[conditions.baseline]", "[conditions.crowded]", "slots.count = 5"]), slotsWith());

    const engine = ["### Energy model", "", "none", "", "### Environment processes", "", "none", "", "### How fast information travels", "", "Every sensor and channel is instant.", ""].join("\n");
    expect(listed.slice(listed.indexOf('## Condition "baseline"'), listed.indexOf('## Condition "crowded"'))).toContain(engine);
    expect(listed.slice(listed.indexOf('## Condition "crowded"'))).toContain(engine);
  });

  it("prints the outcomes the engine gives, with the text the agent receives for each, in each condition", () => {
    const listed = printed(experimentOf(["[conditions.baseline]", "[conditions.crowded]", "slots.count = 5"]), slotsWith());

    const engine = [
      "### Outcomes the engine gives",
      "",
      "- invalid_arguments: the harness's explanation of the arguments it rejects",
      "- unknown_tool: the harness's explanation: Tool <name> not found",
      "- cut_off: the outcome's name",
      "",
    ].join("\n");
    expect(listed.slice(listed.indexOf('## Condition "baseline"'), listed.indexOf('## Condition "crowded"'))).toContain(engine);
    expect(listed.slice(listed.indexOf('## Condition "crowded"'))).toContain(engine);
  });

  it.each([
    ["describeRhythm", "rhythm description"],
    ["describeDuration", "description of its tools' durations"],
  ] as const)("refuses a scenario without its %s, naming what it lacks", (part, named) => {
    const scenario: Partial<Scenario<Slots>> = slotsWith();
    delete scenario[part];

    expect(() => inventory(experimentOf(["[conditions.baseline]"]), scenario)).toThrow(`Scenario "slots" lacks its ${named}`);
  });

  it("fences a system prompt that holds a fence with a longer one, so the prompt is given whole", () => {
    const experiment = experimentOf(["[conditions.baseline]"]);
    const scenario = slotsWith({ systemPrompt: () => "Answer like this:\n```\ndone\n```" });

    expect(printed(experiment, scenario)).toContain("System prompt:\n\n````text\nAnswer like this:\n```\ndone\n```\n````\n");
  });
});
