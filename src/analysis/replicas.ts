/** The five numbers that show a distribution of values: none, when there are no values. */
export interface Quartiles {
  minimum: number | null;
  lowerQuartile: number | null;
  median: number | null;
  upperQuartile: number | null;
  maximum: number | null;
}

/**
 * The minimum, the quartiles and the maximum of the values, each by linear interpolation between the two sorted values
 * around its place, at its share of the way from the first to the last; none, without values.
 */
export function quartiles(values: readonly number[]): Quartiles {
  if (values.length === 0) return { minimum: null, lowerQuartile: null, median: null, upperQuartile: null, maximum: null };
  const sorted = [...values].sort((one, other) => one - other);
  const at = (share: number) => {
    const place = share * (sorted.length - 1);
    const below = Math.floor(place);
    return sorted[below] + (sorted[Math.ceil(place)] - sorted[below]) * (place - below);
  };
  return { minimum: at(0), lowerQuartile: at(0.25), median: at(0.5), upperQuartile: at(0.75), maximum: at(1) };
}
