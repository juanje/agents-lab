// The `lab` command as a process, which bin.mjs starts: `lab run <experiment.toml>`, from the directory its runs go under,
// or `lab inventory <experiment.toml>`, which prints to standard output.
import { labModel } from "../engine/adapter.ts";
import { scenarioLibrary } from "../scenarios/library.ts";
import { lab } from "./lab.ts";

// Ctrl-C or a termination signal ends the run in progress as a stopped one (FR-RUN-05); with the listeners gone, a
// second one ends the process at once, as Node does by default.
const SIGNALS = ["SIGINT", "SIGTERM"] as const;
const interruption = new AbortController();
const interrupt = () => {
  for (const signal of SIGNALS) process.off(signal, interrupt);
  interruption.abort();
};
for (const signal of SIGNALS) process.on(signal, interrupt);

try {
  await lab(process.argv.slice(2), {
    directory: process.cwd(),
    print: (text) => process.stdout.write(text),
    scenarios: scenarioLibrary,
    model: labModel,
    interruption: interruption.signal,
  });
} catch (error) {
  // The message says what failed and why; a stack would only bury it.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
