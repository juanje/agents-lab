import type { TomlTable, TomlValue } from "smol-toml";
import type { Calendar, WorldTime } from "./calendar.ts";
import { type ChangesSinceSensing, applyCounted } from "./changes.ts";
import { type RunClock, waitAtLeast } from "./clock.ts";
import { type Fields, type MailSettings, actRefusal, wordsOf } from "./mail.ts";
import type { ParticipantSettings } from "./participants.ts";
import type { Stimuli } from "./stimuli.ts";
import type { AgentCall, Effector, Refusal, Tool } from "./tools.ts";
import type { Action, World } from "./world.ts";

/** A configuration's [phone] (FR-PHONE-01), as the engine follows it. */
export interface PhoneSettings {
  /** The agents and participants that have a line, by name. */
  lines: readonly string[];
  /** How long a phone rings, in world minutes, before a call nobody answers ends. */
  ringMinutes: number;
  /** How long a call that connects lasts, in world minutes, before its words. */
  callMinutes: number;
  /** One world minute more per this many words of both texts of a call that connects, when given. */
  callWordsPerMinute?: number;
  /** The ring's text, with its placeholders. */
  ring: string;
}

/** The placeholders a ring's text may name. */
const RING_PLACEHOLDERS = ["from", "act", "fields", "text", "call"];

/** A key of the phone that cannot be followed: an error that names it, its value and why. */
function refused(key: string, value: unknown, why: string): Error {
  return new Error(`The configuration's ${key} ${JSON.stringify(value) ?? "(none)"} cannot be followed: ${why}`);
}

/** Whether a TOML value is a table. */
function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

/** A positive number of world minutes, refused, naming its key, otherwise. */
function positiveMinutes(table: TomlTable, key: string): number {
  const value = table[key];
  if (typeof value !== "number" || !(value > 0)) throw refused(`phone.${key}`, value, "it is not a positive number of world minutes");
  return value;
}

/**
 * Reads a configuration's [phone] (FR-PHONE-01); one that cannot be followed is refused, with an error that names the
 * key: no [calendar], a line for a name that is no agent or participant, ring_minutes or call_minutes that are not a
 * positive number, a negative call_words_per_minute, and a ring that names a placeholder other than {from}, {act},
 * {fields}, {text} and {call}.
 */
export function readPhone(value: TomlValue, calendar: Calendar | undefined, names: readonly string[]): PhoneSettings {
  if (calendar === undefined) throw new Error("The configuration's phone cannot be followed: its durations are world time, and the configuration declares no [calendar]");
  const table = isTable(value) ? value : {};
  const { lines = [], ring, call_words_per_minute: words } = table;
  if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) throw refused("phone.lines", lines, "it is not a list of names");
  const stranger = (lines as string[]).find((line) => !names.includes(line));
  if (stranger !== undefined) throw refused("phone.lines", lines, `"${stranger}" is no agent or participant`);
  if (typeof ring !== "string") throw refused("phone.ring", ring, "it is not a text");
  const unknown = [...ring.matchAll(/\{(\w+)\}/g)].find(([, name]) => !RING_PLACEHOLDERS.includes(name));
  if (unknown !== undefined) throw refused("phone.ring", ring, `it names ${unknown[0]}, which is none of {${RING_PLACEHOLDERS.join("}, {")}}`);
  if (words !== undefined && (typeof words !== "number" || !(words >= 0))) throw refused("phone.call_words_per_minute", words, "it is not a number of words of at least 0");
  return {
    lines: lines as string[],
    ringMinutes: positiveMinutes(table, "ring_minutes"),
    callMinutes: positiveMinutes(table, "call_minutes"),
    // No time per word at 0, as when it is not given.
    ...(typeof words === "number" && words > 0 ? { callWordsPerMinute: words } : {}),
    ring,
  };
}

/** A call as the world keeps it (FR-PHONE-01). */
export interface PhoneCall {
  id: string;
  from: string;
  to: string;
  act: string;
  fields: Fields;
  subject?: string;
  text?: string;
  /** Ringing; placed but ringing nowhere, until its ring_minutes end; connected; or ended. */
  status: "ringing" | "unrung" | "connected" | "ended";
  /** Why a call that rings nowhere fails as its ring_minutes end. */
  failing?: "busy" | "no_answer";
  answer?: { act: string; fields: Fields; text?: string };
  /** How it ended, once it has. */
  outcome?: "answered" | "no_answer" | "busy";
}

/** The phone as the world keeps it: every call of the run, in the order placed. */
export interface Phone {
  calls: readonly PhoneCall[];
}

/** Where a scenario's state keeps the phone (FR-PHONE-01): how to read it, and the state with another phone in it. */
export interface PhoneKeeper<State> {
  of(state: State): Phone;
  with(state: State, phone: Phone): State;
}

/** The channel through which a ring reaches its callee, from the caller (FR-PHONE-01). */
export const PHONE_CHANNEL = "phone";

/** The phone as a run starts: no call. */
export function startingPhone(): Phone {
  return { calls: [] };
}

/**
 * Refuses a participant whose line takes calls, since it keeps the channel "phone", without the tool answer_call: it
 * would hear every ring and never pick up (FR-PHONE-01).
 */
export function assertAnswering(participants: readonly ParticipantSettings[]): void {
  for (const { name, tools, channels } of participants) {
    if (channels.includes(PHONE_CHANNEL) && !tools.includes("answer_call")) {
      throw refused(`participants.${name}.tools`, tools, `"${name}" keeps the channel "${PHONE_CHANNEL}", so it takes calls, and has no tool "answer_call"`);
    }
  }
}

/** A call as its caller makes it: its callee, act, fields, subject and text, as given. */
interface Dialled {
  to: string;
  act: string;
  fields?: Fields;
  subject?: string;
  text?: string;
}

/** An answer as its callee gives it: the call it answers, and its act, fields and text. */
interface Answered {
  call: string;
  act: string;
  fields?: Fields;
  text?: string;
}

/** Whether a call keeps a party's line busy: its caller's until it ends, its callee's while it rings or is connected. */
function occupies(call: PhoneCall, party: string): boolean {
  if (call.status === "ended") return false;
  return call.from === party || (call.to === party && call.status !== "unrung");
}

/** The last call a party made: the one its call, which lasts until that call ends, is about. */
function lastCallOf(phone: Phone, caller: string): PhoneCall | undefined {
  return phone.calls.filter(({ from }) => from === caller).at(-1);
}

/** The phone with one of its calls changed. */
function withCall(phone: Phone, id: string, change: Partial<PhoneCall>): Phone {
  return { calls: phone.calls.map((call) => (call.id === id ? { ...call, ...change } : call)) };
}

/** The world minutes a connected call lasts: call_minutes, plus one minute per call_words_per_minute words of both texts. */
function connectedMinutes(settings: PhoneSettings, texts: readonly (string | undefined)[]): number {
  const words = texts.reduce((sum, text) => sum + wordsOf(text), 0);
  return settings.callMinutes + (settings.callWordsPerMinute === undefined ? 0 : words / settings.callWordsPerMinute);
}

/** A call's fields as a ring and an answer give them: each as "<name>: <value>.", one after another. */
function fieldsText(fields: Fields): string[] {
  return Object.entries(fields).map(([name, value]) => `${name}: ${value}.`);
}

/** How each phone tool's duration is computed, for the inventory (FR-INVENTORY-01). */
export const PHONE_DURATIONS: Readonly<Record<string, string>> = {
  call: "until the call ends: ring_minutes when nobody answers, or until the callee's answer_call ends, in world minutes",
  answer_call: "call_minutes, plus one minute per call_words_per_minute words of the call's text and the answer's, in world minutes",
};

/** What the phone's tools are given besides its settings: where the state keeps it, the acts each callee takes, and whether a callee is within its hours now. */
export interface PhoneOf<State> {
  settings: PhoneSettings;
  keeper: PhoneKeeper<State>;
  acts: MailSettings["acts"];
  inHours(callee: string): boolean;
}

/**
 * The phone's tools (FR-PHONE-01): call, which lasts until its call ends, and answer_call. A call is placed as it
 * starts: it rings when its callee's line is free and the callee is within its hours, and rings nowhere otherwise.
 */
export function phoneTools<State>({ settings, keeper, acts, inHours }: PhoneOf<State>): Tool<State>[] {
  const placing: Action<State, AgentCall> = {
    precondition: () => ({ holds: true }),
    effect: (state, { agent, arguments: args }) => {
      const phone = keeper.of(state);
      const { to, act, fields = {}, subject, text } = args as unknown as Dialled;
      const busy = phone.calls.some((call) => occupies(call, to));
      const failing = busy ? "busy" : inHours(to) ? undefined : "no_answer";
      const placed: PhoneCall = {
        id: `c-${phone.calls.length + 1}`,
        from: agent,
        to,
        act,
        fields,
        ...(subject === undefined ? {} : { subject }),
        ...(text === undefined ? {} : { text }),
        status: failing === undefined ? "ringing" : "unrung",
        ...(failing === undefined ? {} : { failing }),
      };
      return keeper.with(state, { calls: [...phone.calls, placed] });
    },
  };
  const call: Effector<State> = {
    kind: "effector",
    name: "call",
    description:
      "Call someone on the phone: whom, the act (one word for what you call about, such as ask or offer), its fields (named values), and optionally a subject and a text. It rings for a while; if they pick up, you talk until the call ends and get their answer.",
    parameters: {
      type: "object",
      properties: { to: { type: "string" }, act: { type: "string" }, fields: { type: "object" }, subject: { type: "string" }, text: { type: "string" } },
      required: ["to", "act"],
    },
    refuses: (_state, { arguments: args }) => {
      const dialled = args as unknown as Dialled;
      if (!settings.lines.includes(dialled.to)) return { outcome: "unknown_recipient", reason: `"${dialled.to}" has no line` };
      return actRefusal(acts, dialled);
    },
    // It lasts until its call ends, which the world tells it.
    durationMs: () => Number.POSITIVE_INFINITY,
    start: { ...placing, describe: (state) => ({ call: `c-${keeper.of(state).calls.length + 1}` }) },
    endsEarly: {
      outcome: "success",
      byChange: (before, after, { agent }) => lastCallOf(keeper.of(before), agent)?.status !== "ended" && lastCallOf(keeper.of(after), agent)?.status === "ended",
      byStimulus: () => false,
      outcomeOf: (state, { agent }) => {
        const outcome = lastCallOf(keeper.of(state), agent)?.outcome;
        return outcome === "answered" ? "success" : (outcome ?? "no_answer");
      },
    },
    reply: {
      of: "the answer: who answered, its act, its fields and its text",
      text: (state, { agent }) => {
        const { to, answer } = lastCallOf(keeper.of(state), agent) as PhoneCall;
        const { act, fields, text } = answer as NonNullable<PhoneCall["answer"]>;
        return [`Answer from ${to}. Act: ${act}.`, ...fieldsText(fields), ...(text === undefined ? [] : [text])].join(" ");
      },
    },
    readTarget: () => "not_sensed",
  };
  const ringingFor = (state: State, callee: string, id: unknown) => keeper.of(state).calls.find((each) => each.id === id && each.to === callee && each.status === "ringing");
  const answerCall: Effector<State> = {
    kind: "effector",
    name: "answer_call",
    description: "Pick up a call that is ringing for you, by its id, with your answer: its act, its fields (named values) and optionally a text. You talk until the call ends.",
    parameters: {
      type: "object",
      properties: { call: { type: "string" }, act: { type: "string" }, fields: { type: "object" }, text: { type: "string" } },
      required: ["call", "act"],
    },
    refuses: (state, { agent, arguments: args }): Refusal | undefined =>
      ringingFor(state, agent, args.call) === undefined ? { outcome: "no_such_call", reason: `no call "${String(args.call)}" is ringing for you` } : undefined,
    durationMs: (state, { agent, arguments: args }) => ({
      worldSeconds: connectedMinutes(settings, [ringingFor(state, agent, args.call)?.text, (args as unknown as Answered).text]) * 60,
    }),
    start: {
      precondition: () => ({ holds: true }),
      effect: (state, { arguments: args }) => {
        const { call: id, act, fields = {}, text } = args as unknown as Answered;
        return keeper.with(state, withCall(keeper.of(state), id, { status: "connected", answer: { act, fields, ...(text === undefined ? {} : { text }) } }));
      },
      describe: (_state, { arguments: args }) => ({ call: args.call }),
    },
    action: {
      precondition: (state, { arguments: args }) =>
        keeper.of(state).calls.some(({ id, status }) => id === args.call && status === "connected") ? { holds: true } : { holds: false, reason: "no_such_call" },
      effect: (state, { arguments: args }) => keeper.with(state, withCall(keeper.of(state), args.call as string, { status: "ended", outcome: "answered" })),
    },
    texts: { success: "The call has ended.", no_such_call: "no_such_call: no such call is ringing for you" },
    readTarget: () => "not_sensed",
  };
  return [call, answerCall];
}

/** A moment of a call: the run's time, by performance.now(), and the world's time then. */
export interface CallMoment {
  atMs: number;
  worldTime: WorldTime;
}

/** The line of the run's log a call adds as it ends (FR-PHONE-01). */
export type CallLine = { type: "call" } & Omit<PhoneCall, "status" | "failing" | "outcome"> & {
    outcome: "answered" | "no_answer" | "busy" | "cut_off";
    rang?: CallMoment;
    answered?: CallMoment;
    ended: CallMoment;
  };

/** What the phone runs in: the world, where it keeps the phone, its settings, the run's time and end, the changes since sensing, the stimuli and the log. */
export interface PhoneRun<State> {
  world: World<State>;
  keeper: PhoneKeeper<State>;
  settings: PhoneSettings;
  clock: RunClock;
  runEnd: AbortSignal;
  changes: ChangesSinceSensing;
  stimuli: Stimuli;
  record(line: CallLine): void;
}

/** The name the phone's own changes are counted by among the changes since sensing. */
const PHONE = "phone";

/**
 * The phone in a run (FR-PHONE-01): it rings each callee as its call is placed, ends each call still ringing, or ringing
 * nowhere, when ring_minutes end, through the arbiter, and writes a call line as each call ends, or for each call the
 * run's end cuts off.
 */
export class PhoneExchange<State> {
  readonly #run: PhoneRun<State>;
  readonly #pending = new Set<Promise<void>>();
  /** When each call rang and was answered, by its id. */
  readonly #moments = new Map<string, { rang?: CallMoment; answered?: CallMoment }>();
  readonly #recorded = new Set<string>();

  constructor(run: PhoneRun<State>) {
    this.#run = run;
  }

  /** Watches the world from now on for each call placed, answered and ended. */
  start(): void {
    const { world, keeper } = this.#run;
    world.watch((before, after) => {
      const was = new Map(keeper.of(before).calls.map((call) => [call.id, call]));
      for (const call of keeper.of(after).calls) {
        const earlier = was.get(call.id);
        if (earlier === undefined) this.#placed(call);
        else if (earlier.status !== call.status && call.status === "connected") this.#momentOf(call.id).answered = this.#now();
        if (call.status === "ended" && earlier?.status !== "ended") this.#ended(call, call.outcome as CallLine["outcome"]);
      }
    });
  }

  /** Whether a call still rings, or rings nowhere, before its ring_minutes end. */
  get busy(): boolean {
    return this.#pending.size > 0;
  }

  /** Resolves once every ring has run out, or the run has ended. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all(this.#pending);
  }

  /** Writes the line of each call the run's end cut off: one that had not ended, which connected nothing. */
  cutOff(): void {
    for (const call of this.#run.keeper.of(this.#run.world.state).calls) if (call.status !== "ended") this.#ended(call, "cut_off");
  }

  #now(): CallMoment {
    return { atMs: performance.now(), worldTime: this.#run.clock.worldTime() as WorldTime };
  }

  #momentOf(id: string): { rang?: CallMoment; answered?: CallMoment } {
    const moments = this.#moments.get(id) ?? {};
    this.#moments.set(id, moments);
    return moments;
  }

  /** A call placed: its callee hears the ring at once, not held for a reply delay, when it rings; either way its ring_minutes start. */
  #placed(call: PhoneCall): void {
    const { settings, stimuli, clock } = this.#run;
    if (call.status === "ringing") {
      this.#momentOf(call.id).rang = this.#now();
      const values = { from: call.from, act: call.act, fields: fieldsText(call.fields).map((text) => `${text} `).join(""), text: call.text ?? "", call: call.id };
      stimuli.deliver(call.to, PHONE_CHANNEL, values, { source: call.from, held: false });
    }
    const ringing = this.#ringOut(call.id, clock.runMsOf({ worldSeconds: settings.ringMinutes * 60 })).finally(() => this.#pending.delete(ringing));
    this.#pending.add(ringing);
  }

  /** Ends a call nobody answered as its ring_minutes end: as busy or no_answer for one that rang nowhere, no_answer for one still ringing. */
  async #ringOut(id: string, afterMs: number): Promise<void> {
    const { world, keeper, runEnd, changes } = this.#run;
    await waitAtLeast(afterMs, runEnd);
    if (runEnd.aborted) return;
    const ringingOut: Action<State, undefined> = {
      precondition: (state) => {
        const status = keeper.of(state).calls.find((call) => call.id === id)?.status;
        return status === "ringing" || status === "unrung" ? { holds: true } : { holds: false, reason: "answered" };
      },
      effect: (state) => {
        const call = keeper.of(state).calls.find((each) => each.id === id) as PhoneCall;
        return keeper.with(state, withCall(keeper.of(state), id, { status: "ended", outcome: call.failing ?? "no_answer" }));
      },
    };
    applyCounted(world, changes, PHONE, ringingOut, undefined);
  }

  #ended({ status: _status, failing: _failing, outcome: _outcome, ...call }: PhoneCall, outcome: CallLine["outcome"]): void {
    if (this.#recorded.has(call.id)) return;
    this.#recorded.add(call.id);
    this.#run.record({ type: "call", ...call, outcome, ...this.#moments.get(call.id), ended: this.#now() });
  }
}

/** The phone as the inventory gives it (FR-PHONE-01): its lines, ring_minutes, call_minutes, time per word and ring. */
export function phoneInventory({ lines, ringMinutes, callMinutes, callWordsPerMinute, ring }: PhoneSettings): PhoneSettings {
  return { lines: [...lines], ringMinutes, callMinutes, ...(callWordsPerMinute === undefined ? {} : { callWordsPerMinute }), ring };
}
