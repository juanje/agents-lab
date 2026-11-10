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

  it("draws in [0, 1)", () => {
    for (const draw of draws(new Random(7), 1000)) {
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });
});
