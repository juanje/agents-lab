import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { parse } from "smol-toml";
import { type Condition, loadScenario } from "../../src/engine/scenario.ts";
import { slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";

Given(
  "the test scenario {string}, whose base configuration has {int} slots",
  function (this: Context, name: string, slots: number) {
    // The scenario lives in the fixture; these checks keep the scenario's words and the fixture from drifting apart.
    assert.equal(slotsScenario.name, name);
    assert.equal(parse(slotsScenario.baseConfiguration).slots, slots);
    this.scenario = slotsScenario;
  },
);

Given(
  "a condition {string} that sets the number of slots to {int}",
  function (this: Context, name: string, slots: number) {
    this.condition = { name, change: `slots = ${slots}\n` };
  },
);

/** Loads the scenario, keeping what loading gave: the loaded scenario or the error that refused it. */
function load(context: Context, condition?: Condition): void {
  try {
    context.loaded = loadScenario(context.scenario, condition);
  } catch (error) {
    context.loadingError = error as Error;
  }
}

When("the engine loads it", function (this: Context) {
  load(this);
});

When("the engine loads it with the condition {string}", function (this: Context, name: string) {
  assert.equal(this.condition?.name, name, "the scenario gives the condition before loading with it");
  load(this, this.condition);
});

Then("it loads", function (this: Context) {
  assert.equal(this.loadingError, undefined, `expected the scenario to load, but it failed: ${this.loadingError?.message}`);
});

Then("its world starts with {int} empty slots", function (this: Context, slots: number) {
  assert.ok(this.loaded !== undefined, `expected a loaded scenario, but loading failed: ${this.loadingError?.message}`);
  assert.deepEqual(this.loaded.world.state, Array.from({ length: slots }, () => null));
  assert.equal(this.loaded.world.version, 0);
});
