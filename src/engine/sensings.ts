/** What one sensor call returned, and when: at the moment the call ended. */
export interface Sensing {
  tool: string;
  /** The text the agent received. */
  result: string;
  atMs: number;
}

/** What each agent has sensed: what an agent knows is what it last perceived, not the world's state (FR-TOOL-03). */
export class Sensings {
  record(_agent: string, _sensing: Sensing): void {}

  /** The agent's last sensing, or undefined if it has sensed nothing. */
  last(_agent: string): Sensing | undefined {
    return undefined;
  }
}
