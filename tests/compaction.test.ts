import { shouldCompact } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { isSummaryRequest, piCompactionSettings, summaryInstructions } from "../src/engine/compaction.ts";

describe("summaryInstructions", () => {
  it("gives the system prompt Pi gives the model to write a summary", () => {
    expect(summaryInstructions.systemPrompt).toMatch(/^You are a context summarization assistant\./);
  });

  it("gives Pi's instructions for a first summary, for an update of the previous one and for a split turn, without the conversation they follow", () => {
    const { first, update, splitTurn } = summaryInstructions;

    expect(first).toMatch(/^The messages above are a conversation to summarize\./);
    expect(first).toContain("## Goal");
    expect(update).toMatch(/^The messages above are NEW conversation messages/);
    expect(splitTurn).toMatch(/^The messages above are earlier context from an ongoing conversation\./);
    expect(splitTurn).toContain("## Original Request");
    for (const text of [first, update, splitTurn]) expect(text).not.toMatch(/conversation>|# Conversation|previous-summary>|# Instructions/);
  });
});

describe("isSummaryRequest", () => {
  it("tells a request to write a summary, by Pi's system prompt for it, from an agent's turn", () => {
    const system = (content: string) => [{ role: "system" as const, content, timestamp: 0 }];

    expect(isSummaryRequest(system(summaryInstructions.systemPrompt))).toBe(true);
    expect(isSummaryRequest(system('You are agent "a", in a world of slots.'))).toBe(false);
    expect(isSummaryRequest([])).toBe(false);
  });
});

describe("piCompactionSettings", () => {
  it("turns the share of the window that starts a compaction into Pi's reserve for the model's window, so Pi starts one once the context is above that share", () => {
    const settings = piCompactionSettings({ enabled: true, triggerAt: 0.5, keepRecentTokens: 500 }, 4000);

    expect(settings).toEqual({ enabled: true, reserveTokens: 2000, keepRecentTokens: 500 });
    expect(shouldCompact(2000, 4000, settings)).toBe(false);
    expect(shouldCompact(2001, 4000, settings)).toBe(true);
  });

  it("starts at the same share for models with different windows", () => {
    for (const window of [4000, 128000, 1000000]) {
      const settings = piCompactionSettings({ enabled: true, triggerAt: 0.8, keepRecentTokens: 500 }, window);
      expect(shouldCompact(0.8 * window, window, settings)).toBe(false);
      expect(shouldCompact(0.8 * window + 1, window, settings)).toBe(true);
    }
  });

  it("turns Pi's compaction off when the experiment does", () => {
    expect(piCompactionSettings({ enabled: false }, 4000)).toMatchObject({ enabled: false });
  });
});
