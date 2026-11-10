import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
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
