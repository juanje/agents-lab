import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { parse } from "smol-toml";
import { type Position, place, position } from "../../src/engine/grid.ts";
import { Random } from "../../src/engine/random.ts";
import type { LoadedScenario, Scenario } from "../../src/engine/scenario.ts";
import { World } from "../../src/engine/world.ts";
import { KINDS, type Kind, type Neighbourhood, neighbourhoodScenario } from "../../src/scenarios/neighbourhood.ts";
import type { Context } from "../support/context.ts";
import { withBase } from "./neighbourhood.steps.ts";
import { callOf, callWithThenEnd, modelOf, returned, script } from "./tool.steps.ts";

Given(
  "the neighbourhood scenario with a grid {int} cells wide and {int} cells high, a look radius of {int}, and moving taking {int} milliseconds per cell",
  function (this: Context, width: number, height: number, radius: number, msPerCell: number) {
    this.neighbourhood = withBase(neighbourhoodScenario, { width, height, look_radius: radius, ms_per_cell: msPerCell });
    this.assembleRun = (agents) => assembled(this, agents) as LoadedScenario<unknown>;
  },
);

/**
 * The neighbourhood as the scenario set it up: its configuration, with the residents it names on the cells it gives
 * rather than on cells drawn from a seed, and the residents that have a model as its agents.
 */
function assembled(context: Context, agents: readonly string[]): LoadedScenario<Neighbourhood> {
  const configuration = parse(context.neighbourhood.baseConfiguration ?? "");
  // The scenario's own initial state with no residents gives the grid and the settings the configuration sets.
  const empty = neighbourhoodScenario.initialState({ ...configuration, residents: 0 }, new Random(context.seed));
  let grid = empty.grid;
  const kinds: Record<string, Kind> = {};
  for (const { name, kind, x, y } of context.residents) {
    assert.ok((KINDS as readonly string[]).includes(kind), `the neighbourhood has no kind "${kind}"`);
    grid = place(grid, name, { x, y });
    kinds[name] = kind as Kind;
  }
  const scenario: Scenario<Neighbourhood> = {
    ...neighbourhoodScenario,
    agents: () => agents,
    systemPrompt: (_configuration, agent) => `You are "${agent}", a resident of a neighbourhood.`,
  };
  const world = new World<Neighbourhood>({ ...empty, grid, kinds });
  context.neighbourhoodWorld = world;
  const systemPrompts = new Map(agents.map((agent) => [agent, scenario.systemPrompt(configuration, agent)]));
  return { scenario, configuration, world, systemPrompts, channels: scenario.channels(configuration) };
}

Given("resident {string} of kind {string} is at {int}, {int}", function (this: Context, name: string, kind: string, x: number, y: number) {
  this.residents.push({ name, kind, x, y });
});

Given(
  "resident {string} runs on a scripted model that calls {string}, then ends without a tool call",
  function (this: Context, resident: string, tool: string) {
    script(this, resident, callWithThenEnd(tool, {}, 0));
  },
);

Given(
  "resident {string} runs on a scripted model that calls {string} with dx {int} and dy {int}, then ends without a tool call",
  function (this: Context, resident: string, tool: string, dx: number, dy: number) {
    script(this, resident, callWithThenEnd(tool, { dx, dy }, 0));
  },
);

/** Where the neighbourhood holds a resident once the run has ended. */
function assertAt(context: Context, resident: string, at: Position): void {
  assert.ok(context.neighbourhoodWorld !== undefined, "the neighbourhood did not run");
  const found = position(context.neighbourhoodWorld.state.grid, resident);
  assert.deepEqual(found, at, `resident "${resident}" is at ${JSON.stringify(found)}`);
}

Then("resident {string} is at {int}, {int}", function (this: Context, resident: string, x: number, y: number) {
  assertAt(this, resident, { x, y });
});

Then(
  "{string}'s {string} call ended at least {int} milliseconds after it started",
  function (this: Context, resident: string, tool: string, durationMs: number) {
    const { startedAtMs, endedAtMs } = callOf(this, resident, tool);
    assert.ok(endedAtMs - startedAtMs >= durationMs, `resident "${resident}"'s "${tool}" call took ${endedAtMs - startedAtMs} ms`);
  },
);

Then(
  "{string}'s {string} result marks its own cell, the cell at {int}, {int} as its own kind, the cell at {int}, {int} as the other kind, the cell at {int}, {int} as empty, and the cells to the left and above as outside the grid",
  function (this: Context, resident: string, tool: string, sameX: number, sameY: number, otherX: number, otherY: number, emptyX: number, emptyY: number) {
    modelOf(this, resident);
    const at = this.residents.find(({ name }) => name === resident);
    assert.ok(at !== undefined, `the scenario places no resident "${resident}"`);
    const radius = parse(this.neighbourhood.baseConfiguration ?? "").look_radius as number;
    // The window as rows from the top, each from the left, the resident's cell in the middle: every cell the step
    // names is marked as it says, and every other cell of the window lies to the left of or above the grid.
    const expected: string[][] = [];
    for (let y = at.y - radius; y <= at.y + radius; y += 1) {
      const row: string[] = [];
      for (let x = at.x - radius; x <= at.x + radius; x += 1) {
        const is = (cx: number, cy: number) => x === cx && y === cy;
        if (is(at.x, at.y)) row.push("you");
        else if (is(sameX, sameY)) row.push("same");
        else if (is(otherX, otherY)) row.push("other");
        else if (is(emptyX, emptyY)) row.push("empty");
        else {
          assert.ok(x < 0 || y < 0, `the step does not say how the cell at ${x}, ${y} is marked`);
          row.push("outside");
        }
      }
      expected.push(row);
    }
    assert.deepEqual(JSON.parse(returned(this, resident, tool)), expected);
  },
);
