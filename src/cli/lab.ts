import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentModel } from "../engine/adapter.ts";
import { readExperiment } from "../engine/experiment.ts";
import { runExperiment } from "../engine/runner.ts";
import type { LibraryScenario } from "../scenarios/library.ts";

/** What the `lab` command works with: the directory it runs in, the scenario library, and the models by name. */
export interface LabEnvironment {
  /** The current directory, under which an experiment's runs are written. */
  directory: string;
  /** Each scenario of the library, by its name. */
  scenarios: ReadonlyMap<string, LibraryScenario>;
  /** The model a name in Pi's provider/id form names; it fails, naming it, for a name it does not know. */
  model: (name: string) => Promise<AgentModel>;
}

/** The `lab` command, with its arguments: `lab run <experiment.toml>`. */
export async function lab([, path]: readonly string[], environment: LabEnvironment): Promise<void> {
  const experiment = readExperiment(readFileSync(path, "utf8"));
  const scenario = environment.scenarios.get(experiment.scenario);
  if (scenario === undefined) throw new Error(`The scenario library has no scenario "${experiment.scenario}"`);
  const models = new Map<string, AgentModel>();
  for (const name of experiment.models) models.set(name, await environment.model(name));
  await runExperiment(experiment, scenario, models, join(environment.directory, "runs", experiment.id));
}
