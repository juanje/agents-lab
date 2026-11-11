import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { judgeRuns } from "../analysis/judge.ts";
import { summarizeRuns, summaryMarkdown } from "../analysis/replicas.ts";
import type { AgentModel } from "../engine/adapter.ts";
import { type Experiment, readExperiment } from "../engine/experiment.ts";
import { inventory, inventoryMarkdown } from "../engine/inventory.ts";
import { runExperiment } from "../engine/runner.ts";
import type { LibraryScenario } from "../scenarios/library.ts";
import { Progress } from "./progress.ts";

/**
 * What the `lab` command works with: the directory it runs in, the scenario library, the models by name, and where it
 * prints what it lists.
 */
export interface LabEnvironment {
  /** The current directory, under which an experiment's runs are written, and against which a runs directory to summarize is found. */
  directory: string;
  /** Prints a text the command gives, as it gives it. */
  print: (text: string) => void;
  /** Each scenario of the library, by its name. */
  scenarios: ReadonlyMap<string, LibraryScenario>;
  /** The model a name in Pi's provider/id form names; it fails, naming it, for a name it does not know. */
  model: (name: string) => Promise<AgentModel>;
  /** Aborts when the command is interrupted (Ctrl-C, or a termination signal): `lab run` then ends the run in progress as a stopped one (FR-RUN-05). */
  interruption?: AbortSignal;
}

/** How often `lab run` prints a run's progress, unless it is given another interval (FR-RUN-04). */
const PROGRESS_INTERVAL_MS = 30_000;

/** How the command is used, as an error for other arguments says. */
const USAGE = "Usage: lab run <experiment.toml> [--progress-interval-ms <ms>], lab inventory <experiment.toml>, lab summarize <runs-dir> [--json] or lab judge <runs-dir> <judge.toml>";

/**
 * The `lab` command, with its arguments: `lab run <experiment.toml>` runs the experiment, printing each run's progress
 * every `--progress-interval-ms`, 30 seconds unless given; `lab inventory <experiment.toml>` prints its environment
 * inventory, without running it or resolving any model; `lab summarize <runs-dir>` prints the summary of an
 * experiment's runs as Markdown, or as JSON with `--json`, from the directory's index and logs alone (FR-RUN-02);
 * `lab judge <runs-dir> <judge.toml>` judges what the agents of its completed runs wrote, with the judge file's model,
 * and prints where the verdicts are (FR-ANALYSIS-02).
 */
export async function lab(args: readonly string[], environment: LabEnvironment): Promise<void> {
  const command = parse(args);
  if (command.name === "judge") {
    const written = await judgeRuns(resolve(environment.directory, command.path), resolve(environment.directory, command.judgeFile), environment.scenarios, environment.model);
    environment.print(`The verdicts are in ${written}\n`);
    return;
  }
  if (command.name === "summarize") {
    const rows = summarizeRuns(resolve(environment.directory, command.path), command.path);
    environment.print(command.json ? `${JSON.stringify(rows, null, 2)}\n` : summaryMarkdown(rows));
    return;
  }
  const experiment = readExperiment(readFileSync(command.path, "utf8"), dirname(command.path));
  const scenario = environment.scenarios.get(experiment.scenario);
  if (scenario === undefined) throw new Error(`The scenario library has no scenario "${experiment.scenario}"`);
  if (command.name === "inventory") {
    environment.print(inventoryMarkdown(inventory(experiment, scenario)));
    return;
  }
  await run(experiment, scenario, environment, command.progressIntervalMs);
}

/** A command `lab` was given, with what it takes. */
type Command =
  | { name: "inventory"; path: string }
  | { name: "run"; path: string; progressIntervalMs: number }
  | { name: "summarize"; path: string; json: boolean }
  | { name: "judge"; path: string; judgeFile: string };

/** The command the arguments give; it refuses any other arguments, saying how the command is used. */
function parse(args: readonly string[]): Command {
  const [name, path, ...options] = args;
  if (path !== undefined && name === "inventory" && options.length === 0) return { name, path };
  if (path !== undefined && name === "judge" && options.length === 1) return { name, path, judgeFile: options[0] };
  if (path !== undefined && name === "summarize" && options.length <= 1 && options.every((option) => option === "--json")) {
    return { name, path, json: options.length === 1 };
  }
  if (path !== undefined && name === "run") {
    if (options.length === 0) return { name, path, progressIntervalMs: PROGRESS_INTERVAL_MS };
    const [option, value] = options;
    const ms = Number(value);
    if (options.length === 2 && option === "--progress-interval-ms" && Number.isInteger(ms) && ms > 0) return { name, path, progressIntervalMs: ms };
  }
  throw new Error(`lab was given ${JSON.stringify(args)}. ${USAGE}`);
}

/**
 * Runs an experiment with its scenario, each of its models resolved by name first, into runs/<id>/ under the directory,
 * printing each run's progress at the interval.
 */
async function run(experiment: Experiment, scenario: LibraryScenario, environment: LabEnvironment, progressIntervalMs: number): Promise<void> {
  const models = new Map<string, AgentModel>();
  for (const name of experiment.models) models.set(name, await environment.model(name));
  const progress = new Progress(environment.print, { intervalMs: progressIntervalMs });
  try {
    await runExperiment(experiment, scenario, models, join(environment.directory, "runs", experiment.id), progress, environment.interruption);
  } finally {
    // Also when a run stopped the experiment: its total says how far it got (FR-RUN-04).
    progress.experimentEnded();
  }
}
