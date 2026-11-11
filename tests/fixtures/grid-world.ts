import { type Grid, distance, move, position } from "../../src/engine/grid.ts";
import type { Scenario } from "../../src/engine/scenario.ts";
import type { AgentCall, Effector, Tool } from "../../src/engine/tools.ts";
import { rhythmChannel } from "./slots.ts";

/** A call of the effector "walk" as the grid's move reads it: the calling agent moves to the cell its arguments give. */
function walkCall({ agent, arguments: args }: AgentCall) {
  return { entity: agent, to: { x: args.x as number, y: args.y as number } };
}

/**
 * The test grid world's effector "walk x y": it moves the calling agent to a cell, taking `msPerCell` for each cell of
 * the distance from where the agent is when the call starts, and fails with `cell_full` when the cell is held when the
 * agent arrives.
 */
export function walkTool(msPerCell: number): Effector<Grid> {
  return {
    kind: "effector",
    name: "walk",
    description: "Walk to a cell of the grid.",
    parameters: {
      type: "object",
      properties: { x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 } },
      required: ["x", "y"],
    },
    durationMs: (grid, call) => {
      const { entity, to } = walkCall(call);
      const from = position(grid, entity);
      if (from === undefined) throw new Error(`the test grid world holds no agent ${entity} to walk`);
      return msPerCell * distance(from, to);
    },
    action: {
      precondition: (grid, call) => move.precondition(grid, walkCall(call)),
      effect: (grid, call) => move.effect(grid, walkCall(call)),
    },
    // The test grid world has no sensor, so an agent never has a sensing to read the target in.
    readTarget: () => "not_sensed",
  };
}

/** The test grid world as a scenario, with the grid it starts from, its tools and its agents. */
export function gridScenario(start: Grid, tools: readonly Tool<Grid>[], agents: readonly string[]): Scenario<Grid> {
  return {
    name: "grid",
    agents: () => agents,
    initialState: () => start,
    tools,
    channels: () => [rhythmChannel],
    metrics: {},
    systemPrompt: () => "You are an agent on a grid.",
    // Its agents wake at once: a test that needs another rhythm gives it.
    rhythm: () => () => 0,
    describeDuration: () => "As each tool gives it.",
    describeRhythm: () => "No wait before any activation.",
    baseConfiguration: "",
  };
}
