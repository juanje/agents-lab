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
  /** The channels whose stimuli each agent still has to receive as it first wakes. */
  readonly #first: Map<string, readonly string[]>;
  /** Who watches each agent's stimuli as they are delivered. */
  readonly #watchers = new Map<string, Set<(stimulus: Stimulus) => void>>();

  /**
   * Takes the scenario's channels, what to do with each stimulus as it is delivered (the run records it), and the
   * channels whose stimuli each agent receives once, as it first wakes.
   */
  constructor(
    channels: readonly Channel[],
    delivered: (agent: string, stimulus: Stimulus) => void = () => {},
    first: ReadonlyMap<string, readonly string[]> = new Map(),
  ) {
    this.#channels = channels;
    this.#delivered = delivered;
    this.#first = new Map(first);
  }

  /**
   * Delivers a channel's stimulus to an agent, each `{name}` in its text filled with the value given for it, such as a
   * mail notice's sender (FR-MESSAGE-01): it waits until the agent's session takes it.
   */
  deliver(agent: string, channel: string, values: Readonly<Record<string, string>> = {}): void {
    const declared = this.#stimulusOf(channel);
    const content = declared.content.replace(/\{(\w+)\}/g, (written, name: string) => (Object.hasOwn(values, name) ? values[name] : written));
    const stimulus = { ...declared, content };
    this.#delivered(agent, stimulus);
    this.#waiting.set(agent, [...(this.#waiting.get(agent) ?? []), stimulus]);
    for (const watcher of this.#watchers.get(agent) ?? []) watcher(stimulus);
  }

  /**
   * Tells a watcher each stimulus delivered to an agent from now on, as it is delivered, until the function it returns is
   * called; the stimulus still waits for the agent's session. An effector's call that ends early watches its agent's
   * stimuli (FR-WORKPLACE-07).
   */
  watch(agent: string, watcher: (stimulus: Stimulus) => void): () => void {
    const own = (stimulus: Stimulus) => watcher(stimulus);
    const watchers = this.#watchers.get(agent) ?? new Set();
    watchers.add(own);
    this.#watchers.set(agent, watchers);
    return () => watchers.delete(own);
  }

  /** Takes the stimuli waiting for an agent, in the order they were delivered. */
  take(agent: string): Stimulus[] {
    const waiting = this.#waiting.get(agent) ?? [];
    this.#waiting.delete(agent);
    return waiting;
  }

  /**
   * What an agent receives when its rhythm wakes it: the rhythm's stimulus, then, the first time only, its first
   * stimuli, then the stimuli waiting for it.
   */
  wake(agent: string): Stimulus[] {
    const now = [RHYTHM_CHANNEL, ...(this.#first.get(agent) ?? [])].map((channel) => this.#stimulusOf(channel));
    this.#first.delete(agent);
    for (const stimulus of now) this.#delivered(agent, stimulus);
    return [...now, ...this.take(agent)];
  }

  #stimulusOf(name: string): Stimulus {
    const channel = this.#channels.find((declared) => declared.name === name);
    if (channel === undefined) throw new Error(`no channel named "${name}" is declared`);
    return { channel: channel.name, source: channel.source, content: channel.stimulus };
  }
}
