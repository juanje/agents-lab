/**
 * For each agent, the effects other agents applied since it last sensed the world (FR-RECORD-01). It keeps, in the
 * order applied, the agent each effect was applied for; an agent's sensing marks where its changes since sensing start.
 */
export class ChangesSinceSensing {
  readonly #applied: string[] = [];
  readonly #atSensing = new Map<string, number>();

  /** An effect applied for an agent. */
  applied(agent: string): void {
    this.#applied.push(agent);
  }

  /** An agent sensed the world now. */
  sensed(agent: string): void {
    this.#atSensing.set(agent, this.#applied.length);
  }

  /** The effects other agents applied since the agent last sensed, or null, no count, when it has not sensed. */
  since(agent: string): number | null {
    return this.appliedBy(agent)?.length ?? null;
  }

  /**
   * The agent that applied each effect other agents applied since the agent last sensed, in the order applied, or null
   * when it has not sensed.
   */
  appliedBy(agent: string): string[] | null {
    const atSensing = this.#atSensing.get(agent);
    return atSensing === undefined ? null : this.#applied.slice(atSensing).filter((other) => other !== agent);
  }
}
