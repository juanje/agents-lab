import type { Position } from "./grid.ts";

/** What one sensor call returned, and when: at the moment the call ended. */
export interface Sensing {
  tool: string;
  /** The text the agent received. */
  result: string;
  /** Where the agent sensed from, for a sensor that declares it. */
  takenFrom?: Position;
  atMs: number;
}

/** What each agent has sensed: what an agent knows is what it last perceived, not the world's state (FR-TOOL-03). */
export class Sensings {
  readonly #last = new Map<string, Sensing>();

  record(agent: string, sensing: Sensing): void {
    this.#last.set(agent, sensing);
  }

  /** The agent's last sensing, or undefined if it has sensed nothing. */
  last(agent: string): Sensing | undefined {
    return this.#last.get(agent);
  }
}
