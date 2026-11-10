import type { ActionArgs, DeclaredAction, Outcome } from "./actions.ts";
import type { ScriptedModel } from "./scripted-model.ts";
import type { World } from "./world.ts";

/** An agent in a run: its name, the model it decides with, and how many decisions it makes. */
export interface Agent {
  name: string;
  model: ScriptedModel;
  decisions: number;
}

/** One decision of an agent: the model's raw answer and its latency, when the model gave one, and the outcome. */
export interface Decision {
  answer?: string;
  latencyMs?: number;
  outcome: Outcome;
}

/** Runs every agent's decisions against the world, and gives each agent's decisions in order. */
export async function run<State>(
  _world: World<State>,
  _actions: readonly DeclaredAction<State, ActionArgs>[],
  _agents: readonly Agent[],
): Promise<Map<string, Decision[]>> {
  return new Map();
}
