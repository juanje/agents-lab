import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import { emptyGrid, entitiesAt, place, position } from "../src/engine/grid.ts";
import { Random } from "../src/engine/random.ts";
import type { Configuration } from "../src/engine/scenario.ts";
import type { Tool } from "../src/engine/tools.ts";
import { World } from "../src/engine/world.ts";
import { type Neighbourhood, neighbourhoodScenario } from "../src/scenarios/neighbourhood.ts";

const configuration = (width: number, height: number, residents: number): Configuration => ({
  ...parse(neighbourhoodScenario.baseConfiguration),
  width,
  height,
  residents,
});

/** The neighbourhood's tool of that name. */
function toolNamed(name: string): Tool<Neighbourhood> {
  const tool = neighbourhoodScenario.tools.find((declared) => declared.name === name);
  if (tool === undefined) throw new Error(`the neighbourhood declares no tool "${name}"`);
  return tool;
}

/** A neighbourhood of that size with "r1" (teal) at 0, 0, "r2" (amber) at 1, 0 and "r3" (teal) at 0, 1. */
function residentsAt(width: number, height: number, settings: { lookRadius: number; msPerCell: number }): Neighbourhood {
  let grid = emptyGrid(width, height, 1);
  grid = place(grid, "r1", { x: 0, y: 0 });
  grid = place(grid, "r2", { x: 1, y: 0 });
  grid = place(grid, "r3", { x: 0, y: 1 });
  return { grid, kinds: { r1: "teal", r2: "amber", r3: "teal" }, ...settings };
}

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

  it("tells each resident who it is and its kind, the kind its initial state gives it, and no rule by default", () => {
    const base = configuration(3, 2, 2);
    const { kinds } = neighbourhoodScenario.initialState(base, new Random(1));

    expect(base.rule).toBe("");
    expect(neighbourhoodScenario.systemPrompt(base, "resident 1")).toBe(
      `You are "resident 1", a resident of a neighbourhood. Your kind is "${kinds["resident 1"]}".`,
    );
    expect(neighbourhoodScenario.systemPrompt(base, "resident 2")).toBe(
      `You are "resident 2", a resident of a neighbourhood. Your kind is "${kinds["resident 2"]}".`,
    );
  });

  it("adds the configured rule at the end of the system prompt, after a blank line", () => {
    const ruled = { ...configuration(3, 2, 2), rule: "Stay put." };

    expect(neighbourhoodScenario.systemPrompt(ruled, "resident 2")).toBe(
      'You are "resident 2", a resident of a neighbourhood. Your kind is "amber".\n\nStay put.',
    );
  });

  it("refuses a system prompt for an agent that is not one of its residents, naming it", () => {
    expect(() => neighbourhoodScenario.systemPrompt(configuration(3, 2, 2), "resident 3")).toThrow(
      'The neighbourhood has no resident "resident 3"',
    );
  });

  it("declares its rhythm channel with the source and text its configuration's [rhythm] table gives", () => {
    const base = configuration(3, 2, 2);

    expect(neighbourhoodScenario.channels({ ...base, rhythm: { source: "a clock", text: "Tick." } })).toEqual([
      { name: "rhythm", source: "a clock", stimulus: "Tick." },
    ]);
    const { source, text } = base.rhythm as { source: unknown; text: unknown };
    expect([typeof source, typeof text]).toEqual(["string", "string"]);
    expect(neighbourhoodScenario.channels(base)).toEqual([{ name: "rhythm", source, stimulus: text }]);
  });

  it("keeps the configured look radius and time per cell of distance in its state, for its tools to read", () => {
    const base = parse(neighbourhoodScenario.baseConfiguration);
    const state = neighbourhoodScenario.initialState({ ...configuration(3, 2, 2), look_radius: 2, ms_per_cell: 40 }, new Random(1));

    expect([typeof base.look_radius, typeof base.ms_per_cell]).toEqual(["number", "number"]);
    expect({ lookRadius: state.lookRadius, msPerCell: state.msPerCell }).toEqual({ lookRadius: 2, msPerCell: 40 });
  });

  it("lets a resident look at its window, rows from the top, marking itself, its kind, the other kind, empty and outside", () => {
    const look = toolNamed("look");
    const state = residentsAt(5, 5, { lookRadius: 1, msPerCell: 100 });

    expect(look.kind).toBe("sensor");
    if (look.kind !== "sensor") return;
    expect(JSON.parse(look.sense(state, "r1"))).toEqual([
      ["outside", "outside", "outside"],
      ["outside", "you", "other"],
      ["outside", "same", "empty"],
    ]);
    expect(JSON.parse(look.sense(state, "r2"))).toEqual([
      ["outside", "outside", "outside"],
      ["other", "you", "empty"],
      ["other", "empty", "empty"],
    ]);
  });

  it("shows a window as wide as the configured look radius", () => {
    const look = toolNamed("look");
    const state = residentsAt(5, 5, { lookRadius: 2, msPerCell: 100 });

    if (look.kind !== "sensor") throw new Error("look is not a sensor");
    expect(JSON.parse(look.sense(state, "r3"))).toEqual([
      ["outside", "outside", "outside", "outside", "outside"],
      ["outside", "outside", "same", "other", "empty"],
      ["outside", "outside", "you", "empty", "empty"],
      ["outside", "outside", "empty", "empty", "empty"],
      ["outside", "outside", "empty", "empty", "empty"],
    ]);
  });

  it("lets a resident move to the empty cell at an offset, anywhere in the grid, through the arbiter", () => {
    const move = toolNamed("move");
    if (move.kind !== "effector") throw new Error("move is not an effector");
    const world = new World(residentsAt(5, 5, { lookRadius: 1, msPerCell: 100 }));

    expect(world.apply(move.action, { agent: "r1", arguments: { dx: 3, dy: 4 } })).toEqual({ applied: true });
    expect(position(world.state.grid, "r1")).toEqual({ x: 3, y: 4 });
    expect(world.version).toBe(1);
  });

  it("takes the configured time per cell for the distance from where the resident is to its target", () => {
    const move = toolNamed("move");
    const state = residentsAt(5, 5, { lookRadius: 1, msPerCell: 40 });

    expect(move.durationMs(state, { agent: "r2", arguments: { dx: 2, dy: 3 } })).toBe(120);
    expect(move.durationMs(state, { agent: "r2", arguments: { dx: -1, dy: 1 } })).toBe(40);
  });

  it("draws the cells from the random sequence it is given", () => {
    const cellsOf = (seed: number) => neighbourhoodScenario.initialState(configuration(6, 6, 10), new Random(seed)).grid;
    const where = (seed: number) =>
      Array.from({ length: 36 }, (_, index) => entitiesAt(cellsOf(seed), { x: index % 6, y: Math.floor(index / 6) })[0] ?? null);

    expect(where(7)).toEqual(where(7));
    expect(where(7)).not.toEqual(where(8));
  });
});
