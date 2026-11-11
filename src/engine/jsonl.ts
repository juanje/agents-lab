import { closeSync, openSync, writeSync } from "node:fs";

/**
 * A new JSONL file, such as a run's log or an experiment's index: created exclusively, so nothing here ever writes to
 * an existing file, and with each line written at once, synchronously, since a line kept in a buffer would be lost if
 * the process stopped, and these files are all an experiment is read from.
 */
export class JsonlFile {
  readonly #file: number;

  private constructor(file: number) {
    this.#file = file;
  }

  /** Creates the file at the path; it refuses a file that is already there. */
  static create(path: string): JsonlFile {
    try {
      return new JsonlFile(openSync(path, "wx"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw new Error(`The lab never writes to an existing file, and ${path} is already there`, { cause: error });
    }
  }

  /** Writes a value as one line, at once. */
  write(value: unknown): void {
    writeSync(this.#file, `${JSON.stringify(value)}\n`);
  }

  close(): void {
    closeSync(this.#file);
  }
}
