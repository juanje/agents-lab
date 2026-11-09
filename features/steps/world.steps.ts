import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { World } from "../../src/engine/world.ts";
import { SLOT_TAKEN, emptySlots, holder, take } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";

Given("a test world with {int} slots, all empty", function (this: Context, count: number) {
  this.world = new World(emptySlots(count));
});

Given(
  "the action {string} puts an agent in a slot, only if that slot is empty, and otherwise fails with {string}",
  (name: string, reason: string) => {
    // The rule lives in the fixture; these checks keep the scenario's words and the fixture from drifting apart.
    assert.equal(name, "take");
    assert.equal(reason, SLOT_TAKEN);
  },
);

Given("agent {string} holds slot {int}", function (this: Context, agent: string, slot: number) {
  // The arbiter is the only writer, so the setup goes through it too.
  assert.deepEqual(this.world.apply(take, { agent, slot }), { applied: true });
});

When("agent {string} takes slot {int}", function (this: Context, agent: string, slot: number) {
  this.versionBefore = this.world.version;
  this.result = this.world.apply(take, { agent, slot });
});

Then("the action succeeds", function (this: Context) {
  assert.deepEqual(this.result, { applied: true });
});

Then("the action fails with {string}", function (this: Context, reason: string) {
  assert.deepEqual(this.result, { applied: false, reason });
});

Then("the world's version is the same as before the action", function (this: Context) {
  assert.equal(this.world.version, this.versionBefore);
});

Then("slot {int} holds agent {string}", function (this: Context, slot: number, agent: string) {
  assert.equal(holder(this.world.state, slot), agent);
});

Then("the world's version is {int}", function (this: Context, version: number) {
  assert.equal(this.world.version, version);
});

When(
  "agents {string} and {string} both take slot {int} at the same moment",
  async function (this: Context, first: string, second: string, slot: number) {
    this.versionBefore = this.world.version;
    // Each request yields once before it reaches the arbiter, so both are in flight before either is applied,
    // as when two agents' loops finish deciding in the same tick.
    this.results = await Promise.all(
      [first, second].map(async (agent) => {
        await Promise.resolve();
        return this.world.apply(take, { agent, slot });
      }),
    );
  },
);

Then("exactly one of the two actions succeeds", function (this: Context) {
  assert.equal(this.results.filter((outcome) => outcome.applied).length, 1);
});

Then("the other fails with {string}", function (this: Context, reason: string) {
  assert.deepEqual(
    this.results.filter((outcome) => !outcome.applied),
    [{ applied: false, reason }],
  );
});

Then("the world's version grew by {int}", function (this: Context, growth: number) {
  assert.equal(this.world.version, this.versionBefore + growth);
});
