import { describe, expect, it } from "vitest";
import { emptyGrid, neighbours } from "../src/engine/grid.ts";

describe("neighbours", () => {
  const grid = emptyGrid(5, 4, 1);

  it("gives the eight cells around a cell inside the grid, row by row", () => {
    expect(neighbours(grid, { x: 2, y: 1 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
  });

  it("leaves out the cells beyond any edge, without wrapping around", () => {
    expect(neighbours(grid, { x: 4, y: 3 })).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 3, y: 3 },
    ]);
    expect(neighbours(grid, { x: 0, y: 1 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ]);
  });
});
