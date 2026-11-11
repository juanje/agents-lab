// The `lab` command as a process, which bin.mjs starts: `lab run <experiment.toml>`, from the directory its runs go under,
// or `lab inventory <experiment.toml>`, which prints to standard output.
import { labModel } from "../engine/adapter.ts";
import { scenarioLibrary } from "../scenarios/library.ts";
import { lab } from "./lab.ts";

try {
  await lab(process.argv.slice(2), {
    directory: process.cwd(),
    print: (text) => process.stdout.write(text),
    scenarios: scenarioLibrary,
    model: labModel,
  });
} catch (error) {
  // The message says what failed and why; a stack would only bury it.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
