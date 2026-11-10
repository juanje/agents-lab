/**
 * A replica's random source: the same seed gives the same draws. It is mulberry32, a small generator with 32 bits of
 * state, written here so that no dependency decides what a seed means.
 */
export class Random {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /** The next draw, in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let mixed = this.#state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  }
}
