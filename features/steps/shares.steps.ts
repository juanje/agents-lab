import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { entitiesAt, neighbours } from "../../src/engine/grid.ts";
import type { LoadedScenario } from "../../src/engine/scenario.ts";
import { type Neighbourhood, neighbourhoodScenario } from "../../src/scenarios/neighbourhood.ts";
import type { Context } from "../support/context.ts";
import { withBase } from "./neighbourhood.steps.ts";
import { assembled } from "./residents.steps.ts";
import { callWithThenEnd, script } from "./tool.steps.ts";

Given("the neighbourhood scenario with a grid {int} cells wide and {int} cells high", function (this: Context, width: number, height: number) {
  this.libraryScenario = withBase(neighbourhoodScenario, { width, height });
  this.assembleRun = (agents) => assembled(this, agents) as LoadedScenario<unknown>;
});

Given(
  "residents of kind {string} at {int}, {int} and {int}, {int}, and of kind {string} at {int}, {int} and {int}, {int}",
  function (this: Context, one: string, x1: number, y1: number, x2: number, y2: number, other: string, x3: number, y3: number, x4: number, y4: number) {
    const placed = [
      { kind: one, x: x1, y: y1 },
      { kind: one, x: x2, y: y2 },
      { kind: other, x: x3, y: y3 },
      { kind: other, x: x4, y: y4 },
    ];
    for (const { kind, x, y } of placed) this.residents.push({ name: `resident ${this.residents.length + 1}`, kind, x, y });
  },
);

/** The neighbourhood's state: as the run left it, or as the scenario set it up when nothing ran. */
function stateOf(context: Context): Neighbourhood {
  return (context.neighbourhoodWorld ?? assembled(context, []).world).state;
}

/** The value of the neighbourhood's metric of that name, computed from its state. */
function metric(context: Context, name: string): ReturnType<(typeof neighbourhoodScenario.metrics)[string]> {
  const compute = neighbourhoodScenario.metrics[name];
  assert.ok(compute !== undefined, `the neighbourhood declares no metric "${name}"`);
  return compute(stateOf(context));
}

/** Each resident's share, by its name, as the "shares" metric gives them. */
function shares(context: Context): Readonly<Record<string, number>> {
  const value = metric(context, "shares");
  assert.ok(typeof value === "object" && value !== null, `the "shares" metric gives ${JSON.stringify(value)}, not a share for each resident`);
  return value;
}

/** The resident the neighbourhood holds at a cell. */
function residentAt(context: Context, x: number, y: number): string {
  const [resident] = entitiesAt(stateOf(context).grid, { x, y });
  assert.ok(resident !== undefined, `the neighbourhood holds no resident at ${x}, ${y}`);
  return resident;
}

Then("the share of the resident at {int}, {int} is {float}", function (this: Context, x: number, y: number, share: number) {
  const resident = residentAt(this, x, y);
  assert.equal(shares(this)[resident], share, `the share of "${resident}" at ${x}, ${y}`);
});

Then("the resident at {int}, {int} has no share, because it has no neighbour", function (this: Context, x: number, y: number) {
  const resident = residentAt(this, x, y);
  const { grid } = stateOf(this);
  const held = neighbours(grid, { x, y }).filter((cell) => entitiesAt(grid, cell).length > 0);
  assert.deepEqual(held, [], `the scenario places neighbours around "${resident}"`);
  const given = shares(this);
  assert.ok(!Object.hasOwn(given, resident), `"${resident}" has the share ${given[resident]}`);
});

Then("the segregation is {float}", function (this: Context, segregation: number) {
  assert.equal(metric(this, "segregation"), segregation);
});

Given(
  "the resident at {int}, {int} runs on a scripted model that calls {string} with dx {int} and dy {int}, then calls {string} with dx {int} and dy {int}, then ends without a tool call",
  function (this: Context, x: number, y: number, first: string, dx: number, dy: number, second: string, nextDx: number, nextDy: number) {
    const placed = this.residents.find((resident) => resident.x === x && resident.y === y);
    assert.ok(placed !== undefined, `the scenario places no resident at ${x}, ${y}`);
    script(this, placed.name, [{ toolCalls: [{ name: first, arguments: { dx, dy } }], delayMs: 0 }, ...callWithThenEnd(second, { dx: nextDx, dy: nextDy }, 0)]);
  },
);

Then("the moves metric is {int}", function (this: Context, moves: number) {
  assert.ok(this.toolCalls !== undefined, "the neighbourhood did not run");
  assert.equal(metric(this, "moves"), moves);
});

Given(
  "residents of kind {string} at {int}, {int} and of kind {string} at {int}, {int}",
  function (this: Context, one: string, x1: number, y1: number, other: string, x2: number, y2: number) {
    this.residents.push({ name: "resident 1", kind: one, x: x1, y: y1 }, { name: "resident 2", kind: other, x: x2, y: y2 });
  },
);

Then("the segregation has no value", function (this: Context) {
  assert.equal(metric(this, "segregation"), null);
});
