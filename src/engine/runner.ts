import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { AgentModel } from "./adapter.ts";
import { codeVersion } from "./code-version.ts";
import { type Experiment, replicaSeed } from "./experiment.ts";
import { failure } from "./failure.ts";
import { inventory } from "./inventory.ts";
import { JsonlFile } from "./jsonl.ts";
import type { LogLine } from "./recorder.ts";
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

/** A run of an experiment as it starts: its number, from 1, out of the experiment's runs, what it runs, and its activation budget. */
export interface StartingRun {
  number: number;
  total: number;
  condition: string;
  model: string;
  /** The replica, from 1. */
  replica: number;
  seed: number;
  /** The activations of all its agents. */
  activations: number;
}

/** Who follows an experiment as it runs (FR-RUN-04): each run's start, each line its log records, and how it ends. */
export interface ExperimentObserver {
  runStarted(run: StartingRun): void;
  recorded(line: LogLine): void;
  runEnded(status: IndexLine["status"]): void;
}

/**
 * Runs an experiment: each condition with each of its models, given by name in the experiment's order, for each
 * replica, one run after another. Every agent of a run works with that run's model. Each run writes its log into the
 * runs directory, and the directory's index gets a line for each run as it ends. A run that stops on an error stops
 * the experiment there. An observer, when given, is told when each run starts, each line its log records, and how it
 * ends. An interruption, when given, stops the run in progress as an error would, and no run starts after it (FR-RUN-05).
 */
export async function runExperiment<State>(
  experiment: Experiment,
  scenario: Partial<Scenario<State>>,
  models: ReadonlyMap<string, AgentModel>,
  runsDirectory: string,
  observer?: ExperimentObserver,
  interruption?: AbortSignal,
): Promise<void> {
  // Each condition is loaded once before the first run, so one the scenario refuses fails before any model call.
  for (const condition of experiment.conditions) loadScenario(scenario, experiment.seed, condition);
  // Pi would lower a level a model cannot use without saying so; the run would then use another model than declared.
  for (const [name, { model }] of models) {
    const usable = getSupportedThinkingLevels(model);
    if (!usable.includes(experiment.thinkingLevel)) {
      throw new Error(`The model "${name}" cannot use the thinking level "${experiment.thinkingLevel}"; it can use: ${usable.join(", ")}`);
    }
  }
  // What every run's log gives first, read before any run, so a scenario the inventory refuses, or code whose version
  // cannot be read, fails before any model call.
  const inventories = inventory(experiment, scenario).conditions;
  const code = codeVersion();
  mkdirSync(runsDirectory, { recursive: true });
  const index = JsonlFile.create(join(runsDirectory, "index.jsonl"));
  const total = experiment.conditions.length * models.size * experiment.replicas;
  let number = 0;
  try {
    for (const [at, condition] of experiment.conditions.entries()) {
      for (const [modelName, model] of models) {
        for (let replica = 1; replica <= experiment.replicas; replica += 1) {
          const seed = replicaSeed(experiment.seed, replica);
          const loaded = loadScenario(scenario, seed, condition);
          const agents = [...loaded.systemPrompts.keys()].map((name) => ({ name, model, activations: experiment.limits.activationsPerAgent }));
          // Chosen here, so the index can list a run that stops as well as one that completes.
          const runId = randomUUID();
          const listed = { runId, condition: condition.name, model: modelName, replica, seed };
          number += 1;
          if (interruption?.aborted) throw new Error(`the experiment was interrupted before run ${number} of ${total} started`);
          const activations = agents.reduce((sum, agent) => sum + agent.activations, 0);
          observer?.runStarted({ number, total, condition: condition.name, model: modelName, replica, seed, activations });
          try {
            await run(loaded, agents, seed, {
              logDirectory: runsDirectory,
              runId,
              setup: {
                experiment: experiment.id,
                condition: condition.name,
                configuration: loaded.configuration,
                replica,
                seed,
                model: modelName,
                code,
                inventory: inventories[at],
                materials: loaded.materials,
              },
              modelTurnTimeoutMs: experiment.limits.modelTurnTimeoutMs,
              thinkingLevel: experiment.thinkingLevel,
              parallelismLimit: experiment.limits.parallelismLimit,
              timeLimitMs: experiment.limits.timeLimitMs,
              metricIntervalMs: experiment.metricIntervalMs,
              onRecord: observer === undefined ? undefined : (line) => observer.recorded(line),
              interruption,
            });
          } catch (error) {
            index.write({ ...listed, status: "stopped" } satisfies IndexLine);
            observer?.runEnded("stopped");
            throw failure(`the run of condition "${condition.name}", model "${modelName}", replica ${replica} stopped`, error);
          }
          index.write({ ...listed, status: "completed" } satisfies IndexLine);
          observer?.runEnded("completed");
        }
      }
    }
  } finally {
    index.close();
  }
}
