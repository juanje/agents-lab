import { type ActionArgs, type DeclaredAction, type Outcome, act } from "./actions.ts";
import { waitAtLeast } from "./clock.ts";
import { Random } from "./random.ts";
import type { ScriptedModel } from "./scripted-model.ts";
import type { World } from "./world.ts";

/** An agent in a run: its name, the model it decides with, how many decisions it makes, and its rhythm. */
export interface Agent {
  name: string;
  model: ScriptedModel;
  decisions: number;
  /** Draws the agent's next waiting interval before it observes, in milliseconds, from the agent's random source. */
  rhythm: (random: Random) => number;
}

/**
 * One decision of an agent: when it observed, the model's raw answer and its latency, when the model gave one, when the
 * action the answer names went to the arbiter, and the outcome. Times are read from performance.now().
 */
export interface Decision {
  observedAtMs?: number;
  answer?: string;
  latencyMs?: number;
  actedAtMs?: number;
  outcome: Outcome;
}

/**
 * Runs every agent's decisions against the world, and gives each agent's decisions in order. Each agent runs its own
 * loop and no agent waits for another's decision: there are no turns (NFR-01), only the arbiter ordering actions.
 */
export async function run<State>(
  world: World<State>,
  actions: readonly DeclaredAction<State, ActionArgs>[],
  agents: readonly Agent[],
  _random: Random,
): Promise<Map<string, Decision[]>> {
  // Stub: each rhythm draws from a source unrelated to the replica's, so the steps can fail on their assertions first.
  const made = await Promise.all(
    agents.map((agent) => loop(world, actions, agent, new Random(Math.floor(Math.random() * 2 ** 32)))),
  );
  return new Map(agents.map((agent, index) => [agent.name, made[index]]));
}

/** One agent's loop: it repeats its cycle of waiting an interval from its rhythm, then deciding. */
async function loop<State>(
  world: World<State>,
  actions: readonly DeclaredAction<State, ActionArgs>[],
  agent: Agent,
  random: Random,
): Promise<Decision[]> {
  const made: Decision[] = [];
  for (let count = 0; count < agent.decisions; count += 1) {
    await waitAtLeast(agent.rhythm(random));
    made.push(await decide(world, actions, agent));
  }
  return made;
}

/** One decision: the agent's model answers through Pi, and the action the answer names goes to the world's arbiter. */
async function decide<State>(
  world: World<State>,
  actions: readonly DeclaredAction<State, ActionArgs>[],
  agent: Agent,
): Promise<Decision> {
  // Checked before the call: past its script the faux provider answers with an error and no text, which would be
  // read as an unparsed answer instead of the end of the script.
  if (agent.model.exhausted) return { outcome: "script_exhausted" };
  const observedAtMs = performance.now();
  const start = performance.now();
  const message = await agent.model.models.complete(agent.model.model, { messages: [] });
  const latencyMs = performance.now() - start;
  const answer = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  const actedAtMs = performance.now();
  return { observedAtMs, answer, latencyMs, actedAtMs, outcome: act(world, actions, agent.name, answer) };
}
