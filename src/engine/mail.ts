import type { TomlTable, TomlValue } from "smol-toml";
import type { Calendar, WorldTime } from "./calendar.ts";
import { type ChangesSinceSensing, applyCounted } from "./changes.ts";
import { type RunClock, waitAtLeast } from "./clock.ts";
import { Random } from "./random.ts";
import type { Stimuli } from "./stimuli.ts";
import type { Effector, Tool } from "./tools.ts";
import type { Action, World } from "./world.ts";

/** A message's fields: named values that a rule-based participant can read (FR-MESSAGE-01). */
export type Fields = Readonly<Record<string, string | number | boolean>>;

/** A message: its id, sender, recipient, act, fields, subject (its act when it was given none) and free text. */
export interface Message {
  id: string;
  from: string;
  to: string;
  act: string;
  fields: Fields;
  subject: string;
  text?: string;
}

/** A message in transit: with the world's time it was sent. */
export interface Sent extends Message {
  sent: WorldTime;
}

/** A message in a mailbox: with the world's time it was sent, if it was sent in the run, when it was received, and whether it was read. */
export interface Received extends Message {
  sent?: WorldTime;
  received: WorldTime;
  read: boolean;
}

/** The mail as the world keeps it: each participant's mailbox, by its name, and the messages in transit, in the order sent. */
export interface Mail {
  mailboxes: Readonly<Record<string, readonly Received[]>>;
  inTransit: readonly Sent[];
}

/** Where a scenario's state keeps the mail (FR-MESSAGE-01): how to read it, and the state with other mail in it. */
export interface MailKeeper<State> {
  of(state: State): Mail;
  with(state: State, mail: Mail): State;
}

/** A configuration's [mail] (FR-MESSAGE-01), as the engine follows it. */
export interface MailSettings {
  /** The participants that have a mailbox, by name. */
  mailboxes: readonly string[];
  /** Each recipient that declares the acts it takes, with the fields each act requires. */
  acts: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /** The delivery delay is drawn between these two numbers of world minutes. */
  deliveryMinutes: readonly [number, number];
  sendMinutes: number;
  sendMinutesPerField: number;
  sendWordsPerMinute?: number;
  checkMinutes: number;
  readMinutes: number;
  readWordsPerMinute?: number;
  /** The mail notice's source and text, for a configuration that declares one. */
  notice?: { source: string; text: string };
  /** The messages in the mailboxes before the run. */
  initial: readonly Received[];
}

/** The channel through which an agent learns that a message landed in its mailbox. */
export const MAIL_NOTICE = "mail_notice";

/** The name the medium's deliveries are counted by among the changes since sensing. */
const MAIL = "mail";

/** Reads a configuration's [mail] (FR-MESSAGE-01). */
export function readMail(value: TomlValue, _calendar?: Calendar): MailSettings {
  const table = value as TomlTable;
  const optional = (key: string, name: string) => (table[key] === undefined ? {} : { [name]: table[key] as number });
  return {
    mailboxes: table.mailboxes as string[],
    acts: (table.acts ?? {}) as MailSettings["acts"],
    deliveryMinutes: table.delivery_minutes as [number, number],
    sendMinutes: table.send_minutes as number,
    sendMinutesPerField: (table.send_minutes_per_field ?? 0) as number,
    ...optional("send_words_per_minute", "sendWordsPerMinute"),
    checkMinutes: table.check_minutes as number,
    readMinutes: table.read_minutes as number,
    ...optional("read_words_per_minute", "readWordsPerMinute"),
    ...(table.notice === undefined ? {} : { notice: { source: table.notice_source as string, text: table.notice as string } }),
    initial: [],
  };
}

/** The mail as a run starts: every mailbox empty, and nothing in transit. */
export function startingMail(settings: MailSettings): Mail {
  return { mailboxes: Object.fromEntries(settings.mailboxes.map((name) => [name, []])), inTransit: [] };
}

/** A message as a sender writes it: its recipient, act, fields, subject and text, as given. */
interface Outgoing {
  to: string;
  act: string;
  fields?: Fields;
  subject?: string;
  text?: string;
}

/** The words of a text. */
function wordsOf(text: string | undefined): number {
  return text === undefined ? 0 : text.split(/\s+/).filter((word) => word !== "").length;
}

/**
 * The world minutes sending takes: send_minutes, plus send_minutes_per_field for each field, plus one minute per
 * send_words_per_minute words of the subject and text as given.
 */
function sendingMinutes(settings: MailSettings, { fields = {}, subject, text }: Outgoing): number {
  const words = settings.sendWordsPerMinute === undefined ? 0 : (wordsOf(subject) + wordsOf(text)) / settings.sendWordsPerMinute;
  return settings.sendMinutes + settings.sendMinutesPerField * Object.keys(fields).length + words;
}

/** The mail with a message sent: numbered after every message sent or received before it, and in transit from now on. */
function withSent(mail: Mail, from: string, { to, act, fields = {}, subject, text }: Outgoing, sent: WorldTime | undefined): Mail {
  if (sent === undefined) throw new Error("a message was sent without the world's time; the mail needs a [calendar]");
  const count = Object.values(mail.mailboxes).reduce((sum, mailbox) => sum + mailbox.length, mail.inTransit.length);
  const message: Sent = { id: `m-${count + 1}`, from, to, act, fields, subject: subject ?? act, ...(text === undefined ? {} : { text }), sent };
  return { ...mail, inTransit: [...mail.inTransit, message] };
}

/** The agents' mail tools (FR-MESSAGE-01): send_mail. */
export function mailTools<State>(settings: MailSettings, keeper: MailKeeper<State>): Tool<State>[] {
  const sendMail: Effector<State> = {
    kind: "effector",
    name: "send_mail",
    description:
      "Send a message: to whom, its act (one word for what it does, such as ask or offer), its fields (named values), and optionally a subject and a free text. It reaches its recipient after a delay.",
    parameters: {
      type: "object",
      properties: { to: { type: "string" }, act: { type: "string" }, fields: { type: "object" }, subject: { type: "string" }, text: { type: "string" } },
      required: ["to", "act"],
    },
    durationMs: (_state, call) => ({ worldSeconds: sendingMinutes(settings, call.arguments as unknown as Outgoing) * 60 }),
    action: {
      precondition: () => ({ holds: true }),
      effect: (state, call) => keeper.with(state, withSent(keeper.of(state), call.agent, call.arguments as unknown as Outgoing, call.world)),
    },
    texts: { success: "Sent." },
    readTarget: () => "not_sensed",
  };
  return [sendMail];
}

/** The delivery of a message in transit: it lands in its recipient's mailbox, unread, at the world's time given. */
function delivering<State>(keeper: MailKeeper<State>): Action<State, { id: string; received: WorldTime }> {
  return {
    precondition: (state, { id }) => (keeper.of(state).inTransit.some((message) => message.id === id) ? { holds: true } : { holds: false, reason: "not_in_transit" }),
    effect: (state, { id, received }) => {
      const mail = keeper.of(state);
      const message = mail.inTransit.find((each) => each.id === id) as Sent;
      const mailbox = [...(mail.mailboxes[message.to] ?? []), { ...message, received, read: false }];
      return keeper.with(state, { mailboxes: { ...mail.mailboxes, [message.to]: mailbox }, inTransit: mail.inTransit.filter((each) => each.id !== id) });
    },
  };
}

/** A line of the run's log the mail writes (FR-MESSAGE-01): a message as it is sent, and as it lands. */
export type MailLine =
  | ({ type: "message_sent"; atMs: number; worldTime: WorldTime } & Message)
  | { type: "message_delivered"; id: string; atMs: number; worldTime: WorldTime };

/** What the mail runs in: the world, where it keeps the mail, the run's time and end, the changes since sensing, the stimuli and the log. */
export interface MailRun<State> {
  world: World<State>;
  keeper: MailKeeper<State>;
  settings: MailSettings;
  clock: RunClock;
  runEnd: AbortSignal;
  changes: ChangesSinceSensing;
  stimuli: Stimuli;
  /** The replica's seed, from which each sender's delays are drawn. */
  seed: number;
  /** The run's agents, whom a mail notice reaches. */
  agents: readonly string[];
  record(line: MailLine): void;
}

/**
 * The mail medium in a run (FR-MESSAGE-01): it records each message as it is sent, and delivers it through the arbiter
 * after a delay drawn from the seed and its sender, unread, sending an agent recipient the mail notice; a message still in
 * transit when the run ends is never delivered.
 */
export class MailMedium<State> {
  readonly #run: MailRun<State>;
  /** Each sender's own sequence of delays, so a participant added leaves the others' delays as they were. */
  readonly #delays = new Map<string, Random>();
  readonly #pending = new Set<Promise<void>>();

  constructor(run: MailRun<State>) {
    this.#run = run;
  }

  /** Watches the world from now on for each message sent. */
  start(): void {
    const { world, keeper } = this.#run;
    world.watch((before, after) => {
      const was = new Set(keeper.of(before).inTransit.map(({ id }) => id));
      for (const message of keeper.of(after).inTransit) if (!was.has(message.id)) this.#sent(message);
    });
  }

  /** Resolves once every message sent so far has been delivered, or the run has ended. */
  async delivered(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all(this.#pending);
  }

  #sent({ sent, ...message }: Sent): void {
    const { settings, clock, record } = this.#run;
    record({ type: "message_sent", ...message, atMs: performance.now(), worldTime: sent });
    const [fewest, most] = settings.deliveryMinutes;
    const minutes = fewest + this.#delaysOf(message.from).next() * (most - fewest);
    const delivery = this.#deliver(message, clock.runMsOf({ worldSeconds: minutes * 60 })).finally(() => this.#pending.delete(delivery));
    this.#pending.add(delivery);
  }

  async #deliver(message: Message, afterMs: number): Promise<void> {
    const { world, keeper, settings, clock, runEnd, changes, stimuli, agents, record } = this.#run;
    await waitAtLeast(afterMs, runEnd);
    if (runEnd.aborted) return;
    const received = clock.worldTime() as WorldTime;
    applyCounted(world, changes, MAIL, delivering(keeper), { id: message.id, received });
    record({ type: "message_delivered", id: message.id, atMs: performance.now(), worldTime: received });
    if (settings.notice !== undefined && agents.includes(message.to)) stimuli.deliver(message.to, MAIL_NOTICE, { from: message.from, subject: message.subject });
  }

  #delaysOf(sender: string): Random {
    const delays = this.#delays.get(sender) ?? Random.derive(this.#run.seed, `mail of ${sender}`);
    this.#delays.set(sender, delays);
    return delays;
  }
}
