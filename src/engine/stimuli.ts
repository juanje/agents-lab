/** A declared path by which stimuli reach agents: its name, the source it names, and what it delivers. */
export interface Channel {
  name: string;
  source: string;
  stimulus: string;
}

/** A message delivered into an agent's session through a channel, with the channel's source. */
export interface Stimulus {
  channel: string;
  source: string;
  content: string;
}

/** The stimuli waiting for each agent, until its session takes them (FR-STIMULUS-01). */
export class Stimuli {
  constructor(_channels: readonly Channel[]) {}

  wake(_agent: string): Stimulus[] {
    return [];
  }
}
