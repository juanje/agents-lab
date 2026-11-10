import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { act } from "../../src/engine/actions.ts";
import { declaredActions } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";

Given("the declared actions are {string} and {string}", function (this: Context, first: string, second: string) {
  // The declarations live in the fixture; this check keeps the scenario's words and the fixture from drifting apart.
  const signatures = declaredActions.map((action) =>
    [action.name, ...action.arguments.map((argument) => `<${argument.name}>`)].join(" "),
  );
  assert.deepEqual(signatures, [first, second]);
  this.actions = declaredActions;
});

When("agent {string} answers {string}", function (this: Context, agent: string, answer: string) {
  this.outcome = act(this.world, this.actions, agent, answer);
});

When("agent {string} answers:", function (this: Context, agent: string, answer: string) {
  this.outcome = act(this.world, this.actions, agent, answer);
});

Then("the decision's outcome is {string}", function (this: Context, outcome: string) {
  assert.equal(this.outcome, outcome);
});

Then("every slot is empty", function (this: Context) {
  assert.deepEqual(this.world.state.filter((holder) => holder !== null), []);
});
