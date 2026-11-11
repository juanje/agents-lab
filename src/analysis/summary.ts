import type { ModelTurn, ToolCall } from "../engine/adapter.ts";

/** What the summary reads of a model turn. */
type SummarizedTurn = Pick<ModelTurn, "agent" | "outcome" | "message" | "text" | "slotWaitMs" | "startedAtMs" | "endedAtMs">;

/**
 * A run as a person reads it, agent by agent in the order they first appear: each model turn with its outcome, its
 * latency and its wait for a model slot, then each tool call as the model made it, with its outcome.
 */
export function summarize({ turns, toolCalls }: { turns: readonly SummarizedTurn[]; toolCalls: readonly ToolCall[] }): string {
  const agents = [...new Set([...turns, ...toolCalls].map((entry) => entry.agent))];
  return agents
    .map((agent) => {
      const turnLines = turns
        .filter((turn) => turn.agent === agent)
        .map((turn) => {
          const latency = `${Math.round(turn.endedAtMs - turn.startedAtMs)} ms`;
          const wait = `waited ${Math.round(turn.slotWaitMs)} ms for a model slot`;
          return `    ${turn.outcome}, ${latency} (${wait})${turn.message === undefined ? "" : `: ${turn.message}`}`;
        });
      const callLines = toolCalls
        .filter((call) => call.agent === agent)
        .map((call) => `    ${call.tool} ${JSON.stringify(call.arguments)} → ${call.outcome}`);
      return [
        `agent "${agent}"`,
        turnLines.length === 0 ? "  model turns: none" : "  model turns:",
        ...turnLines,
        callLines.length === 0 ? "  tool calls: none" : "  tool calls:",
        ...callLines,
        "",
      ].join("\n");
    })
    .join("");
}
