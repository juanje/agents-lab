/** The five numbers that show a distribution of values: none, when there are no values. */
export interface Quartiles {
  minimum: number | null;
  lowerQuartile: number | null;
  median: number | null;
  upperQuartile: number | null;
  maximum: number | null;
}

/** A stub that gives none, for the test to fail on its assertions. */
export function quartiles(_values: readonly number[]): Quartiles {
  return { minimum: null, lowerQuartile: null, median: null, upperQuartile: null, maximum: null };
}
