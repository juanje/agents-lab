import { describe, expect, it, vi } from "vitest";
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
    progress.recorded(1, activation);
    progress.recorded(1, turnCosting(0.0012));
    progress.recorded(1, activation);
    nowMs = 1_500;
    progress.runEnded(1, "completed");
    progress.runStarted(starting(2));
    progress.recorded(2, turnCosting(0.0002));
    progress.recorded(2, turnCosting(0.0001));
    nowMs = 4_000;
    progress.runEnded(2, "completed");
    progress.experimentEnded();

    expect(printed).toEqual([
      'Run 1 of 2 started: condition "baseline", model "scripted/one", replica 1, seed 11\n',
      "Run 1 of 2 completed in 1.5 s: 2 activations, 1 model turn, cost $0.0012\n",
      'Run 2 of 2 started: condition "baseline", model "scripted/one", replica 2, seed 12\n',
      "Run 2 of 2 completed in 2.5 s: 0 activations, 2 model turns, cost $0.0003\n",
      "2 runs completed and 0 stopped in 4.0 s, cost $0.0015\n",
    ]);
  });

  it("prints durations in seconds to a tenth under a minute, and in hours, minutes and whole seconds from a minute on", () => {
    const durations = [600, 59_940, 59_960, 75_000, 75_400, 1_800_000, 3_600_000, 3_725_000];
    const printed = durations.map((ms) => {
      let nowMs = 0;
      let text = "";
      const progress = new Progress((line) => (text += line), { intervalMs: 30_000, now: () => nowMs });
      progress.runStarted(starting(1));
      nowMs = ms;
      progress.runEnded(1, "completed");
      return text.split("completed in ")[1].split(":")[0];
    });

    expect(printed).toEqual(["0.6 s", "59.9 s", "1 min 0 s", "1 min 15 s", "1 min 15 s", "30 min 0 s", "1 h 0 min 0 s", "1 h 2 min 5 s"]);
  });

  it("counts, when the experiment ends, the runs that stopped apart from those that completed", () => {
    const printed: string[] = [];
    let nowMs = 0;
    const progress = new Progress((text) => printed.push(text), { intervalMs: 30_000, now: () => nowMs });

    progress.runStarted(starting(1));
    progress.recorded(1, turnCosting(0.0012));
    nowMs = 1_000;
    progress.runEnded(1, "completed");
    progress.runStarted(starting(2));
    progress.recorded(2, turnCosting(0.0002));
    nowMs = 1_500;
    progress.runEnded(2, "stopped");
    progress.experimentEnded();

    expect(printed.at(-1)).toBe("1 run completed and 1 stopped in 1.5 s, cost $0.0014\n");
  });

  it("prints, at its interval while a run goes, the time since it started, its activations out of its budget, its model turns and its cost so far, and nothing once it ends", () => {
    vi.useFakeTimers();
    try {
      const printed: string[] = [];
      const progress = new Progress((text) => printed.push(text), { intervalMs: 100, now: () => Date.now() });

      progress.runStarted(starting(1));
      vi.advanceTimersByTime(100);
      progress.recorded(1, activation);
      progress.recorded(1, turnCosting(0.0012));
      vi.advanceTimersByTime(100);
      progress.runEnded(1, "completed");
      vi.advanceTimersByTime(300);

      expect(printed.slice(1, -1)).toEqual([
        "Run 1 of 2 running: 0.1 s, 0 of 2 activations, 0 model turns, cost $0.0000\n",
        "Run 1 of 2 running: 0.2 s, 1 of 2 activations, 1 model turn, cost $0.0012\n",
      ]);
      expect(printed.at(-1)).toMatch(/^Run 1 of 2 completed/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives, in one progress line, each run in progress by its number, and counts each line its log records for its own run", () => {
    vi.useFakeTimers();
    try {
      const printed: string[] = [];
      const progress = new Progress((text) => printed.push(text), { intervalMs: 100, now: () => Date.now() });

      progress.runStarted(starting(1));
      progress.runStarted(starting(2));
      progress.recorded(2, activation);
      progress.recorded(1, turnCosting(0.0012));
      vi.advanceTimersByTime(100);
      progress.runEnded(1, "completed");
      vi.advanceTimersByTime(100);
      progress.recorded(2, turnCosting(0.0002));
      progress.runEnded(2, "stopped");
      vi.advanceTimersByTime(300);

      expect(printed).toEqual([
        'Run 1 of 2 started: condition "baseline", model "scripted/one", replica 1, seed 11\n',
        'Run 2 of 2 started: condition "baseline", model "scripted/one", replica 2, seed 12\n',
        "Run 1 of 2 running: 0.1 s, 0 of 2 activations, 1 model turn, cost $0.0012; Run 2 of 2 running: 0.1 s, 1 of 2 activations, 0 model turns, cost $0.0000\n",
        "Run 1 of 2 completed in 0.1 s: 0 activations, 1 model turn, cost $0.0012\n",
        "Run 2 of 2 running: 0.2 s, 1 of 2 activations, 0 model turns, cost $0.0000\n",
        "Run 2 of 2 stopped in 0.2 s: 1 activation, 1 model turn, cost $0.0002\n",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
