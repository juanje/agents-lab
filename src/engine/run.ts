import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { type AgentModel, type ModelTurn, type SessionSettings, type ToolCall, openRuntime, openSession, wake } from "./adapter.ts";
import { waitAtLeast } from "./clock.ts";
import { ParallelismLimit } from "./parallelism.ts";
import { Random } from "./random.ts";
import type { Stimuli } from "./stimuli.ts";
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
 * What a run gives: every agent's model turns and tool calls, each in the order they ended, and what each agent's
 * session held at its end.
 */
export interface RunResult {
  turns: ModelTurn[];
  toolCalls: ToolCall[];
  messages: ReadonlyMap<string, AgentSession["messages"]>;
}

/**
 * Runs every agent's activations in the world. Each agent runs its own loop and no agent waits for another: there are
 * no turns (NFR-01), only the arbiter ordering effects.
 */
export async function run<State>(
  world: World<State>,
  tools: readonly Tool<State>[],
  stimuli: Stimuli,
  agents: readonly Agent[],
  seed: number,
  settings: RunSettings,
): Promise<RunResult> {
  const runtime = await openRuntime(agents.map((agent) => agent.model.provider));
  const parallelism = new ParallelismLimit(settings.parallelismLimit);
  const turns: ModelTurn[] = [];
  const toolCalls: ToolCall[] = [];
  const messages = new Map<string, AgentSession["messages"]>();
  await Promise.all(
    agents.map(async (agent) => {
      const session = await openSession(world, tools, agent, runtime, settings, parallelism, turns, stimuli, toolCalls);
      try {
        // Each agent's rhythm has its own sequence, from the seed and the agent's name: sharing one would make an
        // agent's intervals depend on when the others' models answer, and deriving by order on which other agents run.
        await loop(session, agent, stimuli, Random.derive(seed, `rhythm of ${agent.name}`));
      } finally {
        // Copied: disposing the session may clear what it holds.
        messages.set(agent.name, [...session.messages]);
        session.dispose();
      }
    }),
  );
  return { turns, toolCalls, messages };
}

/**
 * One agent's loop: it repeats its cycle of waiting an interval from its rhythm, then an activation, which its rhythm's
 * stimulus starts and in which the agent's session runs model turns and tool calls until a turn makes no tool call.
 */
async function loop(session: AgentSession, agent: Agent, stimuli: Stimuli, random: Random): Promise<void> {
  for (let count = 0; count < agent.activations; count += 1) {
    await waitAtLeast(agent.rhythm(random));
    await wake(session, stimuli.wake(agent.name));
  }
}
