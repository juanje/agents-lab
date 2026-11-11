/** The channel whose stimulus wakes each agent: every scenario declares it (FR-SCENARIO-01). */
export const RHYTHM_CHANNEL = "rhythm";

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
  readonly #delivered: (agent: string, stimulus: Stimulus) => void;

  /** Takes the scenario's channels, and what to do with each stimulus as it is delivered: the run records it. */
  constructor(channels: readonly Channel[], delivered: (agent: string, stimulus: Stimulus) => void = () => {}) {
    this.#channels = channels;
    this.#delivered = delivered;
  }

  /** Delivers a channel's stimulus to an agent: it waits until the agent's session takes it. */
  deliver(agent: string, channel: string): void {
    const stimulus = this.#stimulusOf(channel);
    this.#delivered(agent, stimulus);
    this.#waiting.set(agent, [...(this.#waiting.get(agent) ?? []), stimulus]);
  }

  /** Takes the stimuli waiting for an agent, in the order they were delivered. */
  take(agent: string): Stimulus[] {
    const waiting = this.#waiting.get(agent) ?? [];
    this.#waiting.delete(agent);
    return waiting;
  }

  /** What an agent receives when its rhythm wakes it: the rhythm's stimulus, then the stimuli waiting for it. */
  wake(agent: string): Stimulus[] {
    const rhythm = this.#stimulusOf(RHYTHM_CHANNEL);
    this.#delivered(agent, rhythm);
    return [rhythm, ...this.take(agent)];
  }

  #stimulusOf(name: string): Stimulus {
    const channel = this.#channels.find((declared) => declared.name === name);
    if (channel === undefined) throw new Error(`no channel named "${name}" is declared`);
    return { channel: channel.name, source: channel.source, content: channel.stimulus };
  }
}
