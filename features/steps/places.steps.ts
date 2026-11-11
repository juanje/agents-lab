import assert from "node:assert/strict";
import { BeforeStep, Given, Then, When } from "@cucumber/cucumber";
import { type Places, arrive, entitiesIn, exits, inSight, layout, leave, put, where } from "../../src/engine/places.ts";
import { type Action, World } from "../../src/engine/world.ts";
import type { Context } from "../support/context.ts";

Given(
  "a space with the places {string}, {string} and {string}, a passage of length {int} between {string} and {string}, and a passage of length {int} between {string} and {string}",
  function (this: Context, first: string, second: string, third: string, length1: number, from1: string, to1: string, length2: number, from2: string, to2: string) {
    this.places = layout(
      [first, second, third],
      [
        { between: [from1, to1], length: length1 },
        { between: [from2, to2], length: length2 },
      ],
    );
  },
);

/** The space as it is now: the arbiter's, once a step has acted on it, or else as the scenario set it up. */
function current(context: Context): Places {
  return context.placesWorld?.state ?? context.places;
}

Given(
  "entity {string} is in {string} and entity {string} is in {string}",
  function (this: Context, first: string, firstPlace: string, second: string, secondPlace: string) {
    this.places = put(put(this.places, first, firstPlace), second, secondPlace);
  },
);

BeforeStep(function (this: Context, { pickleStep }) {
  this.checking = pickleStep.type === "Outcome";
});

// The contract says "entity … is in" both to put an entity in a place, as a Given, and to check where it is, as a Then.
Given("entity {string} is in {string}", function (this: Context, entity: string, place: string) {
  if (!this.checking) this.places = put(this.places, entity, place);
  else assert.deepEqual(where(current(this), entity), { place }, `entity "${entity}" is ${JSON.stringify(where(current(this), entity))}`);
});

Then("entity {string} is nowhere in the space", function (this: Context, entity: string) {
  const found = where(current(this), entity);
  assert.equal(found, undefined, `expected entity "${entity}" nowhere, it is ${JSON.stringify(found)}`);
});

Then(
  "{string} has the exits {string}, of length {int}, and {string}, of length {int}",
  function (this: Context, place: string, first: string, firstLength: number, second: string, secondLength: number) {
    assert.deepEqual(exits(current(this), place), [
      { place: first, length: firstLength },
      { place: second, length: secondLength },
    ]);
  },
);

Then("{string} has the exit {string}, of length {int}", function (this: Context, place: string, exit: string, length: number) {
  assert.deepEqual(exits(current(this), place), [{ place: exit, length }]);
});

/** Checks that a place holds exactly these entities, in any order. */
function assertHolds(context: Context, place: string, entities: readonly string[]): void {
  const held = entitiesIn(current(context), place);
  assert.deepEqual([...held].sort(), [...entities].sort(), `"${place}" holds ${JSON.stringify(held)}`);
}

Then("the entities in {string} are {string} and {string}", function (this: Context, place: string, first: string, second: string) {
  assertHolds(this, place, [first, second]);
});

Then("the entities in {string} are {string}", function (this: Context, place: string, entity: string) {
  assertHolds(this, place, [entity]);
});

Then("{string} holds no entities", function (this: Context, place: string) {
  assertHolds(this, place, []);
});

/**
 * Applies an action to the space through the arbiter, which holds the space from the first action on. A refused action
 * is kept for the steps that check the refusal.
 */
function act<Args>(context: Context, action: Action<Places, Args>, args: Args): void {
  context.placesWorld ??= new World(context.places);
  context.versionBefore = context.placesWorld.version;
  try {
    context.result = context.placesWorld.apply(action, args);
  } catch (error) {
    context.spaceError = error as Error;
  }
}

When("entity {string} leaves {string} towards {string}", function (this: Context, entity: string, from: string, towards: string) {
  // The step names where the entity leaves from; it must be there when the space holds it, or the step would say
  // something the space does not.
  const at = where(current(this), entity);
  if (at !== undefined) assert.deepEqual(at, { place: from }, `entity "${entity}" is not in "${from}" to leave it`);
  act(this, leave, { entity, towards });
});

When("entity {string} arrives", function (this: Context, entity: string) {
  act(this, arrive, { entity });
});

/** Whether a place or passage is the passage between two places, whichever way it is named. */
function isPassageBetween(at: ReturnType<typeof where>, one: string, other: string): boolean {
  if (at === undefined || !("passage" in at)) return false;
  return [...at.passage].sort().join("\n") === [one, other].sort().join("\n");
}

Then(
  "entity {string} is in the passage between {string} and {string}",
  function (this: Context, entity: string, one: string, other: string) {
    const at = where(current(this), entity);
    assert.ok(isPassageBetween(at, one, other), `entity "${entity}" is ${JSON.stringify(at)}`);
  },
);

Then("neither {string} nor {string} holds entity {string}", function (this: Context, one: string, other: string, entity: string) {
  for (const place of [one, other]) {
    assert.ok(!entitiesIn(current(this), place).includes(entity), `"${place}" holds entity "${entity}"`);
  }
});

Given("entity {string} has left {string} towards {string}", function (this: Context, entity: string, from: string, towards: string) {
  // Set up as the space's own leave would leave it, before the arbiter holds the space.
  const space = put(this.places, entity, from);
  const args = { entity, towards };
  assert.deepEqual(leave.precondition(space, args), { holds: true });
  this.places = leave.effect(space, args);
});

/** Checks that an entity has exactly these entities in sight, in any order. */
function assertInSight(context: Context, entity: string, seen: readonly string[]): void {
  const sight = inSight(current(context), entity);
  assert.deepEqual([...sight].sort(), [...seen].sort(), `entity "${entity}" has in sight ${JSON.stringify(sight)}`);
}

/** Checks that an entity has none of these entities in sight. */
function assertNotInSight(context: Context, entity: string, unseen: readonly string[]): void {
  const sight = inSight(current(context), entity);
  for (const other of unseen) assert.ok(!sight.includes(other), `entity "${entity}" has "${other}" in sight: ${JSON.stringify(sight)}`);
}

Then("entity {string} has in sight {string} and {string}", function (this: Context, entity: string, first: string, second: string) {
  assertInSight(this, entity, [first, second]);
});

Then(
  "entity {string} has in sight {string}, {string} and {string}",
  function (this: Context, entity: string, first: string, second: string, third: string) {
    assertInSight(this, entity, [first, second, third]);
  },
);

Then("entity {string} does not have in sight {string} or {string}", function (this: Context, entity: string, first: string, second: string) {
  assertNotInSight(this, entity, [first, second]);
});

Then("entity {string} does not have in sight {string}", function (this: Context, entity: string, other: string) {
  assertNotInSight(this, entity, [other]);
});

When(
  "a space is built with the places {string} and {string} and a passage of length {int} between {string} and {string}",
  function (this: Context, first: string, second: string, length: number, one: string, other: string) {
    try {
      this.places = layout([first, second], [{ between: [one, other], length }]);
    } catch (error) {
      this.spaceError = error as Error;
    }
  },
);

/**
 * Checks that what the scenario did was refused with an error whose message holds the given words, and, for an action
 * on the space, that the arbiter applied nothing.
 */
function assertRefused(context: Context, named: string): void {
  assert.ok(context.spaceError, `expected a refusal that names ${named}, got ${JSON.stringify(context.result)}`);
  assert.ok(context.spaceError.message.includes(named), `expected the error to name ${named}: ${context.spaceError.message}`);
  if (context.placesWorld !== undefined) assert.equal(context.placesWorld.version, context.versionBefore, "a refused action applied something");
}

Then("it is refused with an error that names the place {string}", function (this: Context, place: string) {
  assertRefused(this, `place "${place}"`);
});

Then("it is refused with an error that names entity {string}", function (this: Context, entity: string) {
  assertRefused(this, `entity "${entity}"`);
});

Then("it is refused with an error that names the length {int}", function (this: Context, length: number) {
  assertRefused(this, `length ${length}`);
});
