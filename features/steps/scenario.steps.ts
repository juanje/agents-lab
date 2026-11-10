import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { parse } from "smol-toml";
import { loadScenario } from "../../src/engine/scenario.ts";
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

When("the engine loads it", function (this: Context) {
  try {
    this.loaded = loadScenario(this.scenario);
  } catch (error) {
    this.loadingError = error as Error;
  }
});

Then("it loads", function (this: Context) {
  assert.equal(this.loadingError, undefined, `expected the scenario to load, but it failed: ${this.loadingError?.message}`);
});

Then("its world starts with {int} empty slots", function (this: Context, slots: number) {
  assert.ok(this.loaded !== undefined, `expected a loaded scenario, but loading failed: ${this.loadingError?.message}`);
  assert.deepEqual(this.loaded.world.state, Array.from({ length: slots }, () => null));
  assert.equal(this.loaded.world.version, 0);
});
