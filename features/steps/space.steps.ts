import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { emptyGrid, neighbours } from "../../src/engine/grid.ts";
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
