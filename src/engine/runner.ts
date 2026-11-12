import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type AgentModel, assertThinkingLevel } from "./adapter.ts";
import { codeVersion } from "./code-version.ts";
import { type Experiment, replicaSeed } from "./experiment.ts";
import { failure } from "./failure.ts";
import { inventory } from "./inventory.ts";
import { JsonlFile } from "./jsonl.ts";
import { hidingHeldOut } from "./materials.ts";
import type { LogLine } from "./recorder.ts";
import { run } from "./run.ts";
import { type Condition, type Scenario, loadScenario } from "./scenario.ts";

/** A line of an experiment's index: one run, with what it ran and whether it completed or stopped. */
export interface IndexLine {
  runId: string;
  condition: string;
  model: string;
  /** The replica, from 1. */
  replica: number;
  seed: number;
  /** The level of each factor, by the factor's name, when the condition is a combination of levels; otherwise none (FR-EXPERIMENT-02). */
  levels?: Readonly<Record<string, string>>;
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

/**
 * Who follows an experiment as it runs (FR-RUN-04): each run's start, each line its log records, and how it ends, each
 * by the run's number, since several runs can be in progress at once (FR-RUN-06).
 */
export interface ExperimentObserver {
  runStarted(run: StartingRun): void;
  recorded(number: number, line: LogLine): void;
  runEnded(number: number, status: IndexLine["status"]): void;
}

/** A run of an experiment, before it starts: what it runs and where it is listed. */
interface PlannedRun {
  number: number;
  condition: Condition;
  /** Where the condition is in the experiment, which gives its inventory. */
  at: number;
  modelName: string;
  model: AgentModel;
  replica: number;
  seed: number;
}

/**
 * Runs an experiment: each condition with each of its models, given by name in the experiment's order, for each
 * replica. Runs start in that order, and each next one as soon as one ends, so no more than the experiment's
 * `parallelRuns` are in progress at once (FR-RUN-06). Every agent of a run works with that run's model. Each run writes
 * its log into the runs directory, and the directory's index gets a line for each run as it ends. A run that stops on
 * an error stops the experiment: the runs in progress stop, saying the experiment stopped, and no run starts after it.
 * An observer, when given, is told when each run starts, each line its log records, and how it ends. An interruption,
 * when given, stops every run in progress as an error would, and no run starts after it (FR-RUN-05).
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
  for (const [name, { model }] of models) assertThinkingLevel(name, model, experiment.thinkingLevel);
  // What every run's log gives first, read before any run, so a scenario the inventory refuses, or code whose version
  // cannot be read, fails before any model call.
  const inventories = inventory(experiment, scenario).conditions;
  const code = codeVersion();
  mkdirSync(runsDirectory, { recursive: true });
  const index = JsonlFile.create(join(runsDirectory, "index.jsonl"));
  const planned = plannedRuns(experiment, models);
  // Aborts, with the reason each run in progress stops on, when the experiment stops: it is interrupted, or a run stops
  // on an error. Only the first reason is given.
  const runsEnd = new AbortController();
  const interrupt = () => runsEnd.abort(new Error("the run was interrupted"));
  interruption?.addEventListener("abort", interrupt, { once: true });
  // The error the experiment fails with: that of the first run to stop, or of an interruption before a run started.
  let stoppedOn: Error | undefined;
  const inProgress = new Set<Promise<void>>();

  /** Runs one planned run to its end, listing it in the index as it ends. */
  const runOne = async ({ number, condition, at, modelName, model, replica, seed }: PlannedRun): Promise<void> => {
    const loaded = loadScenario(scenario, seed, condition);
    const agents = [...loaded.systemPrompts.keys()].map((name) => ({ name, model, activations: experiment.limits.activationsPerAgent }));
    // Chosen here, so the index can list a run that stops as well as one that completes.
    const runId = randomUUID();
    const levels = condition.levels === undefined ? {} : { levels: condition.levels };
    const listed = { runId, condition: condition.name, model: modelName, replica, seed, ...levels };
    const activations = agents.reduce((sum, agent) => sum + agent.activations, 0);
    observer?.runStarted({ number, total: planned.length, condition: condition.name, model: modelName, replica, seed, activations });
    try {
      await run(loaded, agents, seed, {
        logDirectory: runsDirectory,
        runId,
        setup: {
          experiment: experiment.id,
          scenario: experiment.scenario,
          condition: condition.name,
          configuration: hidingHeldOut(loaded.configuration, loaded.materials),
          replica,
          seed,
          model: modelName,
          code,
          inventory: inventories[at],
          materials: loaded.materials,
          compaction: experiment.compaction,
          parallelRuns: experiment.parallelRuns,
          ...levels,
        },
        modelTurnTimeoutMs: experiment.limits.modelTurnTimeoutMs,
        rateLimit: experiment.rateLimit,
        thinkingLevel: experiment.thinkingLevel,
        compaction: experiment.compaction,
        parallelismLimit: experiment.limits.parallelismLimit,
        timeLimitMs: experiment.limits.timeLimitMs,
        metricIntervalMs: experiment.metricIntervalMs,
        onRecord: observer === undefined ? undefined : (line) => observer.recorded(number, line),
        interruption: runsEnd.signal,
      });
    } catch (error) {
      index.write({ ...listed, status: "stopped" } satisfies IndexLine);
      observer?.runEnded(number, "stopped");
      const what = `the run of condition "${condition.name}", model "${modelName}", replica ${replica} stopped`;
      if (stoppedOn === undefined) {
        stoppedOn = failure(what, error);
        runsEnd.abort(new Error(`the experiment stopped: ${what}`));
      }
      return;
    }
    index.write({ ...listed, status: "completed" } satisfies IndexLine);
    observer?.runEnded(number, "completed");
  };

  try {
    for (const next of planned) {
      while (inProgress.size >= experiment.parallelRuns) await Promise.race(inProgress);
      if (stoppedOn === undefined && interruption?.aborted) {
        stoppedOn = new Error(`the experiment was interrupted before run ${next.number} of ${planned.length} started`);
      }
      if (stoppedOn !== undefined) break;
      const running = runOne(next).finally(() => inProgress.delete(running));
      inProgress.add(running);
    }
    await Promise.all(inProgress);
  } finally {
    interruption?.removeEventListener("abort", interrupt);
    index.close();
  }
  if (stoppedOn !== undefined) throw stoppedOn;
}

/** The experiment's runs, in the order they start: by condition, then model, then replica, each numbered from 1. */
function plannedRuns(experiment: Experiment, models: ReadonlyMap<string, AgentModel>): PlannedRun[] {
  return experiment.conditions.flatMap((condition, at) =>
    [...models].flatMap(([modelName, model]) =>
      Array.from({ length: experiment.replicas }, (_, index) => ({ condition, at, modelName, model, replica: index + 1, seed: replicaSeed(experiment.seed, index + 1) })),
    ),
  ).map((run, at) => ({ ...run, number: at + 1 }));
}
