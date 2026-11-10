import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, type TomlValue, parse, stringify } from "smol-toml";
import { run } from "../../src/engine/run.ts";
import { type Condition, type Scenario, loadScenario } from "../../src/engine/scenario.ts";
import { ScriptedModel } from "../../src/engine/scripted-model.ts";
import { type Slots, slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";

Given(
  "the test scenario {string}, whose base configuration has {int} slots, none held",
  function (this: Context, name: string, count: number) {
    // The scenario lives in the fixture; these checks keep the scenario's words and the fixture from drifting apart.
    assert.equal(slotsScenario.name, name);
    const slots = parse(slotsScenario.baseConfiguration).slots as { count: number; held: number };
    assert.equal(slots.count, count);
    assert.equal(slots.held, 0);
    this.scenario = slotsScenario;
  },
);

Given(
  "a condition {string} that sets the number of slots to {int}",
  function (this: Context, name: string, count: number) {
    this.condition = { name, change: `[slots]\ncount = ${count}\n` };
  },
);

/** A condition whose change, in TOML, sets one value at a dotted path such as "slots.held". */
function setAt(name: string, path: string, value: TomlValue): Condition {
  const change = path.split(".").reduceRight<TomlValue>((inner, key) => ({ [key]: inner }), value) as TomlTable;
  return { name, change: stringify(change) };
}

Given("a condition {string} that sets {string} to {int}", function (this: Context, name: string, path: string, value: number) {
  this.condition = setAt(name, path, value);
});

/**
 * Loads the scenario as the engine does before a run: an agent waits on a scripted model, and the run starts only
 * when loading succeeds. A refusal that came after the run would show as a call to that model.
 */
async function load(context: Context, condition?: Condition): Promise<void> {
  const model = new ScriptedModel([{ text: "wait", delayMs: 0 }]);
  context.models.set("a", model);
  try {
    context.loaded = loadScenario(context.scenario, condition);
  } catch (error) {
    context.loadingError = error as Error;
    return;
  }
  const { world, scenario } = context.loaded;
  context.start = { state: world.state, version: world.version };
  // A run on a scenario that should have been refused can break on its missing part; the model was still called,
  // which the scenario's own checks report, so the break is not what this step reports.
  try {
    context.decisions = await run(world, scenario.actions, [{ name: "a", model, decisions: 1, rhythm: () => 0 }]);
  } catch {
    return;
  }
}

When("the engine loads it", async function (this: Context) {
  await load(this);
});

When("the engine loads it with the condition {string}", async function (this: Context, name: string) {
  assert.equal(this.condition?.name, name, "the scenario gives the condition before loading with it");
  await load(this, this.condition);
});

Then("it loads", function (this: Context) {
  assert.equal(this.loadingError, undefined, `expected the scenario to load, but it failed: ${this.loadingError?.message}`);
});

Then("its world starts with {int} empty slots", function (this: Context, slots: number) {
  assert.ok(this.start !== undefined, `expected a loaded scenario, but loading failed: ${this.loadingError?.message}`);
  assert.deepEqual(this.start, { state: Array.from({ length: slots }, () => null), version: 0 });
});

Then("its world starts with {int} slots, {int} of them held", function (this: Context, count: number, held: number) {
  assert.ok(this.start !== undefined, `expected a loaded scenario, but loading failed: ${this.loadingError?.message}`);
  assert.equal(this.start.state.length, count, `expected ${count} slots, got ${this.start.state.length}`);
  assert.equal(this.start.state.filter((holder) => holder !== null).length, held);
  assert.equal(this.start.version, 0);
});

/** The scenario's words for each part, and the scenario's property that holds it. */
const parts: Readonly<Record<string, keyof Scenario<Slots>>> = {
  "initial state": "initialState",
  perception: "perception",
  actions: "actions",
  metrics: "metrics",
  "system prompt": "systemPrompt",
  "base configuration": "baseConfiguration",
};

Given("the test scenario {string} without its {}", function (this: Context, name: string, part: string) {
  assert.equal(slotsScenario.name, name);
  const property = parts[part];
  assert.ok(property !== undefined, `no scenario part is called "${part}"`);
  const { [property]: _left, ...rest } = slotsScenario;
  this.scenario = rest;
});

Then("loading fails with an error that names {string}", function (this: Context, part: string) {
  if (this.loadingError === undefined) assert.fail("expected loading to fail, but it loaded");
  if (!this.loadingError.message.includes(part)) {
    assert.fail(`expected the error to name "${part}", got: ${this.loadingError.message}`);
  }
});

Then("no model was called", function (this: Context) {
  for (const [agent, model] of this.models) {
    if (model.exhausted) assert.fail(`expected no call to agent "${agent}"'s model, but its script was used`);
  }
});
