import { describe, expect, it } from "vitest";
import { summaryInstructions } from "../src/engine/compaction.ts";
import { readExperiment } from "../src/engine/experiment.ts";
import { inventory, inventoryMarkdown } from "../src/engine/inventory.ts";
import type { Scenario } from "../src/engine/scenario.ts";
import { type Slots, filler, slotsScenario } from "./fixtures/slots.ts";

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
      "[compaction]",
      "enabled = false",
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
  it("is data: for each condition, its agents, tools, channels, what the engine does not provide, the outcomes the engine gives, and the model, its thinking level and the limits", () => {
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
        firstStimuli: [],
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
      thinkingLevel: "off",
      compaction: { enabled: false },
      limits: { activationsPerAgent: 3, timeLimitMs: 1000, parallelismLimit: 2, modelTurnTimeoutMs: 500 },
      materials: [],
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

  it("gives, beside an agent's system prompt, each stimulus it receives as it first wakes, with its channel and source", () => {
    const bell = { name: "bell", source: "town bell", stimulus: "The bell rings." };
    const scenario = slotsWith({
      channels: (configuration) => [...slotsScenario.channels(configuration), bell],
      firstStimuli: (_configuration, agent) => (agent === "a" ? ["bell"] : []),
    });

    const [condition] = inventory(experimentOf(["[conditions.baseline]"]), scenario).conditions;
    const listed = printed(experimentOf(["[conditions.baseline]"]), scenario);

    expect(condition.agents.map(({ name, firstStimuli }) => [name, firstStimuli])).toEqual([
      ["a", [{ channel: "bell", source: "town bell", content: "The bell rings." }]],
      ["b", []],
    ]);
    const prompt = (agent: string) => ["System prompt:", "", "```text", `You are agent "${agent}", in a world of slots.`, "```", ""];
    expect(listed).toContain(
      [...prompt("a"), 'First stimulus on the channel "bell", from town bell:', "", "```text", "The bell rings.", "```", "", '#### Agent "b"'].join("\n"),
    );
    expect(listed).toContain([...prompt("b"), "### Tools"].join("\n"));
  });

  it("lists the text of each outcome an effector's sight follows as followed by what it sees, and its other texts as they are", () => {
    const [look, take] = slotsScenario.tools;
    const texts = { success: "You took the slot.", slot_taken: "Someone holds that slot." };
    const sight = { outcomes: ["success"], of: "the slots held", see: () => ({ text: "", seen: "" }) };
    const scenario = slotsWith({ tools: [look, { ...take, texts, sight } as typeof take] });

    const [condition] = inventory(experimentOf(["[conditions.baseline]"]), scenario).conditions;

    expect(condition.tools[1].texts).toEqual({ success: "You took the slot. (followed by the slots held)", slot_taken: "Someone holds that slot." });
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

  it("gives the experiment's models, thinking level and limits in each condition", () => {
    const listed = printed(experimentOf(["[conditions.baseline]"]), slotsWith());

    expect(listed).toContain(
      [
        "### Model and limits",
        "",
        "- Models: scripted/one",
        "- Thinking level: off",
        "- Activations per agent: 3",
        "- Time limit: 1000 ms",
        "- Parallelism limit: 2",
        "- Model turn timeout: 500 ms",
        "",
      ].join("\n"),
    );
  });

  it("gives the experiment's compaction in each condition and, with it on, the instructions Pi gives the model to write a summary", () => {
    const experiment = { ...experimentOf(["[conditions.baseline]", "[conditions.crowded]", "slots.count = 5"]), compaction: { enabled: true, triggerAt: 0.5, keepRecentTokens: 500 } as const };

    const { conditions } = inventory(experiment, slotsWith());
    const listed = inventoryMarkdown({ experiment: "e-test", scenario: "slots", conditions });

    for (const condition of conditions) expect(condition.compaction).toEqual({ enabled: true, triggerAt: 0.5, keepRecentTokens: 500, instructions: summaryInstructions });
    const crowded = listed.slice(listed.indexOf('## Condition "crowded"'));
    expect(crowded).toContain(["### Compaction", "", "- Compaction: enabled, with trigger_at 0.5 and keep_recent_tokens 500", ""].join("\n"));
    for (const [heading, text] of [
      ["The system prompt for writing a summary:", summaryInstructions.systemPrompt],
      ["The instructions for a first summary, after the conversation it summarizes:", summaryInstructions.first],
      ["The instructions for updating the previous summary, after the new conversation and that summary:", summaryInstructions.update],
      ["The instructions for the start of a turn the compaction cuts through, after that start:", summaryInstructions.splitTurn],
    ]) {
      expect(crowded).toContain(`${heading}\n\n\`\`\`text\n${text}\n\`\`\`\n`);
    }
  });

  it("gives compaction off, with no instructions, when the experiment turns it off", () => {
    const { conditions } = inventory(experimentOf(["[conditions.baseline]"]), slotsWith());

    expect(conditions[0].compaction).toEqual({ enabled: false });
    expect(inventoryMarkdown({ experiment: "e-test", scenario: "slots", conditions })).toContain(["### Compaction", "", "- Compaction: off", ""].join("\n"));
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

  it("lists the situations the scenario says each condition chooses, by id only, when the scenario has situations", () => {
    const scenario = slotsWith({ situations: (configuration) => (configuration.slots as { count: number }).count === 5 ? ["flood", "fire"] : [] });
    const experiment = experimentOf(["[conditions.baseline]", "[conditions.crowded]", "slots.count = 5"]);

    expect(inventory(experiment, scenario).conditions.map(({ situations }) => situations)).toEqual([[], ["flood", "fire"]]);
    const markdown = printed(experiment, scenario);
    expect(markdown).toContain("### Situations\n\n- flood\n- fire\n");
    expect(markdown).toContain("### Situations\n\nnone\n");
  });

  it("has no situations for a scenario without them", () => {
    const experiment = experimentOf(["[conditions.baseline]"]);

    expect(inventory(experiment, slotsWith()).conditions[0]).not.toHaveProperty("situations");
    expect(printed(experiment, slotsWith())).not.toContain("Situations");
  });

  it("lists each component each condition declares, with its kind and the description of its cycle, when the scenario has components", () => {
    const porter = filler("porter", { slot: 2, thing: "crate", waitMs: () => 100, actionMs: 400 });
    const storm = filler("storm", { slot: 3, thing: "leaves", waitMs: () => 500, actionMs: 0, kind: "perturbation" });
    const scenario = slotsWith({ components: (configuration) => ((configuration.slots as { count: number }).count === 5 ? [porter, storm] : []) });
    const experiment = experimentOf(["[conditions.baseline]", "[conditions.stormy]", "slots.count = 5"]);

    expect(inventory(experiment, scenario).conditions.map(({ components }) => components)).toEqual([
      [],
      [
        { name: "porter", kind: "world", cycle: porter.description },
        { name: "storm", kind: "perturbation", cycle: storm.description },
      ],
    ]);
    const markdown = printed(experiment, scenario);
    expect(markdown).toContain(
      `### Components\n\n#### Component "porter"\n\n- Kind: part of the world\n- Cycle: ${porter.description}\n\n#### Component "storm"\n\n- Kind: external perturbation\n- Cycle: ${storm.description}\n`,
    );
    expect(markdown).toContain("### Components\n\nnone\n");
  });

  it("has no components for a scenario without them", () => {
    const experiment = experimentOf(["[conditions.baseline]"]);

    expect(inventory(experiment, slotsWith()).conditions[0]).not.toHaveProperty("components");
    expect(printed(experiment, slotsWith())).not.toContain("Components");
  });

  it("gives the clock's start time and time scale each condition sets, when the scenario has a clock", () => {
    const scenario = slotsWith({ clock: (configuration) => ({ start: "08:30", timeScale: (configuration.slots as { count: number }).count === 5 ? 60 : 1 }) });
    const experiment = experimentOf(["[conditions.baseline]", "[conditions.fast]", "slots.count = 5"]);

    expect(inventory(experiment, scenario).conditions.map(({ clock }) => clock)).toEqual([
      { start: "08:30", timeScale: 1 },
      { start: "08:30", timeScale: 60 },
    ]);
    const markdown = printed(experiment, scenario);
    expect(markdown).toContain("### Clock\n\n- Start: 08:30\n- Time scale: 60 world seconds for each second of the run\n");
    expect(markdown).toContain("### Clock\n\n- Start: 08:30\n- Time scale: 1 world seconds for each second of the run\n");
  });

  it("has no clock for a scenario without one", () => {
    const experiment = experimentOf(["[conditions.baseline]"]);

    expect(inventory(experiment, slotsWith()).conditions[0]).not.toHaveProperty("clock");
    expect(printed(experiment, slotsWith())).not.toContain("Clock");
  });

  it("fences a system prompt that holds a fence with a longer one, so the prompt is given whole", () => {
    const experiment = experimentOf(["[conditions.baseline]"]);
    const scenario = slotsWith({ systemPrompt: () => "Answer like this:\n```\ndone\n```" });

    expect(printed(experiment, scenario)).toContain("System prompt:\n\n````text\nAnswer like this:\n```\ndone\n```\n````\n");
  });
});
