import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { type AgentModel, type ModelTurn, type ToolCall, openRuntime, openSession, wake } from "./adapter.ts";
import { waitAtLeast } from "./clock.ts";
import { ParallelismLimit } from "./parallelism.ts";
import { Random } from "./random.ts";
import type { LoadedScenario } from "./scenario.ts";
import { Stimuli } from "./stimuli.ts";

/** An agent in a run: its name, the model it works with, how many activations it has, and its rhythm. */
export interface Agent {
  name: string;
  model: AgentModel;
  activations: number;
  /** Draws the agent's next waiting interval before it wakes, in milliseconds, from the agent's random source. */
  rhythm: (random: Random) => number;
}

/** What a run takes besides the scenario: the limits on its model calls. */
export interface RunSettings {
  /** How long a model turn may run before it is aborted. */
  modelTurnTimeoutMs: number;
  /** The maximum number of model calls running at once, across all agents. */
  parallelismLimit: number;
  /**
   * Called with the run's stimuli before any agent wakes, so a caller can deliver stimuli while the run goes on. A seam
   * until the world's processes deliver them (FR-PROCESS-01).
   */
  onStart?: (stimuli: Stimuli) => void;
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
 * Runs every agent's activations in the loaded scenario's world, with the scenario's tools, stimulus channels and
 * system prompt: a run takes them only from the scenario it loaded, so it cannot mix one scenario's parts with
 * another's (FR-SCENARIO-01). Each agent runs its own loop and no agent waits for another: there are
 * no turns (NFR-01), only the arbiter ordering effects.
 */
export async function run<State>(
  loaded: LoadedScenario<State>,
  agents: readonly Agent[],
  seed: number,
  settings: RunSettings,
): Promise<RunResult> {
  const { world, scenario } = loaded;
  const stimuli = new Stimuli(scenario.channels);
  settings.onStart?.(stimuli);
  const sessionSettings = { systemPrompt: scenario.systemPrompt, modelTurnTimeoutMs: settings.modelTurnTimeoutMs };
  const runtime = await openRuntime(agents.map((agent) => agent.model.provider));
  const parallelism = new ParallelismLimit(settings.parallelismLimit);
  const turns: ModelTurn[] = [];
  const toolCalls: ToolCall[] = [];
  const messages = new Map<string, AgentSession["messages"]>();
  await Promise.all(
    agents.map(async (agent) => {
      const session = await openSession(world, scenario.tools, agent, runtime, sessionSettings, parallelism, turns, stimuli, toolCalls);
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
