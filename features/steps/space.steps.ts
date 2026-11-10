import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { emptyGrid, neighbours, window } from "../../src/engine/grid.ts";
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
