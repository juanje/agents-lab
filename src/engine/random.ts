/**
 * A random sequence: the same seed gives the same draws. The engine derives one per purpose from a replica's seed
 * (`derive`), so no two purposes share a sequence. It is mulberry32, a small generator with 32 bits of
 * state, written here so that no dependency decides what a seed means.
 */
export class Random {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /**
   * The sequence a replica's seed gives one purpose, such as the initial state or one agent's rhythm. It depends only on
   * the seed and the purpose's name, so how many values one purpose draws never changes another's sequence.
   */
  static derive(seed: number, purpose: string): Random {
    // FNV-1a over the seed's four bytes and the purpose's UTF-16 code units, then murmur3's finalizer, so that seeds
    // and purposes that differ in one character start far apart.
    let hash = 0x811c9dc5;
    const mix = (unit: number) => {
      hash = Math.imul(hash ^ unit, 0x01000193) >>> 0;
    };
    for (let shift = 0; shift < 32; shift += 8) mix(((seed >>> 0) >>> shift) & 0xff);
    for (let index = 0; index < purpose.length; index += 1) mix(purpose.charCodeAt(index));
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
    return new Random(hash ^ (hash >>> 16));
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
