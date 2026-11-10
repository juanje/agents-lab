import { type ActionArgs, type DeclaredAction, type Outcome, act } from "./actions.ts";
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
  world: World<State>,
  actions: readonly DeclaredAction<State, ActionArgs>[],
  agents: readonly Agent[],
): Promise<Map<string, Decision[]>> {
  const decisions = new Map<string, Decision[]>();
  for (const agent of agents) {
    const made: Decision[] = [];
    for (let count = 0; count < agent.decisions; count += 1) {
      made.push(await decide(world, actions, agent));
    }
    decisions.set(agent.name, made);
  }
  return decisions;
}

/** One decision: the agent's model answers through Pi, and the action the answer names goes to the world's arbiter. */
async function decide<State>(
  world: World<State>,
  actions: readonly DeclaredAction<State, ActionArgs>[],
  agent: Agent,
): Promise<Decision> {
  const message = await agent.model.models.complete(agent.model.model, { messages: [] });
  const answer = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  return { answer, outcome: act(world, actions, agent.name, answer) };
}
