import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import type { Component } from "../../src/engine/components.ts";
import type { Random } from "../../src/engine/random.ts";
import { World } from "../../src/engine/world.ts";
import { SLOT_TAKEN, type Slots, drawBetween, emptySlots, filler, holder, slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { stateAt } from "./acting.steps.ts";
import { logLines } from "./record.steps.ts";
import { callOf, runTheScenario, script } from "./tool.steps.ts";

/** How a component of the test world fills its slot, as the scenario declares it, so another can have the same cycle. */
interface Filling {
  slot: number;
  thing: string;
  waitMs: (random: Random) => number;
  actionMs: number;
}

/** What the scenario declared of each test world component, by its name, and the waits each one drew, in order. */
const fillings = new WeakMap<Context, Map<string, Filling>>();
const waits = new WeakMap<Context, Map<string, number[]>>();

function fillingsOf(context: Context): Map<string, Filling> {
  const declared = fillings.get(context) ?? new Map<string, Filling>();
  fillings.set(context, declared);
  return declared;
}

function waitsOf(context: Context): Map<string, number[]> {
  const drawn = waits.get(context) ?? new Map<string, number[]>();
  waits.set(context, drawn);
  return drawn;
}

/** Declares a test world component, in place of any of the same name, keeping each wait it draws. */
function declare(context: Context, name: string, filling: Filling): void {
  fillingsOf(context).set(name, filling);
  const component = filler(name, {
    ...filling,
    waitMs: (random) => {
      const ms = filling.waitMs(random);
      waitsOf(context).set(name, [...(waitsOf(context).get(name) ?? []), ms]);
      return ms;
    },
  });
  const others = context.components.filter((declared) => declared.name !== name);
  context.components = [...others, component];
}

function fillingOf(context: Context, name: string): Filling {
  const filling = fillingsOf(context).get(name);
  assert.ok(filling !== undefined, `the scenario declares no component "${name}"`);
  return filling;
}

Given("a test world with {int} slots, slot {int} held by {string}", function (this: Context, count: number, slot: number, thing: string) {
  this.world = new World<Slots>(emptySlots(count).map((holder, index) => (index === slot - 1 ? thing : holder)));
});

Given(
  "the component {string}, whose cycle waits a number of milliseconds drawn from {int} to {int} from its own random sequence, then fills slot {int} with {string}, an action that takes {int} milliseconds and fails with {string} when the slot is held when it lands, then ends",
  function (this: Context, name: string, minMs: number, maxMs: number, slot: number, thing: string, actionMs: number, reason: string) {
    assert.equal(reason, SLOT_TAKEN);
    declare(this, name, { slot, thing, waitMs: drawBetween(minMs, maxMs), actionMs });
  },
);

Given("the component {string}, with the same cycle as {string} but filling slot {int}", function (this: Context, name: string, like: string, slot: number) {
  declare(this, name, { ...fillingOf(this, like), slot });
});

Given("the porter's wait is drawn as {int} milliseconds", function (this: Context, ms: number) {
  declare(this, "porter", { ...fillingOf(this, "porter"), waitMs: () => ms });
});

Given("agent {string} runs on a scripted model that ends every turn without a tool call", function (this: Context, agent: string) {
  script(this, agent, [{ text: "Nothing to do.", delayMs: 0 }]);
});

Given(
  "agent {string} runs on a scripted model that calls {string} with slot {int} at once, then ends without a tool call",
  function (this: Context, agent: string, tool: string, slot: number) {
    script(this, agent, [
      { toolCalls: [{ name: tool, arguments: { slot } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
  },
);

Given(
  "agent {string} runs on a scripted model that calls {string}, then waits {int} milliseconds, then calls {string} with slot {int}, then ends without a tool call",
  function (this: Context, agent: string, first: string, waitMs: number, second: string, slot: number) {
    script(this, agent, [
      { toolCalls: [{ name: first, arguments: {} }], delayMs: 0 },
      { toolCalls: [{ name: second, arguments: { slot } }], delayMs: waitMs },
      { text: "Done.", delayMs: 0 },
    ]);
  },
);

When(
  "two replicas run with the seed {int}, one with {string} alone and one with {string} and {string}",
  async function (this: Context, seed: number, alone: string, first: string, second: string) {
    assert.equal(alone, first);
    const start = this.world.state;
    const declared = new Map(this.components.map((component) => [component.name, component]));
    const named = (name: string) => {
      const component = declared.get(name);
      assert.ok(component !== undefined, `the scenario declares no component "${name}"`);
      return component;
    };
    this.seed = seed;
    // The added component is declared first, so a sequence shared among components, or derived by their order, would
    // give the porter another draw.
    for (const components of [[named(alone)], [named(second), named(first)]]) {
      this.world = new World(start);
      this.components = components;
      await runTheScenario(this);
    }
  },
);

/** The log's only line for an action of the component. */
function actionOf(context: Context, component: string) {
  const lines = logLines(context).filter((line) => line.type === "component_action" && line.component === component);
  assert.equal(lines.length, 1, `the log has ${lines.length} action lines for the component "${component}"`);
  return lines[0] as unknown as { action: unknown; startedAtMs: number; endedAtMs: number; outcome: string };
}

Then("slot {int} holds {string}", function (this: Context, slot: number, thing: string) {
  assert.equal(holder(this.world.state, slot), thing);
});

Then("slot {int} is empty", function (this: Context, slot: number) {
  assert.equal(holder(this.world.state, slot), null);
});

Then(
  "the run's log has a line for the porter's action, with when it started and ended and the outcome {string}",
  function (this: Context, outcome: string) {
    const line = actionOf(this, "porter");
    assert.equal(typeof line.action, "string");
    assert.equal(line.outcome, outcome);
    // It lasted the action's duration.
    assert.ok(line.endedAtMs - line.startedAtMs >= fillingOf(this, "porter").actionMs, `the action lasted ${line.endedAtMs - line.startedAtMs} ms`);
  },
);

Then("no model was called for the porter", function (this: Context) {
  assert.ok(this.turns !== undefined, "the run gave no model turns");
  const agents = [...this.models.keys()];
  assert.ok(!agents.includes("porter"), "the porter runs on a model");
  const others = this.turns.filter((turn) => !agents.includes(turn.agent));
  assert.deepEqual(others, [], "a model turn was made for no agent of the scenario");
});

Then("the porter's action failed with {string}", function (this: Context, reason: string) {
  assert.equal(actionOf(this, "porter").outcome, reason);
});

Then("the porter's action is recorded with the outcome {string}", function (this: Context, outcome: string) {
  assert.equal(actionOf(this, "porter").outcome, outcome);
});

Then("slot {int} was still empty {int} milliseconds after the porter's action started", function (this: Context, slot: number, afterMs: number) {
  const { startedAtMs } = actionOf(this, "porter");
  assert.equal(holder(stateAt<Slots>(this, startedAtMs + afterMs), slot), null);
});

Then(
  "agent {string}'s {string} call recorded {int} change(s) since sensing, applied by {string}",
  function (this: Context, agent: string, tool: string, count: number, by: string) {
    const call = callOf(this, agent, tool);
    assert.equal(call.changesSinceSensing, count);
    assert.deepEqual(call.changesSinceSensingBy, Array.from({ length: count }, () => by));
  },
);

Then("the porter's wait is the same in both replicas", function (this: Context) {
  const drawn = waitsOf(this).get("porter") ?? [];
  assert.equal(drawn.length, 2, `the porter drew ${drawn.length} waits`);
  assert.equal(drawn[0], drawn[1]);
});

Given(
  "the component {string} is declared by the configuration as an external perturbation, whose cycle fills slot {int} with {string} after {int} milliseconds",
  function (this: Context, name: string, slot: number, thing: string, waitMs: number) {
    declare(this, name, { slot, thing, waitMs: () => waitMs, actionMs: 0 });
    const declared = new Map(this.components.map((component) => [component.name, component]));
    // The configuration declares the porter part of the world and this component an external perturbation; the
    // scenario gives each its cycle by its name.
    const kinds: Record<string, Component<Slots>["kind"]> = { porter: "world", [name]: "perturbation" };
    const table = Object.entries(kinds).map(([component, kind]) => `[components.${JSON.stringify(component)}]\nkind = ${JSON.stringify(kind)}\n`);
    this.libraryScenario = {
      ...slotsScenario,
      baseConfiguration: [slotsScenario.baseConfiguration, ...table].join("\n"),
      components: (configuration) =>
        Object.entries(configuration.components as Record<string, { kind: Component<Slots>["kind"] }>).map(([component, { kind }]) => {
          const cycle = declared.get(component);
          assert.ok(cycle !== undefined, `the scenario gives no cycle to the component "${component}"`);
          return { ...cycle, kind };
        }),
    };
  },
);

Then(
  "it lists {string} as part of the world and {string} as an external perturbation, each with the description of its cycle",
  function (this: Context, world: string, perturbation: string) {
    const printed = this.labOutput ?? "";
    for (const [name, kind] of [
      [world, "part of the world"],
      [perturbation, "external perturbation"],
    ]) {
      const component = this.components.find((declared) => declared.name === name);
      assert.ok(component !== undefined, `the scenario declares no component "${name}"`);
      const listed = `#### Component "${name}"\n\n- Kind: ${kind}\n- Cycle: ${component.description}\n`;
      assert.ok(printed.includes(listed), `the inventory does not list:\n${listed}\nIt printed:\n${printed}`);
    }
  },
);
