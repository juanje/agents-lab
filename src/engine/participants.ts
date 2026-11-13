import type { TomlTable, TomlValue } from "smol-toml";
import { type CallContext, type Records, callTool } from "./adapter.ts";
import { type Calendar, reachedAfterMs } from "./calendar.ts";
import { type RunClock, waitAtLeast } from "./clock.ts";
import { Random } from "./random.ts";
import type { Stimuli, Stimulus } from "./stimuli.ts";
import type { Tool } from "./tools.ts";
import type { World } from "./world.ts";

/**
 * A participant as a configuration declares it (FR-PARTICIPANT-01): a party of the world that perceives and acts only
 * through its tools and channels, decided by a rule set the scenario provides, with its parameters; its tools and
 * channels, by name; and the hours it keeps and its reply delay, in world minutes, when it has them.
 */
export interface ParticipantSettings {
  name: string;
  decides: "rules";
  rules: string;
  params: Readonly<Record<string, unknown>>;
  tools: readonly string[];
  channels: readonly string[];
  hours?: string;
  replyMinutes?: readonly [number, number];
}

/** What a configuration's participants are checked against: the scenario's tools and channels, its calendar, its rule sets and the names its agents and components have. */
export interface Declared {
  tools: readonly string[];
  channels: readonly string[];
  calendar?: Calendar;
  ruleSets: readonly string[];
  taken: readonly string[];
}

/** Whether a TOML value is a table. */
function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

/** Reads a configuration's [participants] (FR-PARTICIPANT-01), in the order it gives them; none when it declares none. */
export function readParticipants(value: TomlValue | undefined, _declared: Declared): ParticipantSettings[] {
  return Object.entries(isTable(value) ? value : {}).map(([name, written]) => {
    const { rules, params, tools, channels, hours, reply_minutes: replyMinutes } = (isTable(written) ? written : {}) as TomlTable;
    return {
      name,
      decides: "rules",
      rules: rules as string,
      params: (isTable(params) ? params : {}) as Record<string, unknown>,
      tools: tools as string[],
      channels: channels as string[],
      ...(hours === undefined ? {} : { hours: hours as string }),
      ...(replyMinutes === undefined ? {} : { replyMinutes: replyMinutes as [number, number] }),
    };
  });
}

/** What a rule set perceives at each step (FR-PARTICIPANT-01): the stimuli that reached its participant since its last step, and its last call's result. */
export interface Perceived {
  stimuli: readonly Stimulus[];
  result?: { tool: string; outcome: string; text: string };
}

/** A rule set's next step: a call of one of its participant's tools, or the end, after which it waits for the next stimulus. */
export type RuleStep = { kind: "call"; tool: string; arguments: Record<string, unknown> } | { kind: "end" };

/** A rule set as it decides one participant in one run: from what the participant perceives only, never the world's state. */
export interface Rules {
  next(perceived: Perceived): RuleStep;
  /** The participant's outcome record, named values, when the run ends. */
  outcome(): Readonly<Record<string, string | number | boolean>>;
}

/** A named rule set a scenario provides, started for a participant with its parameters (FR-PARTICIPANT-01). */
export interface RuleSet {
  start(params: Readonly<Record<string, unknown>>): Rules;
}

/** What the participants run in: the world, the tools, the run's time, end and seed, the stimuli, and how a call is run and recorded. */
export interface ParticipantsRun<State> {
  world: World<State>;
  tools: readonly Tool<State>[];
  participants: readonly ParticipantSettings[];
  ruleSets: Readonly<Record<string, RuleSet>>;
  clock: RunClock;
  calendar?: Calendar;
  seed: number;
  runEnd: AbortSignal;
  stimuli: Stimuli;
  call: CallContext;
  records: Pick<Records, "toolCall">;
}

/**
 * The participants of a run (FR-PARTICIPANT-01). A stimulus reaches a participant at the first moment within its hours
 * that is at least a reply delay after it arrived, the delay drawn between the two numbers of its reply_minutes from the
 * seed and `replies of <name>`. A rule set is woken by each stimulus that reaches its participant, and its calls go
 * through the tools as an agent's do, recorded under the participant's name.
 */
export class Participants<State> {
  readonly #run: ParticipantsRun<State>;
  /** The held stimuli and the rule sets at work, which keep the run going. */
  readonly #pending = new Set<Promise<unknown>>();
  readonly #awake = new Set<string>();

  constructor(run: ParticipantsRun<State>) {
    this.#run = run;
  }

  /** Holds each participant's stimuli by its hours and reply delay, and wakes each rule set by the stimuli that reach it. */
  start(): void {
    const { participants, ruleSets, stimuli } = this.#run;
    for (const participant of participants) {
      if (participant.hours !== undefined || participant.replyMinutes !== undefined) {
        const delays = Random.derive(this.#run.seed, `replies of ${participant.name}`);
        stimuli.hold(participant.name, () => this.#track(this.#held(participant, delays)));
      }
      const rules = ruleSets[participant.rules].start(participant.params);
      stimuli.watch(participant.name, () => this.#wake(participant, rules));
    }
  }

  /** Whether a held stimulus or a rule set at work remains. */
  get busy(): boolean {
    return this.#pending.size > 0;
  }

  /** Resolves once no held stimulus or rule set at work remains. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all(this.#pending);
  }

  #track<T>(work: Promise<T>): Promise<T> {
    const tracked = work.finally(() => this.#pending.delete(tracked));
    this.#pending.add(tracked);
    return tracked;
  }

  /** Waits until a held stimulus reaches its participant; it does not when the run ends first. */
  async #held({ name, hours, replyMinutes }: ParticipantSettings, delays: Random): Promise<boolean> {
    const { calendar, clock, runEnd } = this.#run;
    if (calendar === undefined) throw new Error(`participant "${name}" has hours or a reply delay in a run with no calendar`);
    const [fewest, most] = replyMinutes ?? [0, 0];
    const minutes = fewest + delays.next() * (most - fewest);
    await waitAtLeast(reachedAfterMs(calendar, clock.sinceStartMs(), minutes * 60, hours), runEnd);
    return !runEnd.aborted;
  }

  /** Wakes a rule set that waits for a stimulus; one at work takes the stimulus with its next step. */
  #wake(participant: ParticipantSettings, rules: Rules): void {
    if (this.#awake.has(participant.name)) return;
    this.#awake.add(participant.name);
    void this.#track(this.#act(participant, rules)).finally(() => this.#awake.delete(participant.name));
  }

  /**
   * Runs a rule set's steps from the stimuli that woke it until it ends with none waiting: each call through the
   * participant's tool, recorded under its name. A call of a tool the participant does not declare stops the run.
   */
  async #act({ name }: ParticipantSettings, rules: Rules): Promise<void> {
    const { world, tools, stimuli, runEnd, call, records } = this.#run;
    try {
      for (let waiting = stimuli.take(name); waiting.length > 0 && !runEnd.aborted; waiting = stimuli.take(name)) {
        let step = rules.next({ stimuli: waiting });
        while (step.kind === "call") {
          const { tool: named, arguments: args } = step;
          const tool = tools.find((each) => each.name === named) as Tool<State>;
          const { executed, text } = await callTool(world, tool, name, args, call);
          records.toolCall({ agent: name, tool: tool.name, arguments: args, ...executed });
          if (runEnd.aborted) return;
          step = rules.next({ stimuli: stimuli.take(name), result: { tool: tool.name, outcome: executed.outcome, text } });
        }
      }
    } catch (error) {
      call.stop(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
