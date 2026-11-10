import {
  type AgentSession,
  type ModelRuntime,
  SessionManager,
  type ToolDefinition,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type { Effector, Tool } from "./tools.ts";
import type { World } from "./world.ts";

/** The model an agent works with, and the provider that serves it, which the run registers with Pi's model runtime. */
export interface AgentModel {
  model: Model<Api>;
  provider: Provider;
}

/** Opens the Pi session an agent keeps for the whole run (FR-ADAPTER-02). */
export async function openSession<State>(
  world: World<State>,
  tools: readonly Tool<State>[],
  agent: { name: string; model: AgentModel },
  runtime: ModelRuntime,
): Promise<AgentSession> {
  const { session } = await createAgentSession({
    modelRuntime: runtime,
    model: agent.model.model,
    // The allowlist leaves out Pi's built-in tools and filters custom tools too, so it names every scenario tool.
    tools: tools.map((tool) => tool.name),
    customTools: tools.map((tool) => definition(world, tool, agent.name)),
    sessionManager: SessionManager.inMemory(),
  });
  return session;
}

/** A scenario's tool as Pi runs it for one agent: the agent sees what it is for and what it takes; how it works stays in the world. */
function definition<State>(world: World<State>, tool: Tool<State>, agent: string): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as ToolDefinition["parameters"],
    execute: async (_id, args: Record<string, unknown>) => {
      const text = tool.kind === "sensor" ? tool.sense(world.state, agent) : effect(world, tool, agent, args);
      return { content: [{ type: "text", text }], details: undefined };
    },
  };
}

/** Applies an effector's call through the arbiter, and gives its outcome: "success" or the failure's reason. */
function effect<State>(world: World<State>, effector: Effector<State>, agent: string, args: Record<string, unknown>): string {
  // The agent comes last, so a call cannot act in another agent's name.
  const result = world.apply(effector.action, { ...args, agent });
  return result.applied ? "success" : result.reason;
}
