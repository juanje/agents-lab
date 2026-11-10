import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createPowerShellToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Context } from "../support/context.ts";
import { modelOf, script } from "./tool.steps.ts";

Given("the scenario's system prompt is {string}", function (this: Context, prompt: string) {
  this.systemPrompt = prompt;
});

Given(
  "agent {string} makes 2 activations: in the first its model calls {string}, then ends; in the second it ends its first turn without a tool call",
  function (this: Context, agent: string, tool: string) {
    this.activations.set(agent, 2);
    script(this, agent, [
      { toolCalls: [{ name: tool, arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);
  },
);

Then("all of agent {string}'s model turns ran in the same Pi session", function (this: Context, agent: string) {
  const model = modelOf(this, agent);
  assert.equal(model.received.length, 3, `agent "${agent}"'s model made ${model.received.length} turns, not 3`);
  const sessions = new Set(model.sessions);
  assert.equal(sessions.size, 1, `agent "${agent}"'s turns ran in the sessions ${[...sessions].join(", ")}`);
  assert.ok(!sessions.has(undefined), `agent "${agent}"'s turns ran in no Pi session`);
});

Then("the system prompt agent {string}'s model received is exactly {string}", function (this: Context, agent: string, prompt: string) {
  for (const [turn, messages] of modelOf(this, agent).received.entries()) {
    assert.equal(getCurrentSystemPrompt(messages), prompt, `turn ${turn + 1} received another system prompt`);
  }
});

/** The names of Pi's built-in tools, as Pi itself defines them. */
const builtInTools = [
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createPowerShellToolDefinition,
].map((define) => define(process.cwd()).name);

Then("agent {string}'s model was offered none of Pi's built-in tools", function (this: Context, agent: string) {
  for (const [turn, messages] of modelOf(this, agent).received.entries()) {
    const offered = getCurrentTools(messages).filter((tool) => builtInTools.includes(tool.name));
    assert.deepEqual(offered.map((tool) => tool.name), [], `turn ${turn + 1} was offered Pi's built-in tools`);
  }
});

Given("agent {string} runs on a scripted model whose id is {string}", function (this: Context, agent: string, id: string) {
  this.modelIds.set(agent, id);
  this.lastAgent = agent;
});

Given("its model ends its first turn without a tool call", function (this: Context) {
  assert.ok(this.lastAgent !== undefined, "no agent was named before");
  script(this, this.lastAgent, [{ text: "Nothing to do.", delayMs: 0 }]);
});

Then("nothing agent {string}'s model received mentions {string}", function (this: Context, agent: string, text: string) {
  const model = modelOf(this, agent);
  assert.equal(model.model.id, text, `agent "${agent}"'s model is not "${text}"`);
  for (const [turn, messages] of model.received.entries()) {
    assert.ok(!JSON.stringify(messages).includes(text), `turn ${turn + 1} received "${text}"`);
  }
});
