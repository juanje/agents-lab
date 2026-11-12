import { closeSync, openSync, writeSync } from "node:fs";

/**
 * A JSONL file, such as a run's log or an experiment's index, with each line written at once, synchronously, since a
 * line kept in a buffer would be lost if the process stopped, and these files are all an experiment is read from. A
 * run's log is always created exclusively, so a run never writes to an existing file; only a resumed experiment adds
 * lines to its index (FR-RUN-07).
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

  /** Opens the file at the path to add lines after those it has, creating it when it is not there. */
  static append(path: string): JsonlFile {
    return new JsonlFile(openSync(path, "a"));
  }

  /** Writes a value as one line, at once. */
  write(value: unknown): void {
    writeSync(this.#file, `${JSON.stringify(value)}\n`);
  }

  close(): void {
    closeSync(this.#file);
  }
}
