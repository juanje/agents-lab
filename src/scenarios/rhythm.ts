import type { Configuration, Rhythm } from "../engine/scenario.ts";
import { type Channel, RHYTHM_CHANNEL } from "../engine/stimuli.ts";

/**
 * A rhythm as a library scenario's configuration gives it under `rhythm`: the source and text of the stimulus that
 * wakes each agent, and the bounds of the interval each agent waits before an activation.
 */
interface ConfiguredRhythm {
  source: string;
  text: string;
  min_ms: number;
  max_ms: number;
}

function rhythmOf(configuration: Configuration): ConfiguredRhythm {
  return configuration.rhythm as unknown as ConfiguredRhythm;
}

/** The rhythm channel, with the configured source and text; a condition may change them. */
export function rhythmChannels(configuration: Configuration): Channel[] {
  const { source, text } = rhythmOf(configuration);
  return [{ name: RHYTHM_CHANNEL, source, stimulus: text }];
}

/** Every agent waits an interval drawn uniformly between the configured bounds; a condition may change them. */
export function uniformRhythm(configuration: Configuration): Rhythm {
  const { min_ms: minMs, max_ms: maxMs } = rhythmOf(configuration);
  return (random) => minMs + random.next() * (maxMs - minMs);
}

/** The uniform rhythm as the inventory describes it. */
export function describeUniformRhythm(configuration: Configuration): string {
  const { min_ms: minMs, max_ms: maxMs } = rhythmOf(configuration);
  return `An interval drawn uniformly between ${minMs} and ${maxMs} ms before each activation.`;
}
