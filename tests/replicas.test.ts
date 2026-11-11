import { describe, expect, it } from "vitest";
import { quartiles } from "../src/analysis/replicas.ts";

describe("quartiles", () => {
  it("gives the minimum, the quartiles and the maximum by linear interpolation between the sorted values", () => {
    expect(quartiles([1, 3, 2])).toEqual({ minimum: 1, lowerQuartile: 1.5, median: 2, upperQuartile: 2.5, maximum: 3 });
    expect(quartiles([4, 1, 3, 2])).toEqual({ minimum: 1, lowerQuartile: 1.75, median: 2.5, upperQuartile: 3.25, maximum: 4 });
  });

  it("gives the one value for all five", () => {
    expect(quartiles([4])).toEqual({ minimum: 4, lowerQuartile: 4, median: 4, upperQuartile: 4, maximum: 4 });
  });

  it("gives none without values", () => {
    expect(quartiles([])).toEqual({ minimum: null, lowerQuartile: null, median: null, upperQuartile: null, maximum: null });
  });
});
