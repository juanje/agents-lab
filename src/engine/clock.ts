import { setTimeout as sleep } from "node:timers/promises";

/**
 * Waits at least `ms` by performance.now(), the clock every time in a run is read from, or until `signal` aborts. A Node
 * timer can fire before performance.now() has moved its full delay (seen at 6.66 ms for a 7 ms timer), so it waits
 * again for whatever is left.
 */
export async function waitAtLeast(ms: number, signal?: AbortSignal): Promise<void> {
  const end = performance.now() + ms;
  for (let left = ms; left > 0 && signal?.aborted !== true; left = end - performance.now()) {
    try {
      await sleep(left, undefined, { signal });
    } catch (error) {
      // An abort ends the wait; the loop sees the signal aborted and stops.
      if (!(error instanceof Error && error.name === "AbortError")) throw error;
    }
  }
}
