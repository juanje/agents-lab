import { describe, expect, it } from "vitest";
import { Progress } from "../src/cli/progress.ts";
import type { LogLine } from "../src/engine/recorder.ts";

/** An activation line of a run's log. */
const activation: LogLine = { type: "activation", agent: "a", wokeAtMs: 0, endedAtMs: 1 };

/** A model turn line of a run's log that cost this many dollars. */
function turnCosting(total: number): LogLine {
  return {
    type: "model_turn",
    agent: "a",
    outcome: "success",
    text: "Nothing to do.",
    model: "scripted/one",
    slotWaitMs: 0,
    latencyMs: 1,
    startedAtMs: 0,
    endedAtMs: 1,
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
  };
}

/** A run of a two-run experiment, as it starts. */
const starting = (number: number) => ({ number, total: 2, condition: "baseline", model: "scripted/one", replica: number, seed: 10 + number, activations: 2 });

describe("Progress", () => {
  it("prints when each run starts and ends, read from what its log records, and when the experiment ends, with its totals", () => {
    const printed: string[] = [];
    let nowMs = 0;
    const progress = new Progress((text) => printed.push(text), { intervalMs: 30_000, now: () => nowMs });

    progress.runStarted(starting(1));
    progress.recorded(activation);
    progress.recorded(turnCosting(0.0012));
    progress.recorded(activation);
    nowMs = 1_500;
    progress.runEnded("completed");
    progress.runStarted(starting(2));
    progress.recorded(turnCosting(0.0002));
    progress.recorded(turnCosting(0.0001));
    nowMs = 4_000;
    progress.runEnded("completed");
    progress.experimentEnded();

    expect(printed).toEqual([
      'Run 1 of 2 started: condition "baseline", model "scripted/one", replica 1, seed 11\n',
      "Run 1 of 2 completed in 1.5 s: 2 activations, 1 model turn, cost $0.0012\n",
      'Run 2 of 2 started: condition "baseline", model "scripted/one", replica 2, seed 12\n',
      "Run 2 of 2 completed in 2.5 s: 0 activations, 2 model turns, cost $0.0003\n",
      "2 runs completed in 4.0 s, cost $0.0015\n",
    ]);
  });
});
