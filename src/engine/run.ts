import type { Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
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
  world: World<State>,
  tools: readonly Tool<State>[],
  agents: readonly Agent[],
  seed: number,
): Promise<void> {
  // Each agent's rhythm has its own sequence, from the seed and the agent's name: sharing one would make an agent's
  // intervals depend on when the others' models answer, and deriving by order on which other agents run.
  await Promise.all(agents.map((agent) => loop(world, tools, agent, Random.derive(seed, `rhythm of ${agent.name}`))));
}

/** One agent's loop: it repeats its cycle of waiting an interval from its rhythm, then an activation. */
async function loop<State>(world: World<State>, tools: readonly Tool<State>[], agent: Agent, random: Random): Promise<void> {
  for (let count = 0; count < agent.activations; count += 1) {
    await waitAtLeast(agent.rhythm(random));
    await activate(world, tools, agent);
  }
}

/** One activation: the agent's model works through its tools until a turn makes no tool call. */
async function activate<State>(world: World<State>, tools: readonly Tool<State>[], agent: Agent): Promise<void> {
  // The agent sees what each tool is for and what it takes; how the tool works stays in the world.
  const offered = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const messages: Message[] = [];
  for (;;) {
    const answer = await agent.model.models.complete(agent.model.model, { messages, tools: offered });
    messages.push(answer);
    // Text the model writes acts on nothing (FR-TOOL-02); only its tool calls do.
    const calls = answer.content.filter((block) => block.type === "toolCall");
    if (calls.length === 0) return;
    for (const call of calls) messages.push(use(world, tools, agent.name, call));
  }
}

/** Uses the tool an agent's call names, and gives what returns to the agent. */
function use<State>(world: World<State>, tools: readonly Tool<State>[], agent: string, call: ToolCall): ToolResultMessage {
  const tool = tools.find((declared) => declared.name === call.name);
  if (tool?.kind !== "sensor") throw new Error(`Agent "${agent}" called "${call.name}", which is not a sensor of the scenario`);
  const text = tool.sense(world.state, agent);
  return {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  };
}
