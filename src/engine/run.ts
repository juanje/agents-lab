import { type AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { type AgentModel, type ModelTurn, type SessionSettings, labPiDirectory, openSession } from "./adapter.ts";
import { waitAtLeast } from "./clock.ts";
import { ParallelismLimit } from "./parallelism.ts";
import { Random } from "./random.ts";
import type { Tool } from "./tools.ts";
import type { World } from "./world.ts";

/** An agent in a run: its name, the model it works with, how many activations it has, and its rhythm. */
export interface Agent {
  name: string;
  model: AgentModel;
  activations: number;
  /** Draws the agent's next waiting interval before it wakes, in milliseconds, from the agent's random source. */
  rhythm: (random: Random) => number;
}

/** What a run gives every agent's session besides its tools, and the limit their model calls share. */
export interface RunSettings extends SessionSettings {
  /** The maximum number of model calls running at once, across all agents. */
  parallelismLimit: number;
}

/**
 * Runs every agent's activations in the world, and gives every agent's model turns in the order they ended. Each agent runs its own loop and no agent waits for another: there are
 * no turns (NFR-01), only the arbiter ordering effects.
 */
export async function run<State>(
  world: World<State>,
  tools: readonly Tool<State>[],
  agents: readonly Agent[],
  seed: number,
  settings: RunSettings,
): Promise<ModelTurn[]> {
  // The lab's own credentials and model definitions, never the person's (NFR-08).
  const directory = labPiDirectory();
  const runtime = await ModelRuntime.create({
    authPath: join(directory, "auth.json"),
    modelsPath: join(directory, "models.json"),
    modelsStorePath: join(directory, "models-store.json"),
  });
  for (const agent of agents) runtime.registerNativeProvider(agent.model.provider);
  // Each agent's rhythm has its own sequence, from the seed and the agent's name: sharing one would make an agent's
  // intervals depend on when the others' models answer, and deriving by order on which other agents run.
  const parallelism = new ParallelismLimit(settings.parallelismLimit);
  const turns: ModelTurn[] = [];
  await Promise.all(
    agents.map(async (agent) => {
      const session = await openSession(world, tools, agent, runtime, settings, parallelism, turns);
      try {
        await loop(session, agent, Random.derive(seed, `rhythm of ${agent.name}`));
      } finally {
        session.dispose();
      }
    }),
  );
  return turns;
}

/**
 * One agent's loop: it repeats its cycle of waiting an interval from its rhythm, then an activation, in which the
 * agent's session runs model turns and tool calls until a turn makes no tool call.
 */
async function loop(session: AgentSession, agent: Agent, random: Random): Promise<void> {
  for (let count = 0; count < agent.activations; count += 1) {
    await waitAtLeast(agent.rhythm(random));
    await session.prompt("");
  }
}
