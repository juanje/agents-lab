import type { Random } from "./random.ts";
import type { Action } from "./world.ts";

/** A cell's place on a grid: x from 0 at the left, y from 0 at the top. */
export interface Position {
  x: number;
  y: number;
}

/** A grid of cells, each holding up to `capacity` entities, named by their ids. */
export interface Grid {
  width: number;
  height: number;
  capacity: number;
  /** The entities in each cell, row by row from the top-left cell. */
  cells: readonly (readonly string[])[];
}

export function emptyGrid(width: number, height: number, capacity: number): Grid {
  return { width, height, capacity, cells: Array.from({ length: width * height }, () => []) };
}

function inside(grid: Grid, { x, y }: Position): boolean {
  return x >= 0 && x < grid.width && y >= 0 && y < grid.height;
}

/** The cells around a position that are inside the grid, row by row. The grid does not wrap around its edges. */
export function neighbours(grid: Grid, { x, y }: Position): Position[] {
  const around: Position[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cell = { x: x + dx, y: y + dy };
      if ((dx !== 0 || dy !== 0) && inside(grid, cell)) around.push(cell);
    }
  }
  return around;
}

/** A cell of a window, marked when it lies outside the grid. */
export interface WindowCell extends Position {
  outside: boolean;
}

/**
 * The square of cells within a radius of a position, row by row, the position included. Cells beyond the grid's edges
 * stay in the window, marked as outside, so every window of one radius has the same shape.
 */
export function window(grid: Grid, { x, y }: Position, radius: number): WindowCell[] {
  const cells: WindowCell[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const cell = { x: x + dx, y: y + dy };
      cells.push({ ...cell, outside: !inside(grid, cell) });
    }
  }
  return cells;
}

function indexOf(grid: Grid, { x, y }: Position): number {
  return y * grid.width + x;
}

/** The entities a cell holds. */
export function entitiesAt(grid: Grid, at: Position): readonly string[] {
  return grid.cells[indexOf(grid, at)];
}

/**
 * The grid with one more entity in a cell, for building a world's initial state. Once the world runs, entities change
 * cells only through the arbiter, with `move`.
 */
export function place(grid: Grid, entity: string, at: Position): Grid {
  const where = `cannot place ${entity} at ${at.x}, ${at.y}`;
  if (!inside(grid, at)) throw new Error(`${where}: the cell is outside the ${grid.width} by ${grid.height} grid`);
  if (entitiesAt(grid, at).length >= grid.capacity) {
    throw new Error(`${where}: the cell is at its capacity of ${grid.capacity}`);
  }
  const index = indexOf(grid, at);
  return { ...grid, cells: grid.cells.map((cell, current) => (current === index ? [...cell, entity] : cell)) };
}

/**
 * A cell that holds no entity, drawn from a random sequence among the empty cells taken row by row, so the same
 * sequence gives the same cell. Gives none, and draws nothing, when every cell holds an entity.
 */
export function randomEmptyCell(grid: Grid, random: Random): Position | undefined {
  const empty: Position[] = [];
  grid.cells.forEach((cell, index) => {
    if (cell.length === 0) empty.push({ x: index % grid.width, y: Math.floor(index / grid.width) });
  });
  if (empty.length === 0) return undefined;
  return empty[Math.floor(random.next() * empty.length)];
}

/** Stub: always applies and moves nothing, so the steps can fail on their assertions first. */
export const move: Action<Grid, { entity: string; to: Position }> = {
  precondition: () => ({ holds: true }),
  effect: (grid) => grid,
};
