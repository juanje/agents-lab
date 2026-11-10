import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { getCurrentTools } from "@earendil-works/pi-ai";
import { run } from "../../src/engine/run.ts";
import { type ScriptedAnswer, ScriptedModel } from "../../src/engine/scripted-model.ts";
import { SLOT_TAKEN, slotTools } from "../../tests/fixtures/slots.ts";
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

/** Gives an agent a scripted model with these answers; the run gives each agent one activation to give them in. */
function script(context: Context, agent: string, answers: readonly ScriptedAnswer[]): void {
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
  const agents = [...this.models].map(([name, model]) => ({ name, model, activations: 1, rhythm: () => 0 }));
  // Any seed: these rhythms draw nothing from it.
  await run(this.world, slotTools, agents, 1);
});

/** The scripted model agent runs on, which has made at least one turn. */
function modelOf(context: Context, agent: string): ScriptedModel {
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
