import type { Position } from "./grid.ts";

/**
 * What one sensor call returned, or what an effector's sight kept of what its agent saw (FR-WORKPLACE-08), and when: at
 * the moment the call ended.
 */
export interface Sensing {
  tool: string;
  /** The text the agent received from a sensor, or what an effector's sight kept. */
  result: string;
  /** Where the agent sensed from, for a sensor that declares it. */
  takenFrom?: Position;
  atMs: number;
}

/** What each agent has sensed: what an agent knows is what it last perceived, not the world's state (FR-TOOL-03). */
export class Sensings {
  readonly #last = new Map<string, Sensing>();
  /** Each agent's last sensing by each sensor, by the agent and then the sensor's name. */
  readonly #lastBy = new Map<string, Map<string, Sensing>>();

  record(agent: string, sensing: Sensing): void {
    this.#last.set(agent, sensing);
    this.#keepBy(agent, sensing);
  }

  /**
   * Keeps what an effector's sight saw, by the effector's name, for the agent's later calls; it is no sensing, so the
   * agent's last sensing stays as it was (FR-WORKPLACE-08).
   */
  sighted(agent: string, sighting: Sensing): void {
    this.#keepBy(agent, sighting);
  }

  /** Keeps a sensing or a sighting as the agent's last by its tool. */
  #keepBy(agent: string, kept: Sensing): void {
    const byTool = this.#lastBy.get(agent) ?? new Map<string, Sensing>();
    byTool.set(kept.tool, kept);
    this.#lastBy.set(agent, byTool);
  }

  /** The agent's last sensing, or undefined if it has sensed nothing. */
  last(agent: string): Sensing | undefined {
    return this.#last.get(agent);
  }

  /**
   * The agent's last sensing by a sensor, or what an effector's sight last kept, by the tool's name, whatever came after
   * it; undefined if there is none.
   */
  lastBy(agent: string, tool: string): Sensing | undefined {
    return this.#lastBy.get(agent)?.get(tool);
  }
}
