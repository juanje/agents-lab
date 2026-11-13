import type { TomlTable, TomlValue } from "smol-toml";
import { type CallContext, type Records, callTool } from "./adapter.ts";
import { type Calendar, minutesBetween, reachedAfterMs } from "./calendar.ts";
import { type RunClock, waitAtLeast } from "./clock.ts";
import { Random } from "./random.ts";
import type { Stimuli, Stimulus } from "./stimuli.ts";
import type { Tool } from "./tools.ts";
import type { World } from "./world.ts";

/**
 * A participant as a configuration declares it (FR-PARTICIPANT-01): a party of the world that perceives and acts only
 * through its tools and channels, by name, with the hours it keeps and its reply delay, in world minutes, when it has
 * them; decided by a rule set the scenario provides, with its parameters, or by a model, with its system prompt.
 */
export type ParticipantSettings = {
  name: string;
  tools: readonly string[];
  channels: readonly string[];
  hours?: string;
  replyMinutes?: readonly [number, number];
} & ({ decides: "rules"; rules: string; params: Readonly<Record<string, unknown>> } | { decides: "model"; model: string; systemPrompt: string });

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

/** A participant's key that cannot be followed: an error that names it, its value and why. */
function refused(key: string, value: unknown, why: string): Error {
  return new Error(`The configuration's ${key} ${JSON.stringify(value) ?? "(none)"} cannot be followed: ${why}`);
}

/** A list of names, each one the scenario declares, refused, naming its key, otherwise. */
function namesOf(value: TomlValue | undefined, key: string, declared: readonly string[], what: string): string[] {
  if (!Array.isArray(value) || !value.every((name) => typeof name === "string")) throw refused(key, value, `it is not a list of ${what} names`);
  const unknown = (value as string[]).find((name) => !declared.includes(name));
  if (unknown !== undefined) throw refused(key, value, `the scenario declares no ${what} "${unknown}"`);
  return value as string[];
}

/** A text a participant decided by a model needs, refused, naming its key, when it is missing or empty. */
function textOf(value: TomlValue | undefined, key: string): string {
  if (typeof value !== "string" || value.trim() === "") throw refused(key, value, "a participant decided by a model needs it");
  return value;
}

/**
 * Reads a configuration's [participants] (FR-PARTICIPANT-01), in the order it gives them; none when it declares none.
 * One that cannot be followed is refused, with an error that names the key: a name an agent or a component already has,
 * a tool or channel the scenario does not declare, hours the calendar does not declare or hours without a calendar,
 * reply_minutes without a calendar or that are not two numbers from 0 with the first not above the second, decides that is neither rules nor
 * model, a rule set the scenario does not provide, and a participant decided by a model without a model or a system prompt.
 */
export function readParticipants(value: TomlValue | undefined, declared: Declared): ParticipantSettings[] {
  return Object.entries(isTable(value) ? value : {}).map(([name, written]): ParticipantSettings => {
    const key = `participants.${name}`;
    if (declared.taken.includes(name)) throw refused(key, name, `an agent or a component is already named "${name}"`);
    const table = isTable(written) ? written : {};
    const { decides, rules, params, model, system_prompt: systemPrompt, hours, reply_minutes: replyMinutes } = table;
    const kept = {
      name,
      tools: namesOf(table.tools, `${key}.tools`, declared.tools, "tool"),
      channels: namesOf(table.channels, `${key}.channels`, declared.channels, "channel"),
      ...(hours === undefined ? {} : { hours: hoursOf(hours, `${key}.hours`, declared.calendar) }),
      ...(replyMinutes === undefined ? {} : { replyMinutes: replyMinutesOf(replyMinutes, `${key}.reply_minutes`, declared.calendar) }),
    };
    if (decides === "model") return { ...kept, decides, model: textOf(model, `${key}.model`), systemPrompt: textOf(systemPrompt, `${key}.system_prompt`) };
    if (decides !== "rules") throw refused(`${key}.decides`, decides, 'it is neither "rules" nor "model"');
    if (typeof rules !== "string" || !declared.ruleSets.includes(rules)) throw refused(`${key}.rules`, rules, `the scenario provides no rule set "${String(rules)}"`);
    return { ...kept, decides, rules, params: (isTable(params) ? params : {}) as Record<string, unknown> };
  });
}

/** A participant's reply delay, two numbers of world minutes, refused, naming its key, when there is no calendar to give them. */
function replyMinutesOf(value: TomlValue, key: string, calendar: Calendar | undefined): readonly [number, number] {
  if (calendar === undefined) throw refused(key, value, "they are world minutes, and the configuration declares no [calendar]");
  return minutesBetween(value, key);
}

/** The name of a set of hours a participant keeps, refused, naming its key, when the calendar does not declare it or there is no calendar. */
function hoursOf(value: TomlValue, key: string, calendar: Calendar | undefined): string {
  if (calendar === undefined) throw refused(key, value, "the configuration declares no [calendar]");
  if (typeof value !== "string" || !Object.hasOwn(calendar.hours, value)) throw refused(key, value, `the calendar declares no hours "${String(value)}"`);
  return value;
}

/** What a rule set perceives at each step (FR-PARTICIPANT-01): the stimuli that reached its participant since its last step, and its last call's result. */
export interface Perceived {
  stimuli: readonly Stimulus[];
  result?: { tool: string; outcome: string; text: string };
}

/**
 * A rule set's next step: a call of one of its participant's tools; a wait, in world minutes, which ends early at a
 * stimulus that reaches it; or the end, after which it waits for the next stimulus.
 */
export type RuleStep = { kind: "call"; tool: string; arguments: Record<string, unknown> } | { kind: "wait"; minutes: number } | { kind: "end" };

/** A rule set as it decides one participant in one run: from what the participant perceives only, never the world's state. */
export interface Rules {
  /** Its first step, as the run starts, taken as a wake with no stimuli; none, or undefined, and it waits for its first stimulus. */
  atStart?(): RuleStep | undefined;
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
  /** Each rule set at work in the run, by its participant's name. */
  readonly #rules = new Map<string, Rules>();

  constructor(run: ParticipantsRun<State>) {
    this.#run = run;
  }

  /**
   * Lets each participant's stimuli reach it only through the channels it declares, holds them by its hours and reply
   * delay, and wakes each rule set by the stimuli that reach it.
   */
  start(): void {
    const { participants, ruleSets, stimuli } = this.#run;
    for (const participant of participants) {
      stimuli.only(participant.name, participant.channels);
      if (participant.hours !== undefined || participant.replyMinutes !== undefined) {
        const delays = Random.derive(this.#run.seed, `replies of ${participant.name}`);
        stimuli.hold(participant.name, () => this.#track(this.#held(participant, delays)));
      }
      if (participant.decides !== "rules") continue;
      const rules = ruleSets[participant.rules].start(participant.params);
      this.#rules.set(participant.name, rules);
      stimuli.watch(participant.name, () => this.#wake(participant, rules));
      const first = rules.atStart?.();
      if (first !== undefined) this.#wake(participant, rules, first);
    }
  }

  /** Each participant decided by rules with its rule set's outcome record, as the run ends. */
  outcomes(): { participant: string; outcome: Readonly<Record<string, string | number | boolean>> }[] {
    return [...this.#rules].map(([participant, rules]) => ({ participant, outcome: rules.outcome() }));
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

  /** Wakes a rule set that waits for a stimulus, or with its first step as the run starts; one at work takes the stimulus with its next step. */
  #wake(participant: ParticipantSettings, rules: Rules, first?: RuleStep): void {
    if (this.#awake.has(participant.name)) return;
    this.#awake.add(participant.name);
    void this.#track(this.#act(participant, rules, first)).finally(() => this.#awake.delete(participant.name));
  }

  /**
   * Runs a rule set's steps from the stimuli that woke it until it ends with none waiting: each call through the
   * participant's tool, recorded under its name, and each wait until its end or a stimulus that reaches the participant.
   * A call of a tool the participant does not declare stops the run.
   */
  async #act({ name, tools: declared }: ParticipantSettings, rules: Rules, first?: RuleStep): Promise<void> {
    const { world, tools, stimuli, runEnd, call, records } = this.#run;
    try {
      for (let step = first; !runEnd.aborted; step = undefined) {
        if (step === undefined) {
          const waiting = stimuli.take(name);
          if (waiting.length === 0) return;
          step = rules.next({ stimuli: waiting });
        }
        while (step.kind !== "end") {
          if (step.kind === "wait") {
            await this.#wait(name, step.minutes);
            if (runEnd.aborted) return;
            step = rules.next({ stimuli: stimuli.take(name) });
            continue;
          }
          const { tool: named, arguments: args } = step;
          if (!declared.includes(named)) throw new Error(`participant "${name}"'s rule set called the tool "${named}", which "${name}" does not declare`);
          const tool = tools.find((each) => each.name === named) as Tool<State>;
          const { executed, text } = await callTool(world, tool, name, args, { ...call, caller: "participant" });
          records.toolCall({ agent: name, tool: tool.name, arguments: args, ...executed });
          if (runEnd.aborted) return;
          step = rules.next({ stimuli: stimuli.take(name), result: { tool: tool.name, outcome: executed.outcome, text } });
        }
      }
    } catch (error) {
      call.stop(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** A rule set's wait: the world minutes it asked for, from now, or until a stimulus reaches its participant or the run ends first. */
  async #wait(name: string, minutes: number): Promise<void> {
    const { clock, stimuli, runEnd } = this.#run;
    const reached = new AbortController();
    const unwatch = stimuli.watch(name, () => reached.abort());
    try {
      await waitAtLeast(clock.runMsOf({ worldSeconds: minutes * 60 }), AbortSignal.any([runEnd, reached.signal]));
    } finally {
      unwatch();
    }
  }
}
