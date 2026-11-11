import { type Places, arrive, exits, leave, where } from "../../src/engine/places.ts";
import type { Scenario } from "../../src/engine/scenario.ts";
import type { AgentCall, Effector, Tool } from "../../src/engine/tools.ts";
import { testWorldScenario } from "./slots.ts";

/** A call of the effector "go" as the space's leave reads it: the calling agent leaves towards the place it names. */
function goCall({ agent, arguments: args }: AgentCall) {
  return { entity: agent, towards: args.place as string };
}

/**
 * The test place world's effector "go <place>": it moves the calling agent to a place one passage away, taking
 * `msPerUnit` for each unit of the passage's length: it leaves its place as the call starts, and arrives when it ends.
 */
export function goTool(msPerUnit: number): Effector<Places> {
  return {
    kind: "effector",
    name: "go",
    description: "Go to a place one passage away.",
    parameters: { type: "object", properties: { place: { type: "string" } }, required: ["place"] },
    durationMs: (space, call) => {
      const { entity, towards } = goCall(call);
      const from = where(space, entity);
      const exit = from !== undefined && "place" in from ? exits(space, from.place).find(({ place }) => place === towards) : undefined;
      if (exit === undefined) throw new Error(`the test place world has no passage for agent ${entity} to go to ${towards}`);
      return msPerUnit * exit.length;
    },
    // The agent leaves its place as the call starts, and is in the passage until it arrives, when the call lands.
    start: {
      precondition: (space, call) => leave.precondition(space, goCall(call)),
      effect: (space, call) => leave.effect(space, goCall(call)),
      // The place the agent left, and the place it heads for.
      describe: (space, call) => ({ left: (where(space, call.agent) as { place: string }).place, towards: goCall(call).towards }),
    },
    action: {
      precondition: (space, { agent }) => arrive.precondition(space, { entity: agent }),
      effect: (space, { agent }) => arrive.effect(space, { entity: agent }),
    },
    // The test place world has no sensor, so an agent never has a sensing to read the target in.
    readTarget: () => "not_sensed",
  };
}

/** The test place world as a scenario, with the space it starts from, its tools and its agents. */
export function placesScenario(start: Places, tools: readonly Tool<Places>[], agents: readonly string[]): Scenario<Places> {
  return testWorldScenario("places", "in a building", start, tools, agents);
}
