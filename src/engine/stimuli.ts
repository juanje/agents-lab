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
  readonly #waiting = new Map<string, Stimulus[]>();

  constructor(channels: readonly Channel[]) {
    this.#channels = channels;
  }

  /** Delivers a channel's stimulus to an agent: it waits until the agent's session takes it. */
  deliver(agent: string, channel: string): void {
    const waiting = this.#waiting.get(agent) ?? [];
    this.#waiting.set(agent, [...waiting, this.#stimulusOf(channel)]);
  }

  /** Takes the stimuli waiting for an agent, in the order they were delivered. */
  take(agent: string): Stimulus[] {
    const waiting = this.#waiting.get(agent) ?? [];
    this.#waiting.delete(agent);
    return waiting;
  }

  /** What an agent receives when its rhythm wakes it: the rhythm's stimulus, then the stimuli waiting for it. */
  wake(agent: string): Stimulus[] {
    return [this.#stimulusOf("rhythm"), ...this.take(agent)];
  }

  #stimulusOf(name: string): Stimulus {
    const channel = this.#channels.find((declared) => declared.name === name);
    if (channel === undefined) throw new Error(`no channel named "${name}" is declared`);
    return { channel: channel.name, source: channel.source, content: channel.stimulus };
  }
}
