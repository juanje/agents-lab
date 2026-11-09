import { World as CucumberWorld, setWorldConstructor } from "@cucumber/cucumber";
import type { ActionArgs, DeclaredAction, Outcome } from "../../src/engine/actions.ts";
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
}

setWorldConstructor(Context);
