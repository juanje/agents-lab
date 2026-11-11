import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import {
  type Grid,
  emptyGrid,
  entitiesAt,
  move,
  neighbours,
  place,
  randomEmptyCell,
  window,
} from "../../src/engine/grid.ts";
import * as space from "../../src/engine/grid.ts";
import { Random } from "../../src/engine/random.ts";
import { World } from "../../src/engine/world.ts";
import type { Context } from "../support/context.ts";

Given(
  "a grid {int} cells wide and {int} cells high, with a capacity of {int} per cell",
  function (this: Context, width: number, height: number, capacity: number) {
    this.grid = emptyGrid(width, height, capacity);
  },
);

Then("the cell at {int}, {int} has {int} neighbours", function (this: Context, x: number, y: number, count: number) {
  const around = neighbours(this.grid, { x, y });
  assert.equal(around.length, count, `expected ${count} neighbours of ${x}, ${y}, got ${JSON.stringify(around)}`);
});

When(
  "I take the window of radius {int} around the cell at {int}, {int}",
  function (this: Context, radius: number, x: number, y: number) {
    this.window = window(this.grid, { x, y }, radius);
  },
);

Then("the window has {int} cells", function (this: Context, count: number) {
  assert.equal(this.window.length, count, `expected ${count} cells in the window, got ${JSON.stringify(this.window)}`);
});

Then("{int} of them are marked as outside the grid", function (this: Context, count: number) {
  const outside = this.window.filter((cell) => cell.outside);
  assert.equal(outside.length, count, `expected ${count} cells outside the grid, got ${JSON.stringify(outside)}`);
});

/** Places one entity, named after its cell, in every cell of the grid that the scenario does not leave empty. */
function fill(grid: Grid, except?: { x: number; y: number }): Grid {
  let filled = grid;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (x !== except?.x || y !== except?.y) filled = place(filled, `entity at ${x}, ${y}`, { x, y });
    }
  }
  return filled;
}

Given("every cell holds an entity except the cell at {int}, {int}", function (this: Context, x: number, y: number) {
  this.grid = fill(this.grid, { x, y });
});

Given("every cell holds an entity", function (this: Context) {
  this.grid = fill(this.grid);
});

/** The seed of the sequence the steps draw cells from; any seed must give the only empty cell, or none. */
const DRAW_SEED = 42;

When("I ask for a random empty cell", function (this: Context) {
  this.drawnCell = randomEmptyCell(this.grid, new Random(DRAW_SEED));
});

Then("I get the cell at {int}, {int}", function (this: Context, x: number, y: number) {
  assert.deepEqual(this.drawnCell, { x, y });
});

Then("I get no cell", function (this: Context) {
  assert.equal(this.drawnCell, undefined, `expected no cell, got ${JSON.stringify(this.drawnCell)}`);
});

Given(
  "entity {string} is at {int}, {int} and entity {string} is at {int}, {int}",
  function (this: Context, first: string, x1: number, y1: number, second: string, x2: number, y2: number) {
    this.grid = place(place(this.grid, first, { x: x1, y: y1 }), second, { x: x2, y: y2 });
  },
);

When("entity {string} moves to {int}, {int}", function (this: Context, entity: string, x: number, y: number) {
  // A move changes the world, so it goes through the arbiter.
  this.gridWorld = new World(this.grid);
  try {
    this.result = this.gridWorld.apply(move, { entity, to: { x, y } });
  } catch (error) {
    // A refused move is kept for the steps that check the refusal; a step that expects a result then finds none.
    this.moveError = error as Error;
  }
});

Then("the move fails with {string}", function (this: Context, reason: string) {
  assert.equal(this.moveError, undefined, `expected the move to fail with "${reason}", it was refused: ${this.moveError}`);
  assert.deepEqual(this.result, { applied: false, reason });
});

/** Checks that the move was refused with an error whose message holds the given words, and that nothing was applied. */
function assertRefused(context: Context, named: string): void {
  assert.ok(context.moveError, `expected the move to be refused, it gave ${JSON.stringify(context.result)}`);
  assert.ok(context.moveError.message.includes(named), `expected the error to name ${named}: ${context.moveError.message}`);
  assert.equal(context.gridWorld.version, 0, "expected a refused move to apply nothing");
}

Then("the move is refused with an error that names entity {string}", function (this: Context, entity: string) {
  assertRefused(this, `entity ${entity}`);
});

Then(
  "the move is refused with an error that names the cell at {int}, {int}",
  function (this: Context, x: number, y: number) {
    assertRefused(this, `cell ${x}, ${y}`);
  },
);

Then("the cell at {int}, {int} is empty", function (this: Context, x: number, y: number) {
  assert.deepEqual(entitiesAt(this.gridWorld.state, { x, y }), []);
});

Then("entity {string} is still at {int}, {int}", function (this: Context, entity: string, x: number, y: number) {
  assert.deepEqual(entitiesAt(this.gridWorld.state, { x, y }), [entity]);
});

/** The grid's answer to where an entity is, failing on an assertion while the grid cannot answer it. */
function positionIn(grid: Grid, entity: string) {
  assert.equal(typeof space.position, "function", "the grid does not answer which cell an entity is in");
  return space.position(grid, entity);
}

Then("entity {string}'s position is {int}, {int}", function (this: Context, entity: string, x: number, y: number) {
  assert.deepEqual(positionIn(this.grid, entity), { x, y });
});

Then("entity {string} has no position", function (this: Context, entity: string) {
  const found = positionIn(this.grid, entity);
  assert.equal(found, undefined, `expected entity ${entity} to have no position, got ${JSON.stringify(found)}`);
});
