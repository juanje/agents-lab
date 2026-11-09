/** Whether an action's precondition holds, and if not, the action's named reason. */
export type Check = { holds: true } | { holds: false; reason: string };

/** An operation on the world: a precondition checked against the current state, and an effect that gives the next state. */
export interface Action<State, Args> {
  precondition(state: State, args: Args): Check;
  effect(state: State, args: Args): State;
}

export type ActionResult = { applied: true } | { applied: false; reason: string };

/** A scenario's state and its arbiter, the only writer of that state. */
export class World<State> {
  #state: State;
  #version = 0;

  constructor(initial: State) {
    this.#state = initial;
  }

  get state(): State {
    return this.#state;
  }

  /** The number of actions applied so far. */
  get version(): number {
    return this.#version;
  }

  // Stub: the arbiter is not built yet, so nothing is applied.
  apply<Args>(_action: Action<State, Args>, _args: Args): ActionResult {
    return { applied: false, reason: "not_built" };
  }
}
