import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  /** The current directory, under which an experiment's runs are written. */
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
const USAGE = "Usage: lab run <experiment.toml> [--progress-interval-ms <ms>] or lab inventory <experiment.toml>";

/**
 * The `lab` command, with its arguments: `lab run <experiment.toml>` runs the experiment, printing each run's progress
 * every `--progress-interval-ms`, 30 seconds unless given; `lab inventory <experiment.toml>` prints its environment
 * inventory, without running it or resolving any model.
 */
export async function lab(args: readonly string[], environment: LabEnvironment): Promise<void> {
  const command = parse(args);
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
type Command = { name: "inventory"; path: string } | { name: "run"; path: string; progressIntervalMs: number };

/** The command the arguments give; it refuses any other arguments, saying how the command is used. */
function parse(args: readonly string[]): Command {
  const [name, path, ...options] = args;
  if (path !== undefined && name === "inventory" && options.length === 0) return { name, path };
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
