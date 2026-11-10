import { setTimeout as sleep } from "node:timers/promises";

/**
 * Waits at least `ms` by performance.now(), the clock every time in a run is read from. A Node timer can fire before
 * performance.now() has moved its full delay (seen at 6.66 ms for a 7 ms timer), so it waits again for whatever is left.
 */
export async function waitAtLeast(ms: number): Promise<void> {
  const end = performance.now() + ms;
  for (let left = ms; left > 0; left = end - performance.now()) await sleep(left);
}
