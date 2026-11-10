import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { getCurrentTools } from "@earendil-works/pi-ai";
import { run } from "../../src/engine/run.ts";
import { type ScriptedAnswer, ScriptedModel } from "../../src/engine/scripted-model.ts";
import type { LoadedScenario } from "../../src/engine/scenario.ts";
import type { Action } from "../../src/engine/world.ts";
import { SLOT_TAKEN, type Seen, type Slots, slotTools, slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";

/** The test world's tool of a kind and a name; the tools live in the fixture, and this keeps the words and it in step. */
function fixtureTool(kind: string, name: string) {
  const tool = slotTools.find((declared) => declared.name === name);
  assert.ok(tool !== undefined, `the test world declares no tool "${name}"`);
  assert.equal(tool.kind, kind);
  return tool;
}

Given("the sensor {string} returns which slots are empty and which are held", function (this: Context, name: string) {
  fixtureTool("sensor", name);
});

Given(
  "the effector {string} puts the agent in a slot, only if that slot is empty, and otherwise fails with {string}",
  function (this: Context, name: string, reason: string) {
    fixtureTool("effector", name);
    assert.equal(reason, SLOT_TAKEN);
  },
);

/** Gives an agent a scripted model with these answers. */
export function script(context: Context, agent: string, answers: readonly ScriptedAnswer[]): void {
  context.models.set(agent, new ScriptedModel(answers, context.modelIds.get(agent)));
  context.scripts.set(agent, answers);
}

/** Gives an agent a number of activations, each scripted by its index from 0, all in one scripted model. */
export function scriptActivations(context: Context, agent: string, count: number, activation: (index: number) => readonly ScriptedAnswer[]): void {
  context.activations.set(agent, count);
  script(context, agent, Array.from({ length: count }, (_, index) => activation(index)).flat());
}

Given(
  "agent {string} runs on a scripted model that ends its first turn without a tool call",
  function (this: Context, agent: string) {
    script(this, agent, [{ text: "Nothing to do.", delayMs: 0 }]);
  },
);

When("the run ends", async function (this: Context) {
  this.versionBefore = this.world.version;
  // Watched, not changed: the arbiter still decides, and the scenario sees the order it applied effects in.
  const apply = this.world.apply.bind(this.world);
  this.world.apply = (action, args) => {
    const result = apply(action, args);
    if (result.applied) this.applied.push({ action: action as Action<Slots, never>, args });
    return result;
  };
  const agents = [...this.models, ...this.realModels].map(([name, model]) => ({
    name,
    model,
    activations: this.activations.get(name) ?? 1,
    rhythm: this.rhythms.get(name) ?? (() => this.waitBeforeActivationMs),
  }));
  // Most of these scenarios set up their world and the scenario's parts step by step rather than from a base
  // configuration, so the slots scenario is assembled around them as loading would give it.
  const loaded: LoadedScenario<Slots> = this.loaded ?? {
    scenario: { ...slotsScenario, tools: this.tools, channels: this.channels, systemPrompt: this.systemPrompt },
    configuration: {},
    world: this.world,
  };
  const { turns, messages, toolCalls } = await run(loaded, agents, this.seed, {
    modelTurnTimeoutMs: this.modelTurnTimeoutMs,
    parallelismLimit: this.parallelismLimit,
    onStart: (stimuli) => {
      this.stimuli = stimuli;
      // Watched too: an agent wakes when its session takes its rhythm's stimulus.
      const wake = stimuli.wake.bind(stimuli);
      stimuli.wake = (agent) => {
        this.wokeAtMs.set(agent, [...(this.wokeAtMs.get(agent) ?? []), performance.now()]);
        return wake(agent);
      };
    },
  });
  this.turns = turns;
  this.sessionMessages = messages;
  this.toolCalls = toolCalls;
});

/** The scripted model agent runs on, which has made at least one turn. */
export function modelOf(context: Context, agent: string): ScriptedModel {
  const model = context.models.get(agent);
  assert.ok(model !== undefined, `agent "${agent}" runs on no scripted model`);
  assert.ok(model.received.length > 0, `agent "${agent}"'s model made no turn`);
  return model;
}

Then(
  "agent {string}'s model was offered the tools {string} and {string} and no others",
  function (this: Context, agent: string, first: string, second: string) {
    for (const [turn, messages] of modelOf(this, agent).received.entries()) {
      const offered = getCurrentTools(messages).map((tool) => tool.name);
      assert.deepEqual([...offered].sort(), [first, second].sort(), `turn ${turn + 1} was offered ${offered.join(", ")}`);
    }
  },
);

Given(
  "agent {string} runs on a scripted model that calls {string}, then ends without a tool call",
  function (this: Context, agent: string, tool: string) {
    script(this, agent, [
      { toolCalls: [{ name: tool, arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
  },
);

Given(
  "agent {string} runs on a scripted model that calls {string} with slot {int}, then ends without a tool call",
  function (this: Context, agent: string, tool: string, slot: number) {
    script(this, agent, [
      { toolCalls: [{ name: tool, arguments: { slot } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
  },
);

/** The result the agent's model received back for its first call of the tool, in a later turn. */
function resultOf(context: Context, agent: string, tool: string) {
  const messages = modelOf(context, agent).received.flat();
  const call = messages
    .flatMap((message) => (message.role === "assistant" ? message.content : []))
    .find((block) => block.type === "toolCall" && block.name === tool);
  assert.ok(call !== undefined && call.type === "toolCall", `agent "${agent}"'s model had no call of "${tool}" in its transcript`);
  const result = messages.find((message) => message.role === "toolResult" && message.toolCallId === call.id);
  assert.ok(result !== undefined && result.role === "toolResult", `agent "${agent}"'s "${tool}" call returned nothing`);
  return result;
}

/** The text the agent's model received back for its first call of the tool, in a later turn. */
function returned(context: Context, agent: string, tool: string): string {
  return resultOf(context, agent, tool)
    .content.flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

Then(
  "agent {string}'s {string} call returned slot {int} held and slots {int} and {int} empty",
  function (this: Context, agent: string, tool: string, held: number, first: number, second: number) {
    const expected: Seen[] = [];
    expected[held - 1] = "held";
    expected[first - 1] = "empty";
    expected[second - 1] = "empty";
    assert.deepEqual(JSON.parse(returned(this, agent, tool)), expected);
  },
);

Then("the world's version is the same as before the run", function (this: Context) {
  assert.equal(this.world.version, this.versionBefore);
});

Given(
  "agent {string} runs on a scripted model that writes {string} and makes no tool call",
  function (this: Context, agent: string, text: string) {
    script(this, agent, [{ text, delayMs: 0 }]);
  },
);

Then("agent {string}'s reflection {string} was recorded", function (this: Context, agent: string, text: string) {
  assert.ok(this.turns !== undefined, "the run gave no model turns");
  const reflections = this.turns.filter((turn) => turn.agent === agent).map((turn) => turn.text);
  assert.deepEqual(reflections, [text]);
});

Given(
  /^agent "([^"]*)" runs on a scripted model that calls "([^"]*)" with the arguments (\{.*\}), then ends without a tool call$/,
  function (this: Context, agent: string, tool: string, json: string) {
    script(this, agent, [
      { toolCalls: [{ name: tool, arguments: JSON.parse(json) }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
  },
);

Then("agent {string}'s {string} call has the outcome {string}", function (this: Context, agent: string, tool: string, outcome: string) {
  assert.ok(this.toolCalls !== undefined, "the run gave no tool calls");
  const calls = this.toolCalls.filter((call) => call.agent === agent && call.tool === tool);
  assert.equal(calls.length, 1, `agent "${agent}" made ${calls.length} "${tool}" calls`);
  assert.equal(calls[0]?.outcome, outcome);
  this.lastToolCall = calls[0];
});

Then(/^the call is kept with the arguments (\{.*\}), as the model made it$/, function (this: Context, json: string) {
  assert.ok(this.lastToolCall !== undefined, "no call was checked before");
  assert.deepEqual(this.lastToolCall.arguments, JSON.parse(json));
});

Then("no slot holds agent {string}", function (this: Context, agent: string) {
  assert.ok(!this.world.state.includes(agent), `a slot holds agent "${agent}": ${JSON.stringify(this.world.state)}`);
});

Then(
  "the result agent {string}'s model received for its {string} call is marked as an error and says {string}",
  function (this: Context, agent: string, tool: string, text: string) {
    assert.equal(resultOf(this, agent, tool).isError, true, "the result is not marked as an error");
    assert.equal(returned(this, agent, tool), text);
  },
);

Given(
  "the effector {string} declares only the argument {string}, and its schema does not forbid others",
  function (this: Context, name: string, argument: string) {
    const parameters = fixtureTool("effector", name).parameters as { properties: object; additionalProperties?: unknown };
    assert.deepEqual(Object.keys(parameters.properties), [argument]);
    assert.notEqual(parameters.additionalProperties, false);
  },
);

Then(
  "agent {string}'s model was offered {string} with the schema the scenario declares, unchanged",
  function (this: Context, agent: string, name: string) {
    const declared = fixtureTool("effector", name).parameters;
    for (const [turn, messages] of modelOf(this, agent).received.entries()) {
      const offered = getCurrentTools(messages).find((tool) => tool.name === name);
      assert.deepEqual(offered?.parameters, declared, `turn ${turn + 1} was offered another schema for "${name}"`);
    }
  },
);
