import assert from "node:assert/strict";
import { Before, Given, Then, When } from "@cucumber/cucumber";
import { World, type ActionResult } from "../../src/engine/world.ts";
import { SLOT_TAKEN, emptySlots, holder, take, type Slots } from "../../tests/fixtures/slots.ts";

let world: World<Slots>;
let result: ActionResult;
let versionBefore: number;

Before(() => {
  world = new World(emptySlots(0));
});

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

When("agent {string} takes slot {int}", (agent: string, slot: number) => {
  versionBefore = world.version;
  result = world.apply(take, { agent, slot });
});

Then("the action succeeds", () => {
  assert.deepEqual(result, { applied: true });
});

Then("slot {int} holds agent {string}", (slot: number, agent: string) => {
  assert.equal(holder(world.state, slot), agent);
});

Then("the world's version is {int}", (version: number) => {
  assert.equal(world.version, version);
});
