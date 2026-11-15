import { INVOICE_NOTICE } from "../engine/money.ts";
import type { Perceived, RuleSet, RuleStep, Rules } from "../engine/participants.ts";
import type { Random } from "../engine/random.ts";
import type { Stimulus } from "../engine/stimuli.ts";

/** A rule set's script: a generator that yields its steps and is given, for each, what its participant perceived. */
type Script = Generator<RuleStep, never, Perceived>;

/** A message's or a call's fields, as a party reads them. */
type Fields = Record<string, string | number | boolean>;

/** What reached a party: its sender, its act and its fields; free text is ignored. */
interface Received {
  from: string;
  act: string;
  fields: Fields;
}

/** An answer: its act and fields, and what the party does once it has answered. */
interface Answer {
  act: string;
  fields: Fields;
  then?: () => Script;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * What reached a party, from the world's record of a message or a call (FR-CONGRESS-09): its sender, act and fields,
 * never read from the text rendered for a model, so free text cannot change a field.
 */
function receivedOf(record: Readonly<Record<string, unknown>> | undefined): Received | undefined {
  if (record === undefined || typeof record.from !== "string" || typeof record.act !== "string") return undefined;
  return { from: record.from, act: record.act, fields: { ...((record.fields ?? {}) as Fields) } };
}

/** A ring, from the world's record of its call. */
function readRing(stimulus: Stimulus): (Received & { call: string }) | undefined {
  const received = receivedOf(stimulus.record);
  return received === undefined || typeof stimulus.record?.call !== "string" ? undefined : { ...received, call: stimulus.record.call };
}

/** A world time "day <n> <weekday> HH:MM" as world minutes since day 1's midnight, with the weekday of day 1. */
function minutesOf(text: string): { minutes: number; weekdayOfDayOne: number } {
  const [, day, weekday, hours, minutes] = /^day (\d+) (\w+) (\d\d):(\d\d)$/.exec(text) ?? [];
  if (day === undefined) throw new Error(`"${text}" is no world time`);
  return { minutes: (Number(day) - 1) * 1440 + Number(hours) * 60 + Number(minutes), weekdayOfDayOne: (((WEEKDAYS.indexOf(weekday) - (Number(day) - 1)) % 7) + 7) % 7 };
}

/** World minutes since day 1's midnight as a world time "day <n> <weekday> HH:MM". */
function timeText(minutes: number, weekdayOfDayOne: number): string {
  const day = Math.floor(minutes / 1440);
  const within = Math.floor(minutes - day * 1440);
  const two = (value: number) => String(value).padStart(2, "0");
  return `day ${day + 1} ${WEEKDAYS[(weekdayOfDayOne + day) % 7]} ${two(Math.floor(within / 60))}:${two(within % 60)}`;
}

/** A time a perturbation gives, "day <n> HH:MM" (a weekday may follow the day), as world minutes since day 1's midnight; undefined when it does not follow that format. */
export function perturbationMinutes(text: unknown): number | undefined {
  const [, day, hours, minutes] = /^day (\d+)(?: [A-Z][a-z]+day)? (\d\d):(\d\d)$/.exec(String(text)) ?? [];
  return day === undefined ? undefined : (Number(day) - 1) * 1440 + Number(hours) * 60 + Number(minutes);
}

/** The probability that a party calls back a ring it missed (FR-CONGRESS-07). */
const CALL_BACK = 0.5;

/** What any party's script does: its calls, its waits, its clock, its mail and its rings, from what it perceives only. */
class Party {
  /** The stimuli that reached it and wait to be handled. */
  readonly stimuli: Stimulus[] = [];
  now = 0;
  weekdayOfDayOne = 0;
  /** When it calls back a ring it missed: between the two numbers, in world minutes after the ring (FR-CONGRESS-07). */
  readonly #callBack?: readonly [number, number];
  /** The rings it missed and will call back, each at its world time. */
  readonly #callBacks: { at: number; ring: Received }[] = [];
  /** How it answers what reaches it, as it last handled something. */
  #answer?: (received: Received) => Answer | undefined;
  /** What it reads before it answers something, as it last handled something (FR-CONGRESS-17). */
  #prepare?: (received: Received) => Generator<RuleStep, void, Perceived>;
  /**
   * The messages it answered, by sender, act and fields, with its answer's act and world time, and its version as it
   * answered, so a repeat is answered already_sent while nothing changed (FR-CONGRESS-09, FR-CONGRESS-11, FR-CONGRESS-13).
   */
  readonly #answered = new Map<string, { act: string; sent: string; version: number }>();
  /** How many times something reached it or its own state changed: an act from any sender, or a change of its own (FR-CONGRESS-13). */
  #version = 0;
  /** The hours it keeps: its days, and from and to "HH:MM" on each (FR-CONGRESS-09); none, always. */
  readonly #keeps?: { days: readonly string[]; from: string; to: string };

  /** A party with its parameters: call_back_minutes and the hours it keeps, when the world gives them. */
  constructor(params: Readonly<Record<string, unknown>> = {}) {
    this.#callBack = params.call_back_minutes as [number, number] | undefined;
    this.#keeps = params.keeps as { days: readonly string[]; from: string; to: string } | undefined;
  }

  /** The first moment, in world minutes, at or after the one given that is within its hours (FR-CONGRESS-09). */
  withinHours(minutes: number): number {
    const keeps = this.#keeps;
    if (keeps === undefined) return minutes;
    const clock = (text: string) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
    for (let day = Math.floor(minutes / 1440); day < Math.floor(minutes / 1440) + 8; day += 1) {
      if (!keeps.days.includes(WEEKDAYS[(this.weekdayOfDayOne + day) % 7])) continue;
      const opens = day * 1440 + clock(keeps.from);
      const closes = day * 1440 + clock(keeps.to);
      if (minutes < closes) return Math.max(minutes, opens);
    }
    return minutes;
  }

  /** Notes a change of its own state that no act brought, such as a booking's lapse, a change or an allocation (FR-CONGRESS-13). */
  changed(): void {
    this.#version += 1;
  }

  /** A call of one of its tools; it gives the call's result and keeps any stimulus that came meanwhile. */
  *call(tool: string, args: Record<string, unknown> = {}): Generator<RuleStep, NonNullable<Perceived["result"]> | { outcome: string; text: string; record?: undefined }, Perceived> {
    const perceived = yield { kind: "call", tool, arguments: args };
    this.stimuli.push(...perceived.stimuli);
    return perceived.result ?? { outcome: "none", text: "" };
  }

  /**
   * A wait, or the end when there is nothing to wait for; it keeps the stimuli that wake it. A call back it owes shortens
   * the wait, and is made once its time has come.
   */
  *rest(minutes: number | undefined): Generator<RuleStep, void, Perceived> {
    const next = this.#callBacks.reduce((first, { at }) => Math.min(first, at), Infinity);
    const until = Math.min(minutes ?? Infinity, next - this.now);
    const perceived = yield until === Infinity ? { kind: "end" } : { kind: "wait", minutes: until };
    this.stimuli.push(...perceived.stimuli);
    if (this.#callBacks.length > 0) yield* this.callBack();
  }

  /** Calls back each ring it missed whose time has come, with missed_call; answered, it answers the ring's act by mail. */
  *callBack(): Generator<RuleStep, void, Perceived> {
    yield* this.clock();
    for (const due of this.#callBacks.filter(({ at }) => at <= this.now)) {
      this.#callBacks.splice(this.#callBacks.indexOf(due), 1);
      if ((yield* this.call("call", { to: due.ring.from, act: "missed_call" })).outcome !== "success") continue;
      if (this.#prepare !== undefined) yield* this.#prepare(due.ring);
      const given = this.#answer?.(due.ring);
      if (given === undefined) continue;
      yield* this.call("send_mail", { to: due.ring.from, act: given.act, fields: given.fields });
      if (given.then !== undefined) yield* given.then();
    }
  }

  /**
   * Sends a mail of its own, not an answer, at the first moment within its hours (FR-CONGRESS-09): out of them it waits,
   * keeping what reaches it meanwhile.
   */
  *write(to: string, act: string, fields: Readonly<Record<string, unknown>> | (() => Readonly<Record<string, unknown>>) = {}): Generator<RuleStep, void, Perceived> {
    yield* this.clock();
    for (let opens = this.withinHours(this.now); opens > this.now; opens = this.withinHours(this.now)) {
      const perceived = yield { kind: "wait", minutes: opens - this.now };
      this.stimuli.push(...perceived.stimuli);
      yield* this.clock();
    }
    // Fields given as a function are written as it sends, at the time it sends (FR-CONGRESS-16).
    yield* this.call("send_mail", { to, act, fields: typeof fields === "function" ? fields() : fields });
  }

  /** Reads the world's time with its own check_time. */
  *clock(): Generator<RuleStep, void, Perceived> {
    const read = minutesOf((yield* this.call("check_time")).text);
    this.now = read.minutes;
    this.weekdayOfDayOne = read.weekdayOfDayOne;
  }

  /** A time, in its world minutes, as a world time. */
  text(minutes = this.now): string {
    return timeText(minutes, this.weekdayOfDayOne);
  }

  /** Its unread mail, each message read in turn. */
  *mail(): Generator<RuleStep, Received[], Perceived> {
    const listed = (yield* this.call("check_mail", { unread_only: true })).text;
    const read: Received[] = [];
    for (const [, id] of listed.matchAll(/^(m-\d+):/gm)) {
      const message = receivedOf((yield* this.call("read_mail", { id })).record);
      if (message !== undefined) read.push(message);
    }
    return read;
  }

  /** Its ledger, as JSON. */
  *ledger(): Generator<RuleStep, Record<string, unknown>, Perceived> {
    return JSON.parse((yield* this.call("ledger")).text) as Record<string, unknown>;
  }

  /** Voids each invoice it issued that stands, as its ledger gives them, whose "for" text matches (FR-CONGRESS-13). */
  *voidInvoices(matches: (what: string) => boolean): Generator<RuleStep, void, Perceived> {
    const ledger = yield* this.ledger();
    for (const issued of (ledger.invoices_issued ?? []) as { id: string; for: string; voided?: boolean }[]) {
      if (issued.voided !== true && matches(issued.for)) yield* this.call("void_invoice", { invoice: issued.id });
    }
  }

  /** Releases each commitment it recorded, as its ledger gives them, whose "for" text matches. */
  *release(matches: (what: string) => boolean): Generator<RuleStep, void, Perceived> {
    const ledger = yield* this.ledger();
    for (const recorded of (ledger.commitments_recorded ?? []) as { id: string; for: string }[]) {
      if (matches(recorded.for)) yield* this.call("release", { commitment: recorded.id });
    }
  }

  /**
   * Handles what has reached it: a ring it picks up, with the probability given, is answered by answer_call; its unread
   * mail is answered by mail. Each answer is made, then what it does once it has answered; no answer, nothing is sent.
   * A repeat is answered already_sent, unless `afresh` says the party answers that message afresh. What `prepare` reads
   * comes before each answer, as a caterer reads an order's permit (FR-CONGRESS-17).
   */
  *handle(
    answer: (received: Received) => Answer | undefined,
    pickUp: number,
    random: Random,
    afresh: (received: Received) => boolean = () => false,
    prepare?: (received: Received) => Generator<RuleStep, void, Perceived>,
  ): Generator<RuleStep, void, Perceived> {
    let mail = false;
    this.#answer = answer;
    this.#prepare = prepare;
    while (this.stimuli.length > 0) {
      const stimulus = this.stimuli.shift() as Stimulus;
      if (stimulus.channel === "mail_notice") mail = true;
      if (stimulus.channel !== "phone") continue;
      const ring = readRing(stimulus);
      if (ring === undefined) continue;
      this.changed();
      if (!(random.next() < pickUp)) {
        // A missed ring is called back with probability 0.5, within the party's reply delay after the ring ends (FR-CONGRESS-07).
        if (this.#callBack !== undefined && random.next() < CALL_BACK) {
          const [fewest, most] = this.#callBack;
          const after = fewest + random.next() * (most - fewest);
          yield* this.clock();
          this.#callBacks.push({ at: this.now + after, ring });
        }
        continue;
      }
      if (prepare !== undefined) yield* prepare(ring);
      const given = answer(ring);
      if (given === undefined) continue;
      yield* this.call("answer_call", { call: ring.call, act: given.act, fields: given.fields });
      if (given.then !== undefined) yield* given.then();
    }
    if (!mail) return;
    // Its mail in the order it landed, as check_mail lists it, answered at the time it reads it.
    const messages = yield* this.mail();
    if (messages.length > 0) yield* this.clock();
    for (const message of messages) {
      const key = JSON.stringify([message.from, message.act, message.fields]);
      const earlier = this.#answered.get(key);
      // A repeat of a message it answered, while nothing reached it and nothing of its own changed since: what it
      // answered and when, and nothing else (FR-CONGRESS-11, FR-CONGRESS-13); unless the party answers it afresh
      // (FR-CONGRESS-16).
      if (earlier !== undefined && earlier.version === this.#version && !afresh(message)) {
        yield* this.call("send_mail", { to: message.from, act: "already_sent", fields: { act: earlier.act, sent: earlier.sent } });
        continue;
      }
      this.changed();
      if (prepare !== undefined) yield* prepare(message);
      const given = answer(message);
      if (given === undefined) continue;
      const sent = this.text();
      yield* this.call("send_mail", { to: message.from, act: given.act, fields: given.fields });
      if (given.then !== undefined) yield* given.then();
      this.#answered.set(key, { act: given.act, sent, version: this.#version });
    }
  }
}

/** Rules from a script that starts as the run starts, and an outcome record. */
function rulesOf(script: Script, outcome: () => Readonly<Record<string, string | number | boolean>>): Rules {
  return {
    atStart: () => script.next(undefined as unknown as Perceived).value,
    next: (perceived) => script.next(perceived).value,
    outcome,
  };
}

/** A room of a venue's template. */
interface Room {
  id: string;
  seats: number;
  equipment?: string[];
}

/** A step of a venue's cancellation schedule: the share charged when more than so many days are left, or otherwise. */
interface CancellationStep {
  more_than_days?: number;
  share: number;
}

/** A venue's parameters: its template and what the congress adds to it. */
interface VenueParams {
  id: string;
  rooms: Room[];
  access_claim: string;
  /** Its catering rule: in_house, outside_fee (with outside_fee_per_head) or outside_free (FR-CONGRESS-07). */
  catering?: string;
  outside_fee_per_head?: number;
  /** At an in_house venue, the fee a head for outside meals of a diet its caterer cannot serve in full (FR-CONGRESS-17). */
  outside_diet_fee_per_head?: number;
  /** Its in-house caterer's diets, with their limits, when it has one (FR-CONGRESS-17). */
  in_house_diets?: Record<string, { limit?: number }>;
  opening?: string;
  price: number;
  extras?: Record<string, number>;
  hold_days: number;
  deposit_share: number;
  deposit_due_days: number;
  cancellation: CancellationStep[];
  indicative?: boolean;
  enquiries_per_day?: number;
  pick_up?: number;
  booked_by_others?: string[];
  organiser: string;
  event_day: number;
  floor_plan: { between: [string, string]; step_free: true | string }[];
  perturbations: { name: string; kind?: string; between?: [string, string]; at?: string }[];
  /** The mail's delivery delay, its fewest and most world minutes, so a change's answer_by counts from its delivery (FR-CONGRESS-16). */
  mail_delivery_minutes?: [number, number];
}

/** A venue's cancellation schedule as a text: "more than 14 days: 0.1; 14 days or fewer: 0.5". */
export function scheduleText(schedule: readonly CancellationStep[]): string {
  return schedule
    .map(({ more_than_days: days, share }, index) => (days !== undefined ? `more than ${days} days: ${share}` : `${schedule[index - 1]?.more_than_days ?? 0} days or fewer: ${share}`))
    .join("; ");
}

/** The share a schedule charges with so many days left before the event. */
function shareCharged(schedule: readonly CancellationStep[], daysLeft: number): number {
  return (schedule.find(({ more_than_days: days }) => days === undefined || daysLeft > days) ?? { share: 0 }).share;
}

/** A contract a venue offered: its id, date, rooms, hours, price, extras, and whether it is confirmed or cancelled. */
interface Contract {
  id: string;
  to: string;
  date: string;
  rooms: string[];
  hours: string;
  price: number;
  extras: Record<string, number>;
  confirmed: boolean;
  /** Cancelled: never accepted again; the date is booked again as a new contract (FR-CONGRESS-15). */
  cancelled?: boolean;
  /**
   * A change the venue announced and awaits an answer on, with the fields its mail gave and the world minute of its
   * answer_by once mailed (FR-CONGRESS-16).
   */
  change?: ({ kind: "price_change"; price: number } | { kind: "room_lost"; room: string; smaller?: string; cut?: number }) & { mailed?: Fields; answerBy?: number };
}

/** How long a venue waits for the answer to its change: 72 world hours after its mail is delivered (FR-CONGRESS-16). */
const CHANGE_ANSWER_MINUTES = 72 * 60;

/**
 * The options a change offers: none for a price change; for a lost room, its smaller room when it has one, and a price
 * cut unless the booking had that room only (FR-CONGRESS-17).
 */
function offered(change: NonNullable<Contract["change"]>): string[] {
  if (change.kind === "price_change") return [];
  return [...(change.smaller === undefined ? [] : ["smaller_room"]), ...(change.cut === undefined ? [] : ["price_cut"])];
}

/** Something a venue does at a world time of its own. */
interface Timer {
  at: number;
  kind: "lapse" | "challenge_lapse" | "reminder" | "unpaid_cancel" | "enquiry" | "room_allocation" | "change_lapse";
  date?: string;
  contract?: string;
}

/**
 * The channel on which the venue change reaches the venue that holds the organiser's live booking, its text the kind
 * declared, room_lost or price_change, or empty when the venue draws it (FR-CONGRESS-13).
 */
export const VENUE_CHANGE = "venue_change";

/** The kinds of a venue change. */
const CHANGE_KINDS = ["room_lost", "price_change"];

/**
 * The venue's rules (FR-CONGRESS-02): from its template, it answers quotes, documents, holds, bookings, contracts, extras,
 * cancellations and changes; its own cycle brings other customers' enquiries, lapsed holds, deposit reminders and
 * cancellations, and the perturbations the configuration declares. It learns the time, its mail and its ledger only
 * through its own tools.
 */
export const venueRules: RuleSet = {
  start: (given, random) => {
    const venue = given as unknown as VenueParams;
    const party = new Party(given);
    const dates = new Map<string, string>((venue.booked_by_others ?? []).map((date) => [date, "other"]));
    const contracts: Contract[] = [];
    const timers: Timer[] = [];
    const history: Record<string, string | number>[] = [];
    const counts = { holds: 0, contracts: 0, confirmations: 0, cancellations: 0, invoices_issued: 0, lost_to_others: 0 };
    const eventDate = `day ${venue.event_day}`;
    const record = (event: string, fields: Record<string, string | number> = {}) => history.push({ at: party.text(), event, ...fields });
    const statusOf = (date: string) => dates.get(date) ?? "free";
    /** The rooms lost for each date, which no booking can have back (FR-CONGRESS-09). */
    const lostRooms = new Map<string, Set<string>>();
    const contractOf = (id: unknown) => contracts.find((contract) => contract.id === id);
    const live = () => contracts.find((contract) => contract.confirmed && statusOf(contract.date) === "confirmed");
    const today = () => Math.floor(party.now / 1440) + 1;
    const roomText = ({ id, seats, equipment = [] }: Room) => `${id}: ${seats} seats${equipment.length === 0 ? "" : `, ${equipment.join(", ")}`}`;
    const plan = () => venue.floor_plan.map(({ between: [from, to], step_free: stepFree }) => `${from} to ${to}: ${stepFree === true ? "step-free" : stepFree}`).join("; ");
    const terms = () =>
      [
        `Price ${venue.price} a day.`,
        `A hold lasts ${venue.hold_days} days.`,
        `Deposit ${venue.deposit_share} of the price, due ${venue.deposit_due_days} days after the contract is accepted.`,
        `Cancellation: ${scheduleText(venue.cancellation)}.`,
        ...(venue.catering === undefined ? [] : [`Catering: ${venue.catering}.`]),
        ...(venue.opening === undefined ? [] : [`Opening: ${venue.opening}.`]),
        ...(venue.indicative === true ? ["Rooms are indicative until allocated."] : []),
      ].join(" ");
    const after = (minutes: number, timer: Omit<Timer, "at">) => timers.push({ at: party.now + minutes, ...timer });
    /** The commitments it recorded for a contract, from its ledger, each released. */
    const releaseAll = (contract: Contract) => party.release((what) => what.startsWith(contract.id));
    const notAvailable = (what: unknown): Answer => ({ act: "not_available", fields: { what: String(what) } });
    const unavailable = (date: string): Answer => ({ act: "unavailable", fields: { date } });
    const free = (date: string) => statusOf(date) === "free" || statusOf(date) === "held";
    const totalSeats = venue.rooms.reduce((sum, { seats }) => sum + seats, 0);
    /** A room's price: its share of the day price by seats, rounded (FR-CONGRESS-07). */
    const roomPrice = (room: string) => Math.round((venue.price * (venue.rooms.find(({ id }) => id === room)?.seats ?? 0)) / totalSeats);
    /** The extras it quoted, by item, with their price and, for a room, which room; for outside diet meals, their diet and attendance. */
    const quoted = new Map<string, { price: number; room?: string; diet?: string; attendance?: number }>();
    /** Whether its in-house caterer cannot serve a diet in full: it serves it with a limit, or not at all (FR-CONGRESS-17). */
    const notServedInFull = (diet: string) => venue.in_house_diets?.[diet]?.limit !== undefined || !Object.hasOwn(venue.in_house_diets ?? {}, diet);
    let permits = 0;
    /** A contract's new price, the difference committed, or its commitments released and the new price committed. */
    function repriced(contract: Contract, to: string, price: number): () => Script {
      const difference = price - contract.price;
      contract.price = price;
      return function* () {
        if (difference > 0) yield* party.call("commit", { with: to, amount: difference, for: `${contract.id} change` });
        if (difference < 0) {
          yield* releaseAll(contract);
          yield* party.call("commit", { with: to, amount: contract.price, for: contract.id });
        }
      } as () => Script;
    }

    /** A customer's contracted or confirmed booking. */
    const bookingOf = (customer: string) => contracts.find((each) => each.to === customer && ["contracted", "confirmed"].includes(statusOf(each.date)));
    /** A change pending on a booking holds it: what would change it is answered change_pending, with the change's fields (FR-CONGRESS-16). */
    const pending = (contract: Contract | undefined): Answer | undefined => (contract?.change === undefined ? undefined : { act: "change_pending", fields: { kind: contract.change.kind, ...contract.change.mailed } });

    const answer = ({ from, act, fields }: Received): Answer => {
      const date = String(fields.date ?? eventDate);
      if (act === "change_booking" || act === "request_extra" || act === "accept_extra") {
        const held = pending(bookingOf(from));
        if (held !== undefined) return held;
      }
      switch (act) {
        case "ask_quote":
          if (!free(date)) return unavailable(date);
          return {
            act: "quote",
            fields: {
              rooms: venue.rooms.map(roomText).join("; "),
              access: venue.access_claim,
              ...(venue.catering === undefined ? {} : { catering: venue.catering }),
              price: venue.price,
              // Its extras with their prices, so the organiser learns them by asking (FR-CONGRESS-11).
              ...(Object.keys(venue.extras ?? {}).length === 0 ? {} : { extras: Object.entries(venue.extras ?? {}).map(([item, price]) => `${item}: ${price}`).join("; ") }),
              hold_days: venue.hold_days,
              deposit_share: venue.deposit_share,
              deposit_due_days: venue.deposit_due_days,
              cancellation: scheduleText(venue.cancellation),
              ...(venue.opening === undefined ? {} : { opening: venue.opening }),
              indicative: venue.indicative === true,
            },
          };
        case "request_document":
          if (fields.kind === "floor_plan" || fields.kind === "photos") return { act: "document", fields: { kind: String(fields.kind), content: plan() } };
          if (fields.kind === "terms") return { act: "document", fields: { kind: "terms", content: terms() } };
          return notAvailable(fields.kind);
        case "hold": {
          if (statusOf(date) !== "free") return statusOf(date) === "held" ? { act: "held", fields: { date } } : unavailable(date);
          dates.set(date, "held");
          counts.holds += 1;
          const until = party.now + venue.hold_days * 1440;
          timers.push({ at: until, kind: "lapse", date });
          record("held", { date, until: party.text(until) });
          return { act: "held", fields: { date, until: party.text(until) } };
        }
        case "book": {
          // A customer that already holds a contract for the date is told so (FR-CONGRESS-09).
          const held = contracts.find((each) => each.to === from && each.date === date && ["contracted", "confirmed"].includes(statusOf(date)));
          if (held !== undefined) return { act: "contract_held", fields: { contract: held.id, date } };
          if (!free(date)) return unavailable(date);
          const rooms = String(fields.rooms ?? "").split(/,\s*/).filter((room) => room !== "");
          const missing = rooms.find((room) => !venue.rooms.some(({ id }) => id === room));
          if (missing !== undefined || rooms.length === 0) return notAvailable(missing ?? "rooms");
          const contract: Contract = { id: `${venue.id}-contract-${contracts.length + 1}`, to: from, date, rooms, hours: String(fields.hours ?? ""), price: venue.price, extras: {}, confirmed: false };
          contracts.push(contract);
          dates.set(date, "contracted");
          counts.contracts += 1;
          record("contract", { contract: contract.id, date });
          return { act: "contract", fields: { contract: contract.id, date, rooms: rooms.join(", "), hours: contract.hours, price: contract.price, terms: terms() } };
        }
        case "accept_contract": {
          const contract = contractOf(fields.contract);
          if (contract === undefined || contract.confirmed || contract.cancelled === true || contract.to !== from) return notAvailable(fields.contract);
          contract.confirmed = true;
          dates.set(contract.date, "confirmed");
          counts.confirmations += 1;
          record("confirmed", { contract: contract.id });
          const due = today() + venue.deposit_due_days;
          return {
            act: "confirmed",
            fields: { contract: contract.id },
            then: function* () {
              yield* party.call("commit", { with: from, amount: contract.price, for: contract.id });
              yield* party.call("issue_invoice", { to: from, amount: contract.price * venue.deposit_share, due: `day ${due}`, for: `deposit ${contract.id}` });
              counts.invoices_issued += 1;
              // A deposit unpaid 5 days after its due date brings a reminder.
              timers.push({ at: party.now + (due - today() + 5) * 1440, kind: "reminder", contract: contract.id });
            } as () => Script,
          };
        }
        case "request_extra": {
          const item = String(fields.item);
          if (item === "outside_catering") {
            const attendance = Number(fields.attendance ?? 0);
            // At an in_house venue, outside meals of a diet its caterer cannot serve in full (FR-CONGRESS-17).
            if (venue.catering === "in_house" && fields.diet !== undefined && notServedInFull(String(fields.diet))) {
              const price = (venue.outside_diet_fee_per_head ?? 0) * attendance;
              quoted.set(item, { price, diet: String(fields.diet), attendance });
              return { act: "extra_quote", fields: { item, price } };
            }
            if (venue.catering !== "outside_fee") return notAvailable(item);
            const price = (venue.outside_fee_per_head ?? 0) * attendance;
            quoted.set(item, { price });
            return { act: "extra_quote", fields: { item, price } };
          }
          if (item === "room") {
            const booked = live()?.rooms ?? [];
            const room = venue.rooms.filter(({ id, seats }) => !booked.includes(id) && seats >= Number(fields.seats ?? 0)).sort((one, other) => one.seats - other.seats)[0];
            if (room === undefined) return notAvailable(item);
            quoted.set(item, { price: roomPrice(room.id), room: room.id });
            return { act: "extra_quote", fields: { item, room: room.id, price: roomPrice(room.id) } };
          }
          const price = venue.extras?.[item];
          return price === undefined ? notAvailable(item) : { act: "extra_quote", fields: { item, price } };
        }
        case "accept_extra": {
          const item = String(fields.item);
          const offer = quoted.get(item);
          const price = offer?.price ?? venue.extras?.[item];
          const contract = live();
          if (price === undefined || contract === undefined) return notAvailable(price === undefined ? item : "contract");
          contract.extras[item] = price;
          if (offer?.room !== undefined) contract.rooms = [...contract.rooms, offer.room];
          record("extra", { contract: contract.id, item });
          // A permit for outside diet meals carries their diet and attendance (FR-CONGRESS-17).
          const diet: Fields = offer?.diet === undefined ? {} : { diet: offer.diet, attendance: offer.attendance as number };
          const permit: Fields = item === "outside_catering" ? { permit: `${venue.id}-permit-${(permits += 1)}`, ...diet } : {};
          return { act: "extra_confirmed", fields: { item, price, ...permit, ...(offer?.room === undefined ? {} : { room: offer.room }) }, then: function* () { yield* party.call("commit", { with: from, amount: price, for: `${contract.id} extra ${item}` }); } as () => Script };
        }
        case "change_booking": {
          const contract = bookingOf(from);
          if (contract === undefined) return notAvailable("booking");
          const rooms = String(fields.rooms ?? "").split(/,\s*/).filter((room) => room !== "");
          const lost = lostRooms.get(contract.date) ?? new Set<string>();
          // A room lost to a change or an allocation is named, without the date (FR-CONGRESS-16).
          const named = rooms.find((room) => lost.has(room));
          if (named !== undefined) return { act: "unavailable", fields: { room: named } };
          if (rooms.length === 0 || rooms.some((room) => !venue.rooms.some(({ id }) => id === room))) return unavailable(contract.date);
          const added = rooms.filter((room) => !contract.rooms.includes(room)).reduce((sum, room) => sum + roomPrice(room), 0);
          const dropped = contract.rooms.filter((room) => !rooms.includes(room)).reduce((sum, room) => sum + roomPrice(room), 0);
          contract.rooms = rooms;
          contract.hours = String(fields.hours ?? contract.hours);
          const then = repriced(contract, from, contract.price + added - dropped);
          record("booking_changed", { contract: contract.id, price: contract.price });
          return { act: "contract_changed", fields: { contract: contract.id, rooms: rooms.join(", "), hours: contract.hours, price: contract.price }, then };
        }
        case "cancel_booking": {
          const contract = contracts.find((each) => each.to === from && ["contracted", "confirmed"].includes(statusOf(each.date)));
          if (contract === undefined) return notAvailable("booking");
          const total = contract.price + Object.values(contract.extras).reduce((sum, price) => sum + price, 0);
          const charge = contract.confirmed ? Math.round(total * shareCharged(venue.cancellation, venue.event_day - today())) : 0;
          return cancelling(contract, charge);
        }
        case "accept_change":
        case "decline_change": {
          const contract = contracts.find((each) => each.to === from && each.change !== undefined);
          if (contract?.change === undefined) return notAvailable("change");
          const change = contract.change;
          // Only an option the change offered; any other leaves it pending (FR-CONGRESS-15).
          if (act === "accept_change" && fields.option !== undefined && !offered(change).includes(String(fields.option))) return notAvailable(fields.option);
          contract.change = undefined;
          if (act === "decline_change") return cancelling(contract, 0);
          let newPrice = contract.price;
          if (change.kind === "price_change") newPrice = change.price;
          if (change.kind === "room_lost") {
            // The smaller room in place of the lost one at the same price, or the lost room gone and its price cut (FR-CONGRESS-07).
            const smaller = change.smaller !== undefined && fields.option !== "price_cut" ? change.smaller : undefined;
            contract.rooms = contract.rooms.flatMap((room) => (room !== change.room ? [room] : smaller === undefined ? [] : [smaller]));
            if (smaller === undefined) newPrice = contract.price - (change.cut ?? 0);
          }
          const then = repriced(contract, from, newPrice);
          record("change_accepted", { contract: contract.id, price: newPrice });
          return { act: "confirmed", fields: { contract: contract.id, price: newPrice, rooms: contract.rooms.join(", ") }, then };
        }
        default:
          return notAvailable(act);
      }
    };

    /**
     * A cancellation with its charge: it releases the contract's commitments, voids its invoices (FR-CONGRESS-13) and
     * invoices the charge when above 0.
     */
    function cancelling(contract: Contract, charge: number): Answer {
      dates.set(contract.date, "free");
      contract.confirmed = false;
      contract.cancelled = true;
      counts.cancellations += 1;
      record("cancelled", { contract: contract.id, charge });
      return {
        act: "cancelled",
        fields: { contract: contract.id, charge },
        then: function* () {
          yield* releaseAll(contract);
          yield* party.voidInvoices((what) => what.endsWith(contract.id));
          if (charge > 0) {
            // A charge is committed as it is invoiced (FR-CONGRESS-05's addition).
            yield* party.call("commit", { with: contract.to, amount: charge, for: `cancellation ${contract.id}` });
            yield* party.call("issue_invoice", { to: contract.to, amount: charge, due: `day ${today()}`, for: `cancellation ${contract.id}` });
            counts.invoices_issued += 1;
          }
        } as () => Script,
      };
    }

    /** Whether the contract's deposit is paid, from its ledger. */
    function* depositPaid(contract: Contract): Generator<RuleStep, boolean, Perceived> {
      const ledger = yield* party.ledger();
      const invoice = ((ledger.invoices_issued ?? []) as { for: string; paid: boolean }[]).find((each) => each.for === `deposit ${contract.id}`);
      return invoice?.paid === true;
    }

    /** Another customer's draw for a free date: it books it with probability 0.5. */
    const otherCustomer = (date: string) => {
      if (random.next() < 0.5) {
        dates.set(date, "other");
        counts.lost_to_others += 1;
        record("booked_by_other", { date });
      } else record("left_free", { date });
    };

    /** What the venue does when one of its timers comes: a change of its own state (FR-CONGRESS-13). */
    function* fire(timer: Timer): Generator<RuleStep, void, Perceived> {
      party.changed();
      const contract = contractOf(timer.contract);
      switch (timer.kind) {
        case "lapse":
        case "challenge_lapse": {
          const date = timer.date as string;
          if (statusOf(date) !== "held") return;
          dates.set(date, "free");
          record("hold_lapsed", { date });
          if (timer.kind === "challenge_lapse") otherCustomer(date);
          return;
        }
        case "enquiry": {
          record("enquiry", { date: eventDate });
          if (statusOf(eventDate) === "free") otherCustomer(eventDate);
          else if (statusOf(eventDate) === "held" && !timers.some(({ kind }) => kind === "challenge_lapse")) {
            const confirmBy = party.now + 48 * 60;
            // A challenged hold ends when the organiser must confirm by, in place of its own end.
            timers.splice(0, timers.length, ...timers.filter(({ kind, date }) => !(kind === "lapse" && date === eventDate)));
            timers.push({ at: confirmBy, kind: "challenge_lapse", date: eventDate });
            yield* party.write(venue.organiser, "hold_challenged", { date: eventDate, confirm_by: party.text(confirmBy) });
          }
          scheduleEnquiry();
          return;
        }
        case "reminder":
          if (contract === undefined || statusOf(contract.date) !== "confirmed" || (yield* depositPaid(contract))) return;
          yield* party.write(contract.to, "reminder", { contract: contract.id });
          record("reminder", { contract: contract.id });
          timers.push({ at: party.now + 2 * 1440, kind: "unpaid_cancel", contract: contract.id });
          return;
        case "unpaid_cancel": {
          if (contract === undefined || statusOf(contract.date) !== "confirmed" || (yield* depositPaid(contract))) return;
          const cancelled = cancelling(contract, 0);
          yield* party.write(contract.to, cancelled.act, cancelled.fields);
          yield* (cancelled.then as () => Script)();
          return;
        }
        case "change_lapse": {
          // A change still unanswered at its answer_by (FR-CONGRESS-16).
          const change = contract?.change;
          if (contract === undefined || change?.answerBy === undefined) return;
          contract.change = undefined;
          if (change.kind === "price_change") {
            // Declined: cancelled with no charge, as on decline_change.
            const cancelled = cancelling(contract, 0);
            yield* party.write(contract.to, cancelled.act, { ...cancelled.fields, reason: "change_unanswered" });
            yield* (cancelled.then as () => Script)();
            return;
          }
          // A one-room booking moves to the smaller room at the same price (FR-CONGRESS-17); any other takes its price cut:
          // the lost room gone, the commitment down by the cut.
          const { cut, smaller } = change;
          contract.rooms = contract.rooms.flatMap((room) => (room !== change.room ? [room] : cut === undefined && smaller !== undefined ? [smaller] : []));
          const then = repriced(contract, contract.to, contract.price - (cut ?? 0));
          record("change_applied", { contract: contract.id, rooms: contract.rooms.join(", "), price: contract.price });
          yield* party.write(contract.to, "change_applied", { contract: contract.id, room: change.room, ...(cut === undefined ? { smaller: smaller as string } : { cut }) });
          yield* then();
          return;
        }
        case "room_allocation": {
          const booked = live();
          if (booked === undefined || venue.indicative !== true) return;
          const seatsOf = (room: string) => venue.rooms.find(({ id }) => id === room)?.seats ?? 0;
          const stepFree = (room: string) => venue.floor_plan.some(({ between, step_free: free }) => between.includes(room) && free === true) || !venue.floor_plan.some(({ between }) => between.includes(room));
          const taken = new Set(booked.rooms);
          const allocation = booked.rooms.map((room) => {
            const moved = venue.rooms.find(({ id }) => !taken.has(id) && seatsOf(id) >= seatsOf(room) && (stepFree(id) || !stepFree(room)));
            if (moved !== undefined) taken.add(moved.id);
            return [room, moved?.id ?? room];
          });
          // At least one booked room changes: renamed, when none could move.
          if (allocation.every(([from, to]) => from === to)) allocation[allocation.length - 1][1] = `${allocation[allocation.length - 1][0]}-allocated`;
          booked.rooms = allocation.map(([, to]) => to);
          // A room renamed or moved away is no room of the booking any more (FR-CONGRESS-11).
          const away = allocation.filter(([from, to]) => from !== to).map(([from]) => from);
          lostRooms.set(booked.date, new Set([...(lostRooms.get(booked.date) ?? []), ...away]));
          record("rooms_allocated", { contract: booked.id });
          yield* party.write(booked.to, "rooms_allocated", { contract: booked.id, allocation: allocation.map(([from, to]) => `${from} -> ${to}`).join("; ") });
          return;
        }
      }
    }

    /** The venue change, when it reaches the venue (FR-CONGRESS-13): to its live booking, of the kind given, or one it draws. */
    function* announceChange(given: string): Generator<RuleStep, void, Perceived> {
      const booked = contracts.find((each) => ["contracted", "confirmed"].includes(statusOf(each.date)));
      if (booked === undefined) return;
      party.changed();
      const drawnKind = CHANGE_KINDS.includes(given) ? given : random.next() < 0.5 ? "room_lost" : "price_change";
      const lost = booked.rooms.at(-1) as string;
      const seats = venue.rooms.find(({ id }) => id === lost)?.seats ?? 0;
      // Its largest free room with fewer seats (FR-CONGRESS-07).
      const smaller = venue.rooms.filter(({ id, seats: other }) => other < seats && !booked.rooms.includes(id)).sort((one, other) => other.seats - one.seats)[0];
      const oneRoom = booked.rooms.length < 2;
      // A booking with one room loses it only for a smaller room; with none free, its price rises instead (FR-CONGRESS-11,
      // FR-CONGRESS-17).
      const kind = drawnKind === "room_lost" && oneRoom && smaller === undefined ? "price_change" : drawnKind;
      if (kind === "price_change") {
        const price = Math.round(booked.price * (1.15 + 0.1 * random.next()));
        booked.change = { kind, price };
        record("price_change", { contract: booked.id, price });
        yield* party.write(booked.to, "price_change", awaiting(booked, { contract: booked.id, old_price: booked.price, price }));
        return;
      }
      lostRooms.set(booked.date, new Set([...(lostRooms.get(booked.date) ?? []), lost]));
      // It offers its largest free smaller room, and a cut of the lost room's price (FR-CONGRESS-07), but no cut that would
      // leave a booking with no room (FR-CONGRESS-17).
      const cut: { cut?: number } = oneRoom ? {} : { cut: roomPrice(lost) };
      booked.change = { kind: "room_lost", room: lost, ...cut, ...(smaller === undefined ? {} : { smaller: smaller.id }) };
      record("room_lost", { contract: booked.id, room: lost });
      const offer: Fields = smaller === undefined ? { offer: "price_cut" } : { offer: "smaller_room", smaller: smaller.id };
      yield* party.write(booked.to, "room_lost", awaiting(booked, { contract: booked.id, room: lost, ...offer, ...(cut as Fields) }));
    }

    /**
     * A change's fields as its mail gives them as it is sent, with answer_by 72 world hours after the mail is delivered;
     * the change lapses at its first working moment after it (FR-CONGRESS-16).
     */
    function awaiting(booked: Contract, fields: Fields): () => Fields {
      return () => {
        const answerBy = party.now + (venue.mail_delivery_minutes?.[1] ?? 0) + CHANGE_ANSWER_MINUTES;
        const mailed = { ...fields, answer_by: party.text(answerBy) };
        Object.assign(booked.change as NonNullable<Contract["change"]>, { mailed, answerBy });
        timers.push({ at: party.withinHours(answerBy), kind: "change_lapse", contract: booked.id });
        return mailed;
      };
    }

    /** The next other customer's enquiry, after an interval drawn from its sequence at enquiries_per_day. */
    function scheduleEnquiry(): void {
      const rate = venue.enquiries_per_day ?? 0;
      if (rate > 0) after((-Math.log(1 - random.next()) / rate) * 1440, { kind: "enquiry" });
    }

    function* script(): Script {
      yield* party.clock();
      scheduleEnquiry();
      // Its rooms' allocation; the venue change is the world's, which reaches it only when it holds the live booking (FR-CONGRESS-13).
      for (const declared of venue.perturbations) {
        if (declared.at !== undefined) timers.push({ at: perturbationMinutes(declared.at) as number, kind: "room_allocation" });
        if (declared.between !== undefined) {
          const [from, to] = declared.between.map((time) => perturbationMinutes(time) as number);
          timers.push({ at: from + random.next() * (to - from), kind: "room_allocation" });
        }
      }
      for (;;) {
        // What reaches it is answered at the time it is answered.
        if (party.stimuli.length > 0) yield* party.clock();
        const changes = party.stimuli.filter(({ channel }) => channel === VENUE_CHANGE);
        party.stimuli.splice(0, party.stimuli.length, ...party.stimuli.filter((stimulus) => !changes.includes(stimulus)));
        for (const { content } of changes) yield* announceChange(content.trim());
        yield* party.handle(answer, venue.pick_up ?? 1, random);
        yield* party.clock();
        // Firing a timer may set others, so the next is found again each time.
        const next = () => timers.sort((one, other) => one.at - other.at)[0] as Timer | undefined;
        for (let due = next(); due !== undefined && due.at <= party.now; due = next()) yield* fire(timers.shift() as Timer);
        if (party.stimuli.length > 0) continue;
        const coming = next();
        yield* party.rest(coming === undefined ? undefined : coming.at - party.now);
      }
    }

    return rulesOf(script(), () => ({ ...counts, dates: JSON.stringify(Object.fromEntries(dates)), history: JSON.stringify(history) }));
  },
};

/** The board's parameters: its funds, its reserve for extra approvals, and the organiser it answers. */
interface BoardParams {
  funds: number;
  reserve?: number;
  pick_up?: number;
  organiser: string;
}

/**
 * The board's rules (FR-CONGRESS-02): it approves a budget within its funds, setting the organiser's ceiling and
 * transferring the funds asked, or counters it with the funds it was given; a new budget replaces the approved one, the
 * difference transferred, or taken back by an invoice (FR-CONGRESS-09). It approves an extra amount within its reserve,
 * or refuses it, saying the reserve left.
 */
export const boardRules: RuleSet = {
  start: (given, random) => {
    const board = given as unknown as BoardParams;
    const party = new Party(given);
    const counts = { approvals: 0, refusals: 0, funds_transferred: 0, reserve_used: 0 };
    const ceilings = new Map<string, number>();
    const answer = ({ from, act, fields }: Received): Answer => {
      if (act === "submit_budget") {
        const asked = Number(fields.funds_requested);
        // A new budget replaces the approved one, so all the funds it was given are available for it.
        if (!(asked <= board.funds)) return { act: "budget_countered", fields: { funds: board.funds } };
        const ceiling = Number(fields.costs) + Number(fields.contingency);
        const difference = asked - counts.funds_transferred;
        ceilings.set(from, ceiling);
        counts.approvals += 1;
        counts.funds_transferred = asked;
        return {
          act: "budget_approved",
          fields: { ceiling, funds: asked },
          then: function* () {
            yield* party.call("approve", { account: from, ceiling });
            if (difference > 0) yield* party.call("transfer", { to: from, amount: difference, for: "budget" });
            if (difference < 0) {
              yield* party.clock();
              yield* party.call("issue_invoice", { to: from, amount: -difference, due: `day ${Math.floor(party.now / 1440) + 1}`, for: "budget returned" });
            }
          } as () => Script,
        };
      }
      if (act === "request_approval") {
        const amount = Number(fields.amount);
        const reserve = (board.reserve ?? 0) - counts.reserve_used;
        // It approves more only over a budget it approved (FR-CONGRESS-07).
        if (!ceilings.has(from)) {
          counts.refusals += 1;
          return { act: "refused", fields: { amount, reason: "no_budget", reserve } };
        }
        if (!(amount <= reserve)) {
          counts.refusals += 1;
          return { act: "refused", fields: { amount, reserve } };
        }
        const ceiling = (ceilings.get(from) ?? 0) + amount;
        ceilings.set(from, ceiling);
        counts.approvals += 1;
        counts.reserve_used += amount;
        return { act: "approved", fields: { amount, ceiling }, then: function* () { yield* party.call("approve", { account: from, ceiling }); } as () => Script };
      }
      if (act === "report") return { act: "acknowledged", fields: {} };
      return { act: "not_available", fields: { what: act } };
    };
    function* script(): Script {
      for (;;) {
        yield* party.rest(undefined);
        yield* party.handle(answer, board.pick_up ?? 1, random);
      }
    }
    return rulesOf(script(), () => ({ ...counts }));
  },
};

/** The conditions a speaker may set on its acceptance. */
export const SPEAKER_CONDITIONS = ["travel_paid", "morning_slot", "fee"] as const;

/** The constraints a speaker may have on its session's time. */
export const SPEAKER_CONSTRAINTS = ["morning", "afternoon"] as const;

/** A speaker's parameters: its template and what the congress adds to it. */
interface SpeakerParams {
  id: string;
  title?: string;
  fee?: number;
  home?: string;
  available?: boolean;
  constraint?: (typeof SPEAKER_CONSTRAINTS)[number];
  acceptance?: number;
  /** Whether it accepts, drawn with the variant (FR-CONGRESS-11). */
  accepts?: boolean;
  condition?: (typeof SPEAKER_CONDITIONS)[number];
  pick_up?: number;
  organiser: string;
  /** The partner's speaker accepts any session it is given, and takes only confirm, change and ask_slides besides. */
  partner?: true;
}

/** Whether a time "HH:MM" is in the morning, before 12:00. */
const inMorning = (time: unknown) => String(time) < "12:00";

/** The perturbations that make a speaker cancel, each reaching it on a channel of its own name. */
export const SPEAKER_PERTURBATIONS = ["early_cancel", "late_cancel"];

/** The channel by which a published programme tells a speaker its session (FR-POPULATION-01). */
const PROGRAMME = "programme";

/** The perturbation that cancels a speaker's hotel room for the night before the event (FR-CONGRESS-05's addition). */
const HOTEL_OVERBOOKS = "hotel_overbooks";

/** When a speaker whose condition is not met withdraws: day 19's start, in world minutes since day 1's midnight. */
const WITHDRAW_MINUTES = 18 * 1440;

/** How long after a conditional answer a speaker waits at least before it withdraws: two world days (FR-CONGRESS-16). */
const LATE_CONDITION_MINUTES = 2 * 1440;

/** The acts the partner's speaker takes. */
const PARTNER_ACTS = ["invite", "confirm", "change", "ask_slides"];

/**
 * The speaker's rules (FR-CONGRESS-04): from its template and its own sequence, it answers an invitation, its
 * condition's answer, a confirmation and a change (which set what it believes about its session), a withdrawn
 * invitation, and requests of slides, a panel or promotion; it learns the time, its mail and its rings only through its
 * own tools.
 */
export const speakerRules: RuleSet = {
  start: (given, random) => {
    const speaker = given as unknown as SpeakerParams;
    const party = new Party(given);
    const fee = speaker.fee ?? 0;
    const record = {
      invitation: "none",
      answer: "none",
      condition: speaker.condition ?? "none",
      condition_met: false,
      believes_time: "none",
      believes_room: "none",
      cancelled: false,
      broken_agreement: false,
      claim: 0,
    };
    let invitation: Fields = {};
    /**
     * Its answer to each session's invitation, by the session, with the offer it answered (FR-CONGRESS-09), and when it
     * last answered accept_if (FR-CONGRESS-16).
     */
    const sessions = new Map<string, { offer: Fields; answer: string; conditionalAt?: number }>();
    /** Whether it would accept, drawn once, the first time it needs it (FR-CONGRESS-09). */
    let wouldAccept: boolean | undefined;
    /** The fee it agreed to, and whether it has committed it. */
    let agreedFee = 0;
    let committed = false;
    let acknowledged = false;
    const today = () => Math.floor(party.now / 1440) + 1;

    /** Whether a session at this time breaks its constraint. */
    const breaksConstraint = (time: unknown) => (speaker.constraint === "morning" && !inMorning(time)) || (speaker.constraint === "afternoon" && inMorning(time));

    /** Whether an invitation meets its condition. */
    const meetsCondition = (fields: Fields) => {
      if (speaker.condition === "fee") return Number(fields.fee ?? 0) >= fee;
      if (speaker.condition === "travel_paid") return speaker.home === "local" || fields.travel_paid === true;
      if (speaker.condition === "morning_slot") return inMorning(fields.time);
      return true;
    };

    /** What its condition needs, as its accept_if states it (FR-CONGRESS-11). */
    const needs = (): Fields => {
      if (speaker.condition === "fee") return { condition: "fee", fee };
      if (speaker.condition === "travel_paid") return { condition: "travel_paid", travel_paid: true, from: speaker.home ?? "local" };
      return { condition: speaker.condition as string, time: "before 12:00" };
    };

    /** Its answer to a session's invitation, or to its condition's answer, as it records it; an acceptance agrees to the fee offered. */
    const answering = (act: string, fields: Fields = {}): Answer => {
      record.answer = act;
      const key = String(invitation.session);
      sessions.set(key, { offer: invitation, answer: act, ...(act === "accept_if" ? { conditionalAt: party.now } : {}) });
      if (act === "accept") agreedFee = Number(invitation.fee ?? 0) > 0 ? Number(invitation.fee) : 0;
      return { act, fields: { session: invitation.session as number, ...fields } };
    };

    /** Whether any session's invitation has this answer. */
    const anyAnswered = (answer: string) => [...sessions.values()].some((session) => session.answer === answer);

    const answer = ({ act, fields }: Received): Answer | undefined => {
      if (speaker.partner === true && !PARTNER_ACTS.includes(act)) return { act: "not_available", fields: { what: act } };
      // Once ill, it declines every invitation and panel, and takes no confirmation or change (FR-CONGRESS-11).
      if (record.cancelled && (act === "invite" || act === "ask_panel")) return act === "invite" && sessions.has(String(fields.session)) ? undefined : { act: "decline", fields: act === "invite" ? { session: fields.session as number } : { slot: fields.slot as number } };
      if (record.cancelled && (act === "confirm" || act === "change")) return { act: "not_available", fields: { what: "acceptance" } };
      switch (act) {
        case "invite": {
          // A second invitation to a session it has answered changes nothing (FR-CONGRESS-09).
          if (sessions.has(String(fields.session))) return undefined;
          invitation = fields;
          record.invitation = JSON.stringify(fields);
          if (speaker.partner === true) return answering("accept");
          // A constraint is hard, whatever the condition (FR-CONGRESS-07).
          if (speaker.available !== true || breaksConstraint(fields.time)) return answering("decline");
          // Whether it would accept is drawn once, with the variant (FR-CONGRESS-11), or by itself when not given (FR-CONGRESS-09).
          wouldAccept ??= speaker.accepts ?? !(random.next() < 1 - (speaker.acceptance ?? 1));
          if (!wouldAccept) return answering("decline");
          if (speaker.condition !== undefined && !meetsCondition(fields)) return answering("accept_if", needs());
          return answering("accept");
        }
        case "accept_condition":
        case "decline_condition": {
          // The session it answered accept_if, the one named when the message names one, otherwise the latest.
          const pending = [...sessions.entries()].filter(([key, session]) => session.answer === "accept_if" && (fields.session === undefined || key === String(fields.session))).at(-1);
          if (pending === undefined) return { act: "not_available", fields: { what: act } };
          invitation = pending[1].offer;
          if (act === "decline_condition") return answering("decline");
          // The condition is checked on the invitation's offer as accept_condition updates it (FR-CONGRESS-09).
          const offer = { ...invitation, ...fields, session: invitation.session as number };
          if (!meetsCondition(offer)) return answering("accept_if", needs());
          invitation = offer;
          record.condition_met = true;
          return answering("accept");
        }
        case "confirm":
        case "change": {
          // Only a speaker who accepted takes a confirmation; the partner's accepted the session the board gave it (FR-CONGRESS-07).
          if (speaker.partner !== true && !anyAnswered("accept")) return { act: "not_available", fields: { what: "acceptance" } };
          if (fields.time !== undefined) record.believes_time = String(fields.time);
          if (fields.room !== undefined) record.believes_room = String(fields.room);
          const first = !acknowledged;
          acknowledged = true;
          return {
            act: "acknowledged",
            fields: {},
            then: function* () {
              if (!first || agreedFee <= 0) return;
              yield* party.call("commit", { with: speaker.organiser, amount: agreedFee, for: `fee ${speaker.id}` });
              committed = true;
            } as () => Script,
          };
        }
        case "withdraw_invitation": {
          const hadAccepted = anyAnswered("accept");
          record.broken_agreement = hadAccepted;
          record.answer = "withdrawn";
          for (const session of sessions.values()) session.answer = "withdrawn";
          return {
            act: "withdrawn",
            fields: {},
            then: function* () {
              if (!hadAccepted || !committed) return;
              yield* party.clock();
              yield* party.call("issue_invoice", { to: speaker.organiser, amount: agreedFee, due: `day ${today()}`, for: `claim ${speaker.id}` });
              record.claim = agreedFee;
            } as () => Script,
          };
        }
        case "ask_slides":
          return random.next() < 0.8 ? { act: "slides", fields: { title: speaker.title ?? speaker.id } } : undefined;
        case "ask_panel":
          return { act: speaker.available === true && random.next() < 0.6 ? "accept" : "decline", fields: { slot: fields.slot as number } };
        case "ask_promote":
          return { act: "promoting", fields: {} };
        default:
          return { act: "not_available", fields: { what: act } };
      }
    };

    /** Its call to the organiser with an act, then its mail if the call is not answered. */
    function* tell(act: string): Generator<RuleStep, void, Perceived> {
      if ((yield* party.call("call", { to: speaker.organiser, act })).outcome === "success") return;
      yield* party.write(speaker.organiser, act);
    }

    /** Its cancellation, when an illness reaches it: by mail, or for late_cancel by a call first, then by mail if the call is not answered. */
    function* cancel(channel: string): Generator<RuleStep, void, Perceived> {
      record.cancelled = true;
      if (channel === "late_cancel") yield* tell("cancel");
      else yield* party.write(speaker.organiser, "cancel", {});
      // Its fee is no longer owed (FR-CONGRESS-13).
      if (!committed) return;
      yield* party.release((what) => what === `fee ${speaker.id}`);
      committed = false;
    }

    function* script(): Script {
      yield* party.clock();
      for (;;) {
        const ill = party.stimuli.filter(({ channel }) => SPEAKER_PERTURBATIONS.includes(channel));
        // A published programme gives it its session, until a later confirmation or change says otherwise (FR-POPULATION-01).
        for (const { content } of party.stimuli.filter(({ channel }) => channel === PROGRAMME)) {
          const [, time, room] = /(\d\d:\d\d) in (\S+)\.$/.exec(content) ?? [];
          if (time !== undefined) Object.assign(record, { believes_time: time, believes_room: room });
        }
        // A hotel room lost the night before the event is urgent: it phones (FR-CONGRESS-05's addition).
        const roomless = party.stimuli.some(({ channel }) => channel === HOTEL_OVERBOOKS);
        party.stimuli.splice(0, party.stimuli.length, ...party.stimuli.filter((stimulus) => !ill.includes(stimulus) && stimulus.channel !== HOTEL_OVERBOOKS && stimulus.channel !== PROGRAMME));
        for (const { channel } of ill) yield* cancel(channel);
        if (roomless) yield* tell("no_room");
        yield* party.handle(answer, speaker.pick_up ?? 1, random);
        // A condition not met by day 19, or two world days after its conditional answer when later, makes it withdraw
        // (FR-CONGRESS-16).
        const waitingOn = [...sessions.entries()].filter(([, session]) => session.answer === "accept_if");
        const deadline = ([, session]: (typeof waitingOn)[number]) => Math.max(WITHDRAW_MINUTES, (session.conditionalAt ?? 0) + LATE_CONDITION_MINUTES);
        if (waitingOn.length > 0) yield* party.clock();
        const due = waitingOn.filter((entry) => deadline(entry) <= party.now).map(([key]) => key);
        if (due.length > 0) {
          // Only the invitations still waiting on its condition; those it accepted stay accepted (FR-CONGRESS-11).
          record.answer = "withdraw";
          for (const key of due) (sessions.get(key) as { answer: string }).answer = "withdraw";
          yield* party.write(speaker.organiser, "withdraw", { sessions: due.join(", "), condition: speaker.condition as string });
          continue;
        }
        if (party.stimuli.length > 0) continue;
        yield* party.rest(waitingOn.length > 0 ? Math.min(...waitingOn.map(deadline)) - party.now : undefined);
      }
    }

    return rulesOf(script(), () => ({ ...record }));
  },
};

/** The partner's rules (FR-CONGRESS-04): a speaker's, but it accepts any session it is given. */
export const partnerRules: RuleSet = {
  start: (given, random) => speakerRules.start({ ...given, partner: true }, random),
};

/** A caterer's parameters: its template and what the congress adds to it. */
interface CatererParams {
  id: string;
  price_per_head: number;
  /** Each diet it serves, with its limit when it has one; standard meals have none. */
  diets?: Record<string, { limit?: number }>;
  minimum?: number;
  final_days: number;
  deposit_share: number;
  deposit_due_days: number;
  cancellation: CancellationStep[];
  pick_up?: number;
  organiser: string;
  event_day: number;
  /** The venue whose in-house caterer it is, if one. */
  in_house_for?: string;
  /** Each chosen venue's catering rule, by its id (FR-CONGRESS-07). */
  venues?: Record<string, { catering?: string }>;
}

/** Counts by diet as a text gives them: "standard: 50; vegan: 6". */
function countsIn(text: unknown): Record<string, number> {
  return Object.fromEntries(
    String(text ?? "")
      .split(/;\s*/)
      .filter((each) => each !== "")
      .map((each) => {
        const [diet, count] = each.split(/:\s*/);
        return [diet, Number(count)];
      }),
  );
}

/** How many days before the event a caterer invoices the balance. */
const BALANCE_DAYS = 5;

/** The share of an ordered total that final numbers may add after their date, and the surcharge on what they add. */
const LATE_INCREASE = 0.05;
const LATE_SURCHARGE = 0.1;

/**
 * The caterer's rules (FR-CONGRESS-05): from its template, it quotes, takes an order within its diets' limits and its
 * minimum (committing its price and invoicing the deposit), takes final numbers by their date or a small increase after
 * it with a surcharge, cancels by its schedule, and invoices the balance five days before the event.
 */
export const catererRules: RuleSet = {
  start: (given, random) => {
    const caterer = given as unknown as CatererParams;
    const party = new Party(given);
    const record = { quotes: 0, order: "none", ordered: 0, final_numbers: "none", surcharges: 0, invoices_issued: 0, cancelled: false };
    const forOrder = `order ${caterer.id}`;
    const finalDay = caterer.event_day - caterer.final_days;
    const balanceAt = (caterer.event_day - BALANCE_DAYS - 1) * 1440;
    let order: { total: number; price: number; deposit: number; balanced: boolean; date: string; counts: string } | undefined;
    const today = () => Math.floor(party.now / 1440) + 1;
    const diets = caterer.diets ?? {};
    const dietsText = () => Object.entries(diets).map(([diet, { limit }]) => `${diet}: ${limit ?? "no limit"}`).join("; ");
    const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, count) => sum + count, 0);
    /** A diet it does not serve, or over its limit, if any. */
    const overLimit = (counts: Record<string, number>) => Object.entries(counts).find(([diet, count]) => diet !== "standard" && (!Object.hasOwn(diets, diet) || count > (diets[diet].limit ?? Infinity)))?.[0];

    /** Its commitments for the order, released, and the order's new price committed. */
    function* recommit(price: number): Generator<RuleStep, void, Perceived> {
      yield* party.release((what) => what === forOrder);
      if (price > 0) yield* party.call("commit", { with: caterer.organiser, amount: price, for: forOrder });
    }

    function* invoice(amount: number, due: string, what: string): Generator<RuleStep, void, Perceived> {
      yield* party.call("issue_invoice", { to: caterer.organiser, amount, due, for: `${what} ${forOrder}` });
      record.invoices_issued += 1;
    }

    /** The permits it read, by their ids: the diet and the attendance each carries, when it carries them (FR-CONGRESS-17). */
    const permits = new Map<string, { diet?: string; attendance?: number }>();

    /** Reads the permit an order gives with read_permit; one it cannot read carries nothing. */
    function* readPermit({ act, fields }: Received): Generator<RuleStep, void, Perceived> {
      if (act !== "order" || fields.permit === undefined) return;
      const text = (yield* party.call("read_permit", { permit: String(fields.permit) })).text;
      let read: { diet?: unknown; attendance?: unknown } = {};
      try {
        read = JSON.parse(text) as typeof read;
      } catch {
        // No such permit: it carries no diet.
      }
      permits.set(String(fields.permit), typeof read.diet === "string" ? { diet: read.diet, attendance: Number(read.attendance) } : {});
    }

    /** Whether counts exceed a permit for outside diet meals: meals of another kind, or more than its attendance (FR-CONGRESS-17). */
    const exceeds = (counts: Record<string, number>, { diet, attendance }: { diet?: string; attendance?: number }) =>
      diet !== undefined && (Object.entries(counts).some(([kind, count]) => kind !== diet && count > 0) || total(counts) > (attendance ?? 0));

    /** Why an order or final numbers below its minimum are refused (FR-CONGRESS-11). */
    const belowMinimum = (): Fields => ({ reason: "below_minimum", minimum: caterer.minimum as number });

    const answer = ({ act, fields }: Received): Answer => {
      switch (act) {
        case "ask_quote":
          record.quotes += 1;
          return {
            act: "quote",
            fields: {
              price_per_head: caterer.price_per_head,
              diets: dietsText(),
              minimum: caterer.minimum ?? 0,
              final_numbers_by: `day ${finalDay}`,
              deposit_share: caterer.deposit_share,
              deposit_due_days: caterer.deposit_due_days,
              cancellation: scheduleText(caterer.cancellation),
            },
          };
        case "order": {
          // A customer that holds an order for the date changes it by final numbers or cancels it (FR-CONGRESS-13).
          if (order !== undefined && order.date === String(fields.date)) return { act: "order_refused", fields: { reason: "order_held", counts: order.counts } };
          // An in-house caterer serves only its venue (FR-CONGRESS-17).
          if (caterer.in_house_for !== undefined && fields.venue !== undefined && fields.venue !== caterer.in_house_for) return { act: "order_refused", fields: { reason: "own_venue_only", venue: caterer.in_house_for } };
          // A venue that keeps its catering or charges for outside catering asks for a permit, unless it is the venue's own (FR-CONGRESS-07).
          const rule = caterer.venues?.[String(fields.venue)]?.catering;
          if (fields.venue !== undefined && (rule === "in_house" || rule === "outside_fee") && caterer.in_house_for !== fields.venue && fields.permit === undefined) {
            return { act: "order_refused", fields: { reason: "venue_requires_permit" } };
          }
          const counts = countsIn(fields.counts);
          if (fields.permit !== undefined && exceeds(counts, permits.get(String(fields.permit)) ?? {})) return { act: "order_refused", fields: { reason: "permit_exceeded" } };
          const over = overLimit(counts);
          if (over !== undefined) return { act: "order_refused", fields: { diet: over } };
          if (total(counts) < (caterer.minimum ?? 0)) return { act: "order_refused", fields: belowMinimum() };
          const price = total(counts) * caterer.price_per_head;
          order = { total: total(counts), price, deposit: Math.round(price * caterer.deposit_share), balanced: false, date: String(fields.date), counts: String(fields.counts) };
          record.order = String(fields.counts);
          record.ordered = order.total;
          const placed = order;
          return {
            act: "order_confirmed",
            fields: { total: placed.total, price },
            then: function* () {
              yield* party.call("commit", { with: caterer.organiser, amount: price, for: forOrder });
              yield* invoice(placed.deposit, `day ${today() + caterer.deposit_due_days}`, "deposit");
            } as () => Script,
          };
        }
        case "final_numbers": {
          const counts = countsIn(fields.counts);
          const over = overLimit(counts);
          if (order === undefined) return { act: "not_available", fields: { what: "order" } };
          if (over !== undefined) return { act: "numbers_refused", fields: { diet: over } };
          const asked = total(counts);
          if (asked < (caterer.minimum ?? 0)) return { act: "numbers_refused", fields: belowMinimum() };
          const increase = asked - order.total;
          const late = today() >= finalDay;
          if (late && !(increase >= 0 && increase <= order.total * LATE_INCREASE)) return { act: "numbers_refused", fields: { total: asked } };
          const surcharge = late ? Math.round(increase * caterer.price_per_head * LATE_SURCHARGE) : 0;
          const price = asked * caterer.price_per_head + surcharge;
          order.price = price;
          order.counts = String(fields.counts);
          record.final_numbers = String(fields.counts);
          record.surcharges += surcharge;
          return { act: "numbers_accepted", fields: { total: asked, price }, then: () => recommit(price) as Script };
        }
        case "cancel_order": {
          if (order === undefined) return { act: "not_available", fields: { what: "order" } };
          const charge = Math.round(order.price * shareCharged(caterer.cancellation, caterer.event_day - today()));
          order = undefined;
          record.cancelled = true;
          return {
            act: "cancelled",
            fields: { charge },
            then: function* () {
              yield* recommit(0);
              yield* party.voidInvoices((what) => what.endsWith(forOrder));
              // A charge is committed as it is invoiced (FR-CONGRESS-05's addition).
              if (charge > 0) yield* party.call("commit", { with: caterer.organiser, amount: charge, for: `cancellation ${forOrder}` });
              if (charge > 0) yield* invoice(charge, `day ${today()}`, "cancellation");
            } as () => Script,
          };
        }
        default:
          return { act: "not_available", fields: { what: act } };
      }
    };

    function* script(): Script {
      yield* party.clock();
      for (;;) {
        if (party.stimuli.length > 0) yield* party.clock();
        yield* party.handle(answer, caterer.pick_up ?? 1, random, undefined, readPermit);
        yield* party.clock();
        if (order !== undefined && !order.balanced && party.now >= balanceAt) {
          order.balanced = true;
          yield* invoice(order.price - order.deposit, `day ${caterer.event_day}`, "balance");
        }
        if (party.stimuli.length > 0) continue;
        yield* party.rest(order !== undefined && !order.balanced ? balanceAt - party.now : undefined);
      }
    }

    return rulesOf(script(), () => ({ ...record }));
  },
};

/** The interpreter agency's parameters: its template and what the congress adds to it. */
interface AgencyParams {
  id: string;
  price: number;
  notice_days: number;
  pick_up?: number;
  organiser: string;
}

/**
 * The interpreter agency's rules (FR-CONGRESS-05): it quotes its price and notice, books a date at least its notice
 * away with a commitment of its price, and cancels a booking, releasing it.
 */
export const agencyRules: RuleSet = {
  start: (given, random) => {
    const agency = given as unknown as AgencyParams;
    const party = new Party(given);
    const record = { booked: "none", cancelled: false };
    const forBooking = `interpreting ${agency.id}`;
    const today = () => Math.floor(party.now / 1440) + 1;
    const answer = ({ act, fields }: Received): Answer => {
      const date = String(fields.date ?? "");
      switch (act) {
        case "ask_quote":
          return { act: "quote", fields: { price: agency.price, notice_days: agency.notice_days } };
        case "book": {
          const day = Number(/^day (\d+)$/.exec(date)?.[1]);
          if (!(day - today() >= agency.notice_days)) return { act: "unavailable", fields: { date } };
          record.booked = date;
          return { act: "booked", fields: { date, price: agency.price }, then: function* () { yield* party.call("commit", { with: agency.organiser, amount: agency.price, for: forBooking }); } as () => Script };
        }
        case "cancel": {
          if (record.booked === "none") return { act: "not_available", fields: { what: "booking" } };
          const booked = record.booked;
          record.booked = "none";
          record.cancelled = true;
          return {
            act: "cancelled",
            fields: { date: booked },
            then: () => party.release((what) => what === forBooking) as Script,
          };
        }
        default:
          return { act: "not_available", fields: { what: act } };
      }
    };
    function* script(): Script {
      for (;;) {
        yield* party.clock();
        yield* party.handle(answer, agency.pick_up ?? 1, random);
        if (party.stimuli.length === 0) yield* party.rest(undefined);
      }
    }
    return rulesOf(script(), () => ({ ...record }));
  },
};

/** The conditions a sponsor may set. */
export const SPONSOR_CONDITIONS = ["logo", "morning_slot", "table", "attendee_list", "passes", "consented_list"] as const;

/** The days a sponsor reads the programme on (FR-POPULATION-01). */
const PROGRAMME_CHECK_DAYS = [19, 25];

/** The perturbation that makes a sponsor withdraw, reaching it on a channel of its own name. */
export const SPONSOR_PERTURBATION = "sponsor_withdraws";

/** A sponsor's parameters: its template and what the congress adds to it. */
interface SponsorParams {
  id: string;
  amount: number;
  conditions: string[];
  insists?: string[];
  counter_acceptance?: number;
  pay_days: [number, number];
  pick_up?: number;
  organiser: string;
}

/** A list as a field gives it: "logo, morning_slot". */
const listIn = (text: unknown) =>
  String(text ?? "")
    .split(/,\s*/)
    .filter((each) => each !== "");

/**
 * The sponsor's rules (FR-CONGRESS-05): from its template and its own sequence, it states its conditions, agrees to its
 * own, refuses a counter that drops what it insists on and takes one that keeps it with its counter_acceptance, or
 * withdraws; it acknowledges a list and evidence, and withdraws when its perturbation reaches it.
 */
export const sponsorRules: RuleSet = {
  start: (given, random) => {
    const sponsor = given as unknown as SponsorParams;
    const party = new Party(given);
    const record = { conditions: sponsor.conditions.join(", "), agreement: "none", paid: 0, withdrew: false };
    const agreed = (conditions: string[]): Answer => {
      record.agreement = conditions.join(", ");
      return { act: "agreement", fields: { amount: sponsor.amount, conditions: record.agreement } };
    };
    const withdrawing = (): Answer => {
      record.withdrew = true;
      record.agreement = "none";
      // It drops the payments it had pending, and rests until a message or a call reaches it (FR-CONGRESS-15).
      payments.length = 0;
      return { act: "withdraw", fields: {} };
    };
    const counter = (conditions: string[]): Answer => {
      const missing = (sponsor.insists ?? []).filter((condition) => !conditions.includes(condition));
      if (missing.length > 0) return { act: "refused", fields: { missing: missing.join(", ") } };
      return random.next() < (sponsor.counter_acceptance ?? 0) ? agreed(conditions) : withdrawing();
    };
    /** Whether it has agreed, and the organiser's act is one that its agreement answers (FR-CONGRESS-16). */
    const keepsAgreement = ({ act }: Received) => record.agreement !== "none" && !record.withdrew && (act === "accept_sponsorship" || act === "counter");
    const answer = (received: Received): Answer => {
      const { act, fields } = received;
      if (record.withdrew) return { act: "not_available", fields: { what: act } };
      // Once agreed, a repeat of its terms or a counter is answered with the agreement in force, drawing nothing (FR-CONGRESS-16).
      if (keepsAgreement(received)) return { act: "agreement", fields: { amount: sponsor.amount, conditions: record.agreement } };
      switch (act) {
        case "ask_conditions":
          return { act: "conditions", fields: { amount: sponsor.amount, conditions: record.conditions, pay_days: `${sponsor.pay_days[0]} to ${sponsor.pay_days[1]}` } };
        case "accept_sponsorship": {
          const conditions = listIn(fields.conditions);
          const own = conditions.length === sponsor.conditions.length && sponsor.conditions.every((condition) => conditions.includes(condition));
          return own ? agreed(conditions) : counter(conditions);
        }
        case "counter":
          return counter(listIn(fields.conditions));
        case "send_attendee_list":
          return { act: "received", fields: {} };
        case "send_evidence":
          return { act: "acknowledged", fields: {} };
        default:
          return { act: "not_available", fields: { what: act } };
      }
    };
    /** When it reads the programme: the starts of days 19 and 25, in world minutes. */
    const checks = PROGRAMME_CHECK_DAYS.map((day) => (day - 1) * 1440);

    /** The logo and morning slot it agreed to that the latest programme, which it reads, does not give. */
    function* missingFromProgramme(): Generator<RuleStep, string[], Perceived> {
      const read = (yield* party.call("read_programme")).text;
      const programme = (read.startsWith("{") ? JSON.parse(read) : { logos: [], sponsor_slots: [] }) as { logos?: string[]; sponsor_slots?: { sponsor: string; start: string }[] };
      const agreed = listIn(record.agreement);
      return [
        ...(agreed.includes("logo") && !(programme.logos ?? []).includes(sponsor.id) ? ["logo"] : []),
        ...(agreed.includes("morning_slot") && !(programme.sponsor_slots ?? []).some(({ sponsor: slot, start }) => slot === sponsor.id && start < "12:00") ? ["morning_slot"] : []),
      ];
    }

    /** Reads the programme, and mails condition_missing for each logo or morning slot it agreed to that is not there. */
    function* checkProgramme(): Generator<RuleStep, void, Perceived> {
      for (const condition of yield* missingFromProgramme()) yield* party.write(sponsor.organiser, "condition_missing", { condition });
    }

    /**
     * Whether its agreed conditions stand as it pays (FR-CONGRESS-09): the programme's are due from day 19, when it
     * first reads the programme, and must then be in the latest one.
     */
    function* conditionsStand(): Generator<RuleStep, boolean, Perceived> {
      if (party.now < (PROGRAMME_CHECK_DAYS[0] - 1) * 1440) return true;
      return (yield* missingFromProgramme()).length === 0;
    }

    /** The payments it has set, each an invoice and when it pays it, in world minutes. */
    const payments: { invoice: string; amount: number; at: number }[] = [];
    const settled = new Set<string>();

    /** Reads its ledger and sets a payment, pay_days after now, for each unpaid invoice from the organiser within what is left of its amount. */
    function* readInvoices(): Generator<RuleStep, void, Perceived> {
      const ledger = yield* party.ledger();
      yield* party.clock();
      for (const invoice of (ledger.invoices_to_pay ?? []) as { id: string; from: string; amount: number; paid: boolean; issued?: string }[]) {
        const left = sponsor.amount - record.paid - payments.reduce((sum, { amount }) => sum + amount, 0);
        if (invoice.paid || invoice.from !== sponsor.organiser || settled.has(invoice.id)) continue;
        // An invoice above what it agreed is disputed, not paid (FR-CONGRESS-05's addition).
        if (invoice.amount > left) {
          settled.add(invoice.id);
          yield* party.write(sponsor.organiser, "invoice_disputed", { invoice: invoice.id, amount: sponsor.amount });
          continue;
        }
        const [fewest, most] = sponsor.pay_days;
        settled.add(invoice.id);
        // pay_days after the invoice was issued, at the first moment within its hours (FR-CONGRESS-09).
        const issued = perturbationMinutes(invoice.issued) ?? party.now;
        payments.push({ invoice: invoice.id, amount: invoice.amount, at: party.withinHours(issued + (fewest + random.next() * (most - fewest)) * 1440) });
      }
    }

    function* script(): Script {
      for (;;) {
        if (party.stimuli.some(({ channel }) => channel === SPONSOR_PERTURBATION) && !record.withdrew) {
          const withdrawn = withdrawing();
          yield* party.write(sponsor.organiser, withdrawn.act, withdrawn.fields);
        }
        // An invoice that reaches it after an agreement is paid; a withdrawn sponsor pays nothing more.
        const noticed = party.stimuli.some(({ channel }) => channel === INVOICE_NOTICE);
        party.stimuli.splice(0, party.stimuli.length, ...party.stimuli.filter(({ channel }) => channel !== SPONSOR_PERTURBATION && channel !== INVOICE_NOTICE));
        if (noticed && record.agreement !== "none") yield* readInvoices();
        yield* party.handle(answer, sponsor.pick_up ?? 1, random, keepsAgreement);
        const checking = record.agreement !== "none" && !record.withdrew && checks.length > 0;
        if (payments.length > 0 || checking) yield* party.clock();
        // On days 19 and 25 it reads the programme for the logo and slot it agreed to (FR-POPULATION-01).
        while (checking && checks.length > 0 && checks[0] <= party.now) {
          checks.shift();
          yield* checkProgramme();
        }
        payments.sort((one, other) => one.at - other.at);
        while (payments.length > 0 && payments[0].at <= party.now && !record.withdrew) {
          const due = payments.shift() as { invoice: string; amount: number; at: number };
          // A payment whose conditions do not stand waits a day, and is paid once they do (FR-CONGRESS-09).
          if (!(yield* conditionsStand())) {
            payments.push({ ...due, at: party.withinHours(party.now + 1440) });
            break;
          }
          if ((yield* party.call("pay", { invoice: due.invoice })).outcome === "success") record.paid += due.amount;
        }
        if (party.stimuli.length > 0) continue;
        const next = Math.min(...payments.map(({ at }) => at), ...(record.agreement !== "none" && !record.withdrew ? checks : []));
        yield* party.rest(next === Infinity ? undefined : next - party.now);
      }
    }
    return rulesOf(script(), () => ({ ...record }));
  },
};
