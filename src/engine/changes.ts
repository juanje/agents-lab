/**
 * For each agent, the effects other agents applied since it last sensed the world (FR-RECORD-01). It counts, for each
 * agent, the effects applied by any other; an agent's count at its sensing is where its changes since sensing start.
 */
export class ChangesSinceSensing {
  #total = 0;
  readonly #own = new Map<string, number>();
  readonly #atSensing = new Map<string, number>();

  /** An effect applied for an agent. */
  applied(agent: string): void {
    this.#total += 1;
    this.#own.set(agent, (this.#own.get(agent) ?? 0) + 1);
  }

  /** An agent sensed the world now. */
  sensed(agent: string): void {
    this.#atSensing.set(agent, this.#byOthers(agent));
  }

  /** The effects other agents applied since the agent last sensed, or null, no count, when it has not sensed. */
  since(agent: string): number | null {
    const atSensing = this.#atSensing.get(agent);
    return atSensing === undefined ? null : this.#byOthers(agent) - atSensing;
  }

  #byOthers(agent: string): number {
    return this.#total - (this.#own.get(agent) ?? 0);
  }
}
