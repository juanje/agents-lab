import { randomUUID } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { ModelTurn, ToolCall } from "./adapter.ts";
import type { Stimulus } from "./stimuli.ts";

/** A line of a run's log: one event of the run. Every time in it is by performance.now(). */
export type LogLine =
  | { type: "activation"; agent: string; wokeAtMs: number; endedAtMs: number }
  | ({ type: "stimulus"; agent: string; deliveredAtMs: number } & Stimulus)
  | ({ type: "model_turn" } & ModelTurn)
  | ({ type: "tool_call" } & ToolCall)
  | { type: "run_stopped"; error: string };

/** Writes a run's log: one new JSONL file, named with the run's id, with a line for each event (FR-RECORD-01). */
export class Recorder {
  readonly runId: string;
  readonly #file: number;
  #stopped = false;

  private constructor(runId: string, file: number) {
    this.runId = runId;
    this.#file = file;
  }

  /**
   * Opens a new log for a run, in the directory, under an id of its own unless one is given. It refuses a file that is
   * already there: a run never writes to an existing file.
   */
  static open(directory: string, runId: string = randomUUID()): Recorder {
    const path = join(directory, `${runId}.jsonl`);
    try {
      return new Recorder(runId, openSync(path, "wx"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw new Error(`A run never writes to an existing file, and ${path} is already there`, { cause: error });
    }
  }

  /**
   * Writes one line at once, synchronously: a line kept in a buffer would be lost if the process stopped, and the log
   * is all an experiment is read from.
   */
  record(line: LogLine): void {
    if (!this.#stopped) writeSync(this.#file, `${JSON.stringify(line)}\n`);
  }

  /**
   * Ends the log of a run that stopped on an error with a line that says so and gives the error; nothing is written
   * after it, so a stopped run's log never reads as a run that simply ended. Only the first error is the run's.
   */
  stop(error: Error): void {
    this.record({ type: "run_stopped", error: error.message });
    this.#stopped = true;
  }

  close(): void {
    closeSync(this.#file);
  }
}
