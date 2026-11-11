import { randomUUID } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { ModelTurn } from "./adapter.ts";
import type { Stimulus } from "./stimuli.ts";

/** A line of a run's log: one event of the run. Every time in it is by performance.now(). */
export type LogLine =
  | { type: "activation"; agent: string; wokeAtMs: number; endedAtMs: number }
  | ({ type: "stimulus"; agent: string; deliveredAtMs: number } & Stimulus)
  | ({ type: "model_turn" } & ModelTurn);

/** Writes a run's log: one new JSONL file, named with the run's id, with a line for each event (FR-RECORD-01). */
export class Recorder {
  readonly runId: string;
  readonly #file: number;

  private constructor(runId: string, file: number) {
    this.runId = runId;
    this.#file = file;
  }

  /** Opens a new log for a run, in the directory, under an id of its own. */
  static open(directory: string): Recorder {
    const runId = randomUUID();
    return new Recorder(runId, openSync(join(directory, `${runId}.jsonl`), "w"));
  }

  /**
   * Writes one line at once, synchronously: a line kept in a buffer would be lost if the process stopped, and the log
   * is all an experiment is read from.
   */
  record(line: LogLine): void {
    writeSync(this.#file, `${JSON.stringify(line)}\n`);
  }

  close(): void {
    closeSync(this.#file);
  }
}
