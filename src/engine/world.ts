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
  readonly #watchers = new Set<(before: State, after: State) => void>();

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

  /**
   * Applies one action against the current state. It runs synchronously, so no other action
   * can change the state between the precondition check and the effect.
   */
  apply<Args>(action: Action<State, Args>, args: Args): ActionResult {
    const check = action.precondition(this.#state, args);
    if (!check.holds) return { applied: false, reason: check.reason };
    const before = this.#state;
    this.#state = action.effect(before, args);
    this.#version += 1;
    for (const watcher of this.#watchers) watcher(before, this.#state);
    return { applied: true };
  }

  /**
   * Tells a watcher each action applied from now on, with the state before it and after it, as it is applied, until the
   * function it returns is called; an effector's call that ends early watches the world's changes (FR-WORKPLACE-07).
   */
  watch(watcher: (before: State, after: State) => void): () => void {
    const own = (before: State, after: State) => watcher(before, after);
    this.#watchers.add(own);
    return () => this.#watchers.delete(own);
  }
}
