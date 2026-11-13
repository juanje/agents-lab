import { setTimeout as sleep } from "node:timers/promises";
import { type Calendar, type WorldDuration, type WorldTime, runMsFor, worldTimeAt } from "./calendar.ts";

/**
 * Waits at least `ms` by performance.now(), the clock every time in a run is read from, or until `signal` aborts. A Node
 * timer can fire before performance.now() has moved its full delay (seen at 6.66 ms for a 7 ms timer), so it waits
 * again for whatever is left.
 */
export async function waitAtLeast(ms: number, signal?: AbortSignal): Promise<void> {
  // A wait with no end, such as a call's until it ends (FR-PHONE-01), lasts until the signal aborts.
  if (ms === Number.POSITIVE_INFINITY) {
    if (signal === undefined) throw new Error("a wait with no end was given no signal to end it");
    if (!signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    return;
  }
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

/**
 * A run's own time: how long since it started, the moment its agents can start and its time limit counts from
 * (FR-CLOCK-02), and the world's time then, when the run has a calendar (FR-CLOCK-03). Sensors and components' cycles are
 * given both, so a world can keep a clock of its own (FR-WORKPLACE-05).
 */
export class RunClock {
  #startedAtMs: number | undefined;
  readonly #calendar: Calendar | undefined;

  constructor(calendar?: Calendar) {
    this.#calendar = calendar;
  }

  /**
   * The run milliseconds a duration takes from now: a duration in run time as it is, one in world time the run time it
   * spans by the run's calendar; a run without one cannot take a duration in world time.
   */
  runMsOf(duration: number | WorldDuration): number {
    if (typeof duration === "number") return duration;
    if (this.#calendar === undefined) throw new Error(`a duration of ${duration.worldSeconds} world seconds was given in a run with no calendar`);
    return runMsFor(this.#calendar, this.sinceStartMs(), duration.worldSeconds);
  }

  /** The world's time now, by the run's calendar; undefined for a run without one. */
  worldTime(): WorldTime | undefined {
    return this.#calendar === undefined ? undefined : worldTimeAt(this.#calendar, this.sinceStartMs());
  }

  /**
   * The world's time now as a key to spread into what an action is given (FR-CLOCK-03): `{ world }` for a run with a
   * calendar, nothing for a run without one.
   */
  worldTimeKey(): { world?: WorldTime } {
    const world = this.worldTime();
    return world === undefined ? {} : { world };
  }

  /** Starts the run's time now, by performance.now(), and gives that moment. */
  start(): number {
    this.#startedAtMs = performance.now();
    return this.#startedAtMs;
  }

  /** The milliseconds since the run started; asking before it started is a defect of the engine. */
  sinceStartMs(): number {
    if (this.#startedAtMs === undefined) throw new Error("the run's time was asked for before the run started");
    return performance.now() - this.#startedAtMs;
  }
}
