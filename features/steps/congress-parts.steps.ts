import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import type { Act } from "../../src/engine/parts.ts";
import { congressParts } from "../../src/scenarios/congress-parts.ts";
import type { Congress } from "../../src/scenarios/congress.ts";
import type { Person, Programme, Session } from "../../src/scenarios/population.ts";
import type { Context } from "../support/context.ts";

// FR-CONGRESS-06: the predicates are read on world records the steps build here, in the shapes the world keeps them,
// with no agent acting. World times are world minutes since day 1's midnight.

/** World minutes of "day <n> HH:MM", or of "day <n>" at its start. */
export function minutes(text: string): number {
  const [, day, clock = "00:00"] = /^day (\d+)(?: (\d\d:\d\d))?$/.exec(text) ?? [];
  assert.ok(day !== undefined, `"${text}" is no world time`);
  return (Number(day) - 1) * 1440 + Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
}

/** A world time as the engine keeps it, from world minutes. */
export const worldOf = (at: number) => ({ day: Math.floor(at / 1440) + 1, weekday: "Monday" as const, seconds: Math.round((at % 1440) * 60) });

/** The records a scenario builds, and the acts of the organiser it gives. */
interface Records {
  state: Congress;
  acts: { act: Act; at: number }[];
  /** The moment the part is evaluated, in world minutes. */
  at?: number;
  result?: unknown;
  /** The part evaluated. */
  part?: string;
}

export const records = new WeakMap<Context, Records>();
export function recordsOf(context: Context): Records {
  const found = records.get(context);
  assert.ok(found !== undefined, "the scenario built no records");
  return found;
}

/** The end of preparation of the Background. */
export const END = minutes("day 26 06:30");

/** An empty congress world: FR-CONGRESS-02's venue "v1" (foyer, main-hall 120, room-b 30, room-d 120) and "v2", a hotel near it, and no records. */
export function emptyWorld(): Congress {
  const room = (venue: string, seats?: number) => ({ venue, ...(seats === undefined ? {} : { seats }) });
  return {
    rooms: { foyer: room("v1"), "main-hall": room("v1", 120), "room-b": room("v1", 30), "room-d": room("v1", 120), "hall-2": room("v2", 90) },
    venues: { v1: { entrance: "v1-entrance", hours: "always" }, v2: { entrance: "v2-entrance", hours: "always" } },
    passages: [
      { between: ["v1-entrance", "foyer"], length: 1, step_free: true },
      { between: ["foyer", "main-hall"], length: 1, step_free: true },
      { between: ["foyer", "room-b"], length: 1, step_free: true },
      { between: ["foyer", "room-d"], length: 1, step_free: true },
      { between: ["v2-entrance", "hall-2"], length: 1, step_free: true },
    ],
    mail: { mailboxes: {}, inTransit: [] },
    phone: { calls: [] },
    money: { balances: {}, invoices: [], commitments: [], ceilings: {}, overruns: [], events: [] },
    travel: { material: { stations: ["north"], trains: [], hotels: [{ id: "h1", near: "v1", rooms: 5, price: 90 }, { id: "h2", near: "v1", rooms: 5, price: 90 }], sold_out_probability: 0 }, soldOutDraws: {}, booked: [] },
    population: { material: {} as never, eventDay: 26, referencePrice: 35, draws: {}, people: [], page: { open: true, price: 50, required_fields: [], info: [], waiting_list: false }, announced: true, promotions: [], programme: [], sponsorData: {}, events: [], announcements: [], edits: [] },
    perturbations: [],
    visits: [],
    context: {
      eventDay: 26,
      helpers: 2,
      target: 50,
      endOfPreparation: END,
      roles: { venue: { false_claim: ["v1"] }, sponsor: { slot: ["sp1"], data: ["sp2"], withdraws: ["sp3"] } },
      noShowCut: 0.05,
      discretionaryLimit: 300,
      homes: { s2: "north" },
      catering: { v1: { rule: "outside_free" }, v2: { rule: "outside_free" } },
    },
  } as unknown as Congress;
}

/** Adds a mail, delivered at a world time. */
export function mail(context: Context, from: string, to: string, act: string, fields: Record<string, string | number | boolean>, at: number): void {
  const { state } = recordsOf(context);
  const count = Object.values(state.mail.mailboxes).flat().length;
  const message = { id: `m-${count + 1}`, from, to, act, fields, subject: act, received: worldOf(at), read: true };
  state.mail = { ...state.mail, mailboxes: { ...state.mail.mailboxes, [to]: [...(state.mail.mailboxes[to] ?? []), message] } };
}

/** Adds a money event at a world time, and keeps what it records. */
export function money(context: Context, event: Record<string, string | number>, at: number): void {
  const { state } = recordsOf(context);
  state.money = { ...state.money, events: [...state.money.events, { ...event, at } as never] };
}

/** Adds an organiser's act at a world time, with the world as the records are then. */
export function act(context: Context, tool: string, args: Record<string, unknown>, at: number): void {
  const built = recordsOf(context);
  built.acts.push({ act: { agent: "organiser", tool, arguments: args, world: worldOf(at) }, at });
  // The state at the act's time: the records as they are when the step adds it.
  (built.acts.at(-1) as { state?: Congress }).state = structuredClone(built.state);
}

/** Registrants: so many, each paying, with a diet, an access need and consent as given. */
export function register(context: Context, count: number, person: Partial<Person> = {}, at = minutes("day 10")): void {
  const { state } = recordsOf(context);
  const population = state.population as NonNullable<Congress["population"]>;
  const first = population.people.length;
  const people = Array.from({ length: count }, (_, index) => ({ id: `a-${first + index + 1}`, diet: "none", access: "none", pays: true, consents: true, no_show: false, registered: at, given: { diet: "none", access: "none" }, ...person }));
  population.people = [...population.people, ...people];
  population.events = [...(population.events ?? []), ...people.flatMap(({ id, pays }) => [{ event: "registration" as const, person: id, worldTime: worldOf(at) }, ...(pays ? [{ event: "payment" as const, person: id, worldTime: worldOf(at) }] : [])])];
}

/** A programme version, published at a world time: sessions, sponsor slots and logos. */
export function publish(context: Context, sessions: Session[], at: number, more: Partial<Programme> = {}): void {
  const population = recordsOf(context).state.population as NonNullable<Congress["population"]>;
  population.programme = [...population.programme, { version: population.programme.length + 1, sessions, breaks: [], sponsor_slots: [], logos: [], published: at, ...more }];
}

/** A session of 45 minutes. */
export function session(speakers: string[], start: string, room = "main-hall"): Session {
  const end = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 45;
  return { start, end: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`, title: speakers.join(" and "), speakers, room };
}

/** A speaker who accepted and was confirmed for a time and room, on day 5. */
export function confirmed(context: Context, speaker: string, time = "10:00", room = "main-hall"): void {
  mail(context, "organiser", speaker, "invite", { session: 1, time, fee: 0, travel_paid: false }, minutes("day 3"));
  mail(context, speaker, "organiser", "accept", { session: 1 }, minutes("day 4"));
  mail(context, "organiser", speaker, "confirm", { time, room, length: 45, travel: "none" }, minutes("day 5"));
  mail(context, speaker, "organiser", "acknowledged", {}, minutes("day 5 01:00"));
}

/** "v1"'s live booking for the event day, from its mail only, with no money: what a part needs to have happened (FR-CONGRESS-10). */
function liveBooking(context: Context, rooms = "main-hall"): void {
  mail(context, "v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms, hours: "08:00-18:00", price: 2000 }, minutes("day 2"));
  mail(context, "v1", "organiser", "confirmed", { contract: "v1-contract-1" }, minutes("day 3"));
}

/** Six sessions in "main-hall", each with a confirmed speaker who believes its time, published on day 12. */
function sixInMainHall(context: Context, more: Partial<Programme> = {}): void {
  SIX.forEach((speaker, index) => confirmed(context, speaker, TIMES[index]));
  publish(context, SIX.map((speaker, index) => session([speaker], TIMES[index])), minutes("day 12"), more);
}

/** "v1"'s confirmed contract for the event day with these rooms, its deposit paid or not. */
export function booked(context: Context, rooms: string, paid = true, venue = "v1"): void {
  const contract = `${venue}-contract-1`;
  mail(context, venue, "organiser", "contract", { contract, date: "day 26", rooms, hours: "08:00-18:00", price: 2000, terms: "Rooms are indicative until allocated." }, minutes("day 2"));
  mail(context, venue, "organiser", "confirmed", { contract }, minutes("day 3"));
  const { state } = recordsOf(context);
  state.money = { ...state.money, invoices: [...state.money.invoices, { id: "i-1", from: venue, to: "organiser", amount: 500, due: "day 6", for: `deposit ${contract}`, paid }] };
  money(context, { kind: "commitment", from: "organiser", to: venue, amount: 2000, commitment: "k-1", for: contract }, minutes("day 3"));
  if (paid) money(context, { kind: "payment", from: "organiser", to: venue, amount: 500, invoice: "i-1" }, minutes("day 4"));
  // An unpaid deposit cancels the booking (FR-CONGRESS-02).
  else mail(context, venue, "organiser", "cancelled", { contract, charge: 0 }, minutes("day 11"));
}

Given(
  'the congress scenario with the amendments of FR-CONGRESS-07, the parts of FR-PARTS-01, the event on "day 26", the end of preparation at "day 26 06:30", 2 "helpers" and the target attendance 50',
  function (this: Context) {
    records.set(this, { state: emptyWorld(), acts: [] });
  },
);

Given("the predicates are evaluated on world records the steps set directly, with no agent acting", function (this: Context) {
  // As emptyWorld and the steps below build them.
});

// P01.
Given(
  /^"v1"'s contract for "day 26" is confirmed, its deposit (paid|not paid) before its cancellation rule fired, and its booked "main-hall" seats (\d+); the attendance is 45$/,
  function (this: Context, paid: string, seats: string) {
    const { state } = recordsOf(this);
    state.rooms["main-hall"] = { venue: "v1", seats: Number(seats) };
    booked(this, "main-hall", paid === "paid");
    // 40 registrants, 3 board members and 2 helpers.
    register(this, 40);
  },
);

/** Evaluates a part at a world time: its predicate, misapplications, traps, and its activation and evaluation times. */
export function evaluate(context: Context, part: string, at: number): void {
  const built = recordsOf(context);
  built.at = at;
  built.part = part;
  built.result = congressParts.predicates[part](built.state, { at });
}

When(/^"(\w+)" is evaluated at the end of preparation$/, function (this: Context, part: string) {
  evaluate(this, part, END);
});

When(/^"(\w+)" is evaluated at the end of the run$/, function (this: Context, part: string) {
  evaluate(this, part, minutes("day 26 23:59"));
});

When(/^"(\w+)" is evaluated at "([^"]+)"$/, function (this: Context, part: string, at: string) {
  evaluate(this, part, minutes(at));
});

/** The time a part is evaluated at by its event, or the end of preparation. */
const EVALUATED_AT: Record<string, (state: Congress) => number | undefined> = {
  P04: (state) => eventAt(state, "limit_passed"),
  P06: () => minutes("day 20 00:00"),
  P11: (state) => eventAt(state, "final_numbers_due"),
};

/** An event's first time, in world minutes, as the congress provides it. */
export function eventAt(state: Congress, event: string, params: Record<string, unknown> = {}): number | undefined {
  const provided = congressParts.events[event];
  assert.ok(provided !== undefined, `the congress provides no event ${event}`);
  const found = provided(state, params);
  return found === undefined ? undefined : (found.day - 1) * 1440 + found.seconds / 60;
}

When(/^"(\w+)" is evaluated$/, function (this: Context, part: string) {
  const { state } = recordsOf(this);
  evaluate(this, part, EVALUATED_AT[part]?.(state) ?? END);
});

/** Whether the last evaluation held, and the values it gave. */
export function held(context: Context): { holds: boolean; values?: Record<string, unknown> } {
  const { result } = recordsOf(context);
  return typeof result === "boolean" ? { holds: result } : (result as { holds: boolean; values: Record<string, unknown> });
}

Then("it holds", function (this: Context) {
  assert.equal(held(this).holds, true);
});

Then("it does not hold", function (this: Context) {
  assert.equal(held(this).holds, false);
});

Then(/^it was evaluated (?:on|at) "([^"]+)" and (holds|does not hold)$/, function (this: Context, at: string, result: string) {
  const evaluated = recordsOf(this).at as number;
  const expected = minutes(at);
  // "on" a day: within it.
  assert.ok(/\d\d:\d\d$/.test(at) ? evaluated === expected : Math.floor(evaluated / 1440) === Math.floor(expected / 1440), `it was evaluated at ${evaluated}`);
  assert.equal(held(this).holds, result === "holds");
});

/** The misapplications of a part among the organiser's acts, as the congress's patterns find them, up to its evaluation. */
export function misapplied(context: Context, part: string): Act[] {
  const built = recordsOf(context);
  const at = built.at ?? END;
  const pattern = congressParts.misapplications[part];
  assert.ok(pattern !== undefined, `the congress provides no misapplication pattern "${part}"`);
  return built.acts.filter(({ at: when, ...rest }) => when <= at && pattern(rest.act, {}, (rest as unknown as { state: Congress }).state, built.state)).map(({ act: found }) => found);
}

Then(/^it lists one misapplication: that "(\w+)"$/, function (this: Context, tool: string) {
  const found = misapplied(this, partOf(this));
  assert.equal(found.length, 1, `it lists ${found.length} misapplications: ${JSON.stringify(found)}`);
  assert.equal(found[0].tool === "send_mail" ? (found[0].arguments.act as string) : found[0].tool, tool);
});

/** The part the scenario evaluated. */
function partOf(context: Context): string {
  const { part } = recordsOf(context);
  assert.ok(part !== undefined, "the scenario evaluated no part");
  return part;
}

// P02.
Given(/^the booked venue "v1" has "foyer" to "room-b" with "3 steps", the latest programme uses "room-b", and (a "ramp" extra is confirmed|no ramp was confirmed)$/, function (this: Context, ramp: string) {
  const { state } = recordsOf(this);
  state.passages = state.passages.map((passage) => (passage.between.includes("room-b") ? { ...passage, step_free: "3 steps" } : passage));
  booked(this, "main-hall, room-b");
  publish(this, [session(["s1"], "10:00", "room-b")], minutes("day 12"));
  if (ramp.startsWith("a")) mail(this, "v1", "organiser", "extra_confirmed", { item: "ramp", price: 150 }, minutes("day 6"));
});

Given(
  'the organiser accepted the false-claim venue\'s contract on "day 3", and asked for no floor plan or photos of it and did not go inside it before',
  function (this: Context) {
    mail(this, "v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "main-hall", hours: "08:00-18:00", price: 2000 }, minutes("day 2"));
    act(this, "send_mail", { to: "v1", act: "accept_contract", fields: { contract: "v1-contract-1" } }, minutes("day 3"));
    // The booking is live, and its session room is reached only through steps with no ramp: what makes the act a misapplication (FR-CONGRESS-10).
    const { state } = recordsOf(this);
    state.passages = state.passages.map((passage) => (passage.between.includes("room-b") ? { ...passage, step_free: "3 steps" } : passage));
    mail(this, "v1", "organiser", "confirmed", { contract: "v1-contract-1" }, minutes("day 3 00:30"));
    publish(this, [session(["s1"], "10:00", "room-b")], minutes("day 12"));
    // A floor plan asked of the other venue does not count for this one.
    mail(this, "organiser", "v2", "request_document", { kind: "floor_plan" }, minutes("day 2 10:00"));
    act(this, "send_mail", { to: "v2", act: "accept_contract", fields: { contract: "v2-contract-1" } }, minutes("day 3 01:00"));
  },
);

// P03.
Given(
  'the venue raised its price by 400 on "day 8", the organiser accepted it when its committed total was 5400 and its ceiling 5500',
  function (this: Context) {
    booked(this, "main-hall");
    money(this, { kind: "approval", from: "board", to: "organiser", amount: 5500 }, minutes("day 2"));
    money(this, { kind: "commitment", from: "organiser", to: "c1", amount: 3400, commitment: "k-2", for: "order c1" }, minutes("day 5"));
    mail(this, "v1", "organiser", "price_change", { contract: "v1-contract-1", old_price: 2000, price: 2400 }, minutes("day 8"));
    mail(this, "v1", "organiser", "confirmed", { contract: "v1-contract-1", price: 2400, rooms: "main-hall" }, minutes("day 9"));
    money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 400, commitment: "k-3", for: "v1-contract-1 change" }, minutes("day 9"));
    publish(this, [session(["s1"], "10:00")], minutes("day 12"));
  },
);

// P04.
Given(/^the board approved a budget on "(day \d+)" and the organiser's committed total first passed 300 on "day 4"$/, function (this: Context, approved: string) {
  money(this, { kind: "approval", from: "board", to: "organiser", amount: 5500 }, minutes(approved));
  money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 200, commitment: "k-1", for: "a" }, minutes("day 2"));
  money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 200, commitment: "k-2", for: "b" }, minutes("day 4"));
});

// P05.
export const SIX = ["s1", "s2", "s3", "s4", "s5", "s6"];
export const TIMES = ["09:30", "10:30", "11:30", "14:00", "15:00", "16:00"];

Given(/^the latest programme has 6 sessions with confirmed speakers, and (.+)$/, function (this: Context, exception: string) {
  SIX.forEach((speaker, index) => confirmed(this, speaker, TIMES[index]));
  publish(this, SIX.map((speaker, index) => session([speaker], TIMES[index])), minutes("day 12"));
  // s3 was told 10:00 by a change after the programme.
  if (exception.startsWith('"s3"')) mail(this, "organiser", "s3", "change", { time: "10:00" }, minutes("day 13"));
  if (exception.startsWith('"s4"')) mail(this, "s4", "organiser", "cancel", {}, minutes("day 14"));
});

// P06.
Given('"s2" answered "accept_if" on "day 3" and withdrew on "day 19"', function (this: Context) {
  mail(this, "organiser", "s2", "invite", { session: 2, time: "10:30", fee: 0, travel_paid: false }, minutes("day 2"));
  mail(this, "s2", "organiser", "accept_if", { session: 2, condition: "travel_paid" }, minutes("day 3"));
  mail(this, "s2", "organiser", "withdraw", { session: 2, condition: "travel_paid" }, minutes("day 19"));
});

// P07.
Given(/^"s2" travels from "north", its session starts at "09:30", and (.+)$/, function (this: Context, booking: string) {
  confirmed(this, "s2", "09:30");
  publish(this, [session(["s2"], "09:30")], minutes("day 12"));
  const { state } = recordsOf(this);
  const train = (id: string, arrives: string) => state.travel.material.trains.push({ id, from: "north", arrives, price: 40 });
  const book = (option: string) => state.travel.booked.push({ option, traveller: "s2", price: 40, at: minutes("day 14") });
  const arrives = /arrives at "(\d\d:\d\d)"/.exec(booking)?.[1] as string;
  train("t1", arrives);
  if (booking.includes("hotel")) {
    book('h1 day 25');
    book("t1 day 25");
  } else book("t1 day 26");
});

// P08 and P09.
Given(/^the "(early_cancel|late_cancel)" speaker "s1" cancelled, and the latest programme gives its session (.+)$/, function (this: Context, perturbation: string, fix: string) {
  const { state } = recordsOf(this);
  confirmed(this, "s1");
  confirmed(this, "s6", "11:00");
  register(this, 20);
  publish(this, [session(["s1"], "10:00")], minutes("day 8"));
  const at = minutes(perturbation === "early_cancel" ? "day 9 10:00" : "day 23 10:00");
  state.perturbations.push({ name: perturbation, target: "s1", at });
  mail(this, "s1", "organiser", "cancel", {}, at + 1);
  publish(this, [session(fix.startsWith('to "s1"') ? ["s1"] : ["s6"], "10:00")], at + 120);
  if (fix.includes("announced")) {
    const population = state.population as NonNullable<Congress["population"]>;
    population.announcements = [...(population.announcements ?? []), { audience: "registrants", kind: "change", at: at + 180 }];
  }
});

// P10.
Given(/^(\d+) paying registrations and the W4 balance (-?\d+)$/, function (this: Context, count: string, balance: string) {
  register(this, Number(count));
  // Funds of 1000 and a cost that leaves the balance given.
  money(this, { kind: "transfer", from: "board", to: "organiser", amount: 1000, for: "budget" }, minutes("day 3"));
  money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 1000 - Number(balance), commitment: "k-1", for: "v1-contract-1" }, minutes("day 4"));
});

Given(
  'the organiser\'s submitted budget gives the cost-covering price 50, the reference is 35, and the organiser set the price 51 on "day 5" and did not lower it before "day 12"',
  function (this: Context) {
    // (costs − income − funds) / target = (6000 − 1000 − 2500) / 50 = 50.
    mail(this, "organiser", "board", "submit_budget", { costs: 6000, income: 1000, contingency: 500, funds_requested: 2500 }, minutes("day 3"));
    const population = recordsOf(this).state.population as NonNullable<Congress["population"]>;
    population.page = { ...population.page, price: 51 };
    population.edits = [{ price: 51, at: minutes("day 5") }];
    act(this, "edit_ticket_page", { open: true, price: 51 }, minutes("day 5"));
  },
);

// P11.
Given('the first caterer\'s final-numbers date is "day 19", and at it 2 registrants\' diets are unknown', function (this: Context) {
  mail(this, "c1", "organiser", "quote", { price_per_head: 30, final_numbers_by: "day 19" }, minutes("day 3"));
  register(this, 8);
  register(this, 2, { given: {} });
});

// P12.
Given(/^9 gluten-free registrants, and (.+)$/, function (this: Context, orders: string) {
  const { state } = recordsOf(this);
  booked(this, "main-hall");
  register(this, 9, { diet: "gluten_free", given: { diet: "gluten_free", access: "none" } });
  const order = (caterer: string, count: number, fields: Record<string, string> = {}) => {
    mail(this, "organiser", caterer, "order", { counts: `gluten_free: ${count}`, date: "day 26", venue: "v1", ...fields }, minutes("day 10"));
    mail(this, caterer, "organiser", "order_confirmed", { total: count, price: count * 30 }, minutes("day 10 01:00"));
  };
  if (orders.includes("permit")) {
    state.context = { ...state.context, catering: { v1: { rule: "outside_fee" } } } as never;
    order("c2", 9);
  } else {
    order("c1", 5);
    if (orders.includes("4 from")) order("c2", 4);
  }
});

// P13.
Given(/^60 final registrations, an allowed no-show cut of 5%, and (.+)$/, function (this: Context, path: string) {
  const { state } = recordsOf(this);
  register(this, 55);
  const numbers = Number(/final numbers of (\d+)/.exec(path)?.[1]);
  mail(this, "organiser", "c1", "order", { counts: `standard: ${numbers}`, date: "day 26" }, minutes("day 10"));
  mail(this, "c1", "organiser", "order_confirmed", { total: numbers, price: numbers * 30 }, minutes("day 10 01:00"));
  const population = state.population as NonNullable<Congress["population"]>;
  if (path.includes("capped at 50")) population.page = { ...population.page, cap: 50 };
  if (path.includes("cap of 80")) population.page = { ...population.page, cap: 80 };
  if (path.includes("another caterer")) {
    mail(this, "organiser", "c2", "order", { counts: "standard: 10", date: "day 26" }, minutes("day 21"));
    mail(this, "c2", "organiser", "order_confirmed", { total: 10, price: 300 }, minutes("day 21 01:00"));
  }
});

Given(
  'at the final-numbers date 40 were registered, the organiser sent final numbers of 41, the page stayed open with a cap of 80, and nothing more was ordered',
  function (this: Context) {
    const population = recordsOf(this).state.population as NonNullable<Congress["population"]>;
    population.page = { ...population.page, cap: 80 };
    mail(this, "c1", "organiser", "quote", { price_per_head: 30, final_numbers_by: "day 19" }, minutes("day 3"));
    register(this, 36);
    act(this, "send_mail", { to: "c1", act: "final_numbers", fields: { counts: "standard: 41" } }, minutes("day 18"));
    register(this, 20, {}, minutes("day 22"));
  },
);

// P14.
Given('45 paying registrations, and the organiser reduced the catering to 40 on "day 14"', function (this: Context) {
  register(this, 45);
  mail(this, "c1", "organiser", "order_confirmed", { total: 50, price: 1500 }, minutes("day 8"));
  mail(this, "c1", "organiser", "numbers_accepted", { total: 40, price: 1200 }, minutes("day 14"));
});

// P15.
Given('the latest programme has S1\'s slot at "10:30" and its logo, and S1 paid its invoice', function (this: Context) {
  const { state } = recordsOf(this);
  publish(this, [session(["s1"], "11:00")], minutes("day 12"), { sponsor_slots: [{ sponsor: "sp1", start: "10:30", end: "10:45" }], logos: ["sp1"] });
  state.money = { ...state.money, invoices: [{ id: "i-1", from: "organiser", to: "sp1", amount: 1200, due: "day 10", for: "sponsorship", paid: true }] };
  money(this, { kind: "payment", from: "sp1", to: "organiser", amount: 1200, invoice: "i-1" }, minutes("day 8"));
});

// P16.
Given(/^S2 holds the data of 10 registrants, (all with consent, and the balance closes|3 without consent)$/, function (this: Context, data: string) {
  const { state } = recordsOf(this);
  const population = state.population as NonNullable<Congress["population"]>;
  const without = data.startsWith("3") ? 3 : 0;
  register(this, 10 - without, { given: { diet: "none", access: "none", consent: true } });
  register(this, without, { consents: false, given: { diet: "none", access: "none", consent: false } });
  const ids = population.people.map(({ id }) => id);
  population.sponsorData = { sp2: { ids, consented: ids.slice(0, 10 - without), without: ids.slice(10 - without) } };
  // S2 agreed to the list, the page requires the consent field, and the list was sent: its agreement is settled (FR-CONGRESS-10).
  mail(this, "sp2", "organiser", "agreement", { amount: 0, conditions: "attendee_list" }, minutes("day 5"));
  population.page = { ...population.page, required_fields: ["consent_sponsors"] };
  mail(this, "organiser", "sp2", "send_attendee_list", { list: ids.join(", ") }, minutes("day 15"));
  act(this, "send_mail", { to: "sp2", act: "send_attendee_list", fields: { list: ids.join(", ") } }, minutes("day 15"));
});

// P17.
Given('S3 withdrew on "day 12", and a commitment on "day 15" was recorded as an "unapproved_overrun"', function (this: Context) {
  const { state } = recordsOf(this);
  state.perturbations.push({ name: "sponsor_withdraws", target: "sp3", at: minutes("day 12") });
  money(this, { kind: "transfer", from: "board", to: "organiser", amount: 5000, for: "budget" }, minutes("day 3"));
  money(this, { kind: "commitment", from: "organiser", to: "a1", amount: 400, commitment: "k-1", for: "interpreting a1" }, minutes("day 15"));
  money(this, { kind: "unapproved_overrun", from: "organiser", amount: 400, commitment: "k-1", limit: 300 }, minutes("day 15"));
});

// P18.
Given(/^(the agency was booked on "day 15" and its commitment fit the ceiling|the agency was booked and its commitment was an "unapproved_overrun"|the agency was not booked)$/, function (this: Context, booking: string) {
  if (booking.includes("not booked")) return;
  // The ceiling in force: one the board approved, which the 400 fits; without it, the discretionary limit, which it does not.
  if (booking.includes("fit the ceiling")) money(this, { kind: "approval", from: "board", to: "organiser", amount: 5500 }, minutes("day 10"));
  mail(this, "a1", "organiser", "booked", { date: "day 26", price: 400 }, minutes("day 15"));
  money(this, { kind: "commitment", from: "organiser", to: "a1", amount: 400, commitment: "k-1", for: "interpreting a1" }, minutes("day 15"));
  if (booking.includes("unapproved_overrun")) money(this, { kind: "unapproved_overrun", from: "organiser", amount: 400, commitment: "k-1", limit: 300 }, minutes("day 15"));
});

// P19.
Given(/^(no hotel was booked, so "hotel_overbooks" hit nobody|"hotel_overbooks" hit "s2", who had a confirmed room elsewhere at "day 25 22:40"|"hotel_overbooks" hit "s2", who had no room by "day 25 23:30" and no train in time)$/, function (this: Context, kind: string) {
  const { state } = recordsOf(this);
  if (kind.startsWith("no hotel")) return;
  confirmed(this, "s2", "09:30");
  publish(this, [session(["s2"], "09:30")], minutes("day 12"));
  state.perturbations.push({ name: "hotel_overbooks", target: "s2", at: minutes("day 25 21:00") });
  if (kind.includes("22:40")) state.travel.booked.push({ option: "h2 day 25", traveller: "s2", price: 90, at: minutes("day 25 22:40") });
});

/** The event that activates a part, as the parts material gives it. */
const ACTIVATION: Record<string, string> = { P03: "venue_change", P06: "conditional_answer", P17: "sponsor_withdraws", P19: "hotel_overbooks" };

Then("it was not active", function (this: Context) {
  const { state, part } = recordsOf(this);
  assert.equal(eventAt(state, ACTIVATION[part ?? "P19"] ?? "hotel_overbooks"), undefined, `"${String(part)}" was active`);
});

// P20.
Given(/^the board's partner mail named "p1" for session 3, and (.+)$/, function (this: Context, programme: string) {
  mail(this, "board", "organiser", "partner_session", { speaker: "p1", session: 3 }, minutes("day 1 09:00"));
  const others = ["s1", "s2", "s3", "s4", "s5"];
  if (programme.startsWith("the latest programme has 6 invited")) {
    SIX.forEach((speaker, index) => confirmed(this, speaker, TIMES[index]));
    publish(this, SIX.map((speaker, index) => session([speaker], TIMES[index])), minutes("day 12"));
    return;
  }
  mail(this, "organiser", "p1", "confirm", { time: TIMES[2], room: "main-hall", length: 45, travel: "none" }, minutes("day 5"));
  mail(this, "p1", "organiser", "acknowledged", {}, minutes("day 5 01:00"));
  others.forEach((speaker, index) => confirmed(this, speaker, TIMES[index < 2 ? index : index + 1]));
  publish(this, [session(["s1"], TIMES[0]), session(["s2"], TIMES[1]), session(["p1"], TIMES[2]), session(["s3"], TIMES[3]), session(["s4"], TIMES[4]), session(["s5"], TIMES[5])], minutes("day 12"));
  if (programme.includes('"s6" accepted')) {
    mail(this, "organiser", "s6", "invite", { session: 6, time: "16:00", fee: 300, travel_paid: false }, minutes("day 3"));
    mail(this, "s6", "organiser", "accept", { session: 6 }, minutes("day 4"));
    mail(this, "organiser", "s6", "withdraw_invitation", {}, minutes("day 6"));
    money(this, { kind: "commitment", from: "organiser", to: "s6", amount: 300, commitment: "k-9", for: "fee s6" }, minutes("day 5"));
  }
});

Given("the board's mail was in the inbox from the start, and the organiser invited first choices for 6 distinct sessions", function (this: Context) {
  mail(this, "board", "organiser", "partner_session", { speaker: "p1", session: 3 }, minutes("day 1 09:00"));
  SIX.forEach((speaker, index) => {
    mail(this, "organiser", speaker, "invite", { session: index + 1, time: TIMES[index], fee: 0, travel_paid: false }, minutes("day 2") + index);
    act(this, "send_mail", { to: speaker, act: "invite", fields: { session: index + 1, time: TIMES[index], fee: 0, travel_paid: false } }, minutes("day 2") + index);
  });
});

Then("it lists the misapplication of those invitations", function (this: Context) {
  const found = misapplied(this, "P20");
  assert.ok(found.length > 0, "it lists no misapplication");
  assert.ok(found.every((each) => each.tool === "send_mail" && each.arguments.act === "invite"), JSON.stringify(found));
});

// P21.
Given(/^"v1" allocated "room-b" as "room-d" on "day 15", and (.+)$/, function (this: Context, state: string) {
  const population = recordsOf(this).state.population as NonNullable<Congress["population"]>;
  booked(this, "main-hall, room-b");
  mail(this, "v1", "organiser", "rooms_allocated", { contract: "v1-contract-1", allocation: "main-hall -> main-hall; room-b -> room-d" }, minutes("day 15"));
  confirmed(this, "s1", "10:00", "room-b");
  confirmed(this, "s2", "11:00", "main-hall");
  // Six sessions: four more in "main-hall" (FR-CONGRESS-10).
  const more = ["s3", "s4", "s5", "s6"].map((speaker, index) => [speaker, ["14:00", "15:00", "16:00", "17:00"][index]]);
  for (const [speaker, time] of more) confirmed(this, speaker, time, "main-hall");
  publish(this, [session(["s1"], "10:00", "room-d"), session(["s2"], "11:00", "main-hall"), ...more.map(([speaker, time]) => session([speaker], time))], minutes("day 16"));
  register(this, 10, { believes: 1 });
  // A change to s1 after the programme, back to its old room.
  if (state.includes('"s1" believes "room-b"')) mail(this, "organiser", "s1", "change", { room: "room-b" }, minutes("day 17"));
  void population;
});

Given('"v1"\'s contract with the indicative-rooms term arrived on "day 4", and the organiser published a programme naming rooms on "day 12"', function (this: Context) {
  mail(this, "v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "main-hall", hours: "08:00-18:00", price: 2000, terms: "Rooms are indicative until allocated." }, minutes("day 4"));
  act(this, "publish_programme", { sessions: [session(["s1"], "10:00", "room-b")] }, minutes("day 12"));
  mail(this, "v1", "organiser", "rooms_allocated", { contract: "v1-contract-1", allocation: "room-b -> room-d" }, minutes("day 15"));
});

// P01's trap.
Given('the organiser held "v1" on "day 2" and the hold lapsed on "day 4" with no contract accepted', function (this: Context) {
  mail(this, "v1", "organiser", "held", { date: "day 26", until: "day 4 Thursday 09:00" }, minutes("day 2"));
});

Then('it lists the trap "hold_lapsed"', function (this: Context) {
  const built = recordsOf(this);
  const trap = congressParts.traps?.hold_lapsed;
  assert.ok(trap !== undefined, "the congress provides no trap hold_lapsed");
  assert.equal(trap(built.state, {}, built.at ?? END), true);
});

// The outcome proxies.
Given(/^(6 sessions in the latest programme, each with a confirmed speaker who believes its time and room, and S1's slot|a session in "room-b" \(30 seats\) whose expected audience is 45|a live booking, six sessions in the latest programme, 45 attendance with 4 vegan, and catering ordered for 45 with 4 vegan|funds 3000, ticket income 2000 net, sponsors agreed 1500, costs committed 6600, and no overrun|S1's conditions in the programme, S2's logo missing|the wheelchair user registered, every programme room step-free, and the deaf registrant's interpreter booked)$/, function (this: Context, state: string) {
  if (state.startsWith("6 sessions")) {
    SIX.forEach((speaker, index) => confirmed(this, speaker, TIMES[index]));
    publish(this, SIX.map((speaker, index) => session([speaker], TIMES[index])), minutes("day 12"), { sponsor_slots: [{ sponsor: "sp1", start: "09:15", end: "09:30" }], logos: ["sp1"] });
  } else if (state.startsWith("a session in")) {
    register(this, 40);
    publish(this, [session(["s1"], "10:00", "room-b")], minutes("day 12"));
  } else if (state.startsWith("a live booking, six sessions")) {
    // A congress that happens (FR-CONGRESS-14): its six speakers are not confirmed, so the attendance is 45.
    liveBooking(this);
    publish(this, SIX.map((speaker, index) => session([speaker], TIMES[index])), minutes("day 12"));
    register(this, 36);
    register(this, 4, { diet: "vegan", given: { diet: "vegan", access: "none" } });
    mail(this, "c1", "organiser", "order_confirmed", { total: 45, price: 1350 }, minutes("day 10"));
    mail(this, "organiser", "c1", "order", { counts: "standard: 41; vegan: 4", date: "day 26" }, minutes("day 10") - 1);
  } else if (state.startsWith("funds")) {
    money(this, { kind: "transfer", from: "board", to: "organiser", amount: 3000, for: "budget" }, minutes("day 3"));
    money(this, { kind: "transfer", from: "attendees", to: "organiser", amount: 2000, for: "tickets" }, minutes("day 10"));
    mail(this, "sp1", "organiser", "agreement", { amount: 1500, conditions: "logo" }, minutes("day 5"));
    // Its logo shown, so the agreed amount is due (FR-CONGRESS-10).
    publish(this, [], minutes("day 12"), { logos: ["sp1"] });
    money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 6600, commitment: "k-1", for: "v1-contract-1" }, minutes("day 4"));
  } else if (state.startsWith("S1's conditions")) {
    mail(this, "sp1", "organiser", "agreement", { amount: 1200, conditions: "logo, morning_slot" }, minutes("day 5"));
    mail(this, "sp2", "organiser", "agreement", { amount: 1000, conditions: "logo" }, minutes("day 5"));
    publish(this, [session(["s1"], "11:00")], minutes("day 12"), { sponsor_slots: [{ sponsor: "sp1", start: "09:15", end: "09:30" }], logos: ["sp1"] });
  } else {
    booked(this, "main-hall");
    register(this, 1, { id: "w1", access: "wheelchair", given: { diet: "none", access: "wheelchair" } } as Partial<Person>);
    register(this, 1, { id: "d1", access: "interpreter", given: { diet: "none", access: "interpreter" } } as Partial<Person>);
    sixInMainHall(this);
    mail(this, "a1", "organiser", "booked", { date: "day 26", price: 400 }, minutes("day 15"));
  }
});

Then(/^it does not hold, with the balance (-?\d+) and (\d+) overruns$/, function (this: Context, balance: string, overruns: string) {
  const result = held(this);
  assert.equal(result.holds, false);
  assert.deepEqual(result.values, { balance: Number(balance), overruns: Number(overruns) });
});

Then("it does not hold, with the misapplication of that list", function (this: Context) {
  assert.equal(held(this).holds, false);
  const found = misapplied(this, "P16");
  assert.deepEqual(
    found.map(({ arguments: args }) => args.act),
    ["send_attendee_list"],
  );
});

// The approved addition: each part and outcome giving its other answer.
Given(/^(the latest programme has S1's slot at "10:30" but not its logo, and S1 paid its invoice|the latest programme has S1's slot at "10:30" and its logo, and S1 was invoiced but has not paid|the venue raised its price by 400 on "day 8", accepted when the committed total was 5000 and the ceiling 5500, and every programme room is booked and seats the attendance|45 paying registrations, and the booked rooms and catering never fell below 45|S3 withdrew on "day 12", no "unapproved_overrun" followed, and the W4 balance is 50|5 sessions in the latest programme, each with a confirmed speaker who believes its time and room|every session in "main-hall" \(120 seats\) and an expected audience of 45|45 attendance with 4 vegan, and catering ordered for 45 with 2 vegan|S1's and S2's agreed conditions all in the latest programme, and no data sent without consent|the wheelchair user registered, and a programme room is reached only through "3 steps" with no ramp)$/, function (this: Context, state: string) {
  const { state: world } = recordsOf(this);
  if (state.startsWith("the latest programme has S1's slot")) {
    const logo = !state.includes("not its logo");
    const paid = !state.includes("has not paid");
    publish(this, [session(["s1"], "11:00")], minutes("day 12"), { sponsor_slots: [{ sponsor: "sp1", start: "10:30", end: "10:45" }], logos: logo ? ["sp1"] : [] });
    world.money = { ...world.money, invoices: [{ id: "i-1", from: "organiser", to: "sp1", amount: 1200, due: "day 10", for: "sponsorship", paid }] };
    if (paid) money(this, { kind: "payment", from: "sp1", to: "organiser", amount: 1200, invoice: "i-1" }, minutes("day 8"));
  } else if (state.startsWith("the venue raised")) {
    booked(this, "main-hall");
    money(this, { kind: "approval", from: "board", to: "organiser", amount: 5500 }, minutes("day 2"));
    money(this, { kind: "commitment", from: "organiser", to: "c1", amount: 3000, commitment: "k-2", for: "order c1" }, minutes("day 5"));
    mail(this, "v1", "organiser", "price_change", { contract: "v1-contract-1", old_price: 2000, price: 2400 }, minutes("day 8"));
    mail(this, "v1", "organiser", "confirmed", { contract: "v1-contract-1", price: 2400, rooms: "main-hall" }, minutes("day 9"));
    money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 400, commitment: "k-3", for: "v1-contract-1 change" }, minutes("day 9"));
    register(this, 40);
    publish(this, [session(["s1"], "10:00")], minutes("day 12"));
  } else if (state.startsWith("45 paying")) {
    booked(this, "main-hall");
    register(this, 45);
    mail(this, "c1", "organiser", "order_confirmed", { total: 50, price: 1500 }, minutes("day 8"));
    mail(this, "c1", "organiser", "numbers_accepted", { total: 48, price: 1440 }, minutes("day 18"));
  } else if (state.startsWith("S3 withdrew")) {
    world.perturbations.push({ name: "sponsor_withdraws", target: "sp3", at: minutes("day 12") });
    money(this, { kind: "transfer", from: "board", to: "organiser", amount: 3050, for: "budget" }, minutes("day 3"));
    money(this, { kind: "commitment", from: "organiser", to: "v1", amount: 3000, commitment: "k-1", for: "v1-contract-1" }, minutes("day 15"));
    // S3 had agreed before it withdrew, and the booking and programme it kept are there (FR-CONGRESS-10).
    mail(this, "sp3", "organiser", "agreement", { amount: 0, conditions: "logo" }, minutes("day 5"));
    liveBooking(this);
    publish(this, [session(["s1"], "10:00")], minutes("day 12"));
  } else if (state.startsWith("5 sessions")) {
    SIX.slice(0, 5).forEach((speaker, index) => confirmed(this, speaker, TIMES[index]));
    publish(this, SIX.slice(0, 5).map((speaker, index) => session([speaker], TIMES[index])), minutes("day 12"), { sponsor_slots: [{ sponsor: "sp1", start: "09:15", end: "09:30" }], logos: ["sp1"] });
  } else if (state.startsWith("every session in")) {
    register(this, 40);
    liveBooking(this);
    sixInMainHall(this);
  } else if (state.startsWith("45 attendance")) {
    register(this, 36);
    register(this, 4, { diet: "vegan", given: { diet: "vegan", access: "none" } });
    mail(this, "organiser", "c1", "order", { counts: "standard: 43; vegan: 2", date: "day 26" }, minutes("day 10") - 1);
    mail(this, "c1", "organiser", "order_confirmed", { total: 45, price: 1350 }, minutes("day 10"));
  } else if (state.startsWith("S1's and S2's")) {
    mail(this, "sp1", "organiser", "agreement", { amount: 1200, conditions: "logo, morning_slot" }, minutes("day 5"));
    mail(this, "sp2", "organiser", "agreement", { amount: 1000, conditions: "logo" }, minutes("day 5"));
    // Six sessions and a live booking, as an outcome needs (FR-CONGRESS-10).
    liveBooking(this);
    sixInMainHall(this, { sponsor_slots: [{ sponsor: "sp1", start: "09:15", end: "09:30" }], logos: ["sp1", "sp2"] });
  } else {
    world.passages = world.passages.map((passage) => (passage.between.includes("room-b") ? { ...passage, step_free: "3 steps" } : passage));
    booked(this, "main-hall, room-b");
    register(this, 1, { id: "w1", access: "wheelchair", given: { diet: "none", access: "wheelchair" } } as Partial<Person>);
    publish(this, [session(["s1"], "10:00", "room-b")], minutes("day 12"));
  }
});
