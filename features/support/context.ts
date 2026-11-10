import { World as CucumberWorld, setWorldConstructor } from "@cucumber/cucumber";
import type { Grid, Position, WindowCell } from "../../src/engine/grid.ts";
import type { Condition, Scenario } from "../../src/engine/scenario.ts";
import type { ActionResult, World } from "../../src/engine/world.ts";
import type { Slots } from "../../tests/fixtures/slots.ts";

/**
 * What one scenario's steps share. Cucumber builds a fresh one for each scenario, so no state leaks
 * between scenarios, and step files of different FRs reach the same test world.
 */
export class Context extends CucumberWorld {
  world!: World<Slots>;
  versionBefore!: number;
  result!: ActionResult;
  results!: ActionResult[];
  /** The scenario the engine is given, and the condition it is loaded with. */
  scenario!: Partial<Scenario<Slots>>;
  condition?: Condition;
  /** The initial state each replica started with, in the order the scenario starts them. */
  replicaStarts!: Slots[];
  /** The range each agent's waiting interval is drawn from, as the scenario gives it. */
  rhythmRange!: { minMs: number; maxMs: number };
  /** The intervals each agent's rhythm drew in each replica, in the order the scenario runs them. */
  replicaIntervals!: Map<string, number[]>[];
  /** The grid the scenario sets up. */
  grid!: Grid;
  /** The window the scenario took. */
  window!: WindowCell[];
  /** The cell a random draw gave, or undefined when it gave none. */
  drawnCell?: Position;
  /** A world whose state is the grid, for what goes through its arbiter. */
  gridWorld!: World<Grid>;
  /** The error a refused move gave, if it was refused. */
  moveError?: Error;
}

setWorldConstructor(Context);
