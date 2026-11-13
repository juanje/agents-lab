import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { readCalendar } from "../src/engine/calendar.ts";
import { ChangesSinceSensing } from "../src/engine/changes.ts";
import { RunClock } from "../src/engine/clock.ts";
import { type Mail, type MailKeeper, type MailLine, MailMedium, mailTools, readMail, startingMail } from "../src/engine/mail.ts";
import { Stimuli } from "../src/engine/stimuli.ts";
import type { Effector, Sensor, Tool } from "../src/engine/tools.ts";
import { World } from "../src/engine/world.ts";
import { rhythmChannel } from "./fixtures/slots.ts";

/** A test world that keeps the mail and nothing else. */
interface Post {
  mail: Mail;
}

const keeper: MailKeeper<Post> = { of: (state) => state.mail, with: (state, mail) => ({ ...state, mail }) };

/** A calendar where one world minute is 100 ms of the run. */
const calendar = readCalendar(parse(['start = "day 1 Monday 09:00"', "[[segments]]", "scale = 600", ""].join("\n")));

/** The [mail] of the contract's Background, with any of its keys replaced. */
function mailTable(changes: Record<string, unknown> = {}) {
  return {
    mailboxes: ["ana", "ben", "desk"],
    delivery_minutes: [1, 1],
    send_minutes: 3,
    check_minutes: 2,
    read_minutes: 1,
    notice_source: "mail client",
    notice: "New mail from {from}: {subject}",
    acts: { desk: { book: ["date", "rooms"], ask: [] } },
    ...changes,
  } as never;
}

/** A mail tool by its name. */
function toolNamed<State>(tools: readonly Tool<State>[], name: string): Tool<State> {
  const tool = tools.find((each) => each.name === name);
  if (tool === undefined) throw new Error(`no mail tool "${name}"`);
  return tool;
}

describe("readMail", () => {
  it("reads the mailboxes, each recipient's acts with their fields, the delivery delay, the durations and the notice", () => {
    expect(readMail(mailTable(), calendar)).toEqual({
      mailboxes: ["ana", "ben", "desk"],
      acts: { desk: { book: ["date", "rooms"], ask: [] } },
      deliveryMinutes: [1, 1],
      sendMinutes: 3,
      sendMinutesPerField: 0,
      checkMinutes: 2,
      readMinutes: 1,
      notice: { source: "mail client", text: "New mail from {from}: {subject}" },
      initial: [],
    });
  });

  it("gives the words per minute when the configuration gives them, and no notice when it declares none", () => {
    const table = mailTable({ send_words_per_minute: 10, read_words_per_minute: 50, send_minutes_per_field: 0.5 });
    delete (table as Record<string, unknown>).notice;

    expect(readMail(table, calendar)).toMatchObject({ sendMinutesPerField: 0.5, sendWordsPerMinute: 10, readWordsPerMinute: 50 });
    expect(readMail(table, calendar)).not.toHaveProperty("notice");
  });
});

/** A message at the start as a configuration writes it, with any of its keys replaced. */
const atStart = (changes: Record<string, unknown> = {}) => ({
  to: "ana",
  from: "the board",
  act: "inform",
  fields: { session: 3 },
  subject: "Partner session",
  text: "A partner society runs session 3.",
  received: "day 1 Monday 07:30",
  ...changes,
});

describe("readMail, refusing what cannot be followed", () => {
  const refused = (table: unknown) => () => readMail(table as never, calendar);

  it("refuses a [mail] without a [calendar], naming mail", () => {
    expect(() => readMail(mailTable(), undefined)).toThrow("The configuration's mail cannot be followed: its durations are world time, and the configuration declares no [calendar]");
  });

  it("refuses delivery_minutes that are not two numbers, the first at least 0 and not above the second", () => {
    for (const minutes of [[5, 1], [-1, 1], [1], [1, "5"], 3]) {
      expect(refused(mailTable({ delivery_minutes: minutes }))).toThrow(/^The configuration's mail\.delivery_minutes .* cannot be followed: /);
    }
  });

  it("refuses a duration that is negative or not a number, naming it", () => {
    for (const key of ["send_minutes", "check_minutes", "read_minutes", "send_minutes_per_field", "send_words_per_minute", "read_words_per_minute"]) {
      expect(refused(mailTable({ [key]: -1 }))).toThrow(`The configuration's mail.${key} -1 cannot be followed`);
    }
    expect(refused(mailTable({ send_minutes: "3" }))).toThrow(`The configuration's mail.send_minutes "3" cannot be followed`);
  });

  it("refuses acts for a participant with no mailbox, and a field list that is not a list of words", () => {
    expect(refused(mailTable({ acts: { zoe: { ask: [] } } }))).toThrow(`The configuration's mail.acts.zoe {"ask":[]} cannot be followed: "zoe" has no mailbox`);
    expect(refused(mailTable({ acts: { desk: { book: "date" } } }))).toThrow(`The configuration's mail.acts.desk.book "date" cannot be followed: it is not a list of words`);
    expect(refused(mailTable({ acts: { desk: { book: ["the date"] } } }))).toThrow("mail.acts.desk.book");
  });

  it("refuses a notice without a notice source", () => {
    const table = mailTable();
    delete (table as Record<string, unknown>).notice_source;

    expect(refused(table)).toThrow("The configuration's mail.notice_source (none) cannot be followed: the mail has a notice");
  });

  it("refuses a message at the start for a participant with no mailbox, whose act its recipient does not take, that lacks a required field, or received after the calendar's start", () => {
    expect(refused(mailTable({ initial: [atStart({ to: "zoe" })] }))).toThrow(`The configuration's mail.initial[0].to "zoe" cannot be followed: "zoe" has no mailbox`);
    expect(refused(mailTable({ initial: [atStart(), atStart({ to: "desk", act: "order" })] }))).toThrow(`The configuration's mail.initial[1].act "order" cannot be followed: "desk" takes the acts book, ask`);
    expect(refused(mailTable({ initial: [atStart({ to: "desk", act: "book", fields: { date: "day 26" } })] }))).toThrow(
      `The configuration's mail.initial[0].fields {"date":"day 26"} cannot be followed: the act "book" requires the field "rooms"`,
    );
    expect(refused(mailTable({ initial: [atStart({ received: "day 1 Monday 10:00" })] }))).toThrow(
      `The configuration's mail.initial[0].received "day 1 Monday 10:00" cannot be followed: it is after the calendar's start`,
    );
    expect(refused(mailTable({ initial: [atStart({ received: "Monday 07:30" })] }))).toThrow("mail.initial[0].received");
  });
});

describe("startingMail", () => {
  it("gives every mailbox empty and nothing in transit", () => {
    expect(startingMail(readMail(mailTable(), calendar))).toEqual({ mailboxes: { ana: [], ben: [], desk: [] }, inTransit: [] });
  });

  it("puts each message at the start in its recipient's mailbox, unread, numbered from 1, received at its world time, its act as its subject when it has none", () => {
    const settings = readMail(mailTable({ initial: [atStart(), atStart({ to: "ben", subject: undefined, text: undefined, fields: undefined })] }), calendar);

    expect(startingMail(settings)).toEqual({
      mailboxes: {
        ana: [{ id: "m-1", from: "the board", to: "ana", act: "inform", fields: { session: 3 }, subject: "Partner session", text: "A partner society runs session 3.", received: { day: 1, weekday: "Monday", seconds: 7.5 * 3600 }, read: false }],
        ben: [{ id: "m-2", from: "the board", to: "ben", act: "inform", fields: {}, subject: "inform", received: { day: 1, weekday: "Monday", seconds: 7.5 * 3600 }, read: false }],
        desk: [],
      },
      inTransit: [],
    });
  });
});

describe("send_mail", () => {
  const settings = readMail(mailTable(), calendar);
  const send = toolNamed(mailTools(settings, keeper), "send_mail") as Effector<Post>;
  const state: Post = { mail: startingMail(settings) };
  const world = { day: 1, weekday: "Monday", seconds: 9 * 3600 + 180 } as const;

  it("is an effector that lasts send_minutes in world time", () => {
    expect(send.kind).toBe("effector");
    expect(send.durationMs(state, { agent: "ana", arguments: { to: "ben", act: "ask", subject: "Friday", text: "Free on Friday?" } })).toEqual({ worldSeconds: 180 });
  });

  it("puts the message in transit when it lands, numbered from 1, from the caller, with the world's time it was sent and its act as its subject when it has none", () => {
    const call = { agent: "ana", arguments: { to: "ben", act: "offer", fields: { date: "day 5", price: 900 } }, atMs: 0, world };

    expect(send.action?.precondition(state, call)).toEqual({ holds: true });
    const sent = send.action?.effect(state, call);

    expect(sent?.mail).toEqual({
      mailboxes: { ana: [], ben: [], desk: [] },
      inTransit: [{ id: "m-1", from: "ana", to: "ben", act: "offer", fields: { date: "day 5", price: 900 }, subject: "offer", sent: world }],
    });
  });

  it("refuses, as it starts, a message whose recipient has no mailbox, whose act the recipient does not take, or that lacks a field its act requires", () => {
    const refusal = (to: string, act: string, fields: Record<string, unknown> = {}) => send.refuses?.(state, { agent: "ana", arguments: { to, act, fields } });

    expect(refusal("zoe", "ask")).toEqual({ outcome: "unknown_recipient", reason: '"zoe" has no mailbox' });
    expect(refusal("desk", "order")).toEqual({ outcome: "act_not_taken", reason: '"desk" takes the acts book, ask' });
    expect(refusal("desk", "book", { date: "day 26" })).toEqual({ outcome: "missing_field", reason: 'the act "book" requires the field "rooms"' });
    expect(refusal("desk", "book", { date: "day 26", rooms: 4 })).toBeUndefined();
    expect(refusal("desk", "ask")).toBeUndefined();
  });

  it("takes every act for a recipient that declares none", () => {
    expect(send.refuses?.(state, { agent: "ana", arguments: { to: "ben", act: "anything" } })).toBeUndefined();
  });

  it("numbers each message after every message sent or received before it", () => {
    const first = send.action?.effect(state, { agent: "ana", arguments: { to: "ben", act: "ask", subject: "Friday", text: "Free on Friday?" }, atMs: 0, world }) as Post;
    const second = send.action?.effect(first, { agent: "ben", arguments: { to: "ana", act: "ask" }, atMs: 0, world }) as Post;

    expect(second.mail.inTransit.map(({ id }) => id)).toEqual(["m-1", "m-2"]);
    expect(second.mail.inTransit[0]).toMatchObject({ subject: "Friday", text: "Free on Friday?", fields: {} });
  });
});

describe("check_mail", () => {
  const settings = readMail(mailTable({ initial: [atStart({ received: "day 1 Monday 08:15" }), atStart({ from: "the chair", subject: "Rooms", received: "day 1 Monday 07:30" })] }), calendar);
  const check = () => toolNamed(mailTools(settings, keeper), "check_mail") as Sensor<Post>;
  const start: Post = { mail: startingMail(settings) };

  it("is a sensor that lasts check_minutes in world time", () => {
    expect(check().kind).toBe("sensor");
    expect(check().durationMs(start, { agent: "ana", arguments: {} })).toEqual({ worldSeconds: 120 });
  });

  it("lists each message in the reader's mailbox, oldest first, with its id, sender, subject and the world's time it was received", () => {
    expect(check().sense(start, "ana", {}, 0)).toBe(['m-2: from the chair, subject "Rooms", received day 1 Monday 07:30', 'm-1: from the board, subject "Partner session", received day 1 Monday 08:15'].join("\n"));
    expect(check().sense(start, "ben", {}, 0)).toBe("No messages.");
  });

  it("lists only the unread messages when asked to", () => {
    const [first, second] = start.mail.mailboxes.ana;
    const read: Post = { mail: { ...start.mail, mailboxes: { ...start.mail.mailboxes, ana: [first, { ...second, read: true }] } } };

    expect(check().sense(read, "ana", { unread_only: true }, 0)).toBe('m-1: from the board, subject "Partner session", received day 1 Monday 08:15');
    expect(check().sense(read, "ana", { unread_only: false }, 0).split("\n")).toHaveLength(2);
  });
});

describe("read_mail", () => {
  const settings = readMail(mailTable({ read_words_per_minute: 2, initial: [atStart(), atStart({ to: "ben", text: undefined, fields: { date: "day 5", price: 900 } })] }), calendar);
  const read = () => toolNamed(mailTools(settings, keeper), "read_mail") as Effector<Post>;
  const start: Post = { mail: startingMail(settings) };
  const call = (agent: string, id: string) => ({ agent, arguments: { id }, atMs: 0 });

  it("is an effector that lasts read_minutes, plus one minute per read_words_per_minute words of the message's text, in world time", () => {
    expect(read().kind).toBe("effector");
    // "A partner society runs session 3." is six words, three minutes at two words per minute.
    expect(read().durationMs(start, call("ana", "m-1"))).toEqual({ worldSeconds: 4 * 60 });
    expect(read().durationMs(start, call("ben", "m-2"))).toEqual({ worldSeconds: 60 });
  });

  it("fails as no_such_mail for an id not in the reader's mailbox", () => {
    expect(read().action?.precondition(start, call("ana", "m-2"))).toEqual({ holds: false, reason: "no_such_mail" });
    expect(read().action?.precondition(start, call("ana", "m-9"))).toEqual({ holds: false, reason: "no_such_mail" });
  });

  it("marks the message read, and gives its sender, its act, each field and its text", () => {
    const after = read().action?.effect(start, call("ana", "m-1")) as Post;

    expect(after.mail.mailboxes.ana[0].read).toBe(true);
    expect(after.mail.mailboxes.ben[0].read).toBe(false);
    expect(read().reply?.text(after, call("ana", "m-1"))).toBe("From: the board. Act: inform. session: 3. A partner society runs session 3.");
    expect(read().reply?.text(after, call("ben", "m-2"))).toBe("From: the board. Act: inform. date: day 5. price: 900.");
  });
});

describe("MailMedium", () => {
  /** A medium over a world with the Background's mail, started now, and what it recorded and delivered as stimuli. */
  function started(table = mailTable(), seed = 1) {
    const settings = readMail(table, calendar);
    const world = new World<Post>({ mail: startingMail(settings) });
    const clock = new RunClock(calendar);
    const lines: MailLine[] = [];
    const delivered: [string, string][] = [];
    const notice = { name: "mail_notice", source: "mail client", stimulus: "New mail from {from}: {subject}" };
    const stimuli = new Stimuli([rhythmChannel, notice], (agent, stimulus) => delivered.push([agent, `${stimulus.source}: ${stimulus.content}`]));
    const runEnd = new AbortController();
    const medium = new MailMedium({ world, keeper, settings, clock, runEnd: runEnd.signal, changes: new ChangesSinceSensing(), stimuli, seed, agents: ["ana", "ben"], record: (line) => lines.push(line) });
    const startedAtMs = clock.start();
    medium.start(startedAtMs);
    const send = toolNamed(mailTools(settings, keeper), "send_mail") as Effector<Post>;
    const sendNow = (agent: string, args: Record<string, unknown>) => world.apply(send.action!, { agent, arguments: args, atMs: performance.now(), world: clock.worldTime() });
    return { world, lines, delivered, medium, runEnd, startedAtMs, sendNow };
  }

  it("records a message as it is sent, delivers it unread after its delay in world minutes, records its delivery, and sends its recipient the notice", async () => {
    const { world, lines, delivered, medium, startedAtMs, sendNow } = started();

    sendNow("ana", { to: "ben", act: "ask", subject: "Friday", text: "Free on Friday?" });
    expect(lines).toEqual([
      {
        type: "message_sent",
        id: "m-1",
        from: "ana",
        to: "ben",
        act: "ask",
        fields: {},
        subject: "Friday",
        text: "Free on Friday?",
        atMs: expect.any(Number),
        worldTime: { day: 1, weekday: "Monday", seconds: 9 * 3600 },
      },
    ]);
    expect(world.state.mail.mailboxes.ben).toEqual([]);
    await medium.delivered();

    const [, landed] = lines;
    expect(landed).toEqual({ type: "message_delivered", id: "m-1", atMs: expect.any(Number), worldTime: { day: 1, weekday: "Monday", seconds: expect.any(Number) } });
    // One world minute is 100 ms of the run; the engine's own milliseconds add a little.
    const landedMs = (landed as { atMs: number }).atMs - startedAtMs;
    expect(landedMs).toBeGreaterThanOrEqual(100);
    expect(landedMs).toBeLessThan(130);
    expect((landed as { worldTime: { seconds: number } }).worldTime.seconds - 9 * 3600).toBeGreaterThanOrEqual(60);
    expect(world.state.mail.inTransit).toEqual([]);
    expect(world.state.mail.mailboxes.ben).toEqual([
      { id: "m-1", from: "ana", to: "ben", act: "ask", fields: {}, subject: "Friday", text: "Free on Friday?", sent: expect.any(Object), received: (landed as { worldTime: unknown }).worldTime, read: false },
    ]);
    expect(delivered).toEqual([["ben", "mail client: New mail from ana: Friday"]]);
  });

  it("records each message at the start as delivered at the run's start, with the world's time it was received, and sends no notice for it", async () => {
    const { lines, delivered, startedAtMs } = started(mailTable({ initial: [atStart()] }));

    expect(lines).toEqual([{ type: "message_delivered", id: "m-1", atMs: startedAtMs, worldTime: { day: 1, weekday: "Monday", seconds: 7.5 * 3600 } }]);
    expect(delivered).toEqual([]);
  });

  it("sends no notice for a message that lands in a component's mailbox, nor for any when the mail declares no notice", async () => {
    const quiet = mailTable();
    delete (quiet as Record<string, unknown>).notice;
    for (const [table, to] of [
      [mailTable(), "desk"],
      [quiet, "ben"],
    ] as const) {
      const { delivered, medium, world, sendNow } = started(table);
      sendNow("ana", { to, act: "ask" });
      await medium.delivered();

      expect(world.state.mail.mailboxes[to]).toHaveLength(1);
      expect(delivered).toEqual([]);
    }
  });

  it("draws each delay between the two numbers of delivery_minutes, from the seed and the sender, so the same seed gives the same delays", async () => {
    const delays = async (seed: number) => {
      const { lines, medium, sendNow } = started(mailTable({ delivery_minutes: [1, 5] }), seed);
      sendNow("ana", { to: "ben", act: "ask" });
      await medium.delivered();
      const [sent, landed] = lines as { worldTime: { seconds: number } }[];
      return (landed.worldTime.seconds - sent.worldTime.seconds) / 60;
    };

    const [first, again, other] = [await delays(42), await delays(42), await delays(7)];

    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(5.2);
    expect(Math.abs(again - first)).toBeLessThan(0.2);
    expect(Math.abs(other - first)).toBeGreaterThan(0.2);
  });

  it("never delivers a message still in transit when the run ends", async () => {
    const { world, lines, delivered, medium, runEnd, sendNow } = started(mailTable({ delivery_minutes: [60, 60] }));

    sendNow("ana", { to: "ben", act: "ask" });
    setTimeout(() => runEnd.abort(), 50);
    await medium.delivered();

    expect(lines.map(({ type }) => type)).toEqual(["message_sent"]);
    expect(world.state.mail.inTransit).toHaveLength(1);
    expect(world.state.mail.mailboxes.ben).toEqual([]);
    expect(delivered).toEqual([]);
  });
});
