/** The channel whose stimulus wakes each agent: every scenario declares it (FR-SCENARIO-01). */
export const RHYTHM_CHANNEL = "rhythm";

/** A declared path by which stimuli reach agents: its name, the source it names, and what it delivers. */
export interface Channel {
  name: string;
  source: string;
  stimulus: string;
  /** Whether a stimulus on it reaches a resting agent at once and starts an activation, as its rhythm does (FR-CONGRESS-08). */
  wakes?: boolean;
}

/** A message delivered into an agent's session through a channel, with the channel's source. */
export interface Stimulus {
  channel: string;
  source: string;
  content: string;
}

/**
 * How a stimulus is delivered besides its channel: from a source of its own, such as a ring's caller, in place of the
 * channel's; and not held, as a ring is not held for a reply delay (FR-PHONE-01).
 */
export interface Delivery {
  source?: string;
  held?: boolean;
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
  /** What holds each recipient's stimuli until they reach it, for a recipient whose stimuli are held. */
  readonly #holds = new Map<string, (stimulus: Stimulus) => Promise<boolean>>();
  /** The channels each recipient that declares its channels takes stimuli through. */
  readonly #declared = new Map<string, readonly string[]>();
  /** What ends each resting agent's rest. */
  readonly #resting = new Map<string, AbortController>();

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
  deliver(agent: string, channel: string, values: Readonly<Record<string, string>> = {}, how: Delivery = {}): void {
    const declared = this.#stimulusOf(channel);
    const content = declared.content.replace(/\{(\w+)\}/g, (written, name: string) => (Object.hasOwn(values, name) ? values[name] : written));
    const stimulus = { ...declared, content, ...(how.source === undefined ? {} : { source: how.source }) };
    if (!(this.#declared.get(agent)?.includes(channel) ?? true)) return;
    const hold = how.held === false ? undefined : this.#holds.get(agent);
    if (hold === undefined) {
      this.#reach(agent, stimulus);
      return;
    }
    void hold(stimulus).then((reached) => {
      if (reached) this.#reach(agent, stimulus);
    });
  }

  /**
   * Holds each stimulus delivered to a recipient from now on until its hold lets it reach, or drops it when it does not,
   * as a participant's hours and reply delay hold its stimuli (FR-PARTICIPANT-01). Only a stimulus that reaches its
   * recipient is recorded, waits for it and is told to its watchers.
   */
  hold(agent: string, until: (stimulus: Stimulus) => Promise<boolean>): void {
    this.#holds.set(agent, until);
  }

  /**
   * Lets stimuli reach a recipient from now on only through the channels given, as a participant's declared channels do
   * (FR-PARTICIPANT-01): a stimulus on another channel never reaches it, is not recorded and is not held.
   */
  only(agent: string, channels: readonly string[]): void {
    this.#declared.set(agent, channels);
  }

  /** A stimulus reaching its recipient: recorded, waiting for it, and told to its watchers; one on a waking channel ends its rest. */
  #reach(agent: string, stimulus: Stimulus): void {
    this.#delivered(agent, stimulus);
    this.#waiting.set(agent, [...(this.#waiting.get(agent) ?? []), stimulus]);
    for (const watcher of this.#watchers.get(agent) ?? []) watcher(stimulus);
    if (this.#wakes(stimulus)) this.#resting.get(agent)?.abort();
  }

  /** Whether a stimulus's channel wakes a resting agent (FR-CONGRESS-08). */
  #wakes({ channel }: Stimulus): boolean {
    return this.#channels.some(({ name, wakes }) => name === channel && wakes === true);
  }

  /**
   * An agent's rest between activations (FR-CONGRESS-08): its signal is aborted when a stimulus on a waking channel
   * reaches the agent, at once when one is already waiting for it, until the rest ends.
   */
  rest(agent: string): { signal: AbortSignal; end: () => void } {
    const controller = new AbortController();
    this.#resting.set(agent, controller);
    if ((this.#waiting.get(agent) ?? []).some((stimulus) => this.#wakes(stimulus))) controller.abort();
    return {
      signal: controller.signal,
      end: () => {
        if (this.#resting.get(agent) === controller) this.#resting.delete(agent);
      },
    };
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
   * What an agent receives when it wakes: the rhythm's stimulus when its rhythm wakes it, then, the first time only, its
   * first stimuli, then the stimuli waiting for it, among them the one that woke it, when a stimulus did (FR-CONGRESS-08).
   */
  wake(agent: string, byRhythm = true): Stimulus[] {
    const now = [...(byRhythm ? [RHYTHM_CHANNEL] : []), ...(this.#first.get(agent) ?? [])].map((channel) => this.#stimulusOf(channel));
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
