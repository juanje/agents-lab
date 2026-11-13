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

/** A field's text as a value: a number, a truth value, or the text. */
function valueOf(text: string): string | number | boolean {
  if (text === "true" || text === "false") return text === "true";
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
}

/** The fields of a text written as "<name>: <value>." one after another. */
function fieldsIn(text: string): Fields {
  const fields: Fields = {};
  for (const [, name, value] of text.matchAll(/(\w+): (.*?)\.(?= \w+: | ?$)/g)) fields[name] = valueOf(value);
  return fields;
}

/** A message as read_mail gives it: "From: <sender>. Act: <act>.", then its fields. */
function readMessage(text: string): Received | undefined {
  const [, from, act, rest = ""] = /^From: (.+?)\. Act: (\w+)\.\s*(.*)$/.exec(text) ?? [];
  return from === undefined ? undefined : { from, act, fields: fieldsIn(rest) };
}

/** A ring as the congress's ring text gives it: "<caller> calls (<call>): <act>. <fields>". */
function readRing(text: string): (Received & { call: string }) | undefined {
  const [, from, call, act, rest = ""] = /^(\S+) calls \((c-\d+)\): (\w+)\.\s*(.*)$/.exec(text) ?? [];
  return from === undefined ? undefined : { from, call, act, fields: fieldsIn(rest.trim()) };
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

/** What any party's script does: its calls, its waits, its clock, its mail and its rings, from what it perceives only. */
class Party {
  /** The stimuli that reached it and wait to be handled. */
  readonly stimuli: Stimulus[] = [];
  now = 0;
  weekdayOfDayOne = 0;

  /** A call of one of its tools; it gives the call's result and keeps any stimulus that came meanwhile. */
  *call(tool: string, args: Record<string, unknown> = {}): Generator<RuleStep, { outcome: string; text: string }, Perceived> {
    const perceived = yield { kind: "call", tool, arguments: args };
    this.stimuli.push(...perceived.stimuli);
    return perceived.result ?? { outcome: "none", text: "" };
  }

  /** A wait, or the end when there is nothing to wait for; it keeps the stimuli that wake it. */
  *rest(minutes: number | undefined): Generator<RuleStep, void, Perceived> {
    const perceived = yield minutes === undefined ? { kind: "end" } : { kind: "wait", minutes };
    this.stimuli.push(...perceived.stimuli);
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
      const message = readMessage((yield* this.call("read_mail", { id })).text);
      if (message !== undefined) read.push(message);
    }
    return read;
  }

  /** Its ledger, as JSON. */
  *ledger(): Generator<RuleStep, Record<string, unknown>, Perceived> {
    return JSON.parse((yield* this.call("ledger")).text) as Record<string, unknown>;
  }

  /**
   * Handles what has reached it: a ring it picks up, with the probability given, is answered by answer_call; its unread
   * mail is answered by mail. Each answer is made, then what it does once it has answered.
   */
  *handle(answer: (received: Received) => Answer, pickUp: number, random: Random): Generator<RuleStep, void, Perceived> {
    let mail = false;
    while (this.stimuli.length > 0) {
      const stimulus = this.stimuli.shift() as Stimulus;
      if (stimulus.channel === "mail_notice") mail = true;
      if (stimulus.channel !== "phone") continue;
      const ring = readRing(stimulus.content);
      if (ring === undefined || !(random.next() < pickUp)) continue;
      const given = answer(ring);
      yield* this.call("answer_call", { call: ring.call, act: given.act, fields: given.fields });
      if (given.then !== undefined) yield* given.then();
    }
    if (!mail) return;
    for (const message of yield* this.mail()) {
      const given = answer(message);
      yield* this.call("send_mail", { to: message.from, act: given.act, fields: given.fields });
      if (given.then !== undefined) yield* given.then();
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
  catering?: string;
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

/** A contract a venue offered: its id, date, rooms, hours, price, extras, and whether it is confirmed. */
interface Contract {
  id: string;
  to: string;
  date: string;
  rooms: string[];
  hours: string;
  price: number;
  extras: Record<string, number>;
  confirmed: boolean;
  /** A change the venue announced and awaits an answer on. */
  change?: { kind: "price_change"; price: number } | { kind: "room_lost"; room: string; smaller?: string; price?: number };
}

/** Something a venue does at a world time of its own. */
interface Timer {
  at: number;
  kind: "lapse" | "challenge_lapse" | "reminder" | "unpaid_cancel" | "enquiry" | "change" | "room_allocation";
  date?: string;
  contract?: string;
  perturbation?: string;
}

/**
 * The venue's rules (FR-CONGRESS-02): from its template, it answers quotes, documents, holds, bookings, contracts, extras,
 * cancellations and changes; its own cycle brings other customers' enquiries, lapsed holds, deposit reminders and
 * cancellations, and the perturbations the configuration declares. It learns the time, its mail and its ledger only
 * through its own tools.
 */
export const venueRules: RuleSet = {
  start: (given, random) => {
    const venue = given as unknown as VenueParams;
    const party = new Party();
    const dates = new Map<string, string>((venue.booked_by_others ?? []).map((date) => [date, "other"]));
    const contracts: Contract[] = [];
    const timers: Timer[] = [];
    const history: Record<string, string | number>[] = [];
    const counts = { holds: 0, contracts: 0, confirmations: 0, cancellations: 0, invoices_issued: 0, lost_to_others: 0 };
    const eventDate = `day ${venue.event_day}`;
    const record = (event: string, fields: Record<string, string | number> = {}) => history.push({ at: party.text(), event, ...fields });
    const statusOf = (date: string) => dates.get(date) ?? "free";
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
    function* releaseAll(contract: Contract): Generator<RuleStep, void, Perceived> {
      const ledger = yield* party.ledger();
      for (const recorded of (ledger.commitments_recorded ?? []) as { id: string; for: string }[]) {
        if (recorded.for.startsWith(contract.id)) yield* party.call("release", { commitment: recorded.id });
      }
    }
    const notAvailable = (what: unknown): Answer => ({ act: "not_available", fields: { what: String(what) } });
    const unavailable = (date: string): Answer => ({ act: "unavailable", fields: { date } });
    const free = (date: string) => statusOf(date) === "free" || statusOf(date) === "held";

    const answer = ({ from, act, fields }: Received): Answer => {
      const date = String(fields.date ?? eventDate);
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
          if (contract === undefined || contract.confirmed || contract.to !== from) return notAvailable(fields.contract);
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
          const price = venue.extras?.[String(fields.item)];
          return price === undefined ? notAvailable(fields.item) : { act: "extra_quote", fields: { item: String(fields.item), price } };
        }
        case "accept_extra": {
          const item = String(fields.item);
          const price = venue.extras?.[item];
          const contract = live();
          if (price === undefined || contract === undefined) return notAvailable(price === undefined ? item : "contract");
          contract.extras[item] = price;
          record("extra", { contract: contract.id, item });
          return { act: "extra_confirmed", fields: { item, price }, then: function* () { yield* party.call("commit", { with: from, amount: price, for: `${contract.id} extra ${item}` }); } as () => Script };
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
          contract.change = undefined;
          if (act === "decline_change") return cancelling(contract, 0);
          const newPrice = change.kind === "price_change" ? change.price : (change.price ?? contract.price);
          if (change.kind === "room_lost") contract.rooms = contract.rooms.flatMap((room) => (room !== change.room ? [room] : change.smaller === undefined ? [] : [change.smaller]));
          const difference = newPrice - contract.price;
          contract.price = newPrice;
          record("change_accepted", { contract: contract.id, price: newPrice });
          return {
            act: "confirmed",
            fields: { contract: contract.id, price: newPrice, rooms: contract.rooms.join(", ") },
            then: function* () {
              if (difference > 0) yield* party.call("commit", { with: from, amount: difference, for: `${contract.id} change` });
              if (difference < 0) {
                yield* releaseAll(contract);
                yield* party.call("commit", { with: from, amount: contract.price, for: contract.id });
              }
            } as () => Script,
          };
        }
        default:
          return notAvailable(act);
      }
    };

    /** A cancellation with its charge: it releases the contract's commitments and invoices the charge when above 0. */
    function cancelling(contract: Contract, charge: number): Answer {
      dates.set(contract.date, "free");
      contract.confirmed = false;
      counts.cancellations += 1;
      record("cancelled", { contract: contract.id, charge });
      return {
        act: "cancelled",
        fields: { contract: contract.id, charge },
        then: function* () {
          yield* releaseAll(contract);
          if (charge > 0) {
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

    /** What the venue does when one of its timers comes. */
    function* fire(timer: Timer): Generator<RuleStep, void, Perceived> {
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
            timers.push({ at: confirmBy, kind: "challenge_lapse", date: eventDate });
            yield* party.call("send_mail", { to: venue.organiser, act: "hold_challenged", fields: { date: eventDate, confirm_by: party.text(confirmBy) } });
          }
          scheduleEnquiry();
          return;
        }
        case "reminder":
          if (contract === undefined || statusOf(contract.date) !== "confirmed" || (yield* depositPaid(contract))) return;
          yield* party.call("send_mail", { to: contract.to, act: "reminder", fields: { contract: contract.id } });
          record("reminder", { contract: contract.id });
          timers.push({ at: party.now + 2 * 1440, kind: "unpaid_cancel", contract: contract.id });
          return;
        case "unpaid_cancel": {
          if (contract === undefined || statusOf(contract.date) !== "confirmed" || (yield* depositPaid(contract))) return;
          const cancelled = cancelling(contract, 0);
          yield* party.call("send_mail", { to: contract.to, act: cancelled.act, fields: cancelled.fields });
          yield* (cancelled.then as () => Script)();
          return;
        }
        case "change": {
          const booked = contracts.find((each) => ["contracted", "confirmed"].includes(statusOf(each.date)));
          if (booked === undefined) return;
          const declared = venue.perturbations.find(({ name }) => name === timer.perturbation);
          const kind = declared?.kind ?? (random.next() < 0.5 ? "room_lost" : "price_change");
          if (kind === "price_change") {
            const price = Math.round(booked.price * (1.15 + 0.1 * random.next()));
            booked.change = { kind, price };
            record("price_change", { contract: booked.id, price });
            yield* party.call("send_mail", { to: booked.to, act: "price_change", fields: { contract: booked.id, old_price: booked.price, price } });
            return;
          }
          const lost = booked.rooms.at(-1) as string;
          const seats = venue.rooms.find(({ id }) => id === lost)?.seats ?? 0;
          const smaller = venue.rooms.filter(({ id, seats: other }) => other < seats && !booked.rooms.includes(id)).sort((one, other) => other.seats - one.seats)[0];
          booked.change = smaller === undefined ? { kind: "room_lost", room: lost, price: Math.round(booked.price * 0.9) } : { kind: "room_lost", room: lost, smaller: smaller.id };
          record("room_lost", { contract: booked.id, room: lost });
          const offer = smaller === undefined ? { offer: "price_cut", price: booked.change.price as number } : { offer: "smaller_room", smaller: smaller.id };
          yield* party.call("send_mail", { to: booked.to, act: "room_lost", fields: { contract: booked.id, room: lost, ...offer } });
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
          record("rooms_allocated", { contract: booked.id });
          yield* party.call("send_mail", { to: booked.to, act: "rooms_allocated", fields: { contract: booked.id, allocation: allocation.map(([from, to]) => `${from} -> ${to}`).join("; ") } });
          return;
        }
      }
    }

    /** The next other customer's enquiry, after an interval drawn from its sequence at enquiries_per_day. */
    function scheduleEnquiry(): void {
      const rate = venue.enquiries_per_day ?? 0;
      if (rate > 0) after((-Math.log(1 - random.next()) / rate) * 1440, { kind: "enquiry" });
    }

    function* script(): Script {
      yield* party.clock();
      scheduleEnquiry();
      for (const declared of venue.perturbations) {
        if (declared.at !== undefined) timers.push({ at: perturbationMinutes(declared.at) as number, kind: declared.name === "room_allocation" ? "room_allocation" : "change", perturbation: declared.name });
        if (declared.between !== undefined) {
          const [from, to] = declared.between.map((time) => perturbationMinutes(time) as number);
          timers.push({ at: from + random.next() * (to - from), kind: declared.name === "room_allocation" ? "room_allocation" : "change", perturbation: declared.name });
        }
      }
      for (;;) {
        yield* party.handle(answer, venue.pick_up ?? 1, random);
        yield* party.clock();
        timers.sort((one, other) => one.at - other.at);
        while (timers.length > 0 && timers[0].at <= party.now) yield* fire(timers.shift() as Timer);
        if (party.stimuli.length > 0) continue;
        yield* party.rest(timers.length === 0 ? undefined : timers[0].at - party.now);
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
 * transferring the funds asked, or counters it; it approves an extra amount within its reserve, or refuses it.
 */
export const boardRules: RuleSet = {
  start: (given, random) => {
    const board = given as unknown as BoardParams;
    const party = new Party();
    const counts = { approvals: 0, refusals: 0, funds_transferred: 0, reserve_used: 0 };
    const ceilings = new Map<string, number>();
    const answer = ({ from, act, fields }: Received): Answer => {
      if (act === "submit_budget") {
        const left = board.funds - counts.funds_transferred;
        const asked = Number(fields.funds_requested);
        if (!(asked <= left)) return { act: "budget_countered", fields: { funds: left } };
        const ceiling = Number(fields.costs) + Number(fields.contingency);
        ceilings.set(from, ceiling);
        counts.approvals += 1;
        counts.funds_transferred += asked;
        return {
          act: "budget_approved",
          fields: { ceiling, funds: asked },
          then: function* () {
            yield* party.call("approve", { account: from, ceiling });
            yield* party.call("transfer", { to: from, amount: asked, for: "budget" });
          } as () => Script,
        };
      }
      if (act === "request_approval") {
        const amount = Number(fields.amount);
        if (!(amount <= (board.reserve ?? 0) - counts.reserve_used)) {
          counts.refusals += 1;
          return { act: "refused", fields: { amount } };
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
