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

/** Stub: no neighbours yet, so the steps can fail on their assertions first. */
export function neighbours(_grid: Grid, _position: Position): Position[] {
  return [];
}
