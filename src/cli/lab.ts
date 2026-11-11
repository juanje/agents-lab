import { readFileSync } from "node:fs";
import { join } from "node:path";
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
}

/** How often `lab run` prints a run's progress, unless it is given another interval (FR-RUN-04). */
const PROGRESS_INTERVAL_MS = 30_000;

/** How the command is used, as an error for other arguments says. */
const USAGE = "Usage: lab run <experiment.toml> or lab inventory <experiment.toml>";

/**
 * The `lab` command, with its arguments: `lab run <experiment.toml>` runs the experiment; `lab inventory
 * <experiment.toml>` prints its environment inventory, without running it or resolving any model.
 */
export async function lab(args: readonly string[], environment: LabEnvironment): Promise<void> {
  const [command, path, ...rest] = args;
  if ((command !== "run" && command !== "inventory") || path === undefined || rest.length > 0) {
    throw new Error(`lab was given ${JSON.stringify(args)}. ${USAGE}`);
  }
  const experiment = readExperiment(readFileSync(path, "utf8"));
  const scenario = environment.scenarios.get(experiment.scenario);
  if (scenario === undefined) throw new Error(`The scenario library has no scenario "${experiment.scenario}"`);
  if (command === "inventory") {
    environment.print(inventoryMarkdown(inventory(experiment, scenario)));
    return;
  }
  await run(experiment, scenario, environment);
}

/** Runs an experiment with its scenario, each of its models resolved by name first, into runs/<id>/ under the directory. */
async function run(experiment: Experiment, scenario: LibraryScenario, environment: LabEnvironment): Promise<void> {
  const models = new Map<string, AgentModel>();
  for (const name of experiment.models) models.set(name, await environment.model(name));
  const progress = new Progress(environment.print, { intervalMs: PROGRESS_INTERVAL_MS });
  await runExperiment(experiment, scenario, models, join(environment.directory, "runs", experiment.id), progress);
  progress.experimentEnded();
}
