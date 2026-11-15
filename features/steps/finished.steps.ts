import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { ScriptedModel } from "../../src/engine/scripted-model.ts";
import { scenarioLibrary } from "../../src/scenarios/library.ts";
import { type Slots, holder, slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { takeLike } from "./acting.steps.ts";
import { turnsOf } from "./adapter.steps.ts";
import { declare } from "./components.steps.ts";
import { indexOf, logOf, runLogs } from "./lab.steps.ts";
import { samplesIn } from "./metric.steps.ts";
import { logLines } from "./record.steps.ts";
import { modelOf, script } from "./tool.steps.ts";

/** Whether slots are both held: the world the scenario says is finished then. */
const bothHeld = (first: number, second: number) => (slots: Slots) => holder(slots, first) !== null && holder(slots, second) !== null;

Given("the world is finished when slots {int} and {int} are both held", function (this: Context, first: number, second: number) {
  this.finished = bothHeld(first, second);
});

Given("the world is never finished", function (this: Context) {
  this.finished = undefined;
});

Given("the effector {string} takes {int} milliseconds and puts the agent in a slot when it lands", function (this: Context, name: string, durationMs: number) {
  takeLike(this, name, durationMs);
});

Given(
  "agent {string} runs on a scripted model whose turns are: a call to {string} with slot {int}; a call to {string} with slot {int}; the text {string} with no tool call",
  function (this: Context, agent: string, firstTool: string, firstSlot: number, secondTool: string, secondSlot: number, text: string) {
    script(this, agent, [
      { toolCalls: [{ name: firstTool, arguments: { slot: firstSlot } }], delayMs: 0 },
      { toolCalls: [{ name: secondTool, arguments: { slot: secondSlot } }], delayMs: 0 },
      { text, delayMs: 0 },
    ]);
  },
);

Given(
  "agent {string} runs on a scripted model whose turns are: a call to {string} with slot {int}; the text {string} with no tool call",
  function (this: Context, agent: string, tool: string, slot: number, text: string) {
    script(this, agent, [
      { toolCalls: [{ name: tool, arguments: { slot } }], delayMs: 0 },
      { text, delayMs: 0 },
    ]);
  },
);

Given(
  "the component {string}, whose cycle fills slot {int} with {string} at once, an action that takes {int} milliseconds, then ends",
  function (this: Context, name: string, slot: number, thing: string, actionMs: number) {
    declare(this, name, { slot, thing, waitMs: () => 0, actionMs });
  },
);

Given(
  "the component {string}, whose cycle fills slot {int} with {string} after {int} milliseconds, an action that takes {int} milliseconds, then ends",
  function (this: Context, name: string, slot: number, thing: string, waitMs: number, actionMs: number) {
    declare(this, name, { slot, thing, waitMs: () => waitMs, actionMs });
  },
);

/** An agent's calls of a tool, as the run recorded them, in the order they ended. */
function callsOf(context: Context, agent: string, tool: string) {
  assert.ok(context.toolCalls !== undefined, "the run gave no tool calls");
  return context.toolCalls.filter((call) => call.agent === agent && call.tool === tool);
}

/** An agent's second call of a tool. */
function secondCall(context: Context, agent: string, tool: string) {
  const second = callsOf(context, agent, tool)[1];
  assert.ok(second !== undefined, `agent "${agent}" made no second "${tool}" call`);
  return second;
}

/** The log's only line of a type. */
function onlyLine(context: Context, type: string) {
  const lines = logLines(context).filter((line) => line.type === type);
  assert.equal(lines.length, 1, `the log has ${lines.length} "${type}" lines`);
  return lines[0];
}

/** Checks the log's world_finished line gives a moment within this many milliseconds of another. */
function finishedAt(context: Context, type: string, atMs: number, withinMs: number): void {
  const line = onlyLine(context, type);
  assert.equal(typeof line.atMs, "number", `the "${type}" line gives no moment: ${JSON.stringify(line)}`);
  const offMs = Math.abs((line.atMs as number) - atMs);
  assert.ok(offMs <= withinMs, `the "${type}" line gives a moment ${offMs} ms from it`);
}

Then("the run ended within {int} milliseconds after agent {string}'s second {string} call ended", function (this: Context, withinMs: number, agent: string, tool: string) {
  assert.ok(this.runEndedAtMs !== undefined, "the run did not end");
  const afterMs = this.runEndedAtMs - secondCall(this, agent, tool).endedAtMs;
  assert.ok(afterMs >= 0 && afterMs <= withinMs, `the run ended ${afterMs} ms after the call ended`);
});

Then(
  "the log has a {string} line, giving as the moment the world was finished the end of agent {string}'s second {string} call, within {int} milliseconds",
  function (this: Context, type: string, agent: string, tool: string, withinMs: number) {
    finishedAt(this, type, secondCall(this, agent, tool).endedAtMs, withinMs);
  },
);

Then(
  "the log has a {string} line, giving as the moment the world was finished the end of the porter's action, within {int} milliseconds",
  function (this: Context, type: string, withinMs: number) {
    const actions = logLines(this).filter((line) => line.type === "component_action" && line.component === "porter");
    assert.equal(actions.length, 1, `the log has ${actions.length} actions of the porter`);
    assert.equal(actions[0].outcome, "success", "the porter's action did not succeed");
    finishedAt(this, type, actions[0].endedAtMs as number, withinMs);
  },
);

Then("agent {string}'s second {string} call succeeded", function (this: Context, agent: string, tool: string) {
  assert.equal(secondCall(this, agent, tool).outcome, "success");
});

Then("agent {string}'s second {string} call has the outcome {string}", function (this: Context, agent: string, tool: string, outcome: string) {
  assert.equal(secondCall(this, agent, tool).outcome, outcome);
});

Then("agent {string} made no model turn after it", function (this: Context, agent: string) {
  const call = secondCall(this, agent, "take");
  const after = turnsOf(this, agent).filter((turn) => turn.startedAtMs >= call.endedAtMs);
  assert.deepEqual(after, [], `agent "${agent}" made ${after.length} model turns after the call`);
  // Nor was its model asked again: one turn for each call.
  assert.equal(modelOf(this, agent).received.length, 2, `agent "${agent}"'s model was asked ${modelOf(this, agent).received.length} times`);
});

Then("agent {string} made only the activations that began before the world was finished", function (this: Context, agent: string) {
  const finished = onlyLine(this, "world_finished").atMs as number;
  const activations = logLines(this).filter((line) => line.type === "activation" && line.agent === agent);
  const budget = this.activations.get(agent) ?? 1;
  // Otherwise the agent's budget, not the world's end, ended its activations, and the check below would say nothing.
  assert.ok(activations.length < budget, `agent "${agent}" made all ${budget} of its activations`);
  for (const [index, activation] of activations.entries()) {
    assert.ok((activation.wokeAtMs as number) < finished, `agent "${agent}"'s activation ${index + 1} began after the world was finished`);
  }
});

Then("the log's last metric sample comes after its {string} line", function (this: Context, type: string) {
  const lines = logLines(this);
  const at = lines.findIndex((line) => line.type === type);
  assert.ok(at !== -1, `the log has no "${type}" line`);
  const last = lines.map((line) => line.type).lastIndexOf("metric_sample");
  assert.ok(last > at, `the log's last metric sample is line ${last + 1}, before its "${type}" line, ${at + 1}`);
});

Then("it gives {string} as {int}, computed from the world's version {int}", function (this: Context, metric: string, value: number, version: number) {
  const last = samplesIn(logLines(this)).at(-1);
  assert.ok(last !== undefined, "the log has no metric sample");
  assert.equal(last.version, version, `the last sample was computed from version ${last.version}`);
  assert.equal(last.metrics[metric], value, `the last sample gives "${metric}" as ${JSON.stringify(last.metrics[metric])}`);
});

Then("the run ended no earlier than agent {string}'s first model turn ended", function (this: Context, agent: string) {
  assert.ok(this.runEndedAtMs !== undefined, "the run did not end");
  const first = turnsOf(this, agent)[0];
  assert.ok(first !== undefined, `agent "${agent}" made no model turn`);
  assert.equal(first.outcome, "success", `agent "${agent}"'s first model turn was ${first.outcome}`);
  assert.ok(this.runEndedAtMs >= first.endedAtMs, "the run ended before the turn did");
});

Then("the log has no {string} line", function (this: Context, type: string) {
  assert.deepEqual(logLines(this).filter((line) => line.type === type), []);
});

Given(
  "an experiment file {string} for a test scenario whose world is finished when slots {int} and {int} are both held, with agent {string} on a scripted model that takes slot {int}, then slot {int}, then writes {string}, {int} replica and a time limit of {int} seconds",
  function (this: Context, id: string, first: number, second: number, agent: string, slot: number, then: number, text: string, replicas: number, seconds: number) {
    assert.equal(agent, "a", "the test scenario's base configuration names agent \"a\"");
    this.library = new Map([...scenarioLibrary, [slotsScenario.name, { ...slotsScenario, finished: bothHeld(first, second) }]]);
    const name = "faux/taker";
    this.labModels.set(
      name,
      new ScriptedModel(
        [
          { toolCalls: [{ name: "take", arguments: { slot } }], delayMs: 0 },
          { toolCalls: [{ name: "take", arguments: { slot: then } }], delayMs: 0 },
          { text, delayMs: 0 },
        ],
        "taker",
      ),
    );
    this.experimentFile = {
      id,
      scenario: slotsScenario.name,
      models: [name],
      thinking_level: "off",
      replicas,
      seed: 1,
      limits: { time_limit_ms: seconds * 1000, activations_per_agent: 1, parallelism_limit: 10, model_turn_timeout_ms: 10_000 },
      compaction: { enabled: false },
      conditions: { baseline: {} },
    };
  },
);

Then("the experiment's {string} lists the run as completed", function (this: Context, file: string) {
  assert.equal(file, "index.jsonl");
  assert.equal(this.labError, undefined, `"lab run" failed: ${this.labError?.message}`);
  const index = indexOf(this);
  assert.equal(index.length, 1, `the index lists ${index.length} runs`);
  assert.equal(index[0].status, "completed");
});

Then("the run's log has a {string} line", function (this: Context, type: string) {
  const logs = runLogs(this);
  assert.equal(logs.length, 1, `the experiment wrote ${logs.length} run logs`);
  const lines = logOf(this, logs[0].replace(/\.jsonl$/, "")).filter((line) => line.type === type);
  assert.equal(lines.length, 1, `the run's log has ${lines.length} "${type}" lines`);
});
