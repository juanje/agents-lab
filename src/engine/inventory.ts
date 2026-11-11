import type { Experiment } from "./experiment.ts";
import { type LoadedScenario, type Scenario, loadScenario } from "./scenario.ts";

/**
 * The environment inventory of an experiment, in Markdown: for each of its conditions, everything its agents meet in
 * its scenario as that condition configures it (FR-INVENTORY-01). It runs nothing and calls no model.
 */
export function inventory<State>(experiment: Experiment, scenario: Partial<Scenario<State>>): string {
  const sections = experiment.conditions.map((condition) => {
    const loaded = loadScenario(scenario, experiment.seed, condition);
    return [`## Condition "${condition.name}"\n`, agentsOf(loaded)].join("\n");
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

/** A text as a fenced block, with a fence longer than any run of backticks in it, so the text is given whole. */
function fenced(text: string, language: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}\n`;
}
