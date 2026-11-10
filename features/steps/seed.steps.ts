import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { parse } from "smol-toml";
import type { Random } from "../../src/engine/random.ts";
import { run } from "../../src/engine/run.ts";
import { type Condition, loadScenario } from "../../src/engine/scenario.ts";
import { ScriptedModel } from "../../src/engine/scripted-model.ts";
import { type Slots, placedAgent, placingScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";

/** The placing scenario's [slots] table: how many slots it has and how many agents it places. */
function placingSlots(): { count: number; agents: number } {
  // smol-toml gives tables a null prototype, so the fields are copied out of the table.
  const { count, agents } = parse(placingScenario.baseConfiguration).slots as { count: number; agents: number };
  return { count, agents };
}

Given(
  "the test scenario {string} with {int} slots, which places {int} agents on random empty slots",
  function (this: Context, name: string, count: number, agents: number) {
    // The scenario lives in the fixture; these checks keep the scenario's words and the fixture from drifting apart.
    assert.equal(placingScenario.name, name);
    assert.deepEqual(placingSlots(), { count, agents });
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
  const { agents } = placingSlots();
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

Given(
  "each agent waits a random interval between {int} and {int} milliseconds between decisions",
  function (this: Context, minMs: number, maxMs: number) {
    this.rhythmRange = { minMs, maxMs };
  },
);

/** How many activations each agent has in a replica: enough for a sequence of intervals, not only one. */
const ACTIVATIONS = 3;

/**
 * Runs one replica of the scenario with a seed, under a condition or its base configuration: each placed agent waits on
 * a scripted model and draws its intervals uniformly from the scenario's range. Gives the intervals each agent's rhythm
 * drew, in order.
 */
async function runReplica(context: Context, seed: number, condition?: Condition): Promise<Map<string, number[]>> {
  const { world, configuration } = loadScenario(context.scenario, seed, condition);
  const { minMs, maxMs } = context.rhythmRange;
  const { agents } = configuration.slots as { agents: number };
  const drawn = new Map<string, number[]>();
  const runningAgents = Array.from({ length: agents }, (_, index) => {
    const name = placedAgent(index + 1);
    const intervals: number[] = [];
    drawn.set(name, intervals);
    return {
      name,
      model: new ScriptedModel(Array.from({ length: ACTIVATIONS }, () => ({ text: "resting", delayMs: 0 }))),
      activations: ACTIVATIONS,
      rhythm: (agentRandom: Random) => {
        const intervalMs = minMs + agentRandom.next() * (maxMs - minMs);
        intervals.push(intervalMs);
        return intervalMs;
      },
    };
  });
  await run(world, runningAgents, seed);
  return drawn;
}

When("two replicas run with the seed {int}", async function (this: Context, seed: number) {
  this.replicaIntervals = [await runReplica(this, seed), await runReplica(this, seed)];
});

Given(
  "a condition {string} that places {int} agents instead of {int}",
  function (this: Context, name: string, agents: number, base: number) {
    assert.equal(placingSlots().agents, base);
    this.condition = { name, change: `[slots]\nagents = ${agents}\n` };
  },
);

When(
  "one replica runs with the seed {int} and the base configuration, and another with the seed {int} and the condition {string}",
  async function (this: Context, baseSeed: number, conditionSeed: number, name: string) {
    assert.equal(this.condition?.name, name, "the scenario gives the condition before running with it");
    this.replicaIntervals = [await runReplica(this, baseSeed), await runReplica(this, conditionSeed, this.condition)];
  },
);

/**
 * Checks that each of the given agents drew a full sequence of intervals within the scenario's range in the first
 * replica, and the same sequence in the second.
 */
function assertSameIntervals(context: Context, agents: readonly string[]): void {
  const [first, second] = context.replicaIntervals;
  const { minMs, maxMs } = context.rhythmRange;
  assert.ok(agents.length > 1, `expected several agents to run, got ${agents.length}`);
  for (const agent of agents) {
    const intervals = first.get(agent) ?? [];
    assert.equal(intervals.length, ACTIVATIONS, `expected ${ACTIVATIONS} intervals of "${agent}", got ${intervals.length}`);
    for (const intervalMs of intervals) {
      assert.ok(minMs <= intervalMs && intervalMs <= maxMs, `"${agent}" waited ${intervalMs} ms, outside the range`);
    }
    assert.deepEqual(second.get(agent), intervals, `expected "${agent}" to wait the same intervals in both replicas`);
  }
}

Then("each agent waited the same sequence of intervals in both replicas", function (this: Context) {
  const [first, second] = this.replicaIntervals;
  assert.deepEqual([...second.keys()], [...first.keys()]);
  assertSameIntervals(this, [...first.keys()]);
});

Then(
  "each of the {int} agents present in both replicas waited the same sequence of intervals in both",
  function (this: Context, count: number) {
    const [first, second] = this.replicaIntervals;
    const inBoth = [...first.keys()].filter((agent) => second.has(agent));
    assert.equal(inBoth.length, count, `expected ${count} agents in both replicas, got ${inBoth.join(", ")}`);
    assert.ok(second.size > first.size, `expected the condition to run more agents, got ${second.size} and ${first.size}`);
    assertSameIntervals(this, inBoth);
  },
);
