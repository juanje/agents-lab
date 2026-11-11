import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Given, Then } from "@cucumber/cucumber";
import { rhythmChannel } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { landsWhileUnderWay } from "./acting.steps.ts";
import { turnsOf } from "./adapter.steps.ts";
import { modelOf, returned } from "./tool.steps.ts";

/** The log files in the scenario's log directory, by name, in no particular order. */
function logFiles(context: Context): string[] {
  return readdirSync(context.logDirectory);
}

/** The lines of a log file, as written: one per event, each ended by a line break. */
function linesOf(context: Context, file: string): string[] {
  const text = readFileSync(join(context.logDirectory, file), "utf8");
  assert.ok(text.endsWith("\n"), `the log "${file}" does not end with a line break`);
  return text.slice(0, -1).split("\n");
}

/** The only log the scenario's run wrote. */
export function theLog(context: Context): string {
  const files = logFiles(context);
  assert.equal(files.length, 1, `the run wrote ${files.length} log files`);
  return files[0];
}

Then("the run wrote one log file, named with its run id", function (this: Context) {
  assert.ok(this.runId !== undefined, "the run gave no run id");
  assert.deepEqual(logFiles(this), [`${this.runId}.jsonl`]);
});

Then("every line of it is a JSON object", function (this: Context) {
  const lines = linesOf(this, theLog(this));
  for (const [index, line] of lines.entries()) {
    const parsed: unknown = JSON.parse(line);
    assert.ok(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed), `line ${index + 1} is not a JSON object: ${line}`);
  }
});

/** A line of a log, as JSON gives it back. */
type Line = Record<string, unknown> & { type: string };

/** The lines of the only log the scenario's run wrote, parsed. */
export function logLines(context: Context): Line[] {
  return linesOf(context, theLog(context)).map((line) => JSON.parse(line) as Line);
}

/** The log's only line of a type for an agent that also has these fields. */
function lineOf(context: Context, type: string, agent: string, fields: Record<string, unknown> = {}): Line {
  const lines = logLines(context).filter(
    (line) => line.type === type && line.agent === agent && Object.entries(fields).every(([name, value]) => line[name] === value),
  );
  assert.equal(lines.length, 1, `the log has ${lines.length} ${type} lines for agent "${agent}" with ${JSON.stringify(fields)}`);
  return lines[0];
}

/** A field of a log line that holds a time, by performance.now(). */
function timeIn(line: Line, field: string): number {
  const value = line[field];
  assert.equal(typeof value, "number", `the ${line.type} line has no time "${field}": ${JSON.stringify(line)}`);
  return value as number;
}

Then("the log has an activation line for agent {string}, with when it woke and when it ended", function (this: Context, agent: string) {
  const activation = lineOf(this, "activation", agent);
  // The agent's only activation holds its model turns.
  const turns = turnsOf(this, agent);
  assert.ok(turns.length > 0, `agent "${agent}" made no model turn`);
  assert.ok(timeIn(activation, "wokeAtMs") <= turns[0].startedAtMs, "the activation woke after its first model turn started");
  assert.ok(timeIn(activation, "endedAtMs") >= turns[turns.length - 1].endedAtMs, "the activation ended before its last model turn");
});

Then(
  "a stimulus line for agent {string} from the channel {string}, with its source, its content and when it was delivered",
  function (this: Context, agent: string, channel: string) {
    assert.equal(channel, rhythmChannel.name);
    const stimulus = lineOf(this, "stimulus", agent, { channel });
    assert.equal(stimulus.source, rhythmChannel.source);
    assert.equal(stimulus.content, rhythmChannel.stimulus);
    // The rhythm's stimulus is delivered as the agent wakes, before its first model turn.
    const activation = lineOf(this, "activation", agent);
    const deliveredAtMs = timeIn(stimulus, "deliveredAtMs");
    assert.ok(timeIn(activation, "wokeAtMs") <= deliveredAtMs, "the stimulus was delivered before the agent woke");
    assert.ok(deliveredAtMs <= turnsOf(this, agent)[0].startedAtMs, "the stimulus was delivered after the first model turn started");
  },
);

/** The usage Pi reported with each of an agent's answers, as its session kept them, in order. */
function usagesOf(context: Context, agent: string) {
  const messages = context.sessionMessages?.get(agent);
  assert.ok(messages !== undefined, `the run gave no session for agent "${agent}"`);
  return messages.flatMap((message) => (message.role === "assistant" ? [message.usage] : []));
}

Then(
  "the log has a model turn line for agent {string} with the text {string}, the model that answered, its wait for a model slot, a latency of at least {int} milliseconds, its tokens and its cost",
  function (this: Context, agent: string, text: string, latencyMs: number) {
    const turn = lineOf(this, "model_turn", agent);
    assert.equal(turn.text, text);
    const { model } = modelOf(this, agent);
    assert.equal(turn.model, `${model.provider}/${model.id}`);
    assert.ok(timeIn(turn, "slotWaitMs") >= 0, "the wait for a model slot is negative");
    assert.ok(timeIn(turn, "latencyMs") >= latencyMs, `the latency was ${String(turn.latencyMs)} ms`);
    // The tokens and the cost are what Pi reported with the answer.
    const [usage] = usagesOf(this, agent);
    const { cost, ...tokens } = usage;
    assert.ok(tokens.output > 0, "Pi reported no output tokens to compare with");
    assert.deepEqual(turn.tokens, tokens);
    assert.deepEqual(turn.cost, cost);
  },
);

/** The scripted arguments of an agent's only call of a tool, exactly as its script makes it. */
function scriptedArguments(context: Context, agent: string, tool: string): unknown {
  const calls = (context.scripts.get(agent) ?? []).flatMap((answer) => answer.toolCalls ?? []).filter((call) => call.name === tool);
  assert.equal(calls.length, 1, `agent "${agent}"'s script calls "${tool}" ${calls.length} times`);
  return calls[0].arguments;
}

Then(
  "the log has a tool call line for agent {string}'s {string} call, with the call as the model made it, when it started and ended, the outcome {string} and its result",
  function (this: Context, agent: string, tool: string, outcome: string) {
    const call = lineOf(this, "tool_call", agent, { tool });
    assert.deepEqual(call.arguments, scriptedArguments(this, agent, tool));
    assert.ok(timeIn(call, "startedAtMs") <= timeIn(call, "endedAtMs"), "the call ended before it started");
    assert.equal(call.outcome, outcome);
    // Its result is what the agent's model received back.
    assert.equal(call.result, returned(this, agent, tool));
  },
);

Given(
  "agent {string} runs on a scripted model whose {string} of slot {int} lands while agent {string}'s {string} is under way",
  function (this: Context, agent: string, tool: string, slot: number, other: string, otherTool: string) {
    landsWhileUnderWay(this, agent, tool, slot, other, otherTool);
  },
);

Then(
  "the log's tool call line for agent {string}'s {string} call gives the outcome {string}, the target as sensed {string}, and {int} change(s) since its last sensing",
  function (this: Context, agent: string, tool: string, outcome: string, sensed: string, changes: number) {
    const call = lineOf(this, "tool_call", agent, { tool });
    assert.equal(call.outcome, outcome);
    assert.equal(call.targetAsSensed, sensed);
    assert.equal(call.changesSinceSensing, changes);
  },
);
