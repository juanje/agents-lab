import { describe, expect, it } from "vitest";
import { emptyGrid, neighbours, window } from "../src/engine/grid.ts";

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

describe("window", () => {
  const grid = emptyGrid(5, 4, 1);

  it("gives every cell within the radius, row by row, the centre included, none outside", () => {
    expect(window(grid, { x: 2, y: 1 }, 1)).toEqual([
      { x: 1, y: 0, outside: false },
      { x: 2, y: 0, outside: false },
      { x: 3, y: 0, outside: false },
      { x: 1, y: 1, outside: false },
      { x: 2, y: 1, outside: false },
      { x: 3, y: 1, outside: false },
      { x: 1, y: 2, outside: false },
      { x: 2, y: 2, outside: false },
      { x: 3, y: 2, outside: false },
    ]);
  });

  it("keeps the cells beyond the edges, marked as outside, so a window always has the same shape", () => {
    const cells = window(grid, { x: 4, y: 0 }, 2);

    expect(cells).toHaveLength(25);
    expect(cells.filter((cell) => !cell.outside)).toEqual([
      { x: 2, y: 0, outside: false },
      { x: 3, y: 0, outside: false },
      { x: 4, y: 0, outside: false },
      { x: 2, y: 1, outside: false },
      { x: 3, y: 1, outside: false },
      { x: 4, y: 1, outside: false },
      { x: 2, y: 2, outside: false },
      { x: 3, y: 2, outside: false },
      { x: 4, y: 2, outside: false },
    ]);
    expect(cells[0]).toEqual({ x: 2, y: -2, outside: true });
    expect(cells[24]).toEqual({ x: 6, y: 2, outside: true });
  });
});
