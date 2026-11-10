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

/** Stub: an empty window, so the steps can fail on their assertions first. */
export function window(_grid: Grid, _position: Position, _radius: number): WindowCell[] {
  return [];
}
