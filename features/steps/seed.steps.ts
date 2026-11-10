import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { parse } from "smol-toml";
import { loadScenario } from "../../src/engine/scenario.ts";
import { type Slots, placingScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";

Given(
  "the test scenario {string} with {int} slots, which places {int} agents on random empty slots",
  function (this: Context, name: string, count: number, agents: number) {
    // The scenario lives in the fixture; these checks keep the scenario's words and the fixture from drifting apart.
    assert.equal(placingScenario.name, name);
    // smol-toml gives tables a null prototype, so the fields are compared, not the table.
    const slots = parse(placingScenario.baseConfiguration).slots as { count: number; agents: number };
    assert.deepEqual({ count: slots.count, agents: slots.agents }, { count, agents });
    this.scenario = placingScenario;
  },
);

/** Starts one replica of the scenario with a seed, and gives its world's initial state. */
function start(context: Context, seed: number): Slots {
  return loadScenario(context.scenario, seed).world.state;
}

When("two replicas start with the seed {int}", function (this: Context, seed: number) {
  this.replicaStarts = [start(this, seed), start(this, seed)];
});

When(
  "one replica starts with the seed {int} and another with the seed {int}",
  function (this: Context, first: number, second: number) {
    this.replicaStarts = [start(this, first), start(this, second)];
  },
);

/** Checks that a replica started with the scenario's agents placed, so comparing two starts compares placements. */
function assertPlaced(slots: Slots): void {
  const agents = (parse(placingScenario.baseConfiguration).slots as { agents: number }).agents;
  assert.equal(slots.filter((holder) => holder !== null).length, agents, `expected ${agents} agents placed, got ${slots}`);
}

Then("both start with the agents on the same slots", function (this: Context) {
  const [first, second] = this.replicaStarts;
  assertPlaced(first);
  assertPlaced(second);
  assert.deepEqual(second, first, "expected the same seed to place the agents on the same slots");
});

Then("the agents start on different slots in the two replicas", function (this: Context) {
  const [first, second] = this.replicaStarts;
  assertPlaced(first);
  assertPlaced(second);
  assert.notDeepEqual(second, first, `expected different seeds to place the agents differently, both gave ${first}`);
});
