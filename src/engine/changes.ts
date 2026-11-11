/** For each agent, the effects other agents applied since it last sensed the world (FR-RECORD-01). */
export class ChangesSinceSensing {
  applied(_agent: string): void {}

  sensed(_agent: string): void {}

  since(_agent: string): number | undefined {
    return -1;
  }
}
