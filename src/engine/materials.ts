import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TomlValue } from "smol-toml";
import { type Configuration, isTable } from "./scenario.ts";

/**
 * A value a condition gives as a material (FR-EXPERIMENT-04): a file, by its path from the experiment file, and
 * whether it is held out, so its text reaches the scenario but never the inventory or a run's setup line.
 */
export interface MaterialReference {
  path: string;
  heldOut: boolean;
}

/**
 * A material a condition set a value to, as a run's setup line lists it: its path, the key it set, as a dotted path in
 * the configuration, the hash of its content, and whether it is held out.
 */
export interface Material {
  path: string;
  key: string;
  /** The SHA-256 hash of the file's content, in hexadecimal, after "sha256:". */
  hash: string;
  heldOut: boolean;
}

/**
 * The material a condition's value refers to, if it refers to one: a table whose keys are `file`, a text, and,
 * optionally, `held_out`, true or false, as in `{ file = "materials/character.md" }`.
 */
export function materialReference(value: TomlValue): MaterialReference | undefined {
  if (!isTable(value) || typeof value.file !== "string") return undefined;
  if (Object.keys(value).some((key) => key !== "file" && key !== "held_out")) return undefined;
  const heldOut = value.held_out ?? false;
  if (typeof heldOut !== "boolean") return undefined;
  return { path: value.file, heldOut };
}

/** A material's file, read: the hash of its content, and its text. */
interface Read {
  hash: string;
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

  /** Where a material's file is. */
  file({ path }: MaterialReference): string {
    return join(this.#directory, path);
  }

  /** A material's file, as it was first read, or undefined when it does not exist. */
  read(reference: MaterialReference): Read | undefined {
    const { path } = reference;
    const known = this.#read.get(path);
    if (known !== undefined) return known;
    let content: Buffer;
    try {
      content = readFileSync(this.file(reference));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const read = { hash: `sha256:${createHash("sha256").update(content).digest("hex")}`, text: content.toString("utf8") };
    this.#read.set(path, read);
    return read;
  }
}

/**
 * A configuration as a run's log may hold it: each key a held-out material set gives the material's reference, as the
 * experiment file gives it, in place of its text.
 */
export function hidingHeldOut(configuration: Configuration, materials: readonly Material[]): Configuration {
  let hidden = configuration;
  for (const { path, key, heldOut } of materials) {
    if (heldOut) hidden = settingAt(hidden, key.split("."), { file: path, held_out: true });
  }
  return hidden;
}

/** A copy of a table with a value at a path of keys, each but the last naming a table in it. */
export function settingAt(table: Configuration, [key, ...rest]: readonly string[], value: TomlValue): Configuration {
  return { ...table, [key]: rest.length === 0 ? value : settingAt(table[key] as Configuration, rest, value) };
}
