import type { Material } from "./materials.ts";
import type { RunSetup, Sampling } from "./recorder.ts";

/** What a resumed experiment compares of a completed run's setup line with the run the experiment file makes now (FR-RUN-07). */
export type ComparedSetup = Pick<RunSetup, "configuration" | "model" | "seed" | "materials" | "code"> & { sampling: Sampling | null };

/**
 * Each way the setup a completed run recorded differs from the one the experiment file makes now, naming what differs,
 * what it was and what it is now: a value of the resolved configuration by its dotted path, the model, the seed, the
 * sampling, a material's path or hash, or the code's commit. Changes not committed are not compared: the commit is
 * what a run can be reproduced from.
 */
export function setupDifferences(recorded: ComparedSetup, now: ComparedSetup): string[] {
  const differences = configurationDifferences(recorded.configuration, now.configuration, []);
  const compare = (what: string, was: unknown, is: unknown) => {
    if (JSON.stringify(was) !== JSON.stringify(is)) differences.push(`${what} was ${JSON.stringify(was)} and is now ${JSON.stringify(is)}`);
  };
  compare("the model", recorded.model, now.model);
  compare("the seed", recorded.seed, now.seed);
  compare("the sampling", recorded.sampling, now.sampling);
  const byKey = (materials: readonly Material[]) => new Map(materials.map(({ key, path, hash }) => [key, { path, hash }]));
  const [materialsWere, materialsAre] = [byKey(recorded.materials), byKey(now.materials)];
  for (const key of new Set([...materialsWere.keys(), ...materialsAre.keys()])) {
    compare(`the material for "${key}"`, materialsWere.get(key) ?? null, materialsAre.get(key) ?? null);
  }
  compare("the code's commit", recorded.code.commit, now.code.commit);
  return differences;
}

/** A table of a configuration: a value that is an object, not a list. */
const isTable = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Each value of two configurations that differs, by its dotted path from the tables' path; a list is one value. */
function configurationDifferences(was: unknown, is: unknown, path: readonly string[]): string[] {
  if (isTable(was) && isTable(is)) {
    return [...new Set([...Object.keys(was), ...Object.keys(is)])].flatMap((key) => configurationDifferences(was[key], is[key], [...path, key]));
  }
  if (JSON.stringify(was) === JSON.stringify(is)) return [];
  const value = (given: unknown) => (given === undefined ? "not set" : JSON.stringify(given));
  return [`the configuration's "${path.join(".")}" was ${value(was)} and is now ${value(is)}`];
}
