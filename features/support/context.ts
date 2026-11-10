import { World as CucumberWorld, setWorldConstructor } from "@cucumber/cucumber";
import type { ActionArgs, DeclaredAction, Outcome } from "../../src/engine/actions.ts";
import type { Grid, Position, WindowCell } from "../../src/engine/grid.ts";
import type { Decision } from "../../src/engine/run.ts";
import type { Condition, LoadedScenario, Scenario } from "../../src/engine/scenario.ts";
import type { ScriptedModel } from "../../src/engine/scripted-model.ts";
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
  actions!: readonly DeclaredAction<Slots, ActionArgs>[];
  outcome!: Outcome;
  /** Each agent's scripted model and decision budget, as the scenario gives them before the run. */
  readonly models = new Map<string, ScriptedModel>();
  readonly budgets = new Map<string, number>();
  /** Each agent's waiting interval between decisions, in milliseconds, as the scenario gives it. */
  readonly intervals = new Map<string, number>();
  decisions!: Map<string, Decision[]>;
  /** The scenario the engine is given, and what loading it gave: the loaded scenario or the error that refused it. */
  scenario!: Partial<Scenario<Slots>>;
  condition?: Condition;
  loaded?: LoadedScenario<Slots>;
  /** The loaded world's state and version before anything ran on it. */
  start?: { state: Slots; version: number };
  loadingError?: Error;
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
