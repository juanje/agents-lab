import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlValue, parse, stringify } from "smol-toml";
import { exits, where } from "../../src/engine/places.ts";
import type { LoadedScenario } from "../../src/engine/scenario.ts";
import { scenarioLibrary } from "../../src/scenarios/library.ts";
import { type Workplace, workplaceScenario } from "../../src/scenarios/workplace.ts";
import type { Context } from "../support/context.ts";
import { runLab } from "./lab.steps.ts";
import { assertRhythmWithin, assertWakeStimuli, inTables, lastLoaded, loadLibraryScenario, withBase } from "./neighbourhood.steps.ts";

/** The worker, the workplace's one agent. */
const WORKER = "worker";

/** A TOML value as the contract writes it, such as ["open-box"]. */
function tomlValue(text: string): TomlValue {
  return parse(`value = ${text}`).value;
}

Given("the workplace scenario, whose configuration sets {string} to:", function (this: Context, key: string, text: string) {
  this.libraryScenario = withBase(workplaceScenario, { [key]: text });
});

Given("it sets {string} to:", function (this: Context, key: string, text: string) {
  this.libraryScenario = withBase(this.libraryScenario, { [key]: text });
});

Given(
  "it sets {string} to {}, {string} to {string} and {string} to {string}",
  function (this: Context, firstKey: string, first: string, secondKey: string, second: string, thirdKey: string, third: string) {
    this.libraryScenario = withBase(this.libraryScenario, { [firstKey]: tomlValue(first), [secondKey]: second, [thirdKey]: third });
  },
);

/** The workplace as the engine loaded it last. */
function loadedWorkplace(context: Context): LoadedScenario<Workplace> {
  return lastLoaded(context);
}

/** The place an entity of the workplace's space is in; it must be in a place, not in a passage. */
function placeOf({ space }: Workplace, entity: string): string {
  const at = where(space, entity);
  assert.ok(at !== undefined, `the workplace's space holds no "${entity}"`);
  assert.ok("place" in at, `"${entity}" is in a passage, not in a place`);
  return at.place;
}

Then(
  "the space has the places {string}, {string} and {string}, with a passage of length {int} between {string} and {string} and one of length {int} between {string} and {string}",
  function (
    this: Context,
    first: string,
    second: string,
    third: string,
    firstLength: number,
    firstOne: string,
    firstOther: string,
    secondLength: number,
    secondOne: string,
    secondOther: string,
  ) {
    const { space } = loadedWorkplace(this).world.state;
    assert.deepEqual([...space.places], [first, second, third]);
    assert.deepEqual(exits(space, firstOne), [{ place: firstOther, length: firstLength }]);
    assert.deepEqual(exits(space, secondOther), [{ place: secondOne, length: secondLength }]);
    assert.equal(space.passages.length, 2);
  },
);

Then("the worker is in {string}", function (this: Context, place: string) {
  assert.equal(placeOf(loadedWorkplace(this).world.state, WORKER), place);
});

/** A thing the workplace holds, by its id. */
function thingOf(state: Workplace, id: string): Workplace["things"][string] {
  assert.ok(Object.hasOwn(state.things, id), `the workplace holds no thing "${id}"`);
  return state.things[id];
}

Then(
  "the thing {string} is in {string}, with the name {string} and the text {string}, and cannot be carried",
  function (this: Context, id: string, place: string, name: string, text: string) {
    const state = loadedWorkplace(this).world.state;
    assert.equal(placeOf(state, id), place);
    const thing = thingOf(state, id);
    assert.deepEqual({ name: thing.name, text: thing.text, portable: thing.portable }, { name, text, portable: false });
  },
);

Then(
  "the thing {string} is inside {string}, with the property {string} as {string}, and can be carried",
  function (this: Context, id: string, container: string, property: string, value: string) {
    const state = loadedWorkplace(this).world.state;
    assert.equal(state.inside[id], container, `"${id}" is not inside "${container}"`);
    assert.equal(where(state.space, id), undefined, `"${id}" is inside "${container}", so the space holds it in no place`);
    const thing = thingOf(state, id);
    assert.equal(thing.properties[property], value);
    assert.equal(thing.portable, true);
  },
);

Then("the world holds the things {string} and {string}, with {string} inside {string}", function (this: Context, first: string, second: string, held: string, container: string) {
  const state = loadedWorkplace(this).world.state;
  thingOf(state, first);
  thingOf(state, second);
  assert.equal(state.inside[held], container, `"${held}" is not inside "${container}"`);
});

Then("{string} is in {string} or in {string}", function (this: Context, id: string, one: string, other: string) {
  const place = placeOf(loadedWorkplace(this).world.state, id);
  assert.ok([one, other].includes(place), `"${id}" is in "${place}"`);
});

Then("the world holds no thing {string}", function (this: Context, id: string) {
  const { space, things } = loadedWorkplace(this).world.state;
  assert.ok(!Object.hasOwn(things, id), `the workplace holds the thing "${id}"`);
  assert.equal(where(space, id), undefined, `the workplace's space holds "${id}"`);
});

Then("{string} is in the same place both times", function (this: Context, id: string) {
  const [first, second] = this.libraryLoads as LoadedScenario<Workplace>[];
  assert.ok(first !== undefined && second !== undefined, "the scenario was not loaded twice");
  assert.equal(placeOf(second.world.state, id), placeOf(first.world.state, id));
});

Given("a condition {string} that sets {string} to [{}]", function (this: Context, name: string, key: string, items: string) {
  this.condition = { name, change: stringify({ [key]: tomlValue(`[${items}]`) }) };
});

When(
  "the engine loads it with the seed {int} and the base configuration, and again with the seed {int} and the condition {string}",
  function (this: Context, baseSeed: number, seed: number, name: string) {
    assert.equal(this.condition?.name, name, "the scenario gives the condition before loading with it");
    loadLibraryScenario(this, baseSeed);
    loadLibraryScenario(this, seed, this.condition);
  },
);

Then("under the condition {string} the thing {string} is in {string}", function (this: Context, name: string, id: string, place: string) {
  assert.equal(this.condition?.name, name, "the scenario loaded with another condition");
  assert.equal(this.libraryLoads.length, 2, "the scenario was not loaded without and with the condition");
  assert.equal(placeOf(loadedWorkplace(this).world.state, id), place);
});

Then("the person {string} is in {string}, and is not an agent", function (this: Context, id: string, place: string) {
  const { world, systemPrompts } = loadedWorkplace(this);
  assert.ok(Object.hasOwn(world.state.people, id), `the workplace holds no person "${id}"`);
  assert.equal(placeOf(world.state, id), place);
  assert.deepEqual([...systemPrompts.keys()], [WORKER]);
});

Then(
  "the worker's system prompt is {string}, then {string}, then {string}, each separated by a blank line",
  function (this: Context, first: string, second: string, third: string) {
    assert.equal(loadedWorkplace(this).systemPrompts.get(WORKER), [first, second, third].join("\n\n"));
  },
);

Given(
  "the configuration sets the rhythm channel's source to {string}, its text to {string}, {string} to {int} and {string} to {int}",
  function (this: Context, source: string, text: string, minPath: string, minMs: number, maxPath: string, maxMs: number) {
    const bounds = inTables([[minPath, minMs], [maxPath, maxMs]]);
    assert.deepEqual(Object.keys(bounds), ["rhythm"], "the bounds are the rhythm's");
    this.libraryScenario = withBase(this.libraryScenario, { rhythm: { source, text, ...(bounds.rhythm as object) } });
  },
);

Then(
  "the worker's stimuli on the channel {string} have the source {string} and the content {string}",
  function (this: Context, channel: string, source: string, content: string) {
    assertWakeStimuli(this, [WORKER], channel, source, content);
  },
);

Then("every interval the worker's rhythm draws is from {int} to {int} milliseconds", function (this: Context, minMs: number, maxMs: number) {
  assertRhythmWithin(this, [WORKER], minMs, maxMs);
});

Then(
  "the scenario holds the reserved keys of {string}: class {string}, covered {word} and kind {string}",
  function (this: Context, situation: string, kind: string, covered: string, conflict: string) {
    const { situations } = loadedWorkplace(this).world.state;
    assert.ok(Object.hasOwn(situations, situation), `the workplace holds no situation "${situation}"`);
    // The keys come as smol-toml reads a table, with no prototype; their entries are what counts.
    assert.deepEqual({ ...situations[situation].keys }, { class: kind, covered: tomlValue(covered), kind: conflict });
  },
);

Then("the worker's system prompt holds none of {string}, {string} or {string}", function (this: Context, first: string, second: string, third: string) {
  const words = [first, second, third];
  const prompt = loadedWorkplace(this).systemPrompts.get(WORKER) ?? "";
  assert.ok(prompt !== "", "the worker has no system prompt");
  const held = words.filter((word) => prompt.includes(word));
  assert.deepEqual(held, [], `the worker's system prompt holds ${held.join(", ")}: ${prompt}`);
});

When('"lab inventory" lists it', async function (this: Context) {
  // An experiment of one condition, with no change, over the workplace as the scenario configured it.
  const scenario = String(this.libraryScenario.name);
  this.library = new Map([...scenarioLibrary, [scenario, this.libraryScenario]]);
  this.experimentFile = {
    id: "workplace-inventory",
    scenario,
    models: ["faux/scripted"],
    thinking_level: "off",
    replicas: 1,
    seed: 42,
    limits: { time_limit_ms: 1_000, activations_per_agent: 1, parallelism_limit: 1, model_turn_timeout_ms: 1_000 },
    conditions: { base: {} },
  };
  await runLab(this, "inventory");
  assert.equal(this.labError, undefined, `"lab inventory" failed: ${this.labError?.message}`);
});

Then("the inventory lists the chosen situation {string} by its id only", function (this: Context, situation: string) {
  const printed = this.labOutput ?? "";
  const lines = printed.split("\n").filter((line) => line.includes(situation));
  assert.equal(lines.length, 1, `the inventory names "${situation}" on ${lines.length} lines:\n${printed}`);
  assert.equal(lines[0].replace(/^- /, "").replaceAll("`", "").trim(), situation, `the inventory lists more than the id: ${lines[0]}`);
  // Nothing the situation brings or holds reaches it: neither its things nor its reserved keys.
  for (const text of ["a cardboard box", "a folded note", "honesty", "conflict"]) {
    assert.ok(!printed.includes(text), `the inventory holds "${text}"`);
  }
});
