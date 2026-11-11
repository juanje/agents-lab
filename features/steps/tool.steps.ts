import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type JsonObject, getCurrentTools } from "@earendil-works/pi-ai";
import { run } from "../../src/engine/run.ts";
import { type ScriptedAnswer, ScriptedModel } from "../../src/engine/scripted-model.ts";
import type { LoadedScenario, Scenario } from "../../src/engine/scenario.ts";
import { type Action, World } from "../../src/engine/world.ts";
import { gridScenario } from "../../tests/fixtures/grid-world.ts";
import { SLOT_TAKEN, type Seen, type Slots, slotTools, slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";

/** The test world's tool of a kind and a name; the tools live in the fixture, and this keeps the words and it in step. */
export function fixtureTool(kind: string, name: string) {
  const tool = slotTools.find((declared) => declared.name === name);
  assert.ok(tool !== undefined, `the test world declares no tool "${name}"`);
  assert.equal(tool.kind, kind);
  return tool;
}

/** Makes the test world's tool of a kind and a name take this long, for every call and in any state. */
export function takeTime(context: Context, kind: string, name: string, durationMs: number): void {
  const declared = fixtureTool(kind, name);
  context.tools = context.tools.map((tool) => (tool.name === name ? { ...declared, durationMs: () => durationMs } : tool));
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

/** An activation whose model calls a tool with these arguments after a delay, then ends its next turn without a tool call. */
export function callWithThenEnd(tool: string, args: JsonObject, delayMs: number): ScriptedAnswer[] {
  return [
    { toolCalls: [{ name: tool, arguments: args }], delayMs },
    { text: "Done.", delayMs: 0 },
  ];
}

/** An activation whose model calls a tool with a slot after a delay, then ends its next turn without a tool call. */
export function callThenEnd(tool: string, slot: number, delayMs: number): ScriptedAnswer[] {
  return callWithThenEnd(tool, { slot }, delayMs);
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
  await runTheScenario(this);
});

/** Runs the scenario as its steps set it up, and keeps what the run gave. */
export async function runTheScenario(context: Context): Promise<void> {
  // Most of these scenarios set up their world and the scenario's parts step by step rather than from a base
  // configuration, so the scenario is assembled around them as loading would give it: the test grid world when the
  // scenario declared its tools, the slots world otherwise.
  // Its agents are the ones the scenario runs.
  const agents = [...context.models.keys(), ...context.realModels.keys()];
  if (context.assembleRun !== undefined) {
    await runScenario(context, context.assembleRun(agents));
    return;
  }
  if (context.gridTools !== undefined) {
    context.gridWorld = new World(context.grid);
    const scenario = { ...gridScenario(context.grid, context.gridTools, agents), rhythm: rhythmsOf(context) };
    await runScenario(context, assembled(scenario, context.gridWorld));
    return;
  }
  context.versionBefore = context.world.version;
  const scenario: Scenario<Slots> = {
    ...slotsScenario,
    agents: () => agents,
    tools: context.tools,
    channels: () => context.channels,
    systemPrompt: () => context.systemPrompt,
    rhythm: rhythmsOf(context),
  };
  await runScenario(context, context.loaded ?? assembled(scenario, context.world));
}

/**
 * The rhythm a test world gives an agent: the one the scenario gives that agent, or else the scenario's wait before
 * every activation.
 */
function rhythmsOf(context: Context): Scenario<unknown>["rhythm"] {
  return (_configuration, agent) => context.rhythms.get(agent) ?? (() => context.waitBeforeActivationMs);
}

/** A scenario assembled around a world as loading would give it, with no configuration. */
function assembled<State>(scenario: Scenario<State>, world: World<State>): LoadedScenario<State> {
  const agents = scenario.agents({});
  const systemPrompts = new Map(agents.map((agent) => [agent, scenario.systemPrompt({}, agent)]));
  const rhythms = new Map(agents.map((agent) => [agent, scenario.rhythm({}, agent)]));
  return { scenario, configuration: {}, world, systemPrompts, channels: scenario.channels({}), rhythms };
}

/** Runs the scenario's agents in a loaded scenario, watching its arbiter, and keeps what the run gave. */
async function runScenario<State>(context: Context, loaded: LoadedScenario<State>): Promise<void> {
  const { world } = loaded;
  context.stateBefore = world.state;
  // Watched, not changed: the arbiter still decides, and the scenario sees the order it applied effects in.
  const apply = world.apply.bind(world);
  world.apply = (action, args) => {
    const result = apply(action, args);
    if (result.applied) context.applied.push({ action: action as Action<unknown, never>, args, atMs: performance.now() });
    return result;
  };
  const agents = [...context.models, ...context.realModels].map(([name, model]) => ({
    name,
    model,
    activations: context.activations.get(name) ?? 1,
  }));
  const { turns, messages, toolCalls, sensings, startedAtMs, runId } = await run(loaded, agents, context.seed, {
    logDirectory: context.logDirectory,
    modelTurnTimeoutMs: context.modelTurnTimeoutMs,
    parallelismLimit: context.parallelismLimit,
    timeLimitMs: context.timeLimitMs,
    onStart: (stimuli) => {
      context.stimuli = stimuli;
      // Watched too: an agent wakes when its session takes its rhythm's stimulus.
      const wake = stimuli.wake.bind(stimuli);
      stimuli.wake = (agent) => {
        context.wokeAtMs.set(agent, [...(context.wokeAtMs.get(agent) ?? []), performance.now()]);
        return wake(agent);
      };
    },
  });
  context.runEndedAtMs = performance.now();
  context.runStartedAtMs = startedAtMs;
  context.runId = runId;
  context.turns = turns;
  context.sessionMessages = messages;
  context.toolCalls = toolCalls;
  context.sensings = sensings;
  for (const check of context.setupChecks) check();
}

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
    script(this, agent, callWithThenEnd(tool, {}, 0));
  },
);

Given(
  "agent {string} runs on a scripted model that calls {string} with slot {int}, then ends without a tool call",
  function (this: Context, agent: string, tool: string, slot: number) {
    script(this, agent, callThenEnd(tool, slot, 0));
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
export function returned(context: Context, agent: string, tool: string): string {
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
    script(this, agent, callWithThenEnd(tool, JSON.parse(json), 0));
  },
);

/** The agent's only call of the tool, as the run recorded it. */
export function callOf(context: Context, agent: string, tool: string) {
  assert.ok(context.toolCalls !== undefined, "the run gave no tool calls");
  const calls = context.toolCalls.filter((call) => call.agent === agent && call.tool === tool);
  assert.equal(calls.length, 1, `agent "${agent}" made ${calls.length} "${tool}" calls`);
  return calls[0];
}

Then("agent {string}'s {string} call has the outcome {string}", function (this: Context, agent: string, tool: string, outcome: string) {
  const call = callOf(this, agent, tool);
  assert.equal(call.outcome, outcome);
  this.lastToolCall = call;
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

Given(
  "the effector {string} declares the text {string} for {string} and {string} for {string}",
  function (this: Context, name: string, firstText: string, firstOutcome: string, secondText: string, secondOutcome: string) {
    const declared = fixtureTool("effector", name);
    const texts = { [firstOutcome]: firstText, [secondOutcome]: secondText };
    this.tools = this.tools.map((tool) => (tool.name === name ? { ...declared, texts } : tool));
  },
);

Given(
  "agent {string} runs on a scripted model that calls {string} with slot {int}, then calls {string} with slot {int}, then ends without a tool call",
  function (this: Context, agent: string, firstTool: string, firstSlot: number, secondTool: string, secondSlot: number) {
    script(this, agent, [
      { toolCalls: [{ name: firstTool, arguments: { slot: firstSlot } }], delayMs: 0 },
      ...callThenEnd(secondTool, secondSlot, 0),
    ]);
  },
);

/** The results the agent's model received back for its calls of the tool, in the order it made them. */
function resultsOf(context: Context, agent: string, tool: string) {
  // The last turn's transcript holds every earlier call and its result.
  const messages = modelOf(context, agent).received.at(-1) ?? [];
  const calls = messages
    .flatMap((message) => (message.role === "assistant" ? message.content : []))
    .flatMap((block) => (block.type === "toolCall" && block.name === tool ? [block] : []));
  return calls.map((call) => {
    const result = messages.find((message) => message.role === "toolResult" && message.toolCallId === call.id);
    assert.ok(result !== undefined && result.role === "toolResult", `agent "${agent}"'s "${tool}" call returned nothing`);
    return result;
  });
}

/** Checks the result the agent's model received for its call of the tool at an index from 0, and keeps who and what for the next step. */
function checkNthResult(context: Context, agent: string, tool: string, index: number, isError: boolean, text: string): void {
  const result = resultsOf(context, agent, tool)[index];
  assert.ok(result !== undefined, `agent "${agent}"'s model received no result for its call ${index + 1} of "${tool}"`);
  assert.equal(result.isError, isError, `the result is${isError ? " not" : ""} marked as an error`);
  assert.equal(result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""), text);
  context.lastResultOf = { agent, tool };
}

Then(
  "the result agent {string}'s model received for its first {string} call is marked as an error and says {string}",
  function (this: Context, agent: string, tool: string, text: string) {
    checkNthResult(this, agent, tool, 0, true, text);
  },
);

Then(
  "the result it received for its second {string} call is not marked as an error and says {string}",
  function (this: Context, tool: string, text: string) {
    assert.ok(this.lastResultOf !== undefined && this.lastResultOf.tool === tool, `no result of a "${tool}" call was checked before`);
    checkNthResult(this, this.lastResultOf.agent, tool, 1, false, text);
  },
);
