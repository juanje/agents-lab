import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IndexLine } from "../engine/runner.ts";

/** The lines of a JSONL file, parsed. */
export function linesOf<Line>(path: string): Line[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Line);
}

/** The lines of a runs directory's index, in its order; a directory without one is refused, naming it as given. */
export function indexOf(directory: string, name: string = directory): IndexLine[] {
  const path = join(directory, "index.jsonl");
  if (!existsSync(path)) throw new Error(`"${name}" has no index (index.jsonl): it is not the runs directory of an experiment`);
  return linesOf<IndexLine>(path);
}
