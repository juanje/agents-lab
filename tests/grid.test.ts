import { describe, expect, it } from "vitest";
import {
  CELL_FULL,
  type Grid,
  emptyGrid,
  entitiesAt,
  move,
  neighbours,
  place,
  randomEmptyCell,
  window,
} from "../src/engine/grid.ts";
import type { Random } from "../src/engine/random.ts";
import { World } from "../src/engine/world.ts";

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

describe("place", () => {
  it("puts an entity in a cell and leaves the other cells as they were", () => {
    const grid = place(place(emptyGrid(3, 2, 2), "a", { x: 2, y: 1 }), "b", { x: 2, y: 1 });

    expect(entitiesAt(grid, { x: 2, y: 1 })).toEqual(["a", "b"]);
    expect(entitiesAt(grid, { x: 2, y: 0 })).toEqual([]);
    expect(entitiesAt(grid, { x: 0, y: 1 })).toEqual([]);
  });

  it("refuses a cell at capacity, saying which cell and its capacity", () => {
    const grid = place(emptyGrid(3, 2, 1), "a", { x: 1, y: 1 });

    expect(() => place(grid, "b", { x: 1, y: 1 })).toThrow("cannot place b at 1, 1: the cell is at its capacity of 1");
  });

  it("refuses a cell outside the grid, saying which cell and the grid's size", () => {
    expect(() => place(emptyGrid(3, 2, 1), "a", { x: 3, y: 0 })).toThrow(
      "cannot place a at 3, 0: the cell is outside the 3 by 2 grid",
    );
  });
});

/** A random sequence that gives the same draw every time, and counts its draws. */
function fixedDraw(draw: number): Random & { draws: number } {
  const random = {
    draws: 0,
    next() {
      random.draws += 1;
      return draw;
    },
  };
  return random as unknown as Random & { draws: number };
}

describe("randomEmptyCell", () => {
  /** A 3 by 2 grid, capacity 2, whose empty cells, row by row, are 0, 0; 2, 0; 1, 1. */
  function partlyFull(): Grid {
    let grid = emptyGrid(3, 2, 2);
    grid = place(grid, "a", { x: 1, y: 0 });
    grid = place(grid, "b", { x: 0, y: 1 });
    grid = place(grid, "c", { x: 2, y: 1 });
    return grid;
  }

  it("draws once among the empty cells, taken row by row, so the same draw gives the same cell", () => {
    expect(randomEmptyCell(partlyFull(), fixedDraw(0))).toEqual({ x: 0, y: 0 });
    expect(randomEmptyCell(partlyFull(), fixedDraw(0.5))).toEqual({ x: 2, y: 0 });
    const random = fixedDraw(0.99);
    expect(randomEmptyCell(partlyFull(), random)).toEqual({ x: 1, y: 1 });
    expect(random.draws).toBe(1);
  });

  it("counts a cell that holds any entity as not empty, though it is below its capacity", () => {
    const grid = place(place(emptyGrid(2, 1, 2), "a", { x: 0, y: 0 }), "b", { x: 0, y: 0 });

    expect(randomEmptyCell(place(emptyGrid(2, 1, 2), "a", { x: 1, y: 0 }), fixedDraw(0.99))).toEqual({ x: 0, y: 0 });
    expect(randomEmptyCell(grid, fixedDraw(0))).toEqual({ x: 1, y: 0 });
  });

  it("gives no cell when every cell holds an entity, and draws nothing then", () => {
    let grid = emptyGrid(2, 1, 2);
    grid = place(grid, "a", { x: 0, y: 0 });
    grid = place(grid, "b", { x: 1, y: 0 });
    const random = fixedDraw(0);

    expect(randomEmptyCell(grid, random)).toBeUndefined();
    expect(random.draws).toBe(0);
  });
});

describe("move", () => {
  it("takes an entity out of its cell and puts it in the destination, through the arbiter", () => {
    const world = new World(place(place(emptyGrid(3, 2, 2), "a", { x: 0, y: 0 }), "b", { x: 0, y: 0 }));

    expect(world.apply(move, { entity: "a", to: { x: 2, y: 1 } })).toEqual({ applied: true });
    expect(entitiesAt(world.state, { x: 0, y: 0 })).toEqual(["b"]);
    expect(entitiesAt(world.state, { x: 2, y: 1 })).toEqual(["a"]);
    expect(world.version).toBe(1);
  });

  it("moves into a cell that holds entities below its capacity", () => {
    const world = new World(place(place(emptyGrid(2, 1, 2), "a", { x: 0, y: 0 }), "b", { x: 1, y: 0 }));

    expect(world.apply(move, { entity: "a", to: { x: 1, y: 0 } })).toEqual({ applied: true });
    expect(entitiesAt(world.state, { x: 1, y: 0 })).toEqual(["b", "a"]);
  });

  it("fails with cell_full when the destination is at capacity, and changes nothing", () => {
    const world = new World(place(place(emptyGrid(2, 1, 1), "a", { x: 0, y: 0 }), "b", { x: 1, y: 0 }));
    const before = world.state;

    expect(world.apply(move, { entity: "a", to: { x: 1, y: 0 } })).toEqual({ applied: false, reason: CELL_FULL });
    expect(CELL_FULL).toBe("cell_full");
    expect(world.state).toBe(before);
    expect(world.version).toBe(0);
  });

  it("refuses an entity the grid does not hold, naming it, and applies nothing", () => {
    const world = new World(place(emptyGrid(3, 2, 1), "a", { x: 0, y: 0 }));
    const before = world.state;

    expect(() => world.apply(move, { entity: "z", to: { x: 2, y: 1 } })).toThrow(
      "cannot move entity z to cell 2, 1: the grid holds no entity z",
    );
    expect(world.state).toBe(before);
    expect(world.version).toBe(0);
  });

  it.each([
    { x: 3, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: -1 },
  ])("refuses the cell $x, $y outside the 3 by 2 grid, naming it, and applies nothing", (to) => {
    const world = new World(place(emptyGrid(3, 2, 1), "a", { x: 0, y: 0 }));
    const before = world.state;

    expect(() => world.apply(move, { entity: "a", to })).toThrow(
      `cannot move entity a to cell ${to.x}, ${to.y}: the cell is outside the 3 by 2 grid`,
    );
    expect(world.state).toBe(before);
    expect(world.version).toBe(0);
  });
});
