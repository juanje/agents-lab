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

/**
 * A row of the summary of an experiment's runs: a condition, a model and a metric, and the agent or situation the
 * metric gives a value for, when it gives one for each.
 */
export interface SummaryRow extends Quartiles {
  condition: string;
  model: string;
  metric: string;
  key?: string;
  completed: number;
  stopped: number;
  values: number[];
  replicas: number[];
  nulls: number;
}

/** A stub that gives no rows and refuses nothing, for the test to fail on its assertions. */
export function summarizeRuns(_directory: string, _name: string = _directory): SummaryRow[] {
  return [];
}
