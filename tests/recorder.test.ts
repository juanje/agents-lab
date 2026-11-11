import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Recorder } from "../src/engine/recorder.ts";

/** A new, empty directory for a test's logs. */
const logDirectory = () => mkdtempSync(join(tmpdir(), "agents-lab-logs-"));

describe("Recorder", () => {
  it("writes each line it records as one JSON object in a new file named with the run's id", () => {
    const directory = logDirectory();
    const recorder = Recorder.open(directory);

    recorder.record({ type: "activation", agent: "a", wokeAtMs: 1, endedAtMs: 2 });
    recorder.record({ type: "activation", agent: "b", wokeAtMs: 3, endedAtMs: 4 });
    recorder.close();

    expect(readdirSync(directory)).toEqual([`${recorder.runId}.jsonl`]);
    expect(readFileSync(join(directory, `${recorder.runId}.jsonl`), "utf8")).toBe(
      '{"type":"activation","agent":"a","wokeAtMs":1,"endedAtMs":2}\n{"type":"activation","agent":"b","wokeAtMs":3,"endedAtMs":4}\n',
    );
  });

  it("gives each run an id of its own", () => {
    const directory = logDirectory();

    const first = Recorder.open(directory);
    const second = Recorder.open(directory);

    expect(first.runId).not.toBe(second.runId);
  });
});
