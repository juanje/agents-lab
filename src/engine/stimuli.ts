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
  readonly #channels: readonly Channel[];

  constructor(channels: readonly Channel[]) {
    this.#channels = channels;
  }

  /** What an agent receives when its rhythm wakes it. */
  wake(_agent: string): Stimulus[] {
    return [this.#stimulusOf("rhythm")];
  }

  #stimulusOf(name: string): Stimulus {
    const channel = this.#channels.find((declared) => declared.name === name);
    if (channel === undefined) throw new Error(`no channel named "${name}" is declared`);
    return { channel: channel.name, source: channel.source, content: channel.stimulus };
  }
}
