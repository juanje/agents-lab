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
   * mail is answered by mail. Each answer is made, then what it does once it has answered; no answer, nothing is sent.
   */
  *handle(answer: (received: Received) => Answer | undefined, pickUp: number, random: Random): Generator<RuleStep, void, Perceived> {
    let mail = false;
    while (this.stimuli.length > 0) {
      const stimulus = this.stimuli.shift() as Stimulus;
      if (stimulus.channel === "mail_notice") mail = true;
      if (stimulus.channel !== "phone") continue;
      const ring = readRing(stimulus.content);
      if (ring === undefined || !(random.next() < pickUp)) continue;
      const given = answer(ring);
      if (given === undefined) continue;
      yield* this.call("answer_call", { call: ring.call, act: given.act, fields: given.fields });
      if (given.then !== undefined) yield* given.then();
    }
    if (!mail) return;
    for (const message of yield* this.mail()) {
      const given = answer(message);
      if (given === undefined) continue;
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
            // A challenged hold ends when the organiser must confirm by, in place of its own end.
            timers.splice(0, timers.length, ...timers.filter(({ kind, date }) => !(kind === "lapse" && date === eventDate)));
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
        // What reaches it is answered at the time it is answered.
        if (party.stimuli.length > 0) yield* party.clock();
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

/** When a speaker whose condition is not met withdraws: day 19's start, in world minutes since day 1's midnight. */
const WITHDRAW_MINUTES = 18 * 1440;

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
    const party = new Party();
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
    /** The fee it agreed to, and whether it has committed it. */
    let agreedFee = 0;
    let committed = false;
    let acknowledged = false;
    const today = () => Math.floor(party.now / 1440) + 1;

    /** Whether a session at this time breaks its constraint. */
    const breaksConstraint = (time: unknown) => (speaker.constraint === "morning" && !inMorning(time)) || (speaker.constraint === "afternoon" && inMorning(time));

    /** Whether an invitation meets its condition. */
    const meetsCondition = (fields: Fields) => {
      if (breaksConstraint(fields.time)) return false;
      if (speaker.condition === "fee") return Number(fields.fee ?? 0) >= fee;
      if (speaker.condition === "travel_paid") return speaker.home === "local" || fields.travel_paid === true;
      if (speaker.condition === "morning_slot") return inMorning(fields.time);
      return true;
    };

    /** Its answer to an invitation, or to its condition's answer, as it records it. */
    const answering = (act: string, fields: Fields = {}): Answer => {
      record.answer = act;
      if (act === "accept") agreedFee = Number(invitation.fee ?? 0) > 0 ? Number(invitation.fee) : 0;
      return { act, fields: { session: invitation.session as number, ...fields } };
    };

    const answer = ({ act, fields }: Received): Answer | undefined => {
      if (speaker.partner === true && !PARTNER_ACTS.includes(act)) return { act: "not_available", fields: { what: act } };
      switch (act) {
        case "invite": {
          invitation = fields;
          record.invitation = JSON.stringify(fields);
          if (speaker.partner === true) return answering("accept");
          if (speaker.available !== true || (breaksConstraint(fields.time) && speaker.condition === undefined)) return answering("decline");
          if (random.next() < 1 - (speaker.acceptance ?? 1)) return answering("decline");
          if (speaker.condition !== undefined && !meetsCondition(fields)) return answering("accept_if", { condition: speaker.condition });
          return answering("accept");
        }
        case "accept_condition":
        case "decline_condition": {
          if (record.answer !== "accept_if") return { act: "not_available", fields: { what: act } };
          if (act === "decline_condition") return answering("decline");
          record.condition_met = true;
          const answered = answering("accept");
          if (speaker.condition === "fee") agreedFee = fee;
          return answered;
        }
        case "confirm":
        case "change": {
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
          const hadAccepted = record.answer === "accept";
          record.broken_agreement = hadAccepted;
          record.answer = "withdrawn";
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

    /** Its cancellation, when an illness reaches it: by mail, or for late_cancel by a call first, then by mail if the call is not answered. */
    function* cancel(channel: string): Generator<RuleStep, void, Perceived> {
      record.cancelled = true;
      if (channel === "late_cancel" && (yield* party.call("call", { to: speaker.organiser, act: "cancel" })).outcome === "success") return;
      yield* party.call("send_mail", { to: speaker.organiser, act: "cancel", fields: {} });
    }

    function* script(): Script {
      yield* party.clock();
      for (;;) {
        const ill = party.stimuli.filter(({ channel }) => SPEAKER_PERTURBATIONS.includes(channel));
        party.stimuli.splice(0, party.stimuli.length, ...party.stimuli.filter((stimulus) => !ill.includes(stimulus)));
        for (const { channel } of ill) yield* cancel(channel);
        yield* party.handle(answer, speaker.pick_up ?? 1, random);
        // A condition not met by day 19 makes it withdraw.
        const pending = record.answer === "accept_if";
        if (pending) yield* party.clock();
        if (pending && party.now >= WITHDRAW_MINUTES) {
          record.answer = "withdraw";
          yield* party.call("send_mail", { to: speaker.organiser, act: "withdraw", fields: { session: invitation.session as number, condition: speaker.condition as string } });
          continue;
        }
        if (party.stimuli.length > 0) continue;
        yield* party.rest(pending ? WITHDRAW_MINUTES - party.now : undefined);
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
    const party = new Party();
    const record = { quotes: 0, order: "none", ordered: 0, final_numbers: "none", surcharges: 0, invoices_issued: 0, cancelled: false };
    const forOrder = `order ${caterer.id}`;
    const finalDay = caterer.event_day - caterer.final_days;
    const balanceAt = (caterer.event_day - BALANCE_DAYS - 1) * 1440;
    let order: { total: number; price: number; deposit: number; balanced: boolean } | undefined;
    const today = () => Math.floor(party.now / 1440) + 1;
    const diets = caterer.diets ?? {};
    const dietsText = () => Object.entries(diets).map(([diet, { limit }]) => `${diet}: ${limit ?? "no limit"}`).join("; ");
    const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, count) => sum + count, 0);
    /** A diet it does not serve, or over its limit, if any. */
    const overLimit = (counts: Record<string, number>) => Object.entries(counts).find(([diet, count]) => diet !== "standard" && (!Object.hasOwn(diets, diet) || count > (diets[diet].limit ?? Infinity)))?.[0];

    /** Its commitments for the order, released, and the order's new price committed. */
    function* recommit(price: number): Generator<RuleStep, void, Perceived> {
      const ledger = yield* party.ledger();
      for (const recorded of (ledger.commitments_recorded ?? []) as { id: string; for: string; released?: boolean }[]) {
        if (recorded.for === forOrder && recorded.released !== true) yield* party.call("release", { commitment: recorded.id });
      }
      if (price > 0) yield* party.call("commit", { with: caterer.organiser, amount: price, for: forOrder });
    }

    function* invoice(amount: number, due: string, what: string): Generator<RuleStep, void, Perceived> {
      yield* party.call("issue_invoice", { to: caterer.organiser, amount, due, for: `${what} ${forOrder}` });
      record.invoices_issued += 1;
    }

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
          const counts = countsIn(fields.counts);
          const over = overLimit(counts);
          if (over !== undefined) return { act: "order_refused", fields: { diet: over } };
          if (total(counts) < (caterer.minimum ?? 0)) return { act: "order_refused", fields: { minimum: caterer.minimum as number } };
          const price = total(counts) * caterer.price_per_head;
          order = { total: total(counts), price, deposit: Math.round(price * caterer.deposit_share), balanced: false };
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
          const increase = asked - order.total;
          const late = today() >= finalDay;
          if (late && !(increase >= 0 && increase <= order.total * LATE_INCREASE)) return { act: "numbers_refused", fields: { total: asked } };
          const surcharge = late ? Math.round(increase * caterer.price_per_head * LATE_SURCHARGE) : 0;
          const price = asked * caterer.price_per_head + surcharge;
          order.price = price;
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
        yield* party.handle(answer, caterer.pick_up ?? 1, random);
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
    const party = new Party();
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
            then: function* () {
              const ledger = yield* party.ledger();
              for (const recorded of (ledger.commitments_recorded ?? []) as { id: string; for: string; released?: boolean }[]) {
                if (recorded.for === forBooking && recorded.released !== true) yield* party.call("release", { commitment: recorded.id });
              }
            } as () => Script,
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
export const SPONSOR_CONDITIONS = ["logo", "morning_slot", "table", "attendee_list", "passes"] as const;

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
    const party = new Party();
    const record = { conditions: sponsor.conditions.join(", "), agreement: "none", paid: 0, withdrew: false };
    const agreed = (conditions: string[]): Answer => {
      record.agreement = conditions.join(", ");
      return { act: "agreement", fields: { amount: sponsor.amount, conditions: record.agreement } };
    };
    const withdrawing = (): Answer => {
      record.withdrew = true;
      record.agreement = "none";
      return { act: "withdraw", fields: {} };
    };
    const counter = (conditions: string[]): Answer => {
      const missing = (sponsor.insists ?? []).filter((condition) => !conditions.includes(condition));
      if (missing.length > 0) return { act: "refused", fields: { missing: missing.join(", ") } };
      return random.next() < (sponsor.counter_acceptance ?? 0) ? agreed(conditions) : withdrawing();
    };
    const answer = ({ act, fields }: Received): Answer => {
      if (record.withdrew) return { act: "not_available", fields: { what: act } };
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
    function* script(): Script {
      for (;;) {
        if (party.stimuli.some(({ channel }) => channel === SPONSOR_PERTURBATION) && !record.withdrew) {
          const withdrawn = withdrawing();
          yield* party.call("send_mail", { to: sponsor.organiser, act: withdrawn.act, fields: withdrawn.fields });
        }
        party.stimuli.splice(0, party.stimuli.length, ...party.stimuli.filter(({ channel }) => channel !== SPONSOR_PERTURBATION));
        yield* party.handle(answer, sponsor.pick_up ?? 1, random);
        if (party.stimuli.length === 0) yield* party.rest(undefined);
      }
    }
    return rulesOf(script(), () => ({ ...record }));
  },
};
