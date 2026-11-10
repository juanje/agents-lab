/** The maximum number of model calls running at once across a run (the parallelism limit), and the calls waiting for a slot. */
export class ParallelismLimit {
  #free: number;
  readonly #waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.#free = limit;
  }

  /** Waits for a free slot, first come first served, and gives the function that frees it. */
  async acquire(): Promise<() => void> {
    if (this.#free > 0) this.#free -= 1;
    else await new Promise<void>((resolve) => this.#waiting.push(resolve));
    return () => {
      // The slot passes straight to the next waiting call, so a newcomer cannot take it first.
      const next = this.#waiting.shift();
      if (next === undefined) this.#free += 1;
      else next();
    };
  }
}
