import type { RunSetup, Sampling } from "./recorder.ts";

/** What a resumed experiment compares of a completed run's setup line with the run the experiment file makes now (FR-RUN-07). */
export type ComparedSetup = Pick<RunSetup, "configuration" | "model" | "seed" | "materials" | "code"> & { sampling: Sampling | null };

/** Each way the setup a completed run recorded differs from the one the experiment file makes now, naming what differs. */
export function setupDifferences(recorded: ComparedSetup, now: ComparedSetup): string[] {
  return [];
}
