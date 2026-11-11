import type { AgentModel } from "../engine/adapter.ts";
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

/** The `lab` command, with its arguments. */
export async function lab(_args: readonly string[], _environment: LabEnvironment): Promise<void> {}
