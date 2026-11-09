import type { Action, World } from "./world.ts";

/** One argument of a declared action: its name, and how its value is read from the answer's text. */
export interface Argument {
  name: string;
  read(text: string): unknown;
}

/** What every declared action receives: the agent that acts, and each declared argument's value under its name. */
export type ActionArgs = { agent: string };

/** An action as a scenario declares it to its agents. */
export interface DeclaredAction<State, Args extends ActionArgs> extends Action<State, Args> {
  name: string;
  /** The text the agent sees. */
  description: string;
  arguments: readonly Argument[];
  failureReasons: readonly string[];
}

/** The single result of a decision: "success", an engine failure, or a failure reason the scenario declares. */
export type Outcome = string;

/** Reads an agent's answer against the declared actions and applies the action it names through the world's arbiter. */
export function act<State>(
  world: World<State>,
  actions: readonly DeclaredAction<State, ActionArgs>[],
  agent: string,
  answer: string,
): Outcome {
  const [name, ...texts] = answer.split(" ");
  const action = actions.find((declared) => declared.name === name);
  if (action === undefined) return "unparsed";
  const args: ActionArgs = { agent };
  action.arguments.forEach((argument, index) => {
    Object.assign(args, { [argument.name]: argument.read(texts[index]) });
  });
  const result = world.apply(action, args);
  return result.applied ? "success" : result.reason;
}
