import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AgentModel, assertThinkingLevel } from "./adapter.ts";
import { codeVersion } from "./code-version.ts";
import { type Experiment, replicaSeed } from "./experiment.ts";
import { failure } from "./failure.ts";
import { inventory } from "./inventory.ts";
import { JsonlFile } from "./jsonl.ts";
import { hidingHeldOut } from "./materials.ts";
import type { LogLine, RunSetup } from "./recorder.ts";
import { type ComparedSetup, setupDifferences } from "./resume.ts";
import { PROVIDER_DEFAULTS, run } from "./run.ts";
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
  /** Told once, before the first run, when the experiment resumes: how many of its runs are already completed, and how many are left (FR-RUN-07). */
  resumed?(counts: { completed: number; left: number }): void;
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
 * replica, or replica by replica when several run at once. Each next one starts as soon as one ends, so no more than
 * the experiment's `parallelRuns` are in progress at once (FR-RUN-06). Every agent of a run works with that run's model. Each run writes
 * its log into the runs directory, and the directory's index gets a line for each run as it ends. A run that stops on
 * an error stops the experiment: the runs in progress stop, saying the experiment stopped, and no run starts after it.
 * An observer, when given, is told when each run starts, each line its log records, and how it ends. An interruption,
 * when given, stops every run in progress as an error would, and no run starts after it (FR-RUN-05). Resumed, it runs
 * only the runs its index does not list as completed, and adds their lines after those the index has (FR-RUN-07).
 */
export async function runExperiment<State>(
  experiment: Experiment,
  scenario: Partial<Scenario<State>>,
  models: ReadonlyMap<string, AgentModel>,
  runsDirectory: string,
  observer?: ExperimentObserver,
  interruption?: AbortSignal,
  { resume = false }: { resume?: boolean } = {},
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
  const indexPath = join(runsDirectory, "index.jsonl");
  const planned = plannedRuns(experiment, models);
  const completed = new Map((resume ? indexLines(indexPath) : []).filter((line) => line.status === "completed").map((line) => [runKey(line), line]));
  const keyOf = (next: PlannedRun) => runKey({ condition: next.condition.name, model: next.modelName, replica: next.replica });

  /** What a planned run loads, its agents, and the setup its log gives first. */
  const setUp = ({ condition, at, modelName, model, replica, seed }: PlannedRun) => {
    const loaded = loadScenario(scenario, seed, condition);
    const agents = [...loaded.systemPrompts.keys()].map((name) => ({ name, model, activations: experiment.limits.activationsPerAgent }));
    const levels = condition.levels === undefined ? {} : { levels: condition.levels };
    const setup: RunSetup = {
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
    };
    return { loaded, agents, levels, setup };
  };

  // A resumed experiment must be the same experiment: each completed run must have the setup the file makes now.
  for (const next of planned) {
    const done = completed.get(keyOf(next));
    if (done === undefined) continue;
    const { agents, setup } = setUp(next);
    const sampling = { thinkingLevels: Object.fromEntries(agents.map(({ name }) => [name, experiment.thinkingLevel])), otherParameters: PROVIDER_DEFAULTS };
    // Compared as the log holds it, as JSON gives it back.
    const now = JSON.parse(JSON.stringify({ ...setup, sampling })) as ComparedSetup;
    const differences = setupDifferences(recordedSetup(runsDirectory, done.runId), now);
    if (differences.length > 0) {
      const what = `condition "${done.condition}", model "${done.model}", replica ${done.replica}`;
      throw new Error(`--resume is refused: the completed run ${done.runId} of ${what} was made with another setup than the experiment file makes now: ${differences.join("; ")}`);
    }
  }
  const left = planned.filter((next) => !completed.has(keyOf(next)));
  const index = resume ? JsonlFile.append(indexPath) : JsonlFile.create(indexPath);
  if (resume) observer?.resumed?.({ completed: planned.length - left.length, left: left.length });
  // Aborts, with the reason each run in progress stops on, when the experiment stops: it is interrupted, or a run stops
  // on an error. Only the first reason is given.
  const runsEnd = new AbortController();
  const interrupt = () => runsEnd.abort(new Error("the run was interrupted"));
  interruption?.addEventListener("abort", interrupt, { once: true });
  // The error the experiment fails with: that of the first run to stop, or of an interruption before a run started.
  let stoppedOn: Error | undefined;
  const inProgress = new Set<Promise<void>>();

  /** Runs one planned run to its end, listing it in the index as it ends. */
  const runOne = async (next: PlannedRun): Promise<void> => {
    const { number, condition, modelName, replica, seed } = next;
    const { loaded, agents, levels, setup } = setUp(next);
    // Chosen here, so the index can list a run that stops as well as one that completes.
    const runId = randomUUID();
    const listed = { runId, condition: condition.name, model: modelName, replica, seed, ...levels };
    const activations = agents.reduce((sum, agent) => sum + agent.activations, 0);
    observer?.runStarted({ number, total: planned.length, condition: condition.name, model: modelName, replica, seed, activations });
    try {
      await run(loaded, agents, seed, {
        logDirectory: runsDirectory,
        runId,
        setup,
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
    for (const next of left) {
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

/** The lines of an experiment's index at the path, or none when there is no index yet. */
function indexLines(path: string): IndexLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as IndexLine);
}

/** The setup line a run's log in the runs directory gives first. */
function recordedSetup(runsDirectory: string, runId: string): ComparedSetup {
  const [first] = readFileSync(join(runsDirectory, `${runId}.jsonl`), "utf8").split("\n");
  const line = JSON.parse(first) as LogLine;
  if (line.type !== "run_setup") throw new Error(`The log of run ${runId} does not begin with its setup line, so --resume cannot check it`);
  return line;
}

/** What tells a run of an experiment from the others: its condition, model and replica. */
const runKey = ({ condition, model, replica }: Pick<IndexLine, "condition" | "model" | "replica">) => JSON.stringify([condition, model, replica]);

/**
 * The experiment's runs, in the order they start, each numbered from 1: one at a time, by condition, then model, then
 * replica; with `parallelRuns` above 1, replica by replica, so the runs in progress together are one replica of each
 * condition and model (FR-RUN-06).
 */
function plannedRuns(experiment: Experiment, models: ReadonlyMap<string, AgentModel>): PlannedRun[] {
  const replicas = Array.from({ length: experiment.replicas }, (_, index) => index + 1);
  const runs = experiment.conditions.flatMap((condition, at) =>
    [...models].flatMap(([modelName, model]) =>
      replicas.map((replica) => ({ condition, at, modelName, model, replica, seed: replicaSeed(experiment.seed, replica) })),
    ),
  );
  // A stable sort, so within a replica the runs keep the order of condition, then model.
  if (experiment.parallelRuns > 1) runs.sort((one, other) => one.replica - other.replica);
  return runs.map((run, at) => ({ ...run, number: at + 1 }));
}
