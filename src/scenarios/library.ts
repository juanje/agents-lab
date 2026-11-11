import type { Scenario } from "../engine/scenario.ts";

/**
 * A scenario as the library holds it. Its state's type is left open: the library holds scenarios whose states differ,
 * and the engine loads and runs each with its own state. It is `any`, not `unknown`, because a scenario's tools and
 * metrics take its state as an argument, and a function of one state is no function of every state.
 */
export type LibraryScenario = Partial<Scenario<any>>;

/** The scenario library: each reusable scenario, by its name. */
export const scenarioLibrary: ReadonlyMap<string, LibraryScenario> = new Map();
