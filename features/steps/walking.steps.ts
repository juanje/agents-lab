import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { CELL_FULL, type Grid, type Position, emptyGrid, entitiesAt, place, position } from "../../src/engine/grid.ts";
import type { Effector } from "../../src/engine/tools.ts";
import { walkTool } from "../../tests/fixtures/grid-world.ts";
import type { Context } from "../support/context.ts";
import { stateAt } from "./acting.steps.ts";
import { callOf, callWithThenEnd, script } from "./tool.steps.ts";

Given(
  "a test grid world {int} cells wide and {int} cells high, with a capacity of {int} per cell",
  function (this: Context, width: number, height: number, capacity: number) {
    this.grid = emptyGrid(width, height, capacity);
  },
);

Given(
  "the effector {string} moves the calling agent to a cell, taking {int} milliseconds per cell of distance, and fails with {string} when the cell is held when it arrives",
  function (this: Context, name: string, msPerCell: number, reason: string) {
    const walk = walkTool(msPerCell);
    assert.equal(walk.name, name);
    assert.equal(reason, CELL_FULL);
    this.gridTools = [walk];
  },
);

/** The test grid world's effector of that name, as the scenario declared it. */
function gridEffector(context: Context, name: string): Effector<Grid> {
  const tool = context.gridTools?.find((declared) => declared.name === name);
  assert.ok(tool?.kind === "effector", `the test grid world declares no effector "${name}"`);
  return tool;
}

/** Where the grid holds an agent once the run has ended, or before it starts. */
function assertAt(grid: Grid, agent: string, at: Position): void {
  assert.deepEqual(position(grid, agent), at, `agent "${agent}" is at ${JSON.stringify(position(grid, agent))}`);
}

// The contract says "agent … is at" both to set the grid up and to check it once the run has ended.
Given("agent {string} is at {int}, {int}", function (this: Context, agent: string, x: number, y: number) {
  if (this.toolCalls === undefined) this.grid = place(this.grid, agent, { x, y });
  else assertAt(this.gridWorld.state, agent, { x, y });
});

Then("agent {string} is still at {int}, {int}", function (this: Context, agent: string, x: number, y: number) {
  assertAt(this.gridWorld.state, agent, { x, y });
});

Given(
  "agent {string} runs on a scripted model that calls {string} to {int}, {int}, then ends without a tool call",
  function (this: Context, agent: string, tool: string, x: number, y: number) {
    script(this, agent, callWithThenEnd(tool, { x, y }, 0));
  },
);

Given(
  "agent {string} runs on a scripted model that calls {string} to {int}, {int} while agent {string}'s {string} is under way, then ends without a tool call",
  function (this: Context, agent: string, tool: string, x: number, y: number, other: string, otherTool: string) {
    const mine = gridEffector(this, tool);
    const theirs = gridEffector(this, otherTool);
    // Each call's duration as it would start on the grid as set up: this agent's walk is the shorter, so it wakes as
    // much after the other's starts as it lands before the other's ends. The check below makes sure it did.
    const mineMs = mine.durationMs(this.grid, { agent, arguments: { x, y } });
    const otherCall = this.scripts.get(other)?.[0]?.toolCalls?.[0];
    assert.ok(otherCall !== undefined, `agent "${other}" calls nothing for this call to land during`);
    const theirsMs = theirs.durationMs(this.grid, { agent: other, arguments: otherCall.arguments });
    assert.ok(mineMs < theirsMs, `agent "${agent}"'s "${tool}" takes ${mineMs} ms, no less than agent "${other}"'s ${theirsMs} ms`);
    script(this, agent, callWithThenEnd(tool, { x, y }, 0));
    this.rhythms.set(agent, () => (theirsMs - mineMs) / 2);
    this.setupChecks.push(() => {
      const landed = callOf(this, agent, tool);
      const underWay = callOf(this, other, otherTool);
      assert.ok(
        underWay.startedAtMs < landed.startedAtMs && landed.endedAtMs < underWay.endedAtMs,
        `agent "${agent}"'s "${tool}" did not land while agent "${other}"'s was under way`,
      );
    });
  },
);

Then(
  "{int} milliseconds after agent {string}'s {string} call started, agent {string} was still at {int}, {int} and the cell at {int}, {int} was empty",
  function (this: Context, afterMs: number, agent: string, tool: string, walker: string, x: number, y: number, emptyX: number, emptyY: number) {
    const { startedAtMs } = callOf(this, agent, tool);
    const grid = stateAt<Grid>(this, startedAtMs + afterMs);
    assertAt(grid, walker, { x, y });
    assert.deepEqual(entitiesAt(grid, { x: emptyX, y: emptyY }), []);
  },
);

Then("agent {string}'s {string} call succeeded", function (this: Context, agent: string, tool: string) {
  assert.equal(callOf(this, agent, tool).outcome, "success");
});
