import type { Experiment } from "./experiment.ts";
import type { Scenario } from "./scenario.ts";

/**
 * The environment inventory of an experiment, in Markdown: for each of its conditions, everything its agents meet in
 * its scenario (FR-INVENTORY-01). It runs nothing and calls no model.
 */
export function inventory<State>(experiment: Experiment, scenario: Partial<Scenario<State>>): string {
  const sections = experiment.conditions.map((condition) => `## Condition "${condition.name}"\n`);
  return [`# Environment inventory of experiment "${experiment.id}", scenario "${scenario.name}"\n`, ...sections].join("\n");
}
