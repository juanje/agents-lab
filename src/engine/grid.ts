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

/**
 * The cells around a position that are inside the grid, row by row: its window of radius 1 without the position
 * itself and the cells outside. The grid does not wrap around its edges.
 */
export function neighbours(grid: Grid, position: Position): Position[] {
  return window(grid, position, 1)
    .filter((cell) => !cell.outside && (cell.x !== position.x || cell.y !== position.y))
    .map(({ x, y }) => ({ x, y }));
}

/**
 * The distance between two cells, counted in steps between neighbouring cells: a diagonal step counts as one, as a
 * diagonal cell is a neighbour (FR-SPACE-02).
 */
export function distance(from: Position, to: Position): number {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
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

/** Refuses a cell outside the grid, saying what was attempted (`where`) and the grid's size. */
function assertInside(grid: Grid, at: Position, where: string): void {
  if (!inside(grid, at)) throw new Error(`${where}: the cell is outside the ${grid.width} by ${grid.height} grid`);
}

function indexOf(grid: Grid, { x, y }: Position): number {
  return y * grid.width + x;
}

/** The cell at an index of `cells`, the inverse of `indexOf`. */
function cellAt(grid: Grid, index: number): Position {
  return { x: index % grid.width, y: Math.floor(index / grid.width) };
}

/** The entities a cell holds. */
export function entitiesAt(grid: Grid, at: Position): readonly string[] {
  return grid.cells[indexOf(grid, at)];
}

/** The cell an entity is in, or none when the grid does not hold it. */
export function position(grid: Grid, entity: string): Position | undefined {
  const index = grid.cells.findIndex((cell) => cell.includes(entity));
  return index === -1 ? undefined : cellAt(grid, index);
}

/**
 * The grid with one more entity in a cell, for building a world's initial state. Once the world runs, entities change
 * cells only through the arbiter, with `move`.
 */
export function place(grid: Grid, entity: string, at: Position): Grid {
  const where = `cannot place ${entity} at ${at.x}, ${at.y}`;
  assertInside(grid, at, where);
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
    if (cell.length === 0) empty.push(cellAt(grid, index));
  });
  if (empty.length === 0) return undefined;
  return empty[Math.floor(random.next() * empty.length)];
}

/** Why a move fails when its destination already holds as many entities as its capacity. */
export const CELL_FULL = "cell_full";

/** Moves an entity from its cell to another. It fails with `cell_full` when the destination is at its capacity. */
export const move: Action<Grid, { entity: string; to: Position }> = {
  // An unknown entity or a cell outside the grid is a defect in the scenario that moves it, not an agent's choice, so
  // it is refused before the world changes rather than recorded as an outcome.
  precondition: (grid, { entity, to }) => {
    const where = `cannot move entity ${entity} to cell ${to.x}, ${to.y}`;
    assertInside(grid, to, where);
    if (position(grid, entity) === undefined) throw new Error(`${where}: the grid holds no entity ${entity}`);
    return entitiesAt(grid, to).length < grid.capacity ? { holds: true } : { holds: false, reason: CELL_FULL };
  },
  effect: (grid, { entity, to }) => {
    const destination = indexOf(grid, to);
    const cells = grid.cells.map((cell, index) => {
      const others = cell.filter((held) => held !== entity);
      return index === destination ? [...others, entity] : others;
    });
    return { ...grid, cells };
  },
};
