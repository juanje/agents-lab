import { describe, expect, it } from "vitest";
import { summarize } from "../src/analysis/summary.ts";

describe("summarize", () => {
  it("prints each agent's model turns with their latencies and its tool calls with their outcomes, agent by agent", () => {
    const printed = summarize({
      turns: [
        { agent: "a", outcome: "success", text: "", slotWaitMs: 0.2, startedAtMs: 100, endedAtMs: 3812.4 },
        { agent: "b", outcome: "model_error", message: "quota", text: "", slotWaitMs: 1500, startedAtMs: 0, endedAtMs: 250 },
        { agent: "a", outcome: "success", text: "", slotWaitMs: 0, startedAtMs: 5000, endedAtMs: 6000 },
      ],
      toolCalls: [
        { agent: "a", tool: "look", arguments: {}, outcome: "success" },
        { agent: "b", tool: "take", arguments: { slot: 1 }, outcome: "slot_taken" },
      ],
    });

    expect(printed).toBe(
      [
        'agent "a"',
        "  model turns:",
        "    success, 3712 ms (waited 0 ms for a model slot)",
        "    success, 1000 ms (waited 0 ms for a model slot)",
        "  tool calls:",
        "    look {} → success",
        'agent "b"',
        "  model turns:",
        "    model_error, 250 ms (waited 1500 ms for a model slot): quota",
        "  tool calls:",
        '    take {"slot":1} → slot_taken',
        "",
      ].join("\n"),
    );
  });

  it("says so when an agent made no tool call", () => {
    const printed = summarize({
      turns: [{ agent: "a", outcome: "success", text: "", slotWaitMs: 0, startedAtMs: 0, endedAtMs: 10 }],
      toolCalls: [],
    });

    expect(printed).toContain("  tool calls: none\n");
  });
});
