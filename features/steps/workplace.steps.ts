import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { type TomlValue, parse } from "smol-toml";
import { exits, where } from "../../src/engine/places.ts";
import type { LoadedScenario } from "../../src/engine/scenario.ts";
import { type Workplace, workplaceScenario } from "../../src/scenarios/workplace.ts";
import type { Context } from "../support/context.ts";
import { lastLoaded, withBase } from "./neighbourhood.steps.ts";

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

Then("the person {string} is in {string}, and is not an agent", function (this: Context, id: string, place: string) {
  const { world, systemPrompts } = loadedWorkplace(this);
  assert.ok(Object.hasOwn(world.state.people, id), `the workplace holds no person "${id}"`);
  assert.equal(placeOf(world.state, id), place);
  assert.deepEqual([...systemPrompts.keys()], [WORKER]);
});
