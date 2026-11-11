import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { ScriptedModel } from "../../src/engine/scripted-model.ts";
import type { Context } from "../support/context.ts";
import { completedIndex, firstLine, logOf } from "./lab.steps.ts";

/**
 * What an agent writes as it looks, long enough that its context fills the scripted model's small window within its
 * turns: about 500 tokens a turn, by Pi's estimate of 4 characters a token.
 */
const REFLECTION = "I look at the slots again, to see which of them are empty and which are held. ".repeat(26);

Given(
  "the scripted model {string}, with a context window of {int} tokens, whose agents call {string} in every turn for {int} turns, then end without a tool call, and which writes the summary {string} when asked to compact",
  function (this: Context, name: string, contextWindow: number, tool: string, turns: number, summary: string) {
    this.compactionModel = { name, contextWindow, tool, turns, turnDelayMs: 0, summary: { text: summary, delayMs: 0 } };
    setUpCompactionModel(this);
  },
);

/** Makes the compaction scenario's scripted model as it now stands, for "lab" to resolve by its name. */
function setUpCompactionModel(context: Context): void {
  assert.ok(context.compactionModel !== undefined, "the scenario gives no scripted model to compact with");
  const { name, contextWindow, tool, turns, turnDelayMs, summary } = context.compactionModel;
  const script = [
    ...Array.from({ length: turns }, () => ({ text: REFLECTION, toolCalls: [{ name: tool, arguments: {} }], delayMs: turnDelayMs })),
    { text: "Done.", delayMs: turnDelayMs },
  ];
  // Each agent's session takes the script from its start, so both agents look in their own turns.
  const model = new ScriptedModel(script, name.split("/")[1], { contextWindow, summary, perSession: true });
  context.models.set(name, model);
  context.labModels.set(name, model);
}

/** Changes how the compaction scenario's scripted model answers a summary call, or how long its turns take. */
function changeCompactionModel(context: Context, change: Partial<Pick<NonNullable<Context["compactionModel"]>, "summary" | "turnDelayMs">>): void {
  assert.ok(context.compactionModel !== undefined, "the scenario gives no scripted model to compact with");
  context.compactionModel = { ...context.compactionModel, ...change };
  setUpCompactionModel(context);
}

Given(
  'the file\'s compaction is enabled, with "trigger_at" {float} and "keep_recent_tokens" {int}, and a model turn timeout of {int} milliseconds',
  function (this: Context, triggerAt: number, keepRecentTokens: number, timeoutMs: number) {
    this.experimentFile.compaction = { enabled: true, trigger_at: triggerAt, keep_recent_tokens: keepRecentTokens };
    (this.experimentFile.limits as Record<string, number>).model_turn_timeout_ms = timeoutMs;
  },
);

Given("the scripted model answers the summary call with a provider error", function (this: Context) {
  changeCompactionModel(this, { summary: { error: "overloaded", delayMs: 0 } });
});

Given("the scripted model takes {int} milliseconds to answer the summary call", function (this: Context, delayMs: number) {
  changeCompactionModel(this, { summary: { ...this.compactionModel?.summary, delayMs } });
});

/**
 * How long each scripted turn takes when the run's time limit must pass at a moment after the summary call starts:
 * long enough that the agent's turns before its first compaction, not the engine's own work, set when that call starts.
 */
const TURN_DELAY_MS = 200;

/**
 * The agent's turns before its first compaction, with the Background's model, its window and the trigger at half of
 * it: about 520 tokens of reflection a turn fill half of 4000 within 4. The outcome step checks the moment it gives.
 */
const TURNS_BEFORE_COMPACTION = 4;

Given(
  "the scripted model takes {int} milliseconds to answer the summary call, and the run's time limit passes {int} milliseconds after the summary call starts, before its timeout",
  function (this: Context, delayMs: number, afterMs: number) {
    changeCompactionModel(this, { summary: { ...this.compactionModel?.summary, delayMs }, turnDelayMs: TURN_DELAY_MS });
    (this.experimentFile.limits as Record<string, number>).time_limit_ms = TURNS_BEFORE_COMPACTION * TURN_DELAY_MS + afterMs;
    this.limitAfterSummaryMs = afterMs;
  },
);

Given(
  'the file\'s compaction is enabled, with "trigger_at" {float} and "keep_recent_tokens" {int}',
  function (this: Context, triggerAt: number, keepRecentTokens: number) {
    this.experimentFile.compaction = { enabled: true, trigger_at: triggerAt, keep_recent_tokens: keepRecentTokens };
  },
);

Given("the file's compaction is not enabled", function (this: Context) {
  this.experimentFile.compaction = { enabled: false };
});

Given("the file gives no compaction", function (this: Context) {
  assert.ok(Object.hasOwn(this.experimentFile, "compaction"), "the experiment file has no compaction to leave out");
  delete this.experimentFile.compaction;
});

Given('the file\'s compaction is enabled, with "trigger_at" {float}', function (this: Context, triggerAt: number) {
  // Its keep_recent_tokens is valid, so the file is refused for its trigger_at alone.
  this.experimentFile.compaction = { enabled: true, trigger_at: triggerAt, keep_recent_tokens: 500 };
});

Given('the file\'s compaction is enabled, with no "keep_recent_tokens"', function (this: Context) {
  this.experimentFile.compaction = { enabled: true, trigger_at: 0.5 };
});

/** A compaction line of a run's log, as JSON gives it back. */
interface CompactionLine {
  agent: string;
  outcome: string;
  reason: string;
  startedAtMs: number;
  endedAtMs: number;
  contextTokensBefore: number;
  contextTokensAfter: number;
  summary: string;
  tokens: Record<string, number>;
  cost: Record<string, number>;
}

/** A model turn line of a run's log, as far as these steps read it. */
interface TurnLine {
  agent: string;
  startedAtMs: number;
  tokens: { input: number; cacheRead: number; cacheWrite: number };
}

/** The lines of the only run's log, once "lab run" completed. */
function onlyLog(context: Context) {
  const index = completedIndex(context);
  assert.equal(index.length, 1, `the index lists ${index.length} runs`);
  return logOf(context, index[0].runId);
}

/** An agent's compaction lines in the only run's log, in the order they were written. */
function compactionsOf(context: Context, agent: string): CompactionLine[] {
  return onlyLog(context).filter((line) => line.type === "compaction" && line.agent === agent) as unknown as CompactionLine[];
}

/** An agent's first compaction line, which must be there. */
function firstCompaction(context: Context, agent: string): CompactionLine {
  const [first] = compactionsOf(context, agent);
  assert.ok(first !== undefined, `agent "${agent}"'s log has no compaction line`);
  return first;
}

/** The size of the context a model turn received: every prompt token, whether read from the cache, written to it or not. */
function contextOf({ tokens }: TurnLine): number {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite;
}

/** The scripted model the experiment file names, which must be one model only. */
function onlyModel(context: Context): ScriptedModel {
  const [name] = context.experimentFile.models as string[];
  const model = context.models.get(name);
  assert.ok(model !== undefined, `there is no scripted model "${name}"`);
  return model;
}

Then(
  "agent {string}'s log has at least one compaction line, with the reason {string}, when it started and ended, the context's size before and after it, the summary {string}, and the tokens and cost of the call that wrote it",
  function (this: Context, agent: string, reason: string, summary: string) {
    const compactions = compactionsOf(this, agent);
    assert.ok(compactions.length >= 1, `agent "${agent}"'s log has no compaction line`);
    for (const line of compactions) {
      assert.equal(line.reason, reason);
      assert.ok(line.startedAtMs <= line.endedAtMs, `a compaction ended at ${line.endedAtMs}, before it started at ${line.startedAtMs}`);
      assert.ok(line.contextTokensBefore > 0 && line.contextTokensAfter > 0, "a compaction gives no context size before or after it");
      // Pi composes the summary the context holds around the text the model wrote, such as for a split turn.
      assert.ok(line.summary.includes(summary), `the summary does not hold the model's text: ${line.summary}`);
      assert.ok(line.tokens.totalTokens > 0, "a compaction gives no tokens for the call that wrote its summary");
      assert.equal(typeof line.cost.total, "number", "a compaction gives no cost for the call that wrote its summary");
    }
  },
);

Then(
  "agent {string}'s log has a compaction line with the outcome {string}, no summary, and the tokens and cost spent",
  function (this: Context, agent: string, outcome: string) {
    const lines = compactionsOf(this, agent).filter((line) => line.outcome === outcome);
    assert.ok(lines.length > 0, `agent "${agent}"'s log has no compaction line with the outcome "${outcome}": ${JSON.stringify(compactionsOf(this, agent))}`);
    for (const line of lines) {
      assert.equal(line.summary, undefined, `a compaction that did not finish gives the summary ${line.summary}`);
      assert.ok(line.startedAtMs <= line.endedAtMs, "a compaction ended before it started");
      for (const field of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) assert.equal(typeof line.tokens?.[field], "number", `it gives no ${field} tokens`);
      assert.equal(typeof line.cost?.total, "number", "it gives no cost");
    }
    if (this.limitAfterSummaryMs !== undefined) {
      // The time limit passed as the scenario set it: after the summary call started, and before the call's timeout.
      const [start] = onlyLog(this).filter((line) => line.type === "metric_sample") as unknown as { atMs: number }[];
      const limitMs = (this.experimentFile.limits as Record<string, number>).time_limit_ms;
      const timeoutMs = (this.experimentFile.limits as Record<string, number>).model_turn_timeout_ms;
      const afterMs = start.atMs + limitMs - lines[0].startedAtMs;
      assert.ok(afterMs > 0 && afterMs < timeoutMs, `the time limit passed ${afterMs} ms after the compaction started`);
    }
  },
);

Then("the context's size after it is smaller than before it", function (this: Context) {
  for (const line of compactionsOf(this, "a")) {
    assert.ok(line.contextTokensAfter < line.contextTokensBefore, `a compaction left ${line.contextTokensAfter} tokens of ${line.contextTokensBefore}`);
  }
});

Then("agent {string}'s model turns after the compaction received the summary {string}", function (this: Context, agent: string, summary: string) {
  const compaction = firstCompaction(this, agent);
  const turns = onlyLog(this).filter((line) => line.type === "model_turn" && line.agent === agent) as unknown as TurnLine[];
  const before = turns.filter((turn) => turn.startedAtMs < compaction.startedAtMs).length;
  // The agent's own turns, told from the other agent's by the system prompt that names it, in the order they were called.
  const received = onlyModel(this).received.filter((messages) => getCurrentSystemPrompt(messages)?.includes(`agent "${agent}"`));
  assert.equal(received.length, turns.length, `the model received ${received.length} turns of agent "${agent}", and its log has ${turns.length}`);
  const after = received.slice(before);
  assert.ok(after.length > 0, `agent "${agent}" made no model turn after its compaction`);
  for (const [at, messages] of after.entries()) {
    assert.ok(JSON.stringify(messages).includes(summary), `agent "${agent}"'s turn ${before + at + 1} did not receive the summary`);
  }
});

Then(
  "agent {string}'s first compaction started when its context was above {int} tokens and no earlier turn's context was",
  function (this: Context, agent: string, threshold: number) {
    const compaction = firstCompaction(this, agent);
    assert.ok(compaction.contextTokensBefore > threshold, `the compaction started with ${compaction.contextTokensBefore} tokens`);
    const earlier = onlyLog(this).filter((line) => line.type === "model_turn" && line.agent === agent && (line.startedAtMs as number) < compaction.startedAtMs) as unknown as TurnLine[];
    assert.ok(earlier.length > 0, `agent "${agent}" made no turn before its compaction`);
    for (const turn of earlier) assert.ok(contextOf(turn) <= threshold, `an earlier turn's context was ${contextOf(turn)} tokens`);
  },
);

Then("no log has a compaction line", function (this: Context) {
  const lines = onlyLog(this);
  assert.ok(lines.some((line) => line.type === "model_turn"), "the run made no model turn");
  assert.deepEqual(lines.filter((line) => line.type === "compaction"), []);
});

Then(
  'the run\'s setup line gives compaction enabled, with "trigger_at" {float} and "keep_recent_tokens" {int}',
  function (this: Context, triggerAt: number, keepRecentTokens: number) {
    assert.deepEqual(firstLine(this).compaction, { enabled: true, triggerAt, keepRecentTokens });
  },
);

/** The text a message's content holds: itself, or its text blocks joined. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return ((content ?? []) as { type: string; text?: string }[]).flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("");
}

/** The instructions Pi gives the model to write a summary, as the inventory gives them. */
interface SummaryInstructions {
  systemPrompt: string;
  first: string;
  update: string;
  splitTurn: string;
}

Then("the inventory gives the same setting and the instructions the model is given to write the summary", function (this: Context) {
  assert.ok(this.inventoryOutput !== undefined, `"lab inventory" did not print: ${this.labError?.message}`);
  const printed = this.inventoryOutput;
  const { compaction } = firstLine(this).inventory as { compaction: { enabled: boolean; triggerAt: number; keepRecentTokens: number; instructions: SummaryInstructions } };
  assert.deepEqual({ ...compaction, instructions: undefined }, { ...(firstLine(this).compaction as object), instructions: undefined });
  assert.ok(printed.includes("- Compaction: enabled"), "the inventory does not say compaction is enabled");
  assert.ok(printed.includes(`trigger_at ${compaction.triggerAt}`) && printed.includes(`keep_recent_tokens ${compaction.keepRecentTokens}`), "the inventory does not give the setting");
  const { systemPrompt, ...sets } = compaction.instructions;
  for (const text of [systemPrompt, ...Object.values(sets)]) assert.ok(printed.includes(text), `the inventory does not print: ${text.slice(0, 80)}…`);
  // What the model was asked to write each summary with: the system prompt, and a prompt that ends with one of the sets.
  const requests = onlyModel(this).summaryRequests;
  assert.ok(requests.length > 0, "the model was never asked to write a summary");
  for (const messages of requests) {
    assert.equal(getCurrentSystemPrompt(messages), systemPrompt);
    const prompt = textOf(messages.at(-1)?.content);
    assert.ok(Object.values(sets).some((text) => prompt.endsWith(text)), `the model was asked with instructions the inventory does not give: …${prompt.slice(-200)}`);
  }
});
