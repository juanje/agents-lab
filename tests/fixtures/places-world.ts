import { type Places, arrive, exits, leave, where } from "../../src/engine/places.ts";
import type { Scenario } from "../../src/engine/scenario.ts";
import type { AgentCall, Effector, Tool } from "../../src/engine/tools.ts";
import { rhythmChannel } from "./slots.ts";

/** A call of the effector "go" as the space's leave reads it: the calling agent leaves towards the place it names. */
function goCall({ agent, arguments: args }: AgentCall) {
  return { entity: agent, towards: args.place as string };
}

/**
 * The test place world's effector "go <place>": it moves the calling agent to a place one passage away, taking
 * `msPerUnit` for each unit of the passage's length.
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
    action: {
      precondition: (space, call) => leave.precondition(space, goCall(call)),
      effect: (space, call) => arrive.effect(leave.effect(space, goCall(call)), { entity: call.agent }),
    },
    // The test place world has no sensor, so an agent never has a sensing to read the target in.
    readTarget: () => "not_sensed",
  };
}

/** The test place world as a scenario, with the space it starts from, its tools and its agents. */
export function placesScenario(start: Places, tools: readonly Tool<Places>[], agents: readonly string[]): Scenario<Places> {
  return {
    name: "places",
    agents: () => agents,
    initialState: () => start,
    tools,
    channels: () => [rhythmChannel],
    metrics: {},
    systemPrompt: () => "You are an agent in a building.",
    // Its agents wake at once: a test that needs another rhythm gives it.
    rhythm: () => () => 0,
    describeDuration: () => "As each tool gives it.",
    describeRhythm: () => "No wait before any activation.",
    baseConfiguration: "",
  };
}
