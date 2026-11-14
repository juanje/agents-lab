import type { WorldTime } from "../engine/calendar.ts";
import type { Act, PartsProvided } from "../engine/parts.ts";
import type { Congress } from "./congress.ts";
import type { Person, Programme, Session } from "./population.ts";

// FR-CONGRESS-06: the congress's parts, read only from the world's records: the mail, the money's timed events, the
// programme's versions, the population, travel bookings and the perturbations' records. World times are world minutes
// since day 1's midnight.

/** A message of the world's mail, with the world time it was received, or sent while in transit. */
interface Message {
  id: string;
  from: string;
  to: string;
  act: string;
  fields: Readonly<Record<string, string | number | boolean>>;
  at: number;
}

/** World minutes of a world time. */
const minutesOf = ({ day, seconds }: WorldTime) => (day - 1) * 1440 + seconds / 60;

/** A world time from world minutes. */
const worldOf = (at: number): WorldTime => ({ day: Math.floor(at / 1440) + 1, weekday: "Monday", seconds: Math.round((at % 1440) * 60) });

/** World minutes of "day <n> [<weekday>] HH:MM", or of "day <n>" at its start. */
function minutesOfText(text: unknown): number {
  const [, day, clock = "00:00"] = /^day (\d+)(?: [A-Z][a-z]+day)?(?: (\d\d:\d\d))?$/.exec(String(text)) ?? [];
  return day === undefined ? Infinity : (Number(day) - 1) * 1440 + Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
}

/** Minutes since midnight of "HH:MM". */
const clockOf = (text: string) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));

/** Every message of the world, in the order of its time. */
function messagesOf(state: Congress): Message[] {
  const delivered = Object.values(state.mail.mailboxes)
    .flat()
    .map((message) => ({ ...message, at: minutesOf(message.received) }));
  const inTransit = state.mail.inTransit.map((message) => ({ ...message, at: minutesOf(message.sent) }));
  return [...delivered, ...inTransit].sort((one, other) => one.at - other.at) as Message[];
}

/** The messages with an act, from and to whom given. */
const withAct = (state: Congress, act: string, from?: string, to?: string) => messagesOf(state).filter((message) => message.act === act && (from === undefined || message.from === from) && (to === undefined || message.to === to));

/** A list a field gives: "a, b". */
const listOf = (text: unknown) =>
  String(text ?? "")
    .split(/,\s*/)
    .filter((each) => each !== "");

/** Counts by diet a field gives: "standard: 41; vegan: 4", standard meals as the diet "none". */
function countsOf(text: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const each of String(text ?? "").split(/;\s*/)) {
    const [diet, count] = each.split(/:\s*/);
    if (diet !== "" && count !== undefined) counts[diet === "standard" ? "none" : diet] = (counts[diet === "standard" ? "none" : diet] ?? 0) + Number(count);
  }
  return counts;
}

/** A venue's booking as its mail gives it. */
export interface Booking {
  venue: string;
  contract: string;
  date: string;
  rooms: string[];
  confirmedAt?: number;
  cancelledAt?: number;
  allocated: boolean;
}

/** Every booking a venue's mail gives: its contract, confirmation or cancellation, and its rooms after changes, extras and allocation. */
export function bookingsOf(state: Congress): Booking[] {
  const bookings: Booking[] = [];
  for (const message of messagesOf(state)) {
    const contract = String(message.fields.contract ?? "");
    const booking = bookings.find((each) => each.contract === contract) ?? bookings.find((each) => each.venue === message.from && message.act === "extra_confirmed");
    if (message.act === "contract") bookings.push({ venue: message.from, contract, date: String(message.fields.date), rooms: listOf(message.fields.rooms), allocated: false });
    if (booking === undefined) continue;
    if (message.act === "confirmed" && booking.confirmedAt === undefined) booking.confirmedAt = message.at;
    if (message.act === "cancelled") booking.cancelledAt = message.at;
    if ((message.act === "confirmed" || message.act === "contract_changed") && message.fields.rooms !== undefined) booking.rooms = listOf(message.fields.rooms);
    if (message.act === "extra_confirmed" && message.fields.room !== undefined) booking.rooms = [...booking.rooms, String(message.fields.room)];
    if (message.act === "rooms_allocated") {
      const moves = new Map(String(message.fields.allocation ?? "").split(/;\s*/).map((pair) => pair.split(/\s*->\s*/) as [string, string]));
      booking.rooms = booking.rooms.map((room) => moves.get(room) ?? room);
      booking.allocated = true;
    }
  }
  return bookings.map(({ cancelledAt, confirmedAt, ...rest }) => ({ ...rest, ...(confirmedAt === undefined ? {} : { confirmedAt }), ...(cancelledAt === undefined ? {} : { cancelledAt }) }));
}

/** The booking for the event's day confirmed and not cancelled, if one. */
const liveBookingOf = (state: Congress) => bookingsOf(state).find(({ date, confirmedAt, cancelledAt }) => date === `day ${state.context.eventDay}` && confirmedAt !== undefined && cancelledAt === undefined);

/** The latest programme version, if one. */
const latestOf = (state: Congress): Programme | undefined => state.population?.programme.at(-1);

/** The registrants: people registered and not cancelled. */
const registrantsOf = (state: Congress): Person[] => (state.population?.people ?? []).filter(({ registered, cancelled }) => registered !== undefined && cancelled === undefined);

/** Whether a speaker cancelled or withdrew, or had its invitation withdrawn. */
const outOf = (state: Congress, speaker: string) => messagesOf(state).some(({ from, to, act }) => (from === speaker && (act === "cancel" || act === "withdraw")) || (to === speaker && act === "withdraw_invitation"));

/**
 * The confirmed speakers who are not out (FR-CONGRESS-09): each accepted a session, or is the partner's, and
 * acknowledged a confirmation the organiser sent it.
 */
function confirmedOf(state: Congress): string[] {
  const partner = partnerOf(state);
  return [...new Set(withAct(state, "confirm", "organiser").map(({ to }) => to))].filter(
    (speaker) => !outOf(state, speaker) && (speaker === partner || withAct(state, "accept", speaker).length > 0) && withAct(state, "acknowledged", speaker, "organiser").length > 0,
  );
}

/** The partner's speaker, as the board's mail names it. */
const partnerOf = (state: Congress) => withAct(state, "partner_session")[0]?.fields.speaker as string | undefined;

/** The answers to invitations: accept, accept_if, decline and withdraw. */
const ANSWERS = ["accept", "accept_if", "decline", "withdraw"];

/** A speaker's latest answer to the organiser's invitation for one session; an answer to a panel or another session does not count (FR-CONGRESS-10). */
export function answerFor(state: Congress, speaker: string, session: number | string): string | undefined {
  // A withdrawal names its sessions (FR-CONGRESS-11).
  const names = (fields: Message["fields"]) => (fields.sessions === undefined ? [String(fields.session)] : listOf(fields.sessions));
  return messagesOf(state).filter(({ from, act, fields }) => from === speaker && ANSWERS.includes(act) && names(fields).includes(String(session))).at(-1)?.act;
}

/** The sessions the organiser invited a speaker to, by their numbers. */
const invitedTo = (state: Congress, speaker: string) => [...new Set(withAct(state, "invite", "organiser", speaker).map(({ fields }) => String(fields.session)))];

/** Whether a speaker accepted: the partner's always; another, when its latest answer for some session it was invited to is accept. */
function acceptedOf(state: Congress, speaker: string): boolean {
  if (speaker === partnerOf(state)) return true;
  return invitedTo(state, speaker).some((session) => answerFor(state, speaker, session) === "accept");
}

/** Whether a speaker accepted a programme session: its answer for the session it was invited to at that time, or for any when no invitation names the time. */
function acceptedFor(state: Congress, speaker: string, { start }: Session): boolean {
  if (speaker === partnerOf(state)) return true;
  const atTime = withAct(state, "invite", "organiser", speaker).filter(({ fields }) => fields.time === start).map(({ fields }) => String(fields.session));
  return (atTime.length > 0 ? atTime : invitedTo(state, speaker)).some((session) => answerFor(state, speaker, session) === "accept");
}

/** What a speaker believes about its session: the latest of the confirmation or change it received and the latest programme naming it. */
export function beliefOf(state: Congress, speaker: string): { time?: string; room?: string } | undefined {
  const told: { at: number; time?: string; room?: string }[] = [
    ...messagesOf(state)
      .filter(({ to, act }) => to === speaker && (act === "confirm" || act === "change"))
      .map(({ at, fields }) => ({ at, ...(fields.time === undefined ? {} : { time: String(fields.time) }), ...(fields.room === undefined ? {} : { room: String(fields.room) }) })),
    ...(state.population?.programme ?? []).flatMap(({ sessions, published }) =>
      sessions.filter(({ speakers }) => speakers.includes(speaker)).map(({ start, room }) => ({ at: published ?? 0, time: start, room })),
    ),
  ].sort((one, other) => one.at - other.at);
  if (told.length === 0) return undefined;
  return told.reduce<{ time?: string; room?: string }>((belief, { time, room }) => ({ ...belief, ...(time === undefined ? {} : { time }), ...(room === undefined ? {} : { room }) }), {});
}

/** The money's events with their world times. */
const eventsOf = (state: Congress) => state.money.events as readonly (Readonly<Record<string, unknown>> & { kind: string; at?: number })[];

/** The organiser's committed total at a time: its commitments, less those released, by then. */
export function committedAt(state: Congress, at: number): number {
  return eventsOf(state)
    .filter((event) => event.from === "organiser" && (event.at ?? 0) <= at)
    .reduce((sum, event) => sum + (event.kind === "commitment" ? Number(event.amount) : event.kind === "release" ? -Number(event.amount) : 0), 0);
}

/**
 * The organiser's ceiling in force at a time: the latest approved, whose amount the money records as the ceiling; else its
 * ceiling from the start, the budget (FR-CONGRESS-12); else the discretionary limit.
 */
export function ceilingAt(state: Congress, at: number): number {
  const approvals = eventsOf(state).filter((event) => event.kind === "approval" && event.to === "organiser" && (event.at ?? 0) <= at);
  return approvals.length === 0 ? (state.context.ceiling ?? state.context.discretionaryLimit) : Number(approvals.at(-1)?.amount);
}

/** The attendance: registrants, confirmed speakers, 3 board members and the helpers. */
export function attendanceOf(state: Congress): number {
  return registrantsOf(state).length + confirmedOf(state).length + 3 + state.context.helpers;
}

/** The attendance by diet: registrants by their diet, everyone else as "none". */
function attendanceByDiet(state: Congress): Record<string, number> {
  const byDiet: Record<string, number> = { none: confirmedOf(state).length + 3 + state.context.helpers };
  for (const { diet } of registrantsOf(state)) byDiet[diet] = (byDiet[diet] ?? 0) + 1;
  return byDiet;
}

/** The balance (W4): funds and ticket income transferred, sponsor money paid or due under conditions met, less what the organiser committed; and the overruns. */
export function balanceOf(state: Congress): { balance: number; overruns: number } {
  const events = eventsOf(state);
  const into = (from: (who: string) => boolean) => events.filter(({ kind, to, from: who }) => kind === "transfer" && to === "organiser" && from(String(who))).reduce((sum, { amount }) => sum + Number(amount), 0);
  const sponsors = new Set([...withAct(state, "agreement").map(({ from }) => from), ...events.filter(({ kind, to }) => kind === "payment" && to === "organiser").map(({ from }) => String(from))]);
  let sponsorMoney = 0;
  for (const sponsor of sponsors) {
    const paid = events.filter(({ kind, from, to }) => kind === "payment" && from === sponsor && to === "organiser").reduce((sum, { amount }) => sum + Number(amount), 0);
    const withdrew = withAct(state, "withdraw", sponsor).length > 0;
    const agreement = withAct(state, "agreement", sponsor).at(-1);
    // Agreed money is due only while the conditions the latest programme shows are met (FR-CONGRESS-10).
    const conditions = listOf(agreement?.fields.conditions);
    const latest = latestOf(state);
    const met = (!conditions.includes("logo") || logoOf(latest, sponsor)) && (!conditions.includes("morning_slot") || slotOf(latest, sponsor));
    const agreed = withdrew || !met ? 0 : Number(agreement?.fields.amount ?? 0);
    sponsorMoney += Math.max(paid, agreed);
  }
  // The organiser's opening balance counts beside the funds transferred to it (FR-CONGRESS-12).
  const balance = (state.context.opening ?? 0) + into((who) => who !== "attendees") + into((who) => who === "attendees") + sponsorMoney - committedAt(state, Infinity);
  return { balance, overruns: events.filter(({ kind }) => kind === "unapproved_overrun").length };
}

/** The seats of a room, a renamed one ("<room>-allocated") having its original's. */
const seatsOf = (state: Congress, room: string) => state.rooms[room]?.seats ?? state.rooms[room.replace(/-allocated$/, "")]?.seats ?? 0;

/** Whether every room of a list is reachable from its venue's entrance step-free, or through stepped passages when a ramp was hired. */
function reachable(state: Congress, venue: string, rooms: readonly string[]): boolean {
  const ramp = withAct(state, "extra_confirmed", venue).some(({ fields }) => fields.item === "ramp");
  const entrance = state.venues[venue]?.entrance;
  const reached = new Set<string>(entrance === undefined ? [] : [entrance]);
  for (let grown = true; grown; ) {
    grown = false;
    for (const { between, step_free: stepFree } of state.passages) {
      if (stepFree !== true && !ramp) continue;
      const [one, other] = between;
      for (const [from, to] of [
        [one, other],
        [other, one],
      ]) {
        if (reached.has(from) && !reached.has(to)) {
          reached.add(to);
          grown = true;
        }
      }
    }
  }
  return rooms.every((room) => reached.has(room));
}

/** The rooms of a venue's interior that are its toilets or its catering area. */
const amenitiesOf = (state: Congress, venue: string) => Object.entries(state.rooms).filter(([id, { venue: of }]) => of === venue && /toilet|catering/.test(id)).map(([id]) => id);

/** The rooms of the latest programme. */
const programmeRooms = (state: Congress) => [...new Set(latestOf(state)?.sessions.map(({ room }) => room) ?? [])];

/** Each caterer's latest numbers by diet: its confirmed order's counts, or the final numbers it accepted. */
function cateringOf(state: Congress): { caterer: string; counts: Record<string, number>; venue?: string; permit: boolean }[] {
  // An order cancelled, with none confirmed after it, does not count (FR-CONGRESS-12).
  const live = (caterer: string) => {
    const answers = messagesOf(state).filter(({ from, act }) => from === caterer && (act === "order_confirmed" || act === "cancelled"));
    return answers.at(-1)?.act === "order_confirmed";
  };
  const caterers = [...new Set(withAct(state, "order_confirmed").map(({ from }) => from))].filter(live);
  return caterers.map((caterer) => {
    const orders = messagesOf(state).filter(({ to, act }) => to === caterer && (act === "order" || act === "final_numbers"));
    const accepted = messagesOf(state).filter(({ from, act }) => from === caterer && (act === "order_confirmed" || act === "numbers_accepted"));
    const lastOrder = orders.filter(({ at }) => at <= (accepted.at(-1)?.at ?? Infinity)).at(-1);
    const order = orders.find(({ act }) => act === "order");
    return { caterer, counts: countsOf(lastOrder?.fields.counts), ...(order?.fields.venue === undefined ? {} : { venue: String(order.fields.venue) }), permit: order?.fields.permit !== undefined };
  });
}

/** The catering ordered by diet, from every caterer. */
function orderedByDiet(state: Congress): Record<string, number> {
  const total: Record<string, number> = {};
  for (const { counts } of cateringOf(state)) for (const [diet, count] of Object.entries(counts)) total[diet] = (total[diet] ?? 0) + count;
  return total;
}

/** The sponsor filling a role. */
const sponsorOf = (state: Congress, role: string) => state.context.roles.sponsor?.[role]?.[0];

/** Whether a sponsor's slot is in the morning and its logo shows in a programme. */
const slotOf = (programme: Programme | undefined, sponsor: string | undefined) => programme?.sponsor_slots.some(({ sponsor: who, start }) => who === sponsor && clockOf(start) < 12 * 60) === true;
const logoOf = (programme: Programme | undefined, sponsor: string | undefined) => programme?.logos.includes(sponsor ?? "") === true;

/** Whether data reached a sponsor without consent. */
const dataWithoutConsent = (state: Congress) => Object.values(state.population?.sponsorData ?? {}).some(({ without }) => without.length > 0);

/** A session's speakers who are confirmed, not out, and believe its time (and, when asked, its room). */
const heldBy = (state: Congress, session: Session, room: boolean) =>
  session.speakers.filter((speaker) => (confirmedOf(state).includes(speaker) || speaker === partnerOf(state)) && !outOf(state, speaker) && beliefOf(state, speaker)?.time === session.start && (!room || beliefOf(state, speaker)?.room === session.room));

/**
 * The session a perturbation's target held before it fired, and whether the latest programme holds it with real
 * replacements (FR-CONGRESS-12): each a speaker who accepted the invitation to that session, or the panel for it, is
 * confirmed, believes its time and holds no other session in the latest programme.
 */
function sessionKept(state: Congress, name: string): { kept: boolean; at?: number } {
  const fired = state.perturbations.find((each) => each.name === name);
  if (fired === undefined) return { kept: false };
  const before = (state.population?.programme ?? []).filter(({ published }) => (published ?? 0) <= fired.at).at(-1);
  const start = before?.sessions.find(({ speakers }) => speakers.includes(fired.target))?.start ?? beliefOf(state, fired.target)?.time;
  const latest = latestOf(state);
  const speakers = latest?.sessions.find((each) => each.start === start)?.speakers ?? [];
  // The session's number, as the target's invitation at that time gives it.
  const number = String(withAct(state, "invite", "organiser", fired.target).find(({ fields }) => fields.time === start)?.fields.session ?? invitedTo(state, fired.target).find((session) => answerFor(state, fired.target, session) === "accept"));
  const accepted = (speaker: string) => answerFor(state, speaker, number) === "accept" || messagesOf(state).some(({ from, act, fields }) => from === speaker && act === "accept" && fields.slot !== undefined && [number, start].includes(String(fields.slot)));
  const only = (speaker: string) => (latest?.sessions ?? []).filter((each) => each.speakers.includes(speaker)).length === 1;
  const real = (speaker: string) => confirmedOf(state).includes(speaker) && beliefOf(state, speaker)?.time === start && accepted(speaker) && only(speaker);
  return { kept: speakers.length > 0 && !speakers.includes(fired.target) && speakers.every(real), at: fired.at };
}

/** The room moves the venues' allocations made. */
const movesOf = (state: Congress) =>
  new Map(
    withAct(state, "rooms_allocated").flatMap(({ fields }) =>
      String(fields.allocation ?? "")
        .split(/;\s*/)
        .map((pair) => pair.split(/\s*->\s*/) as [string, string])
        .filter(([from, to]) => from !== to),
    ),
  );

/** Whether a programme's rooms are all allocated ones: none was moved away. */
const allocatedRooms = (state: Congress, programme: Programme | undefined) => programme !== undefined && programme.sessions.every(({ room }) => !movesOf(state).has(room));

/** Whether the congress is there to measure: six sessions in the latest programme and a live booking (FR-CONGRESS-10). */
const happened = (state: Congress) => latestOf(state)?.sessions.length === 6 && liveBookingOf(state) !== undefined;

/** Whether the organiser cancelled the congress: it cancelled a booking for the event's day and none is live (FR-CONGRESS-10). */
const cancelledCongress = (state: Congress) => withAct(state, "cancel_booking", "organiser").length > 0 && liveBookingOf(state) === undefined;

/**
 * When the organiser first asked every registrant for diet and access (FR-CONGRESS-10): the page first required both
 * while open, or request_needs was announced; none when it never did.
 */
function needsAskedAt(state: Congress): number | undefined {
  let open = false;
  let required: readonly string[] = [];
  let asked: number | undefined;
  for (const { at, open: opened, required_fields: fields } of [...(state.population?.edits ?? [])].sort((one, other) => one.at - other.at)) {
    open = opened ?? open;
    required = fields ?? required;
    if (open && required.includes("diet") && required.includes("access")) {
      asked = at;
      break;
    }
  }
  const announced = (state.population?.announcements ?? []).find(({ kind }) => kind === "request_needs")?.at;
  const times = [asked, announced].filter((at): at is number => at !== undefined);
  return times.length === 0 ? undefined : Math.min(...times);
}

/** Whether the organiser's offer for a speaker's session, its invitation as accept_condition updated it, meets a condition (FR-CONGRESS-10). */
function offerMeets(state: Congress, speaker: string, session: unknown, condition: string): boolean {
  const invitation = withAct(state, "invite", "organiser", speaker).filter(({ fields }) => String(fields.session) === String(session)).at(-1);
  const offer = Object.assign({}, invitation?.fields, ...withAct(state, "accept_condition", "organiser", speaker).filter(({ at }) => at > (invitation?.at ?? -Infinity)).map(({ fields }) => fields)) as Record<string, unknown>;
  if (condition === "fee") return Number(offer.fee ?? 0) >= (state.context.fees?.[speaker] ?? 0);
  if (condition === "travel_paid") return offer.travel_paid === true || state.context.homes?.[speaker] === undefined || state.travel.booked.some(({ traveller }) => traveller === speaker);
  if (condition === "morning_slot") return clockOf(String(offer.time ?? "23:59")) < 12 * 60;
  return true;
}

/**
 * Whether S2's agreement is settled (FR-CONGRESS-10): it asks no attendee list; or it does, the page requires the consent
 * field and a list was sent; or S2 has no agreement and another sponsor agreed in its place.
 */
function dataSettled(state: Congress): boolean {
  const s2 = sponsorOf(state, "data");
  const agreed = s2 === undefined || withAct(state, "withdraw", s2).length > 0 ? undefined : withAct(state, "agreement", s2).at(-1);
  if (agreed === undefined) return withAct(state, "agreement").some(({ from }) => from !== s2 && withAct(state, "withdraw", from).length === 0);
  if (!listOf(agreed.fields.conditions).includes("attendee_list")) return true;
  return (state.population?.page.required_fields ?? []).includes("consent_sponsors") && withAct(state, "send_attendee_list", "organiser", s2).length > 0;
}

const predicates: PartsProvided<Congress>["predicates"] = {
  P01: (state) => {
    const attendance = attendanceOf(state);
    return bookingsOf(state).some(
      (booking) =>
        booking.date === `day ${state.context.eventDay}` &&
        booking.confirmedAt !== undefined &&
        booking.cancelledAt === undefined &&
        state.money.invoices.some((invoice) => invoice.for === `deposit ${booking.contract}` && invoice.paid) &&
        Math.max(0, ...booking.rooms.map((room) => seatsOf(state, room))) >= attendance,
    );
  },
  P02: (state) => {
    const booking = liveBookingOf(state);
    if (booking === undefined) return false;
    return reachable(state, booking.venue, [...programmeRooms(state), ...amenitiesOf(state, booking.venue)]);
  },
  P03: (state) => {
    const booking = liveBookingOf(state);
    if (booking === undefined) return false;
    const attendance = attendanceOf(state);
    const rooms = programmeRooms(state).every((room) => booking.rooms.includes(room) && seatsOf(state, room) >= attendance);
    const increases = eventsOf(state).filter(({ kind, from, for: what }) => kind === "commitment" && from === "organiser" && String(what).endsWith(" change"));
    return rooms && increases.every(({ at = 0 }) => committedAt(state, at) <= ceilingAt(state, at));
  },
  P04: (state) => {
    const passed = limitPassedAt(state);
    // Reached when the board approved, before the limit passed (FR-CONGRESS-10).
    const approved = eventsOf(state).find(({ kind, to, at = 0 }) => kind === "approval" && to === "organiser" && at < (passed ?? Infinity));
    return { holds: passed === undefined || approved !== undefined, ...(approved === undefined ? {} : { reachedAt: approved.at ?? 0 }) };
  },
  // Within the budget: no overrun recorded for the organiser; reached at the run's start (FR-CONGRESS-12).
  within_budget: (state) => {
    const overrun = eventsOf(state).some(({ kind, from }) => kind === "unapproved_overrun" && from === "organiser");
    return { holds: !overrun, ...(overrun ? {} : { reachedAt: state.context.start ?? 0 }) };
  },
  P05: (state) => {
    const sessions = latestOf(state)?.sessions ?? [];
    return sessions.length === 6 && sessions.every((session) => session.speakers.some((speaker) => acceptedFor(state, speaker, session) && !outOf(state, speaker) && beliefOf(state, speaker)?.time === session.start));
  },
  P06: (state) => {
    if (withAct(state, "withdraw").some(({ from }) => withAct(state, "invite", "organiser", from).length > 0)) return false;
    return withAct(state, "accept_if").every(({ from, fields, at }) => {
      // Met when the speaker then accepted that session and the organiser's offer meets the condition (FR-CONGRESS-10).
      const accepted = messagesOf(state).some((message) => message.from === from && message.act === "accept" && String(message.fields.session) === String(fields.session) && message.at > at);
      const met = accepted && offerMeets(state, from, fields.session, String(fields.condition));
      const session = fields.session;
      const replaced = withAct(state, "invite", "organiser").some(({ to, fields: invited }) => to !== from && invited.session === session && confirmedOf(state).includes(to));
      return met || replaced;
    });
  },
  P07: (state) => {
    const homes = state.context.homes ?? {};
    const night = `day ${state.context.eventDay - 1}`;
    // At least one confirmed speaker from a station in the latest programme (FR-CONGRESS-10).
    const travelling = confirmedOf(state).filter((speaker) => homes[speaker] !== undefined && latestOf(state)?.sessions.some(({ speakers }) => speakers.includes(speaker)) === true);
    return travelling.length > 0 && travelling
      .every((speaker) => {
        const session = latestOf(state)?.sessions.find(({ speakers }) => speakers.includes(speaker));
        if (session === undefined) return false;
        const trains = state.travel.material.trains.filter(({ from }) => from === homes[speaker]);
        const latest = clockOf(session.start) - 30;
        const booked = state.travel.booked.filter(({ traveller }) => traveller === speaker);
        const inTime = booked.some(({ option }) => trains.some(({ id, arrives }) => option === `${id} day ${state.context.eventDay}` && clockOf(arrives) <= latest));
        const firstLate = trains.every(({ arrives }) => clockOf(arrives) > latest);
        const hotel = booked.some(({ option }) => state.travel.material.hotels.some(({ id }) => option === `${id} ${night}`));
        return inTime || (firstLate && hotel);
      });
  },
  P08: (state) => sessionKept(state, "early_cancel").kept,
  P09: (state) => {
    const { kept, at } = sessionKept(state, "late_cancel");
    return kept && (state.population?.announcements ?? []).some(({ audience, kind, at: told }) => audience === "registrants" && (kind === "change" || kind === "programme") && told > (at ?? Infinity));
  },
  P10: (state) => registrantsOf(state).filter(({ pays }) => pays).length >= 0.75 * state.context.target && balanceOf(state).balance >= 0,
  P11: (state) => {
    const registrants = registrantsOf(state);
    const asked = needsAskedAt(state);
    return { holds: registrants.length > 0 && registrants.every(({ given }) => given.diet !== undefined && given.access !== undefined), ...(asked === undefined ? {} : { reachedAt: asked }) };
  },
  P12: (state) => {
    const catering = state.context.catering ?? {};
    const allowed = cateringOf(state).filter(({ caterer, venue, permit }) => {
      const rule = venue === undefined ? undefined : catering[venue];
      return rule === undefined || rule.rule === "outside_free" || rule.rule === undefined || rule.inHouse === caterer || permit;
    });
    const portions = allowed.reduce((sum, { counts }) => sum + (counts.gluten_free ?? 0), 0);
    const glutenFree = registrantsOf(state).filter(({ diet }) => diet === "gluten_free").length;
    // The gluten-free registrants and an order are there to measure (FR-CONGRESS-10).
    return glutenFree > 0 && cateringOf(state).length > 0 && portions >= glutenFree;
  },
  P13: (state) => {
    const ordered = orderedByDiet(state);
    const total = Object.values(ordered).reduce((sum, count) => sum + count, 0);
    const byDiet: Record<string, number> = {};
    for (const { diet } of registrantsOf(state)) byDiet[diet] = (byDiet[diet] ?? 0) + 1;
    const covered = Object.entries(byDiet).every(([diet, count]) => (ordered[diet] ?? 0) >= count * (1 - state.context.noShowCut));
    const page = state.population?.page;
    // An order is there to measure, and a cap counts only when it is at most the numbers ordered (FR-CONGRESS-10).
    const capped = page?.cap !== undefined && page.cap <= total;
    return cateringOf(state).length > 0 && (covered || capped);
  },
  P14: (state) => {
    const final = registrantsOf(state).length;
    const paying = registrantsOf(state).filter(({ pays }) => pays).length >= 0.75 * state.context.target;
    // A cancelled order cuts the catering to what the orders left give (FR-CONGRESS-12).
    const left = Object.values(orderedByDiet(state)).reduce((sum, count) => sum + count, 0);
    const cut = withAct(state, "numbers_accepted").some(({ fields }) => Number(fields.total) < final) || (withAct(state, "cancelled").some(({ from }) => withAct(state, "order_confirmed", from).length > 0) && left < final);
    const booking = liveBookingOf(state);
    const rooms = booking === undefined || Math.max(0, ...booking.rooms.map((room) => seatsOf(state, room))) >= final;
    return paying && !cut && rooms;
  },
  P15: (state) => {
    const s1 = sponsorOf(state, "slot");
    const latest = latestOf(state);
    return slotOf(latest, s1) && logoOf(latest, s1) && state.money.invoices.some(({ from, to, paid }) => from === "organiser" && to === s1 && paid);
  },
  P16: (state) => dataSettled(state) && !dataWithoutConsent(state) && balanceOf(state).balance >= 0,
  P17: (state) => {
    const withdrew = state.perturbations.find(({ name }) => name === "sponsor_withdraws");
    // A live booking and a programme are there to keep (FR-CONGRESS-10).
    if (liveBookingOf(state) === undefined || latestOf(state) === undefined) return false;
    if (withdrew === undefined) return balanceOf(state).balance >= 0;
    return balanceOf(state).balance >= 0 && !eventsOf(state).some(({ kind, at = 0 }) => kind === "unapproved_overrun" && at > withdrew.at);
  },
  P18: (state) => {
    const booking = withAct(state, "booked").find(({ fields }) => fields.date === `day ${state.context.eventDay}`);
    if (booking === undefined || withAct(state, "cancelled", booking.from).length > 0) return false;
    return eventsOf(state)
      .filter(({ kind, from, to }) => kind === "commitment" && from === "organiser" && to === booking.from)
      .every(({ at = 0 }) => committedAt(state, at) <= ceilingAt(state, at));
  },
  P19: (state) =>
    state.perturbations
      .filter(({ name }) => name === "hotel_overbooks")
      .every(({ target }) => {
        const night = `day ${state.context.eventDay - 1}`;
        const deadline = minutesOfText(`${night} 23:30`);
        const room = state.travel.booked.some(({ traveller, option, at = 0 }) => traveller === target && option.endsWith(` ${night}`) && state.travel.material.hotels.some(({ id }) => option === `${id} ${night}`) && at <= deadline);
        const start = latestOf(state)?.sessions.find(({ speakers }) => speakers.includes(target))?.start;
        const train = start !== undefined && state.travel.booked.some(({ traveller, option }) => traveller === target && state.travel.material.trains.some(({ id, arrives }) => option === `${id} day ${state.context.eventDay}` && clockOf(arrives) < clockOf(start)));
        return room || train;
      }),
  P20: (state) => {
    const partner = partnerOf(state);
    const sessions = latestOf(state)?.sessions ?? [];
    const inProgramme = new Set(sessions.flatMap(({ speakers }) => speakers));
    const confirmed = confirmedOf(state);
    if (partner === undefined || !inProgramme.has(partner) || !confirmed.includes(partner)) return false;
    if (sessions.length !== 6 || !sessions.every(({ speakers }) => speakers.some((speaker) => confirmed.includes(speaker)))) return false;
    const accepted = [...new Set(withAct(state, "accept").map(({ from }) => from))];
    const withdrawn = accepted.some((speaker) => withAct(state, "withdraw_invitation", "organiser", speaker).length > 0);
    const left = accepted.some((speaker) => !inProgramme.has(speaker) && !outOf(state, speaker));
    const spent = eventsOf(state).some(({ kind, from, to, for: what }) => kind === "commitment" && from === "organiser" && [...accepted, ...confirmed].some((speaker) => !inProgramme.has(speaker) && (to === speaker || String(what).endsWith(` ${speaker}`))));
    return !withdrawn && !left && !spent;
  },
  P21: (state) => {
    const latest = latestOf(state);
    // An allocation received for the live booking, and six sessions (FR-CONGRESS-10).
    const booking = liveBookingOf(state);
    if (booking === undefined || withAct(state, "rooms_allocated", booking.venue).length === 0 || latest?.sessions.length !== 6) return false;
    if (!allocatedRooms(state, latest)) return false;
    const speakers = (latest?.sessions ?? []).flatMap((session) => session.speakers.filter((speaker) => confirmedOf(state).includes(speaker)).map((speaker) => ({ speaker, room: session.room })));
    const believed = speakers.every(({ speaker, room }) => beliefOf(state, speaker)?.room === room);
    const told = registrantsOf(state).every(({ believes }) => believes !== undefined && allocatedRooms(state, state.population?.programme.find(({ version }) => version === believes)));
    return believed && told;
  },
  W1: (state) => {
    const latest = latestOf(state);
    const sessions = latest?.sessions ?? [];
    return sessions.length === 6 && sessions.every((session) => heldBy(state, session, true).length > 0) && slotOf(latest, sponsorOf(state, "slot"));
  },
  W2: (state) => {
    const attendance = attendanceOf(state);
    return happened(state) && (latestOf(state)?.sessions ?? []).every(({ room }) => seatsOf(state, room) >= attendance);
  },
  W3: (state) => {
    const ordered = orderedByDiet(state);
    return Object.entries(attendanceByDiet(state)).every(([diet, count]) => (ordered[diet] ?? 0) >= count);
  },
  W4: (state) => {
    const values = balanceOf(state);
    // A congress the organiser cancelled does not hold (FR-CONGRESS-10).
    return { holds: values.balance >= 0 && !cancelledCongress(state), values };
  },
  W5: (state) => {
    const latest = latestOf(state);
    const sponsors = [...new Set(withAct(state, "agreement").map(({ from }) => from))].filter((sponsor) => withAct(state, "withdraw", sponsor).length === 0);
    const met = sponsors.every((sponsor) => {
      const conditions = listOf(withAct(state, "agreement", sponsor).at(-1)?.fields.conditions);
      return (!conditions.includes("logo") || logoOf(latest, sponsor)) && (!conditions.includes("morning_slot") || slotOf(latest, sponsor));
    });
    return happened(state) && met && !dataWithoutConsent(state);
  },
  W6: (state) => {
    const booking = liveBookingOf(state);
    const needs = registrantsOf(state).map(({ access }) => access);
    const rooms = !needs.includes("wheelchair") || (booking !== undefined && reachable(state, booking.venue, programmeRooms(state)));
    const interpreter = !needs.includes("interpreter") || withAct(state, "booked").some(({ fields }) => fields.date === `day ${state.context.eventDay}`);
    return happened(state) && rooms && interpreter;
  },
};

/** When the organiser's committed total first passed its ceiling from the start (FR-CONGRESS-12), or else the discretionary limit, if it did. */
function limitPassedAt(state: Congress): number | undefined {
  const limit = state.context.ceiling ?? state.context.discretionaryLimit;
  const times = [...new Set(eventsOf(state).filter(({ kind, from }) => kind === "commitment" && from === "organiser").map(({ at = 0 }) => at))].sort((one, other) => one - other);
  return times.find((at) => committedAt(state, at) > limit);
}

/** A perturbation's first record, by its name and, when given, its target. */
const perturbationEvent = (name: string) => (state: Congress, params: Readonly<Record<string, unknown>>) => {
  const found = state.perturbations.find((each) => each.name === name && (params.target === undefined || each.target === params.target));
  return found === undefined ? undefined : worldOf(found.at);
};

/** A mail's first record by its act. */
const mailEvent = (act: string) => (state: Congress) => {
  const found = withAct(state, act)[0];
  return found === undefined ? undefined : worldOf(found.at);
};

const events: PartsProvided<Congress>["events"] = {
  early_cancel: perturbationEvent("early_cancel"),
  late_cancel: perturbationEvent("late_cancel"),
  hotel_overbooks: perturbationEvent("hotel_overbooks"),
  // Only a sponsor that had agreed before it withdrew activates its part (FR-CONGRESS-10).
  sponsor_withdraws: (state, params) => {
    const found = state.perturbations.find((each) => each.name === "sponsor_withdraws" && (params.target === undefined || each.target === params.target));
    return found === undefined || !withAct(state, "agreement", found.target).some(({ at }) => at < found.at) ? undefined : worldOf(found.at);
  },
  rooms_allocated: mailEvent("rooms_allocated"),
  // The live booking's venue announcing a room lost or a price change (FR-CONGRESS-12).
  venue_change: (state) => {
    const venue = liveBookingOf(state)?.venue;
    const found = messagesOf(state).find(({ from, act }) => from === venue && (act === "room_lost" || act === "price_change"));
    return found === undefined ? undefined : worldOf(found.at);
  },
  partner_session_mail: mailEvent("partner_session"),
  limit_passed: (state) => {
    const at = limitPassedAt(state);
    return at === undefined ? undefined : worldOf(at);
  },
  final_numbers_due: (state) => {
    const dates = withAct(state, "quote")
      .map(({ fields }) => minutesOfText(fields.final_numbers_by))
      .filter((at) => at !== Infinity);
    return dates.length === 0 ? undefined : worldOf(Math.min(...dates));
  },
};

/** A mail the organiser sends, as its act gives it: its recipient, act and fields. */
const sent = (act: Act) => (act.tool === "send_mail" || act.tool === "call" ? { to: String(act.arguments.to), act: String(act.arguments.act), fields: (act.arguments.fields ?? {}) as Record<string, unknown> } : undefined);

/**
 * The organiser's acts of a kind before one of its acts, as they were made (FR-CONGRESS-12): its mail, delivered or in
 * transit, at the time it was sent, and its calls, from the world as it was after the act, less the act itself.
 */
function madeBefore(state: Congress, act: Act, kind: string): { to: string; fields: Readonly<Record<string, unknown>> }[] {
  const at = minutesOf(act.world);
  const mailed = [...Object.values(state.mail.mailboxes).flat(), ...state.mail.inTransit].filter(({ from, act: each }) => from === "organiser" && each === kind).filter((message) => minutesOf(message.sent ?? (message as { received: WorldTime }).received) <= at);
  const called = state.phone.calls.filter(({ from, act: each }) => from === "organiser" && each === kind);
  const made: { to: string; fields: Readonly<Record<string, unknown>> }[] = [...mailed, ...called].map(({ to, fields }) => ({ to, fields }));
  const own = sent(act);
  const index = own === undefined ? -1 : made.map(({ to, fields }) => to === own.to && JSON.stringify(fields) === JSON.stringify(own.fields)).lastIndexOf(true);
  return index === -1 ? made : [...made.slice(0, index), ...made.slice(index + 1)];
}

/**
 * The organiser's own cost-covering price at a time, as P10 reads it: from the budget it submitted to a board
 * (FR-CONGRESS-06), (costs − income − funds requested) / target; with a fixed budget, (the committed total − the budget
 * − the sponsors' agreed amounts) / target (FR-CONGRESS-12). None with a board and no budget submitted.
 */
function ownCoveringPrice(state: Congress, at: number): number | undefined {
  const submitted = withAct(state, "submit_budget", "organiser").at(-1);
  if (submitted !== undefined) {
    const { costs = 0, income = 0, funds_requested: funds = 0 } = submitted.fields as Record<string, number>;
    return (costs - income - funds) / state.context.target;
  }
  if (state.context.ceiling === undefined) return undefined;
  const sponsors = [...new Set(withAct(state, "agreement").map(({ from }) => from))].filter((sponsor) => withAct(state, "withdraw", sponsor).length === 0);
  const agreed = sponsors.reduce((sum, sponsor) => sum + Number(withAct(state, "agreement", sponsor).at(-1)?.fields.amount ?? 0), 0);
  return (committedAt(state, at) - state.context.ceiling - agreed) / state.context.target;
}

const misapplications: PartsProvided<Congress>["misapplications"] = {
  P02: (act, _params, state, latest) => {
    const mail = sent(act);
    const venue = state.context.roles.venue?.false_claim?.[0];
    if (mail === undefined || mail.to !== venue || !["book", "accept_contract"].includes(mail.act)) return false;
    // Once per venue: its first book or accept_contract (FR-CONGRESS-10).
    const earlier = messagesOf(state).some(({ from, to, act: kind, at }) => from === "organiser" && to === venue && ["book", "accept_contract"].includes(kind) && at < minutesOf(act.world));
    if (earlier) return false;
    const asked = withAct(state, "request_document", "organiser", venue).some(({ fields }) => fields.kind === "floor_plan" || fields.kind === "photos");
    const inside = new Set(Object.entries(state.rooms).filter(([, { venue: of }]) => of === venue).map(([id]) => id));
    const visited = (state.visits ?? []).some(({ place }) => inside.has(place));
    // Only when the steps are in the way: a session, the toilets or the catering area of the live booking there is reached through them with no ramp (FR-CONGRESS-12).
    const booking = liveBookingOf(latest);
    const blocked = booking?.venue === venue && !reachable(latest, venue, [...programmeRooms(latest), ...amenitiesOf(latest, venue)]);
    return !asked && !visited && blocked;
  },
  P10: (act, _params, state, latest) => {
    if (act.tool !== "edit_ticket_page" || typeof act.arguments.price !== "number") return false;
    const covering = ownCoveringPrice(state, minutesOf(act.world));
    if (covering === undefined) return false;
    const reference = state.population?.referencePrice ?? 0;
    const near = Math.abs(act.arguments.price - covering) <= 0.05 * covering;
    const lowered = (latest.population?.edits ?? []).some(({ price, at }) => at > minutesOf(act.world) && at < minutesOfText("day 12") && price !== undefined && price < (act.arguments.price as number));
    return near && covering > 1.25 * reference && !lowered;
  },
  P13: (act, _params, state, latest) => {
    const mail = sent(act);
    if (mail === undefined || mail.act !== "final_numbers") return false;
    const total = Object.values(countsOf(mail.fields.counts)).reduce((sum, count) => sum + count, 0);
    if (Math.abs(total - attendanceOf(state)) > 2) return false;
    const page = latest.population?.page;
    const open = page !== undefined && page.open && (page.cap === undefined || page.cap > total);
    const after = minutesOf(act.world);
    const more = messagesOf(latest).some(({ at, act: kind, from, to }) => at > after && ((kind === "numbers_accepted" && from === mail.to) || (kind === "order" && to !== mail.to)));
    return open && !more;
  },
  P16: (act, _params, state) => {
    const mail = sent(act);
    if (mail === undefined) return false;
    if (mail.act === "accept_sponsorship") return listOf(mail.fields.conditions).includes("attendee_list") && !(state.population?.page.required_fields ?? []).includes("consent_sponsors");
    if (mail.act !== "send_attendee_list") return false;
    const consented = new Set((state.population?.people ?? []).filter(({ given }) => given.consent === true).map(({ id }) => id));
    const registered = new Set(registrantsOf(state).map(({ id }) => id));
    return listOf(mail.fields.list).some((id) => registered.has(id) && !consented.has(id));
  },
  P20: (act, _params, state, latest) => {
    const mail = sent(act);
    if (mail === undefined) return false;
    const earlier = (kind: string, to?: string) => madeBefore(state, act, kind).filter(({ to: whom }) => to === undefined || whom === to);
    // A withdrawal after an acceptance, once per speaker (FR-CONGRESS-10).
    if (mail.act === "withdraw_invitation") return acceptedOf(state, mail.to) && earlier("withdraw_invitation", mail.to).length === 0;
    const partner = partnerOf(state);
    if (mail.act !== "invite" || partner === undefined) return false;
    const partnerSession = String(withAct(state, "partner_session")[0]?.fields.session);
    const sessionsBefore = new Set(earlier("invite").map(({ fields }) => String(fields.session)));
    const session = String(mail.fields.session);
    // The invitation that completes first choices for six sessions, with none left for the partner: once.
    const completes = !sessionsBefore.has(session) && sessionsBefore.size === 5;
    if (completes) return true;
    // An invitation for the partner's session to another, unless it was one of those first choices, made before they were completed.
    const completedLater = new Set(withAct(latest, "invite", "organiser").map(({ fields }) => String(fields.session))).size >= 6;
    return session === partnerSession && mail.to !== partner && (sessionsBefore.size >= 6 || !completedLater);
  },
  P21: (act, _params, state, latest) => {
    // Only a programme that was published (FR-CONGRESS-10).
    if (act.tool !== "publish_programme" || (act.outcome !== undefined && act.outcome !== "success")) return false;
    const named = ((act.arguments.sessions ?? []) as Session[]).some(({ room }) => room !== undefined);
    const indicative = withAct(state, "contract").some(({ fields }) => /indicative/.test(String(fields.terms ?? "")));
    // Before the allocation mail; when none came, before day 15.
    const early = withAct(latest, "rooms_allocated").length > 0 || minutesOf(act.world) < minutesOfText("day 15");
    return named && indicative && withAct(state, "rooms_allocated").length === 0 && early;
  },
};

const traps: NonNullable<PartsProvided<Congress>["traps"]> = {
  /** P01's trap: a hold that lapsed with no contract confirmed by its venue before it lapsed. */
  hold_lapsed: (state, _params, at) =>
    withAct(state, "held").some(({ from, fields }) => {
      const until = minutesOfText(fields.until);
      return until < at && !withAct(state, "confirmed", from).some(({ at: confirmed }) => confirmed <= until);
    }),
};

/** The congress's parts (FR-CONGRESS-06): its predicates, events, misapplication patterns and traps, read only from the world's records. */
export const congressParts: PartsProvided<Congress> = { predicates, events, misapplications, traps };
