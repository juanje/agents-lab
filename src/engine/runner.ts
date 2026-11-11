import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { AgentModel } from "./adapter.ts";
import { type Experiment, replicaSeed } from "./experiment.ts";
import { run } from "./run.ts";
import { type Scenario, loadScenario } from "./scenario.ts";

/** A line of an experiment's index: one run, with what it ran and whether it completed or stopped. */
export interface IndexLine {
  runId: string;
  condition: string;
  model: string;
  /** The replica, from 1. */
  replica: number;
  seed: number;
  status: "completed" | "stopped";
}

/**
 * Runs an experiment: each condition with each of its models, given by name in the experiment's order, for each
 * replica, one run after another. Every agent of a run works with that run's model. Each run writes its log into the
 * runs directory, and the directory's index gets a line for each run as it ends.
 */
export async function runExperiment<State>(
  experiment: Experiment,
  scenario: Partial<Scenario<State>>,
  models: ReadonlyMap<string, AgentModel>,
  runsDirectory: string,
): Promise<void> {
  // Each condition is loaded once before the first run, so one the scenario refuses fails before any model call.
  for (const condition of experiment.conditions) loadScenario(scenario, experiment.seed, condition);
  mkdirSync(runsDirectory, { recursive: true });
  // Created exclusively, as a run's log is: an experiment never writes to an existing file.
  const index = openSync(join(runsDirectory, "index.jsonl"), "wx");
  try {
    for (const condition of experiment.conditions) {
      for (const [modelName, model] of models) {
        for (let replica = 1; replica <= experiment.replicas; replica += 1) {
          const seed = replicaSeed(experiment.seed, replica);
          const loaded = loadScenario(scenario, seed, condition);
          const agents = [...loaded.systemPrompts.keys()].map((name) => ({ name, model, activations: experiment.limits.activationsPerAgent }));
          const { runId } = await run(loaded, agents, seed, {
            logDirectory: runsDirectory,
            modelTurnTimeoutMs: experiment.limits.modelTurnTimeoutMs,
            parallelismLimit: experiment.limits.parallelismLimit,
            timeLimitMs: experiment.limits.timeLimitMs,
          });
          const line: IndexLine = { runId, condition: condition.name, model: modelName, replica, seed, status: "completed" };
          // Written at once, as a log line is: the index is how an experiment's runs are found.
          writeSync(index, `${JSON.stringify(line)}\n`);
        }
      }
    }
  } finally {
    closeSync(index);
  }
}
