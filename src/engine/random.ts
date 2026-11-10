/** A replica's random source. Stub: it ignores its seed, so the steps can fail on their assertions first. */
export class Random {
  constructor(_seed: number) {}

  /** The next draw, in [0, 1). */
  next(): number {
    return Math.random();
  }
}
