import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { After, Given, Then, When } from "@cucumber/cucumber";
import type { Api, Model } from "@earendil-works/pi-ai";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { rhythmChannel } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { landsWhileUnderWay } from "./acting.steps.ts";
import { turnsOf } from "./adapter.steps.ts";
import { callOf, callWithThenEnd, modelOf, returned, runTheScenario, script } from "./tool.steps.ts";

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

Then(
  "the log's tool call line for agent {string}'s {string} call gives {int} change(s) since its last sensing, applied by agent {string}",
  function (this: Context, agent: string, tool: string, changes: number, by: string) {
    const call = lineOf(this, "tool_call", agent, { tool });
    assert.equal(call.changesSinceSensing, changes);
    assert.deepEqual(call.changesSinceSensingBy, Array.from({ length: changes }, () => by));
  },
);

Given("a previous run wrote its log", async function (this: Context) {
  script(this, "a", [{ text: "Nothing to do.", delayMs: 0 }]);
  await runTheScenario(this);
  const file = theLog(this);
  this.previousLog = { file, content: readFileSync(join(this.logDirectory, file), "utf8") };
  assert.notEqual(this.previousLog.content, "", "the previous run's log is empty");
});

Then("there are two log files", function (this: Context) {
  assert.equal(logFiles(this).length, 2);
});

Then("the first one is unchanged", function (this: Context) {
  assert.ok(this.previousLog !== undefined, "no previous run wrote a log");
  assert.ok(logFiles(this).includes(this.previousLog.file), "the previous run's log is gone");
  assert.equal(readFileSync(join(this.logDirectory, this.previousLog.file), "utf8"), this.previousLog.content);
});

Given("an effector that throws an error when it runs", function (this: Context) {
  this.throwingTool = { name: "jam", message: "the jam effector broke" };
  const { message } = this.throwingTool;
  const broken = () => {
    throw new Error(message);
  };
  this.tools = [
    ...this.tools,
    {
      kind: "effector",
      name: this.throwingTool.name,
      description: "Jam the slots.",
      parameters: { type: "object", properties: {} },
      durationMs: () => 0,
      action: { precondition: broken, effect: broken },
      readTarget: () => "not_sensed",
    },
  ];
});

Given("agent {string} runs on a scripted model that calls that effector, then ends without a tool call", function (this: Context, agent: string) {
  assert.ok(this.throwingTool !== undefined, "the scenario declares no effector that throws");
  script(this, agent, callWithThenEnd(this.throwingTool.name, {}, 0));
});

When("the run stops on that error", async function (this: Context) {
  try {
    await runTheScenario(this);
  } catch (error) {
    this.runError = error as Error;
    return;
  }
  assert.fail("the run did not stop");
});

/** The last line of the only log the scenario's run wrote, which says the run stopped. */
function stopLine(context: Context): Line {
  const last = logLines(context).at(-1);
  assert.ok(last !== undefined, "the run's log is empty");
  assert.equal(last.type, "run_stopped", `the log's last line does not say the run stopped: ${JSON.stringify(last)}`);
  assert.equal(typeof last.error, "string", "the line that says the run stopped gives no error");
  return last;
}

Then("the last line of the run's log says the run stopped and gives the error", function (this: Context) {
  assert.ok(this.throwingTool !== undefined, "the scenario declares no effector that throws");
  assert.match(stopLine(this).error as string, new RegExp(this.throwingTool.message));
  assert.match(this.runError?.message ?? "", new RegExp(this.throwingTool.message));
});

Then("the last line of the run's log says the run stopped and names agent {string}", function (this: Context, agent: string) {
  assert.match(stopLine(this).error as string, new RegExp(`agent "${agent}"`));
  assert.match(this.runError?.message ?? "", new RegExp(`agent "${agent}"`));
});

/** Watches every Pi session close, by its model's provider, without changing what closing does. */
function watchSessionsClose(context: Context): void {
  const closed: string[] = [];
  context.closedSessions = closed;
  const dispose = AgentSession.prototype.dispose;
  AgentSession.prototype.dispose = function (this: AgentSession) {
    closed.push(this.model?.provider ?? "");
    dispose.call(this);
  };
  context.unwatch.push(() => {
    AgentSession.prototype.dispose = dispose;
  });
}

After(function (this: Context) {
  for (const unwatch of this.unwatch) unwatch();
});

Given("agent {string} runs on a model whose session fails to open", function (this: Context, agent: string) {
  watchSessionsClose(this);
  this.realModels.set(agent, {
    // Opening the session asks for its model, and this one has none to give.
    get model(): Model<Api> {
      throw new Error("this model cannot be given to a session");
    },
  });
});

Then("agent {string}'s session is closed", function (this: Context, agent: string) {
  const { provider } = this.models.get(agent)?.model ?? {};
  assert.ok(provider !== undefined, `agent "${agent}" runs on no scripted model`);
  assert.ok(this.closedSessions?.includes(provider), `agent "${agent}"'s session was not closed`);
});

Then(
  "the log's tool call line for agent {string}'s {string} call gives the target as sensed {string} and no count of changes since sensing",
  function (this: Context, agent: string, tool: string, sensed: string) {
    const call = lineOf(this, "tool_call", agent, { tool });
    assert.equal(call.targetAsSensed, sensed);
    // No count is written as one, not left out, so the field is there in every effector call that ran.
    assert.ok("changesSinceSensing" in call, "the line leaves out the changes since sensing");
    assert.equal(call.changesSinceSensing, null);
  },
);

Given(
  "agent {string} runs on a scripted model that calls {string} with slot {string}, then ends without a tool call",
  function (this: Context, agent: string, tool: string, slot: string) {
    script(this, agent, callWithThenEnd(tool, { slot }, 0));
  },
);

Then("the log's tool call line for agent {string}'s {string} call gives the outcome {string}", function (this: Context, agent: string, tool: string, outcome: string) {
  assert.equal(lineOf(this, "tool_call", agent, { tool }).outcome, outcome);
});

Given(
  "agent {string} runs on a scripted model whose first turn calls {string} and then {string} with slot {int}",
  function (this: Context, agent: string, first: string, second: string, slot: number) {
    script(this, agent, [
      { toolCalls: [{ name: first, arguments: {} }, { name: second, arguments: { slot } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    // The turn's calls run one after another: the second is left unrun when the first is cut off. It then starts no
    // earlier than the first ends, and as it never ran, it read no target.
    this.setupChecks.push(() => {
      const before = callOf(this, agent, first);
      const after = callOf(this, agent, second);
      assert.ok(after.startedAtMs >= before.endedAtMs, `agent "${agent}"'s "${second}" started while its "${first}" was under way`);
      assert.equal(after.targetAsSensed, undefined, `agent "${agent}"'s "${second}" read its target, so it ran`);
    });
  },
);
