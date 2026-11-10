import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { getCurrentTools } from "@earendil-works/pi-ai";
import { run } from "../../src/engine/run.ts";
import { type ScriptedAnswer, ScriptedModel } from "../../src/engine/scripted-model.ts";
import { SLOT_TAKEN, type Seen, slotTools } from "../../tests/fixtures/slots.ts";
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
  context.models.set(agent, new ScriptedModel(answers));
}

Given(
  "agent {string} runs on a scripted model that ends its first turn without a tool call",
  function (this: Context, agent: string) {
    script(this, agent, [{ text: "Nothing to do.", delayMs: 0 }]);
  },
);

When("the run ends", async function (this: Context) {
  this.versionBefore = this.world.version;
  const agents = [...this.models].map(([name, model]) => ({
    name,
    model,
    activations: this.activations.get(name) ?? 1,
    rhythm: () => 0,
  }));
  // Any seed: these rhythms draw nothing from it.
  await run(this.world, slotTools, agents, 1);
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

/** The text the agent's model received back for its first call of the tool, in a later turn. */
function returned(context: Context, agent: string, tool: string): string {
  const messages = modelOf(context, agent).received.flat();
  const call = messages
    .flatMap((message) => (message.role === "assistant" ? message.content : []))
    .find((block) => block.type === "toolCall" && block.name === tool);
  assert.ok(call !== undefined && call.type === "toolCall", `agent "${agent}"'s model had no call of "${tool}" in its transcript`);
  const result = messages.find((message) => message.role === "toolResult" && message.toolCallId === call.id);
  assert.ok(result !== undefined && result.role === "toolResult", `agent "${agent}"'s "${tool}" call returned nothing`);
  return result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
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
