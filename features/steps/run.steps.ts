import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { run } from "../../src/engine/run.ts";
import { ScriptedModel } from "../../src/engine/scripted-model.ts";
import type { Context } from "../support/context.ts";

Given(
  "agent {string} runs on a scripted model that answers {string}, then {string}",
  function (this: Context, agent: string, first: string, second: string) {
    this.models.set(agent, new ScriptedModel([first, second].map((text) => ({ text, delayMs: 0 }))));
  },
);

Given("agent {string} makes {int} decision(s)", function (this: Context, agent: string, decisions: number) {
  this.budgets.set(agent, decisions);
});

When("the run ends", async function (this: Context) {
  const agents = [...this.models].map(([name, model]) => ({ name, model, decisions: this.budgets.get(name) ?? 0 }));
  this.decisions = await run(this.world, this.actions, agents);
});

Then(
  "agent {string}'s decisions had the answers {string} and {string}, in that order",
  function (this: Context, agent: string, first: string, second: string) {
    assert.deepEqual(
      this.decisions.get(agent)?.map((decision) => decision.answer),
      [first, second],
    );
  },
);
