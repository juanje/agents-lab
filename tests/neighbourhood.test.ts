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
function residentsAt(width: number, height: number, settings: { lookRadius: number; msPerCell: number; msPerLook?: number }): Neighbourhood {
  let grid = emptyGrid(width, height, 1);
  grid = place(grid, "r1", { x: 0, y: 0 });
  grid = place(grid, "r2", { x: 1, y: 0 });
  grid = place(grid, "r3", { x: 0, y: 1 });
  return { grid, kinds: { r1: "teal", r2: "amber", r3: "teal" }, msPerLook: 0, ...settings };
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

  it("keeps the configured time a look takes in its state", () => {
    const base = parse(neighbourhoodScenario.baseConfiguration);
    const state = neighbourhoodScenario.initialState({ ...configuration(3, 2, 2), ms_per_look: 30 }, new Random(1));

    expect(typeof base.ms_per_look).toBe("number");
    expect(state.msPerLook).toBe(30);
  });

  it("takes the configured time for a look", () => {
    const look = toolNamed("look");

    expect(look.durationMs(residentsAt(5, 5, { lookRadius: 1, msPerCell: 100, msPerLook: 30 }), { agent: "r1", arguments: {} })).toBe(30);
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

  it("fails a move to a cell outside the grid with invalid_target, changing nothing", () => {
    const move = toolNamed("move");
    if (move.kind !== "effector") throw new Error("move is not an effector");
    const world = new World(residentsAt(5, 5, { lookRadius: 1, msPerCell: 100 }));
    const before = world.state;

    expect(world.apply(move.action, { agent: "r1", arguments: { dx: -1, dy: 0 } })).toEqual({ applied: false, reason: "invalid_target" });
    expect(world.apply(move.action, { agent: "r2", arguments: { dx: 4, dy: 0 } })).toEqual({ applied: false, reason: "invalid_target" });
    expect(world.apply(move.action, { agent: "r3", arguments: { dx: 0, dy: 4 } })).toEqual({ applied: false, reason: "invalid_target" });
    expect(world.state).toBe(before);
    expect(world.version).toBe(0);
  });

  it("takes the configured time per cell for the distance from where the resident is to its target", () => {
    const move = toolNamed("move");
    const state = residentsAt(5, 5, { lookRadius: 1, msPerCell: 40 });

    expect(move.durationMs(state, { agent: "r2", arguments: { dx: 2, dy: 3 } })).toBe(120);
    expect(move.durationMs(state, { agent: "r2", arguments: { dx: -1, dy: 1 } })).toBe(40);
  });

  it("reads a move's target in the resident's last look: held, free, or not sensed outside its window or without a look", () => {
    const look = toolNamed("look");
    const move = toolNamed("move");
    if (look.kind !== "sensor" || move.kind !== "effector") throw new Error("look is not a sensor or move is not an effector");
    const state = residentsAt(5, 5, { lookRadius: 1, msPerCell: 100 });
    const sensing = { tool: "look", result: look.sense(state, "r1"), takenFrom: { x: 0, y: 0 }, atMs: 0 };
    const target = (dx: number, dy: number) => move.readTarget(sensing, { agent: "r1", arguments: { dx, dy } }, state);

    expect([target(1, 0), target(0, 1)]).toEqual(["held", "held"]);
    expect(target(1, 1)).toBe("free");
    expect([target(2, 0), target(3, 3)]).toEqual(["not_sensed", "not_sensed"]);
    expect(move.readTarget({ ...sensing, tool: "another sensor" }, { agent: "r1", arguments: { dx: 1, dy: 1 } }, state)).toBe("not_sensed");
  });

  it("reads a move's target as the cell the last look showed, wherever the resident looked from", () => {
    const look = toolNamed("look");
    const move = toolNamed("move");
    if (look.kind !== "sensor" || move.kind !== "effector") throw new Error("look is not a sensor or move is not an effector");
    const looked = residentsAt(5, 5, { lookRadius: 1, msPerCell: 100 });
    expect(look.takenFrom?.(looked, "r1")).toEqual({ x: 0, y: 0 });
    const sensing = { tool: "look", result: look.sense(looked, "r1"), takenFrom: { x: 0, y: 0 }, atMs: 0 };
    // "r1" has since moved from 0, 0 to 0, 2.
    const moved = { ...looked, grid: place(emptyGrid(5, 5, 1), "r1", { x: 0, y: 2 }) };
    const target = (dx: number, dy: number) => move.readTarget(sensing, { agent: "r1", arguments: { dx, dy } }, moved);

    expect(target(1, -2)).toBe("held");
    expect(target(1, -1)).toBe("free");
    expect([target(1, 0), target(0, 1)]).toEqual(["not_sensed", "not_sensed"]);
  });

  it("reads a move's target that the last look showed outside the grid as outside", () => {
    const look = toolNamed("look");
    const move = toolNamed("move");
    if (look.kind !== "sensor" || move.kind !== "effector") throw new Error("look is not a sensor or move is not an effector");
    const state = residentsAt(5, 5, { lookRadius: 1, msPerCell: 100 });
    const sensing = { tool: "look", result: look.sense(state, "r1"), takenFrom: { x: 0, y: 0 }, atMs: 0 };

    expect(move.readTarget(sensing, { agent: "r1", arguments: { dx: -1, dy: 0 } }, state)).toBe("outside");
    expect(move.readTarget(sensing, { agent: "r1", arguments: { dx: 1, dy: -1 } }, state)).toBe("outside");
  });

  it("gives each resident with an occupied neighbouring cell the share of its neighbours of its own kind, by its name", () => {
    const state = residentsAt(5, 5, { lookRadius: 1, msPerCell: 100 });
    // "r4" (amber), alone in a corner, has no neighbour and so no share.
    const withLoner = { ...state, grid: place(state.grid, "r4", { x: 4, y: 4 }), kinds: { ...state.kinds, r4: "amber" as const } };

    expect(neighbourhoodScenario.metrics.shares(withLoner)).toEqual({ r1: 0.5, r2: 0, r3: 0.5 });
  });

  it("gives as the segregation the mean of the residents' shares, leaving out a resident with no share", () => {
    const state = residentsAt(5, 5, { lookRadius: 1, msPerCell: 100 });
    // "r4" (amber) at 2, 0 makes the shares r1 0.5, r2 1/3, r3 0.5 and r4 1; "r5", alone in a corner, has none.
    const grid = place(place(state.grid, "r4", { x: 2, y: 0 }), "r5", { x: 4, y: 4 });
    const crowded = { ...state, grid, kinds: { ...state.kinds, r4: "amber" as const, r5: "amber" as const } };

    expect(neighbourhoodScenario.metrics.shares(crowded)).toEqual({ r1: 0.5, r2: 1 / 3, r3: 0.5, r4: 1 });
    expect(neighbourhoodScenario.metrics.segregation(crowded)).toBeCloseTo((0.5 + 1 / 3 + 0.5 + 1) / 4, 12);
  });

  it("counts as its moves only the moves the arbiter applied, from none in its initial state", () => {
    const move = toolNamed("move");
    if (move.kind !== "effector") throw new Error("move is not an effector");
    const initial = neighbourhoodScenario.initialState(configuration(3, 2, 2), new Random(1));
    const world = new World(residentsAt(5, 5, { lookRadius: 1, msPerCell: 100 }));

    expect(neighbourhoodScenario.metrics.moves(initial)).toBe(0);
    expect(world.apply(move.action, { agent: "r1", arguments: { dx: 1, dy: 0 } })).toEqual({ applied: false, reason: "cell_full" });
    expect(world.apply(move.action, { agent: "r1", arguments: { dx: -1, dy: 0 } })).toEqual({ applied: false, reason: "invalid_target" });
    expect(world.apply(move.action, { agent: "r1", arguments: { dx: 2, dy: 2 } })).toEqual({ applied: true });
    expect(world.apply(move.action, { agent: "r1", arguments: { dx: 1, dy: 1 } })).toEqual({ applied: true });
    expect(neighbourhoodScenario.metrics.moves(world.state)).toBe(2);
  });

  it("draws the cells from the random sequence it is given", () => {
    const cellsOf = (seed: number) => neighbourhoodScenario.initialState(configuration(6, 6, 10), new Random(seed)).grid;
    const where = (seed: number) =>
      Array.from({ length: 36 }, (_, index) => entitiesAt(cellsOf(seed), { x: index % 6, y: Math.floor(index / 6) })[0] ?? null);

    expect(where(7)).toEqual(where(7));
    expect(where(7)).not.toEqual(where(8));
  });
});
