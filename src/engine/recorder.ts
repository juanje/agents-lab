/** A line of a run's log: one event of the run. */
export type LogLine = { type: "activation"; agent: string; wokeAtMs: number; endedAtMs: number };

/** Writes a run's log: one new JSONL file, named with the run's id, with a line for each event (FR-RECORD-01). */
export class Recorder {
  readonly runId: string = "";

  static open(_directory: string): Recorder {
    return new Recorder();
  }

  record(_line: LogLine): void {}

  close(): void {}
}
