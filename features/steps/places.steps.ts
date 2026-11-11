import assert from "node:assert/strict";
import { BeforeStep, Given, Then } from "@cucumber/cucumber";
import { type Places, layout, put, where } from "../../src/engine/places.ts";
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
