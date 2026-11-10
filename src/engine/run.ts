import { waitAtLeast } from "./clock.ts";
import { Random } from "./random.ts";
import type { ScriptedModel } from "./scripted-model.ts";
import type { Tool } from "./tools.ts";
import type { World } from "./world.ts";

/** An agent in a run: its name, the model it works with, how many activations it has, and its rhythm. */
export interface Agent {
  name: string;
  model: ScriptedModel;
  activations: number;
  /** Draws the agent's next waiting interval before it wakes, in milliseconds, from the agent's random source. */
  rhythm: (random: Random) => number;
}

/**
 * Runs every agent's activations in the world. Each agent runs its own loop and no agent waits for another: there are
 * no turns (NFR-01), only the arbiter ordering effects.
 */
export async function run<State>(
  _world: World<State>,
  _tools: readonly Tool<State>[],
  agents: readonly Agent[],
  seed: number,
): Promise<void> {
  // Each agent's rhythm has its own sequence, from the seed and the agent's name: sharing one would make an agent's
  // intervals depend on when the others' models answer, and deriving by order on which other agents run.
  await Promise.all(agents.map((agent) => loop(agent, Random.derive(seed, `rhythm of ${agent.name}`))));
}

/** One agent's loop: it repeats its cycle of waiting an interval from its rhythm, then waking. */
async function loop(agent: Agent, random: Random): Promise<void> {
  for (let count = 0; count < agent.activations; count += 1) {
    await waitAtLeast(agent.rhythm(random));
    // Text the model writes acts on nothing (FR-TOOL-02).
    await agent.model.models.complete(agent.model.model, { messages: [] });
  }
}
