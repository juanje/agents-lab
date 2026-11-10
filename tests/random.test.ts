import { describe, expect, it } from "vitest";
import { Random } from "../src/engine/random.ts";

/** The first draws of a source. */
function draws(random: Random, count: number): number[] {
  return Array.from({ length: count }, () => random.next());
}

describe("Random", () => {
  it("gives the same draws to two sources with the same seed", () => {
    expect(draws(new Random(42), 20)).toEqual(draws(new Random(42), 20));
  });

  it("gives different draws to sources with different seeds", () => {
    expect(draws(new Random(42), 20)).not.toEqual(draws(new Random(43), 20));
  });

  it("derives one sequence per purpose: the same seed and purpose give the same draws", () => {
    expect(draws(Random.derive(42, "initial state"), 20)).toEqual(draws(Random.derive(42, "initial state"), 20));
  });

  it("derives different sequences for different purposes of one seed, and for one purpose of different seeds", () => {
    const base = draws(Random.derive(42, "rhythm of agent 1"), 20);

    expect(draws(Random.derive(42, "rhythm of agent 2"), 20)).not.toEqual(base);
    expect(draws(Random.derive(42, "initial state"), 20)).not.toEqual(base);
    expect(draws(Random.derive(43, "rhythm of agent 1"), 20)).not.toEqual(base);
  });

  it("draws in [0, 1)", () => {
    for (const draw of draws(new Random(7), 1000)) {
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });
});
