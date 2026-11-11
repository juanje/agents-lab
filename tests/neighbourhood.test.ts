import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import { entitiesAt } from "../src/engine/grid.ts";
import { Random } from "../src/engine/random.ts";
import { neighbourhoodScenario } from "../src/scenarios/neighbourhood.ts";

const configuration = (width: number, height: number, residents: number) => ({
  ...parse(neighbourhoodScenario.baseConfiguration),
  width,
  height,
  residents,
});

describe("the neighbourhood scenario", () => {
  it("has the grid's width and height and the number of residents in its base configuration", () => {
    const base = parse(neighbourhoodScenario.baseConfiguration);

    expect(typeof base.width).toBe("number");
    expect(typeof base.height).toBe("number");
    expect(typeof base.residents).toBe("number");
  });

  it("names the configured number of residents", () => {
    expect(neighbourhoodScenario.agents(configuration(3, 2, 4))).toEqual(["resident 1", "resident 2", "resident 3", "resident 4"]);
  });

  it("places each resident on its own cell of a grid of the configured size, each cell holding one, kinds alternating", () => {
    const { grid, kinds } = neighbourhoodScenario.initialState(configuration(3, 2, 4), new Random(1));

    expect({ width: grid.width, height: grid.height, capacity: grid.capacity }).toEqual({ width: 3, height: 2, capacity: 1 });
    const held = grid.cells.flat();
    expect([...held].sort()).toEqual(["resident 1", "resident 2", "resident 3", "resident 4"]);
    expect(grid.cells.every((cell) => cell.length <= 1)).toBe(true);
    expect(kinds).toEqual({ "resident 1": "teal", "resident 2": "amber", "resident 3": "teal", "resident 4": "amber" });
  });

  it("refuses more residents than the grid has cells, naming the grid's size and the resident left without one", () => {
    expect(() => neighbourhoodScenario.initialState(configuration(2, 1, 3), new Random(1))).toThrow(
      "the 2 by 1 grid has no empty cell left for resident 3",
    );
  });

  it("draws the cells from the random sequence it is given", () => {
    const cellsOf = (seed: number) => neighbourhoodScenario.initialState(configuration(6, 6, 10), new Random(seed)).grid;
    const where = (seed: number) =>
      Array.from({ length: 36 }, (_, index) => entitiesAt(cellsOf(seed), { x: index % 6, y: Math.floor(index / 6) })[0] ?? null);

    expect(where(7)).toEqual(where(7));
    expect(where(7)).not.toEqual(where(8));
  });
});
