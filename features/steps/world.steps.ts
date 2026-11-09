import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { World, type ActionResult } from "../../src/engine/world.ts";
import { SLOT_TAKEN, emptySlots, holder, take, type Slots } from "../../tests/fixtures/slots.ts";

let world: World<Slots>;
let result: ActionResult;
let versionBefore: number;
let results: ActionResult[];

Given("a test world with {int} slots, all empty", (count: number) => {
  world = new World(emptySlots(count));
});

Given(
  "the action {string} puts an agent in a slot, only if that slot is empty, and otherwise fails with {string}",
  (name: string, reason: string) => {
    // The rule lives in the fixture; these checks keep the scenario's words and the fixture from drifting apart.
    assert.equal(name, "take");
    assert.equal(reason, SLOT_TAKEN);
  },
);

Given("agent {string} holds slot {int}", (agent: string, slot: number) => {
  // The arbiter is the only writer, so the setup goes through it too.
  assert.deepEqual(world.apply(take, { agent, slot }), { applied: true });
});

When("agent {string} takes slot {int}", (agent: string, slot: number) => {
  versionBefore = world.version;
  result = world.apply(take, { agent, slot });
});

Then("the action succeeds", () => {
  assert.deepEqual(result, { applied: true });
});

Then("the action fails with {string}", (reason: string) => {
  assert.deepEqual(result, { applied: false, reason });
});

Then("the world's version is the same as before the action", () => {
  assert.equal(world.version, versionBefore);
});

Then("slot {int} holds agent {string}", (slot: number, agent: string) => {
  assert.equal(holder(world.state, slot), agent);
});

Then("the world's version is {int}", (version: number) => {
  assert.equal(world.version, version);
});

When(
  "agents {string} and {string} both take slot {int} at the same moment",
  async (first: string, second: string, slot: number) => {
    versionBefore = world.version;
    // Each request yields once before it reaches the arbiter, so both are in flight before either is applied,
    // as when two agents' loops finish deciding in the same tick.
    results = await Promise.all(
      [first, second].map(async (agent) => {
        await Promise.resolve();
        return world.apply(take, { agent, slot });
      }),
    );
  },
);

Then("exactly one of the two actions succeeds", () => {
  assert.equal(results.filter((outcome) => outcome.applied).length, 1);
});

Then("the other fails with {string}", (reason: string) => {
  assert.deepEqual(
    results.filter((outcome) => !outcome.applied),
    [{ applied: false, reason }],
  );
});

Then("the world's version grew by {int}", (growth: number) => {
  assert.equal(world.version, versionBefore + growth);
});
