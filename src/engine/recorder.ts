import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ModelTurn, ToolCall } from "./adapter.ts";
import { JsonlFile } from "./jsonl.ts";
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
  readonly #file: JsonlFile;
  #stopped = false;

  private constructor(runId: string, file: JsonlFile) {
    this.runId = runId;
    this.#file = file;
  }

  /**
   * Opens a new log for a run, in the directory, under an id of its own unless one is given. It refuses a file that is
   * already there: a run never writes to an existing file.
   */
  static open(directory: string, runId: string = randomUUID()): Recorder {
    return new Recorder(runId, JsonlFile.create(join(directory, `${runId}.jsonl`)));
  }

  /** Writes one line at once. */
  record(line: LogLine): void {
    if (!this.#stopped) this.#file.write(line);
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
    this.#file.close();
  }
}
