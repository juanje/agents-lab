import type { Experiment } from "./experiment.ts";
import { type LoadedScenario, type Scenario, loadScenario } from "./scenario.ts";
import type { Tool } from "./tools.ts";

/** What the agent receives for any outcome a tool declares no text for (FR-TOOL-02). */
const OTHER_OUTCOME = "- any other outcome: the outcome's name";

/**
 * The environment inventory of an experiment, in Markdown: for each of its conditions, everything its agents meet in
 * its scenario as that condition configures it (FR-INVENTORY-01). It runs nothing and calls no model.
 */
export function inventory<State>(experiment: Experiment, scenario: Partial<Scenario<State>>): string {
  const sections = experiment.conditions.map((condition) => {
    const loaded = loadScenario(scenario, experiment.seed, condition);
    return [`## Condition "${condition.name}"\n`, agentsOf(loaded), toolsOf(loaded), channelsOf(loaded), modelsAndLimitsOf(experiment)].join("\n");
  });
  return [`# Environment inventory of experiment "${experiment.id}", scenario "${scenario.name}"\n`, ...sections].join("\n");
}

/** Each agent of a loaded scenario, with its rhythm as the scenario describes it and its system prompt. */
function agentsOf<State>({ scenario, configuration, systemPrompts }: LoadedScenario<State>): string {
  const agents = [...systemPrompts].map(([agent, systemPrompt]) =>
    [`#### Agent "${agent}"\n`, `- Rhythm: ${scenario.describeRhythm(configuration, agent)}\n`, "System prompt:\n", fenced(systemPrompt, "text")].join("\n"),
  );
  return ["### Agents\n", ...agents].join("\n");
}

/** Each tool of a loaded scenario, as its agents see it, with its duration as the scenario describes it. */
function toolsOf<State>({ scenario, configuration }: LoadedScenario<State>): string {
  const tools = scenario.tools.map((tool) =>
    [
      `#### Tool "${tool.name}"\n`,
      `- Kind: ${tool.kind}`,
      `- Duration: ${scenario.describeDuration(configuration, tool.name)}\n`,
      "Description:\n",
      fenced(tool.description, "text"),
      "Parameters:\n",
      fenced(JSON.stringify(tool.parameters, null, 2), "json"),
      "Texts for each outcome:\n",
      ...textsOf(tool),
      OTHER_OUTCOME,
      "",
    ].join("\n"),
  );
  return ["### Tools\n", ...tools].join("\n");
}

/**
 * The text the agent receives for each outcome a tool gives it: a sensor's success gives what it senses; an effector's
 * outcomes give the texts it declares.
 */
function textsOf<State>(tool: Tool<State>): string[] {
  if (tool.kind === "sensor") return ["- success: the part of the world it senses"];
  return Object.entries(tool.texts ?? {}).map(([outcome, text]) => `- ${outcome}: ${text}`);
}

/** Each stimulus channel of a loaded scenario, with its source and what it delivers. */
function channelsOf<State>({ channels }: LoadedScenario<State>): string {
  const listed = channels.map((channel) =>
    [`#### Channel "${channel.name}"\n`, `- Source: ${channel.source}\n`, "Delivers:\n", fenced(channel.stimulus, "text")].join("\n"),
  );
  return ["### Stimulus channels\n", ...listed].join("\n");
}

/** The models an experiment's agents work with, and the limits its runs run under. */
function modelsAndLimitsOf({ models, limits }: Experiment): string {
  return [
    "### Model and limits\n",
    `- Models: ${models.join(", ")}`,
    `- Activations per agent: ${limits.activationsPerAgent}`,
    `- Time limit: ${limits.timeLimitMs} ms`,
    `- Parallelism limit: ${limits.parallelismLimit}`,
    `- Model turn timeout: ${limits.modelTurnTimeoutMs} ms`,
    "",
  ].join("\n");
}

/** A text as a fenced block, with a fence longer than any run of backticks in it, so the text is given whole. */
function fenced(text: string, language: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}\n`;
}
