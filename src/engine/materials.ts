import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TomlValue } from "smol-toml";
import { isTable } from "./scenario.ts";

/** A value a condition gives as a material (FR-EXPERIMENT-04): a file, by its path from the experiment file. */
export interface MaterialReference {
  path: string;
}

/** A material a condition set a value to, as a run's setup line lists it: its path and the hash of its content. */
export interface Material {
  path: string;
  /** The SHA-256 hash of the file's content, in hexadecimal, after "sha256:". */
  hash: string;
}

/**
 * The material a condition's value refers to, if it refers to one: a table whose only key is `file`, a text, as in
 * `{ file = "materials/character.md" }`.
 */
export function materialReference(value: TomlValue): MaterialReference | undefined {
  if (!isTable(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 1 || typeof value.file !== "string") return undefined;
  return { path: value.file };
}

/** A material's file, read: the material, with the hash of its content, and its text. */
interface Read {
  material: Material;
  text: string;
}

/**
 * The materials of an experiment, read from the directory its file is in. Each file is read once, when a condition
 * first sets a value to it, so every run of the experiment uses the text, and the hash, read before its first run.
 */
export class Materials {
  readonly #directory: string;
  readonly #read = new Map<string, Read>();

  constructor(directory: string) {
    this.#directory = directory;
  }

  /** A material's file, as it was first read. */
  read({ path }: MaterialReference): Read {
    const known = this.#read.get(path);
    if (known !== undefined) return known;
    const content = readFileSync(join(this.#directory, path));
    const read = { material: { path, hash: `sha256:${createHash("sha256").update(content).digest("hex")}` }, text: content.toString("utf8") };
    this.#read.set(path, read);
    return read;
  }
}
