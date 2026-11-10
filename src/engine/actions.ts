import type { Action, World } from "./world.ts";

/** One argument of a declared action: its name, and how its value is read from the answer's text. */
export interface Argument {
  name: string;
  /** The argument's value, or undefined when the text is not a value this argument takes. */
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

/**
 * The line of an answer that holds its action, by the one reading rule every scenario shares: lines end in "\n" or
 * "\r\n"; the action is the last line that holds anything besides whitespace, without whitespace at its start and end,
 * and with any run of whitespace inside it counted as one space. The rule ignores only layout; anything else in the
 * answer is left for the action's arguments to accept or refuse.
 */
function actionLine(answer: string): string {
  // "\r" is whitespace, so splitting on "\n" and trimming each line also reads "\r\n" as a line break.
  const lastLine = answer.split("\n").filter((line) => line.trim().length > 0).at(-1) ?? "";
  return lastLine.trim().replace(/\s+/g, " ");
}

/** Reads an agent's answer against the declared actions and applies the action it names through the world's arbiter. */
export function act<State>(
  world: World<State>,
  actions: readonly DeclaredAction<State, ActionArgs>[],
  agent: string,
  answer: string,
): Outcome {
  const [name, ...texts] = actionLine(answer).split(" ");
  const action = actions.find((declared) => declared.name.toLowerCase() === name.toLowerCase());
  if (action === undefined) return "unparsed";
  // A malformed answer is counted, never repaired: extra or missing arguments are not dropped or filled in.
  if (texts.length !== action.arguments.length) return "invalid_arguments";
  const args: ActionArgs = { agent };
  for (const [index, argument] of action.arguments.entries()) {
    const value = argument.read(texts[index]);
    if (value === undefined) return "invalid_arguments";
    Object.assign(args, { [argument.name]: value });
  }
  const result = world.apply(action, args);
  return result.applied ? "success" : result.reason;
}
