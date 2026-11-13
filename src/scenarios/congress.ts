import { type TomlTable, parse } from "smol-toml";
import { type Calendar, type WorldTime, hoursAt, reachedAfterMs, readCalendar, worldTimeText } from "../engine/calendar.ts";
import type { Mail } from "../engine/mail.ts";
import { INVOICE_NOTICE, invoiced } from "../engine/money.ts";
import type { Money } from "../engine/money.ts";
import type { Phone } from "../engine/phone.ts";
import { type Places, arrive, exits, inSight, layout, leave, put, where } from "../engine/places.ts";
import type { Random } from "../engine/random.ts";
import type { Component, Step } from "../engine/components.ts";
import type { Configuration, Scenario } from "../engine/scenario.ts";
import type { Channel } from "../engine/stimuli.ts";
import type { AgentCall, Effector, Sensor, Sight, Tool } from "../engine/tools.ts";
import type { Action } from "../engine/world.ts";
import {
  SPEAKER_CONDITIONS,
  SPEAKER_CONSTRAINTS,
  SPEAKER_PERTURBATIONS,
  SPONSOR_CONDITIONS,
  SPONSOR_PERTURBATION,
  agencyRules,
  boardRules,
  catererRules,
  partnerRules,
  perturbationMinutes,
  speakerRules,
  sponsorRules,
  venueRules,
} from "./congress-parties.ts";
import { describeUniformRhythm, rhythmChannels, uniformRhythm } from "./rhythm.ts";

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The world's travel, whose account invoices the organiser for what it books (FR-CONGRESS-05). */
const TRAVEL = "travel";

/** The place away from which the mail tools take away_factor times their duration. */
const OFFICE = "office";

/** The channel of the person who gives the task: its source is that person, and it delivers their first message. */
const PERSON_CHANNEL = "person";

/** The configuration's texts the organiser meets, in the order each place joins them. */
const TEXTS = ["task", "limits", "restrictions", "knowledge", "guidance"] as const;

/** Where a text goes: the system prompt, or the first message of the person who gives the task. */
type Place = "system" | "person";

/** The longest wait a configuration may allow: a day. */
const MAX_WAIT_MINUTES = 1440;

/** The organiser's durations, in world minutes, by tool, as `[durations]` gives them. */
const DURATION_KEYS = ["check_time", "look", "write_note", "read_notes", "travel_options", "book_travel", "similar_events"] as const;

/** A room of a venue's interior: its id, seats and visible equipment. */
interface Room {
  id: string;
  seats?: number;
  equipment?: string[];
}

/** A venue as the city gives it: its id, its entrance, its interior's rooms and the calendar hours its interior is open. */
interface Venue {
  id: string;
  entrance: string;
  hours: string;
  rooms: Room[];
}

/** A passage as the city gives it: the places it joins, its length in world minutes, and whether it is step-free or what is in the way. */
interface CityPassage {
  between: [string, string];
  length: number;
  step_free: true | string;
}

/** The city as its text gives it. */
interface City {
  places: string[];
  venues: Venue[];
  passages: CityPassage[];
}

/** A room as the world keeps it: its seats and visible equipment, and the venue whose interior it is. */
interface KeptRoom {
  venue: string;
  seats?: number;
  equipment?: string[];
}

/** The congress's world (FR-CONGRESS-01). */
export interface Congress {
  space: Places;
  /** Each passage of the space with its length and step_free. */
  passages: CityPassage[];
  /** Each chosen venue's interior rooms, by id. */
  rooms: Record<string, KeptRoom>;
  /** Each chosen venue's entrance and hours, by its id. */
  venues: Record<string, { entrance: string; hours: string }>;
  calendar: Calendar;
  /** The organiser's notes, in the order first written. */
  notes: { title: string; text: string }[];
  settings: { durations: Record<string, number>; waitMaxMinutes: number; awayFactor: number };
  mail: Mail;
  phone: Phone;
  /** The money, which the engine puts here as a run starts when the configuration declares [money] (FR-MONEY-01). */
  money: Money;
  /** The travel material, each train's draw for selling out, and what was booked for whom (FR-CONGRESS-05). */
  travel: { material: Travel; soldOutDraws: Record<string, number>; booked: { option: string; traveller: string; price: number }[] };
  /** The similar congresses of the drawn topic (FR-CONGRESS-05). */
  similar: { name: string; price: number; size: number }[];
}

/** A key of the congress that cannot be followed: an error that names it, its value and why. */
function refused(key: string, value: unknown, why: string): Error {
  return new Error(`The configuration's ${key} ${JSON.stringify(value) ?? "(none)"} cannot be followed: ${why}`);
}

/** One of the configuration's TOML texts, parsed; one that is not TOML is refused, naming its key. */
function textOf(configuration: Configuration, key: string): TomlTable {
  try {
    return parse(configuration[key] as string);
  } catch (error) {
    throw new Error(`The configuration's ${key} is not valid TOML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Refuses an id given twice among those listed, naming it. */
function assertDistinct(ids: readonly string[], key: string): void {
  const twice = ids.find((id, index) => ids.indexOf(id) !== index);
  if (twice !== undefined) throw refused(key, ids, `the id "${twice}" is given twice`);
}

/**
 * The city of the configuration (FR-CONGRESS-01); one it cannot follow is refused, naming it: two places with one id, a
 * venue without an entrance or whose hours the calendar does not declare, a passage between places the city does not
 * declare, and a step_free that is neither true nor a text.
 */
function cityOf(configuration: Configuration, calendar: Calendar | undefined): City {
  const text = textOf(configuration, "city");
  const places = ((text.places ?? []) as TomlTable[]).map(({ id }) => id as string);
  const venues = ((text.venues ?? []) as TomlTable[]).map(({ id, entrance, hours, rooms = [] }): Venue => {
    if (typeof entrance !== "string") throw refused(`city venue "${String(id)}" entrance`, entrance, `the venue "${String(id)}" has no entrance`);
    if (typeof hours !== "string" || calendar === undefined || !Object.hasOwn(calendar.hours, hours)) {
      throw refused(`city venue "${String(id)}" hours`, hours, `the calendar declares no hours "${String(hours)}" for the venue "${String(id)}"`);
    }
    return { id: id as string, entrance, hours, rooms: rooms as unknown as Room[] };
  });
  const all = [...places, ...venues.flatMap(({ entrance, rooms }) => [entrance, ...rooms.map(({ id }) => id)])];
  assertDistinct(all, "city places");
  assertDistinct(
    venues.map(({ id }) => id),
    "city venues",
  );
  const passages = ((text.passages ?? []) as TomlTable[]).map((passage) => {
    const { between, length, step_free: stepFree } = passage as unknown as CityPassage;
    const unknown = between.find((place) => !all.includes(place));
    if (unknown !== undefined) throw refused("city passages", between, `the city declares no place "${unknown}"`);
    if (stepFree !== true && typeof stepFree !== "string") throw refused("city passages step_free", stepFree, "it is neither true nor a text of what is in the way");
    return { between, length, step_free: stepFree };
  });
  return { places, venues, passages };
}

/** The organiser's settings, refused, naming the key: a wait_max_minutes outside 1 to 1440, an away_factor below 1, a negative duration. */
function settingsOf(configuration: Configuration): Congress["settings"] {
  const waitMaxMinutes = configuration.wait_max_minutes as number;
  if (!(Number.isInteger(waitMaxMinutes) && waitMaxMinutes >= 1 && waitMaxMinutes <= MAX_WAIT_MINUTES)) throw refused("wait_max_minutes", waitMaxMinutes, `it is not a whole number of minutes from 1 to ${MAX_WAIT_MINUTES}`);
  const awayFactor = configuration.away_factor as number;
  if (!(typeof awayFactor === "number" && awayFactor >= 1)) throw refused("away_factor", awayFactor, "it is not a number of at least 1");
  const given = configuration.durations as TomlTable;
  const durations = Object.fromEntries(
    DURATION_KEYS.map((key) => {
      const minutes = given[key];
      if (typeof minutes !== "number" || !(minutes >= 0)) throw refused(`durations.${key}`, minutes, "it is not a number of world minutes of at least 0");
      return [key, minutes];
    }),
  );
  return { durations, waitMaxMinutes, awayFactor };
}

/** What a replica's variant drew: its topic, its target attendance and each kind's chosen template ids. */
interface Drawn {
  topic: string;
  attendance: number;
  chosen: Record<string, string[]>;
}

/** The pools' templates of each kind, by kind, refusing two templates with one id. */
function templatesOf(pools: TomlTable): Record<string, TomlTable[]> {
  const kinds = Object.fromEntries(Object.entries(pools).filter(([kind, templates]) => kind !== "topics" && Array.isArray(templates))) as Record<string, TomlTable[]>;
  assertDistinct(
    Object.values(kinds).flatMap((templates) => templates.map(({ id }) => id as string)),
    "pools",
  );
  return kinds;
}

/** Draws n templates of a pool, each once, from the replica's sequence. */
function chooseFrom(templates: readonly TomlTable[], count: number, random: Random): TomlTable[] {
  const left = [...templates];
  return Array.from({ length: count }, () => left.splice(Math.floor(random.next() * left.length), 1)[0]);
}

/**
 * The replica's variant (FR-CONGRESS-01): its topic, its target attendance (a whole number in the draw's range) and each
 * kind's templates, drawn from the replica's sequence; each chosen template of a kind with `[kinds.<kind>]` becomes a
 * participant named by its id, with its kind's settings and its template's parameters, and gets a mailbox and a line
 * when the configuration has mail and a phone. A draw it cannot make is refused, naming its key.
 */
function variant(configuration: Configuration, random: Random): { configuration: Configuration; drawn: Readonly<Record<string, unknown>> } {
  const pools = textOf(configuration, "pools");
  const draw = textOf(configuration, "draw");
  const kinds = templatesOf(pools);
  const settings = (configuration.kinds ?? {}) as TomlTable;
  for (const kind of Object.keys(settings)) if (!Object.hasOwn(kinds, kind)) throw refused(`kinds.${kind}`, settings[kind], `the pools have no template of the kind "${kind}"`);
  const { attendance = [0, 0], ...counts } = draw;
  const [fewest, most] = attendance as number[];
  if (!(typeof fewest === "number" && typeof most === "number" && fewest <= most)) throw refused("draw.attendance", attendance, "it is not two numbers, the first not above the second");
  const topics = (pools.topics ?? []) as string[];
  const drawn: Drawn = { topic: topics[Math.floor(random.next() * topics.length)], attendance: fewest + Math.floor(random.next() * (most - fewest + 1)), chosen: {} };
  const templates: TomlTable[] = [];
  for (const [kind, count] of Object.entries(counts)) {
    const pool = kinds[kind];
    if (kind === "partner" && typeof count === "number" && count > 1) throw refused("draw.partner", count, "the congress has one partner");
    if (pool === undefined) throw refused(`draw.${kind}`, count, `the pools have no template of the kind "${kind}"`);
    if (typeof count !== "number" || !(count >= 0 && count <= pool.filter(({ in_house_for: inHouse }) => inHouse === undefined).length)) throw refused(`draw.${kind}`, count, `the pool of "${kind}" has ${pool.length} templates`);
    // A venue's in-house caterer comes with its venue, not from the draw (FR-CONGRESS-05).
    const drawable = pool.filter(({ in_house_for: inHouse }) => inHouse === undefined);
    const chosen = chooseFrom(drawable, count, random);
    drawn.chosen[kind] = chosen.map(({ id }) => id as string);
    if (Object.hasOwn(settings, kind)) templates.push(...chosen.map((template) => ({ ...template, kind })));
  }
  if (Object.hasOwn(settings, "caterer")) {
    const venues = drawn.chosen.venue ?? [];
    templates.push(...(kinds.caterer ?? []).filter(({ in_house_for: inHouse }) => venues.includes(inHouse as string)).map((template) => ({ ...template, kind: "caterer" })));
  }
  const calendar = configuration.calendar === undefined ? undefined : readCalendar(configuration.calendar);
  const city = cityOf(configuration, calendar);
  assertParties(kinds, settings, city);
  travelOf(configuration, city);
  const perturbations = perturbationsOf(configuration, kinds);
  const chosenVenues = templates.filter(({ kind }) => kind === "venue");
  const accounts: Record<string, TomlTable> = {};
  const participants = Object.fromEntries(
    templates.map(({ id, kind, reply_minutes: replyMinutes, hours, ...params }) => {
      const { account, ...kept } = settings[kind as string] as TomlTable;
      if (account === "unlimited") accounts[id as string] = { unlimited: true };
      else if (typeof account === "string") accounts[id as string] = { opening: params[account] as number };
      // A template's reply delay and hours are its participant's, in place of its kind's.
      const own = { ...(replyMinutes === undefined ? {} : { reply_minutes: replyMinutes }), ...(hours === undefined ? {} : { hours }) };
      // A missed ring is called back from the ring's end to the party's reply delay after it (FR-CONGRESS-07).
      const ring = (configuration.phone as TomlTable | undefined)?.ring_minutes as number | undefined;
      const [, slowest = 0] = ((replyMinutes ?? kept.reply_minutes ?? []) as number[]);
      const callBack: TomlTable = ring === undefined ? {} : { call_back_minutes: [ring, ring + slowest] };
      const world = worldOf(kept.rules, id as string, configuration, city, perturbations, chosenVenues);
      return [id as string, { decides: "rules", ...kept, ...own, params: { ...params, ...callBack, ...world } }];
    }),
  );
  const names = Object.keys(participants);
  const mail = configuration.mail as TomlTable | undefined;
  const phone = configuration.phone as TomlTable | undefined;
  const money = configuration.money as TomlTable | undefined;
  const completed: Configuration = {
    ...configuration,
    participants: { ...((configuration.participants ?? {}) as TomlTable), ...participants },
    drawn: drawn as unknown as TomlTable,
    ...(mail === undefined ? {} : { mail: { ...mail, mailboxes: [...((mail.mailboxes ?? []) as string[]), ...names], initial: [...((mail.initial ?? []) as TomlTable[]), ...partnerSession(templates, drawn, (configuration.calendar as TomlTable | undefined)?.start)] } }),
    ...(phone === undefined ? {} : { phone: { ...phone, lines: [...((phone.lines ?? []) as string[]), ...names] } }),
    ...(money === undefined ? {} : { money: { ...money, accounts: { ...((money.accounts ?? {}) as TomlTable), ...accounts } } }),
  };
  return { configuration: completed, drawn: { ...drawn, ...referencePrice(configuration, drawn.topic) } };
}

/**
 * The board's mail about the partner's session (FR-CONGRESS-04), in the organiser's mailbox at the calendar's start:
 * the partner drawn, and the session it prefers; none when no partner is drawn.
 */
function partnerSession(templates: readonly TomlTable[], drawn: Drawn, start: unknown): TomlTable[] {
  const partner = templates.find(({ kind }) => kind === "partner");
  if (partner === undefined || start === undefined) return [];
  const fields = { speaker: partner.id as string, session: partner.session as number };
  return [{ from: drawn.chosen.board?.[0] ?? "board", to: ORGANISER, act: "partner_session", fields, received: start as string }];
}

/** The organiser, whom the congress's parties answer. */
const ORGANISER_NAME = "organiser";

/** Whether a share is a number from 0 to 1. */
const isShare = (value: unknown): value is number => typeof value === "number" && value >= 0 && value <= 1;

/**
 * Refuses, naming it, a party the congress's rule sets cannot follow (FR-CONGRESS-02): a venue in the pools that the city
 * does not declare; for a kind decided by the rule set "venue", a template without rooms, price or access_claim, a
 * deposit_share, cancellation share or pick_up outside 0 to 1; for one decided by "board", a template without funds.
 */
function assertParties(kinds: Readonly<Record<string, TomlTable[]>>, settings: TomlTable, city: City): void {
  for (const { id } of kinds.venue ?? []) {
    if (!city.venues.some((venue) => venue.id === id)) throw refused("pools venue", id, `the city declares no venue "${String(id)}"`);
  }
  for (const [kind, templates] of Object.entries(kinds)) {
    const rules = (settings[kind] as TomlTable | undefined)?.rules;
    for (const template of templates) {
      const naming = (key: string, why: string) => refused(`pools ${kind} "${String(template.id)}" ${key}`, template[key], why);
      if (rules === "venue") {
        if (!Array.isArray(template.rooms) || template.rooms.length === 0) throw naming("rooms", "a venue needs its rooms");
        if (typeof template.price !== "number" || !(template.price > 0)) throw naming("price", "a venue needs a price");
        if (typeof template.access_claim !== "string") throw naming("access_claim", "a venue needs the access it claims");
        if (!isShare(template.deposit_share)) throw naming("deposit_share", "it is not a share from 0 to 1");
        if (!Array.isArray(template.cancellation) || !(template.cancellation as TomlTable[]).every(({ share }) => isShare(share))) throw naming("cancellation", "its shares are not from 0 to 1");
        if (template.pick_up !== undefined && !isShare(template.pick_up)) throw naming("pick_up", "it is not a probability from 0 to 1");
      }
      if (rules === "board" && typeof template.funds !== "number") throw naming("funds", "a board needs its funds");
      if (rules === "speaker" || rules === "partner") assertSpeaker(template, rules, naming);
      if (rules === "caterer") assertCaterer(template, kinds.venue ?? [], naming);
      if (rules === "sponsor") assertSponsor(template, naming);
    }
  }
}

/**
 * Refuses, naming it, a speaker template the speaker rule set cannot follow (FR-CONGRESS-04): an acceptance or pick_up
 * outside 0 to 1, a draw outside 0 to 3, a negative fee, a condition or constraint it does not know. A partner has no
 * acceptance of its own.
 */
function assertSpeaker(template: TomlTable, rules: "speaker" | "partner", naming: (key: string, why: string) => Error): void {
  if ((rules === "speaker" || template.acceptance !== undefined) && !isShare(template.acceptance)) throw naming("acceptance", "it is not a probability from 0 to 1");
  if (template.pick_up !== undefined && !isShare(template.pick_up)) throw naming("pick_up", "it is not a probability from 0 to 1");
  if (template.draw !== undefined && !(Number.isInteger(template.draw) && (template.draw as number) >= 0 && (template.draw as number) <= 3)) throw naming("draw", "it is not a whole number from 0 to 3");
  if (template.fee !== undefined && !(typeof template.fee === "number" && template.fee >= 0)) throw naming("fee", "it is not an amount of at least 0");
  if (template.condition !== undefined && !(SPEAKER_CONDITIONS as readonly unknown[]).includes(template.condition)) throw naming("condition", `it is none of ${SPEAKER_CONDITIONS.join(", ")}`);
  if (template.constraint !== undefined && !(SPEAKER_CONSTRAINTS as readonly unknown[]).includes(template.constraint)) throw naming("constraint", `it is none of ${SPEAKER_CONSTRAINTS.join(", ")}`);
}

/** Whether a value is an amount of at least 0. */
const isAmount = (value: unknown) => typeof value === "number" && value >= 0;

/**
 * Refuses, naming it, a caterer template the caterer rule set cannot follow (FR-CONGRESS-05): a negative price per head,
 * diet limit or minimum, a final_days below 1, or an in_house_for that is no venue in the pools.
 */
function assertCaterer(template: TomlTable, venues: readonly TomlTable[], naming: (key: string, why: string) => Error): void {
  if (!isAmount(template.price_per_head)) throw naming("price_per_head", "it is not an amount of at least 0");
  const diets = (template.diets ?? {}) as Record<string, TomlTable>;
  if (Object.values(diets).some(({ limit }) => limit !== undefined && !isAmount(limit))) throw naming("diets", "a limit is not a number of at least 0");
  if (template.minimum !== undefined && !isAmount(template.minimum)) throw naming("minimum", "it is not a number of at least 0");
  if (!(typeof template.final_days === "number" && template.final_days >= 1)) throw naming("final_days", "it is not a number of days of at least 1");
  if (template.in_house_for !== undefined && !venues.some(({ id }) => id === template.in_house_for)) throw naming("in_house_for", "it is no venue in the pools");
}

/**
 * Refuses, naming it, a sponsor template the sponsor rule set cannot follow (FR-CONGRESS-05): a negative amount, a
 * condition it does not know, one it insists on that is not among its conditions, a counter_acceptance outside 0 to 1,
 * and pay_days whose first number is above its second.
 */
function assertSponsor(template: TomlTable, naming: (key: string, why: string) => Error): void {
  if (!isAmount(template.amount)) throw naming("amount", "it is not an amount of at least 0");
  const conditions = (template.conditions ?? []) as string[];
  if (!conditions.every((condition) => (SPONSOR_CONDITIONS as readonly string[]).includes(condition))) throw naming("conditions", `they are not among ${SPONSOR_CONDITIONS.join(", ")}`);
  if (!((template.insists ?? []) as string[]).every((condition) => conditions.includes(condition))) throw naming("insists", "it insists on a condition that is not among its conditions");
  if (template.counter_acceptance !== undefined && !isShare(template.counter_acceptance)) throw naming("counter_acceptance", "it is not a probability from 0 to 1");
  const [fewest, most] = (template.pay_days ?? []) as number[];
  if (!(isAmount(fewest) && isAmount(most) && fewest <= most)) throw naming("pay_days", "it is not two numbers of days, the first not above the second");
}

/** A train of the travel material: its id, its station, the time it arrives at the city's station, and its base price. */
interface Train {
  id: string;
  from: string;
  arrives: string;
  price: number;
}

/** A hotel of the travel material: its id, the venue it is near, its rooms each night, and its base price. */
interface Hotel {
  id: string;
  near: string;
  rooms: number;
  price: number;
}

/** The travel material (FR-CONGRESS-05): its stations, trains and hotels, and the probability a train sells out in the last 2 days. */
interface Travel {
  stations: string[];
  trains: Train[];
  hotels: Hotel[];
  sold_out_probability: number;
}

/** The configuration's travel, refused, naming "travel", when a train names no station or a hotel no venue of the city. */
function travelOf(configuration: Configuration, city: City): Travel {
  const text = textOf(configuration, "travel") as unknown as Partial<Travel>;
  const travel: Travel = { stations: text.stations ?? [], trains: text.trains ?? [], hotels: text.hotels ?? [], sold_out_probability: text.sold_out_probability ?? 0 };
  const train = travel.trains.find(({ from }) => !travel.stations.includes(from));
  if (train !== undefined) throw refused("travel", train, `the train "${train.id}" leaves from "${train.from}", which is no station`);
  const hotel = travel.hotels.find(({ near }) => !city.venues.some(({ id }) => id === near));
  if (hotel !== undefined) throw refused("travel", hotel, `the hotel "${hotel.id}" is near "${hotel.near}", which is no venue`);
  return travel;
}

/** A similar event of the material: its topic, name, price and size. */
interface SimilarEvent {
  topic: string;
  name: string;
  price: number;
  size: number;
}

/** The similar events of a topic, in the material's order. */
function similarEvents(configuration: Configuration, topic: string): SimilarEvent[] {
  return ((textOf(configuration, "similar_events").events ?? []) as unknown as SimilarEvent[]).filter((event) => event.topic === topic);
}

/** The congress's reference price: the median price of the similar events of its topic; none when there are none. */
function referencePrice(configuration: Configuration, topic: string): { reference_price?: number } {
  const prices = similarEvents(configuration, topic)
    .map(({ price }) => price)
    .sort((one, other) => one - other);
  if (prices.length === 0) return {};
  const middle = Math.floor(prices.length / 2);
  return { reference_price: prices.length % 2 === 1 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2 };
}

/** A perturbation as the configuration declares it (NFR-13): its name, kind, window or time, and the venue it is for, if one. */
interface Perturbation {
  name: string;
  kind?: string;
  between?: [string, string];
  at?: string;
  for?: string;
}

/** The configuration's perturbations, refused, naming them, when their times do not follow "day <n> HH:MM" or they are for no venue. */
function perturbationsOf(configuration: Configuration, kinds: Readonly<Record<string, TomlTable[]>>): Perturbation[] {
  return Object.entries((configuration.perturbations ?? {}) as TomlTable).map(([name, written]) => {
    const declared = { name, ...(written as TomlTable) } as unknown as Perturbation;
    const times = [...(declared.between ?? []), ...(declared.at === undefined ? [] : [declared.at])];
    if (times.length === 0 || times.some((time) => perturbationMinutes(time) === undefined)) throw refused(`perturbations.${name}`, written, 'its times do not follow "day <n> HH:MM"');
    // A sponsor's withdrawal is for a sponsor; the others are a venue's.
    const kind = name === SPONSOR_PERTURBATION ? "sponsor" : "venue";
    if ((declared.for !== undefined || kind === "sponsor") && !(kinds[kind] ?? []).some(({ id }) => id === declared.for)) throw refused(`perturbations.${name}`, written, `"${String(declared.for)}" is no ${kind}`);
    return declared;
  });
}

/** The perturbations that are no venue's: the speakers' cancellations and a sponsor's withdrawal. */
const NOT_A_VENUES = [...SPEAKER_PERTURBATIONS, SPONSOR_PERTURBATION];

/**
 * What the world adds to a party's parameters, by its rule set: a venue gets the organiser it answers, the event's day,
 * its interior's true floor plan from the city and the perturbations for it; a board gets the organiser.
 */
function worldOf(rules: unknown, id: string, configuration: Configuration, city: City, perturbations: readonly Perturbation[], venues: readonly TomlTable[]): TomlTable {
  if (rules === "board") return { organiser: ORGANISER_NAME };
  // A caterer knows each chosen venue's catering rule (FR-CONGRESS-07).
  if (rules === "caterer") return { organiser: ORGANISER_NAME, event_day: configuration.event_day as number, venues: Object.fromEntries(venues.map(({ id: venue, catering }): [string, TomlTable] => [venue as string, catering === undefined ? {} : { catering }])) };
  if (rules === "speaker" || rules === "partner" || rules === "agency") return { organiser: ORGANISER_NAME, event_day: configuration.event_day as number };
  if (rules === "sponsor") return { organiser: ORGANISER_NAME };
  if (rules !== "venue") return {};
  const venue = city.venues.find((each) => each.id === id) as Venue;
  const inside = [venue.entrance, ...venue.rooms.map((room) => room.id)];
  return {
    id,
    organiser: ORGANISER_NAME,
    event_day: configuration.event_day as number,
    floor_plan: city.passages.filter(({ between }) => between.every((place) => inside.includes(place))).map(({ between, step_free: stepFree }) => ({ between, step_free: stepFree })),
    perturbations: perturbations.filter((each) => !NOT_A_VENUES.includes(each.name) && (each.for === undefined || each.for === id)) as unknown as TomlTable[],
  };
}

/** The congress's world as a replica starts: the city's places, the chosen venues', the organiser in its place, no notes. */
function initialState(configuration: Configuration, random: Random): Congress {
  const calendar = configuration.calendar === undefined ? undefined : readCalendar(configuration.calendar);
  const city = cityOf(configuration, calendar);
  const settings = settingsOf(configuration);
  const chosen = ((configuration.drawn as unknown as Drawn | undefined)?.chosen.venue ?? []) as string[];
  const venues = city.venues.filter(({ id }) => chosen.includes(id));
  const places = [...city.places, ...venues.flatMap(({ entrance, rooms }) => [entrance, ...rooms.map(({ id }) => id)])];
  const passages = city.passages.filter(({ between }) => between.every((place) => places.includes(place)));
  const start = configuration.organiser_place as string;
  if (!places.includes(start)) throw refused("organiser_place", start, "the city has no such place, or its venue was not chosen");
  if (calendar === undefined) throw new Error("The congress cannot be followed: its durations are world time, and the configuration declares no [calendar]");
  const travel = travelOf(configuration, city);
  return {
    space: put(
      layout(
        places,
        passages.map(({ between, length }) => ({ between, length })),
      ),
      ORGANISER,
      start,
    ),
    passages,
    rooms: Object.fromEntries(venues.flatMap(({ id, rooms }) => rooms.map(({ id: room, ...kept }) => [room, { venue: id, ...kept }]))),
    venues: Object.fromEntries(venues.map(({ id, entrance, hours }) => [id, { entrance, hours }])),
    calendar,
    notes: [],
    settings,
    mail: { mailboxes: {}, inTransit: [] },
    phone: { calls: [] },
    money: { balances: {}, invoices: [], commitments: [], ceilings: {}, overruns: [], events: [] },
    // Each train's draw for selling out comes from the travel's own sequence, the replica's initial state's.
    travel: { material: travel, soldOutDraws: Object.fromEntries(travel.trains.map(({ id }) => [id, random.next()])), booked: [] },
    similar: similarEvents(configuration, (configuration.drawn as unknown as Drawn | undefined)?.topic ?? "").map(({ name, price, size }) => ({ name, price, size })),
  };
}

/** The place the organiser is in; in a passage, none. */
function hereOf({ space }: Congress, agent: string): string | undefined {
  const at = where(space, agent);
  return at !== undefined && "place" in at ? at.place : undefined;
}

/** The venue whose entrance or interior a place is, if any. */
function venueAt(state: Congress, place: string): string | undefined {
  return state.rooms[place]?.venue ?? Object.entries(state.venues).find(([, { entrance }]) => entrance === place)?.[0];
}

/** Whether a venue's interior is closed at the world's time; open when the run gives no world time. */
function isClosed(state: Congress, venue: string, world: WorldTime | undefined): boolean {
  return world !== undefined && !hoursAt(state.calendar, state.venues[venue].hours, world).within;
}

/** Whether a place is the interior of a venue that is closed at the world's time. */
function closedInterior(state: Congress, place: string, world: WorldTime | undefined): boolean {
  const room = state.rooms[place];
  return room !== undefined && isClosed(state, room.venue, world);
}

/** The exits of a place, each with its passage's length and step_free, but none into a closed interior. */
function exitsOf(state: Congress, place: string, world: WorldTime | undefined) {
  return exits(state.space, place)
    .filter(({ place: to }) => !closedInterior(state, to, world) || state.rooms[place] !== undefined)
    .map(({ place: to, length }) => {
      const passage = state.passages.find(({ between }) => between.includes(place) && between.includes(to)) as CityPassage;
      return { place: to, length, step_free: passage.step_free };
    });
}

/** Who the organiser sees from where it is: the space's other entities. */
function peopleInSight(state: Congress, agent: string): string[] {
  return inSight(state.space, agent);
}

/** "look": as JSON, the place, whether its venue's interior is closed, its exits, a room's seats and equipment, and who is in sight. */
const look: Sensor<Congress> = {
  kind: "sensor",
  name: "look",
  description: "Look around: where you are, the passages that leave it (each with its length in minutes and whether it is step-free or what is in the way), a room's seats and equipment, and who is in sight.",
  parameters: { type: "object", properties: {} },
  durationMs: (state) => ({ worldSeconds: state.settings.durations.look * 60 }),
  sense: (state, agent, _args, _sinceStartMs, world) => {
    const place = hereOf(state, agent) as string;
    const venue = venueAt(state, place);
    const closed = venue !== undefined && isClosed(state, venue, world);
    const room = state.rooms[place];
    return JSON.stringify({
      place,
      ...(closed ? { closed: true } : {}),
      exits: exitsOf(state, place, world),
      ...(room?.seats === undefined ? {} : { seats: room.seats }),
      ...(room?.equipment === undefined ? {} : { equipment: room.equipment }),
      people: peopleInSight(state, agent),
    });
  },
};

/** Who is in sight as a go or a wait ends, which follows its text (FR-WORKPLACE-08). */
function whoIsInSight(outcomes: readonly string[]): Sight<Congress> {
  return {
    outcomes,
    of: "who is in sight",
    see: (state, agent) => {
      const people = peopleInSight(state, agent);
      return { text: people.length === 0 ? "Nobody is in sight." : `In sight: ${people.join(", ")}.`, seen: JSON.stringify(people) };
    },
  };
}

/** A place that is not one passage away from the organiser's. */
const INVALID_TARGET = "invalid_target";
/** The organiser's own place. */
const ALREADY_THERE = "already_there";
/** A venue's interior while it is closed. */
const CLOSED = "closed";

/** The passage's length from the organiser's place to the place a call names, or none when no passage joins them. */
function lengthTo(state: Congress, call: AgentCall): number | undefined {
  const here = hereOf(state, call.agent);
  return here === undefined ? undefined : exits(state.space, here).find(({ place }) => place === call.arguments.place)?.length;
}

/** An action on the space, as an action on the congress's world. */
function inSpace<Args, SpaceArgs>(action: Action<Places, SpaceArgs>, read: (args: Args) => SpaceArgs): Action<Congress, Args> {
  return {
    precondition: (state, args) => action.precondition(state.space, read(args)),
    effect: (state, args) => ({ ...state, space: action.effect(state.space, read(args)) }),
  };
}

/** A call of "go" as the space's leave reads it. */
const leaving = ({ agent, arguments: args }: AgentCall) => ({ entity: agent, towards: args.place as string });

/** "go place": the passage's length in world minutes (FR-SPACE-03); into a closed interior it fails as closed, taking no time. */
const go: Effector<Congress> = {
  kind: "effector",
  name: "go",
  description: "Go to a place one passage away, as look gives its exits. It takes the passage's length in minutes.",
  parameters: { type: "object", properties: { place: { type: "string" } }, required: ["place"] },
  refuses: (state, call, world) =>
    lengthTo(state, call) !== undefined && closedInterior(state, call.arguments.place as string, world) ? { outcome: CLOSED, reason: "the venue is closed at this hour" } : undefined,
  durationMs: (state, call) => ({ worldSeconds: (lengthTo(state, call) ?? 0) * 60 }),
  start: {
    ...inSpace(leave, leaving),
    appliesTo: (state, call) => lengthTo(state, call) !== undefined,
    describe: (state, call) => ({ left: hereOf(state, call.agent), towards: leaving(call).towards }),
  },
  action: {
    precondition: (state, call) => {
      const at = where(state.space, call.agent);
      if (at !== undefined && "place" in at) return { holds: false, reason: at.place === call.arguments.place ? ALREADY_THERE : INVALID_TARGET };
      return inSpace(arrive, () => ({ entity: call.agent })).precondition(state, call);
    },
    effect: (state, call) => inSpace(arrive, () => ({ entity: call.agent })).effect(state, call),
  },
  texts: {
    success: "You have arrived.",
    [INVALID_TARGET]: "There is no passage from here to that place; you have not moved.",
    [ALREADY_THERE]: "You are already there; you have not moved.",
    [CLOSED]: "closed: the venue is closed at this hour; you have not moved.",
  },
  sight: whoIsInSight(["success"]),
  readTarget: () => "not_sensed",
};

/** "check_time": the world's time. */
const checkTime: Sensor<Congress> = {
  kind: "sensor",
  name: "check_time",
  description: "Check the day and the time.",
  parameters: { type: "object", properties: {} },
  durationMs: (state) => ({ worldSeconds: state.settings.durations.check_time * 60 }),
  sense: (_state, _agent, _args, _sinceStartMs, world) => (world === undefined ? "The time is unknown." : worldTimeText(world)),
};

/** "write_note title text": keeps a note, replacing one with the same title. */
const writeNote: Effector<Congress> = {
  kind: "effector",
  name: "write_note",
  description: "Write a note for yourself under a title; a note with the same title is replaced.",
  parameters: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"] },
  durationMs: (state) => ({ worldSeconds: state.settings.durations.write_note * 60 }),
  action: {
    precondition: () => ({ holds: true }),
    effect: (state, { arguments: { title, text } }) => {
      const kept = state.notes.some((note) => note.title === title);
      const note = { title: title as string, text: text as string };
      return { ...state, notes: kept ? state.notes.map((each) => (each.title === title ? note : each)) : [...state.notes, note] };
    },
  },
  texts: { success: "Noted." },
  readTarget: () => "not_sensed",
};

/** A note the organiser has not written. */
const NO_SUCH_NOTE = "no_such_note";

/** "read_notes title?": every note's title, or one note's text. */
const readNotes: Effector<Congress> = {
  kind: "effector",
  name: "read_notes",
  description: "Read your notes: without a title, the title of each note; with one, that note's text.",
  parameters: { type: "object", properties: { title: { type: "string" } } },
  refuses: (state, { arguments: { title } }) =>
    title === undefined || state.notes.some((note) => note.title === title) ? undefined : { outcome: NO_SUCH_NOTE, reason: `you have no note "${String(title)}"` },
  durationMs: (state) => ({ worldSeconds: state.settings.durations.read_notes * 60 }),
  reply: {
    of: "the notes' titles, one per line, or the note's text",
    text: (state, { arguments: { title } }) =>
      title === undefined ? (state.notes.length === 0 ? "No notes." : state.notes.map((note) => note.title).join("\n")) : (state.notes.find((note) => note.title === title)?.text as string),
  },
  texts: { [NO_SUCH_NOTE]: "no_such_note: you have no note with that title" },
  readTarget: () => "not_sensed",
};

/** The outcome of a wait that something ended early. */
const INTERRUPTED = "interrupted";

/** "wait minutes": from 1 to wait_max_minutes world minutes, ended early by any stimulus or by someone who comes into sight (FR-WORKPLACE-07). */
const wait: Effector<Congress> = {
  kind: "effector",
  name: "wait",
  description: "Wait for a number of minutes, doing nothing. If something reaches you or someone comes into sight, you stop waiting.",
  parameters: { type: "object", properties: { minutes: { type: "integer" } }, required: ["minutes"] },
  refuses: (state, call) => {
    const minutes = call.arguments.minutes as number;
    const max = state.settings.waitMaxMinutes;
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= max ? undefined : { outcome: "invalid_arguments", reason: `"wait" takes from 1 to ${max} minutes` };
  },
  durationMs: (_state, call) => ({ worldSeconds: (call.arguments.minutes as number) * 60 }),
  endsEarly: {
    outcome: INTERRUPTED,
    byChange: (before, after, call) => peopleInSight(after, call.agent).some((person) => !peopleInSight(before, call.agent).includes(person)),
    byStimulus: () => true,
  },
  texts: { success: "You have waited.", [INTERRUPTED]: "Something happened; you stopped waiting." },
  sight: whoIsInSight(["success", INTERRUPTED]),
  readTarget: () => "not_sensed",
};

/** World minutes since day 1's midnight of a world time. */
const minutesOfWorld = ({ day, seconds }: WorldTime) => (day - 1) * 1440 + seconds / 60;

/** Whether a speaker has cancelled, by mail or by a call to the organiser, as the world's mail and phone hold it. */
function hasCancelled(state: Congress, speaker: string): boolean {
  const mailed = [...(state.mail.mailboxes[ORGANISER] ?? []), ...state.mail.inTransit].some(({ from, act }) => from === speaker && act === "cancel");
  return mailed || state.phone.calls.some(({ from, to, act }) => from === speaker && to === ORGANISER && act === "cancel");
}

/** When a confirm from the organiser reached a speaker's mailbox, in world minutes; none when none has. */
function confirmedAt(state: Congress, speaker: string): number | undefined {
  const confirm = (state.mail.mailboxes[speaker] ?? []).find(({ from, act }) => from === ORGANISER && act === "confirm");
  return confirm === undefined ? undefined : minutesOfWorld(confirm.received);
}

/** How long two days are after a speaker is confirmed when early_cancel found none confirmed at its time. */
const NEXT_CONFIRMED_DELAY_MINUTES = 2 * 1440;

/** How often a cancellation that waits for the next speaker to be confirmed looks again at the world's mail, in world minutes. */
const LOOK_AGAIN_MINUTES = 60;

/**
 * A speaker's cancellation (FR-CONGRESS-04), a perturbation component: from its own sequence it draws its time (in its
 * window, or at its time) and an order of the speakers; at that time it takes the first speaker in that order whom a
 * confirm from the organiser has reached and who has not cancelled, and delivers it the illness on its own channel, not
 * held. early_cancel, finding none, waits for the next to be confirmed and delivers 2 days after its confirm reached it;
 * late_cancel, finding none, ends.
 */
function cancellation(declared: Perturbation, speakers: readonly string[], calendar: Calendar): Component<Congress> {
  return {
    name: declared.name,
    kind: "perturbation",
    description:
      declared.name === "early_cancel"
        ? `At a time drawn between ${String(declared.between?.join(" and "))}, makes the first confirmed speaker, in an order it draws, cancel by mail; with none confirmed, the next to be confirmed, 2 days after.`
        : `At ${String(declared.at)}, makes a confirmed speaker who has not cancelled, in an order it draws, cancel by a call, and by mail if the call is not answered.`,
    cycle: (random) => {
      const [from, to] = (declared.between ?? [declared.at, declared.at]).map((time) => perturbationMinutes(time) as number);
      const time = from + random.next() * (to - from);
      const left = [...speakers];
      const order = speakers.map(() => left.splice(Math.floor(random.next() * left.length), 1)[0]);
      let done = false;
      const waitUntil = (minutes: number, now: number, sinceStartMs: number): Step<Congress> => ({ kind: "wait", ms: reachedAfterMs(calendar, sinceStartMs, (minutes - now) * 60) });
      return {
        next: (state, _outcome, sinceStartMs, world) => {
          const now = minutesOfWorld(world as WorldTime);
          if (done) return { kind: "end" };
          if (now < time) return waitUntil(time, now, sinceStartMs);
          const standing = order.filter((speaker) => !hasCancelled(state, speaker));
          const confirmed = standing.filter((speaker) => (confirmedAt(state, speaker) ?? Infinity) <= time);
          const hit = (speaker: string): Step<Congress> => {
            done = true;
            return { kind: "deliver", agent: speaker, channel: declared.name, held: false };
          };
          if (confirmed.length > 0) return hit(confirmed[0]);
          if (declared.name !== "early_cancel") return { kind: "end" };
          // The next to be confirmed after its time, the first in its order on a tie.
          const next = standing.filter((speaker) => confirmedAt(state, speaker) !== undefined).sort((one, other) => (confirmedAt(state, one) as number) - (confirmedAt(state, other) as number))[0];
          if (next === undefined) return waitUntil(now + LOOK_AGAIN_MINUTES, now, sinceStartMs);
          const fires = (confirmedAt(state, next) as number) + NEXT_CONFIRMED_DELAY_MINUTES;
          return now < fires ? waitUntil(fires, now, sinceStartMs) : hit(next);
        },
      };
    },
  };
}

/**
 * A sponsor's withdrawal (FR-CONGRESS-05), a perturbation component: at a time drawn in its window from its own
 * sequence, it delivers the withdrawal to the sponsor it is for, not held.
 */
function sponsorWithdrawal(declared: Perturbation, calendar: Calendar): Component<Congress> {
  return {
    name: declared.name,
    kind: "perturbation",
    description: `At a time drawn between ${String(declared.between?.join(" and ") ?? declared.at)}, makes "${String(declared.for)}" withdraw its sponsorship.`,
    cycle: (random) => {
      const [from, to] = (declared.between ?? [declared.at, declared.at]).map((time) => perturbationMinutes(time) as number);
      const time = from + random.next() * (to - from);
      let done = false;
      return {
        next: (_state, _outcome, sinceStartMs, world) => {
          const now = minutesOfWorld(world as WorldTime);
          if (done) return { kind: "end" };
          if (now < time) return { kind: "wait", ms: reachedAfterMs(calendar, sinceStartMs, (time - now) * 60) };
          done = true;
          return { kind: "deliver", agent: declared.for as string, channel: declared.name, held: false };
        },
      };
    },
  };
}

/** The speakers' cancellations and a sponsor's withdrawal the configuration declares. */
function components(configuration: Configuration): Component<Congress>[] {
  const declared = Object.entries((configuration.perturbations ?? {}) as TomlTable)
    .filter(([name]) => SPEAKER_PERTURBATIONS.includes(name) || name === SPONSOR_PERTURBATION)
    .map(([name, written]) => ({ name, ...(written as TomlTable) }) as unknown as Perturbation);
  if (declared.length === 0) return [];
  const calendar = readCalendar(configuration.calendar);
  const speakers = Object.entries((configuration.participants ?? {}) as TomlTable)
    .filter(([, participant]) => (participant as TomlTable).rules === "speaker")
    .map(([name]) => name);
  return declared.map((each) => (each.name === SPONSOR_PERTURBATION ? sponsorWithdrawal(each, calendar) : cancellation(each, speakers, calendar)));
}

/** The factor by which the organiser's web tools take longer away from the office (FR-CONGRESS-01, FR-CONGRESS-07). */
function awayFactorOf(state: Congress, agent: string): number {
  return agent === ORGANISER && hereOf(state, agent) !== OFFICE ? state.settings.awayFactor : 1;
}

/** How many days before its date a train's price starts to rise, and by how much it has risen on the day. */
const PRICE_RISE_DAYS = 14;
const PRICE_RISE = 0.8;

/** How many days before its date a train may be sold out. */
const SOLD_OUT_DAYS = 2;

/** A train's price for a date, from the world's day: its base price, rising in the last two weeks. */
function trainPrice(train: Train, date: number, today: number): number {
  return Math.round(train.price * (1 + (PRICE_RISE * Math.max(0, PRICE_RISE_DAYS - (date - today))) / PRICE_RISE_DAYS));
}

/** Whether a train is sold out for a date on the world's day: in its last 2 days, with the material's probability. */
function soldOut(state: Congress, train: Train, date: number, today: number): boolean {
  return date - today <= SOLD_OUT_DAYS && (state.travel.soldOutDraws[train.id] ?? 1) < state.travel.material.sold_out_probability;
}

/** The rooms of a hotel left on a night, "<hotel> day <n>", after what was booked. */
function roomsLeft(state: Congress, hotel: Hotel, option: string): number {
  return hotel.rooms - state.travel.booked.filter((booking) => booking.option === option).length;
}

/** The day of a date "day <n>". */
const dayOfDate = (date: unknown) => Number(/^day (\d+)$/.exec(String(date))?.[1]);

/** "travel_options from date": the trains from a station arriving on a date, and the hotels with rooms the night before, as JSON. */
const travelOptions: Sensor<Congress> = {
  kind: "sensor",
  name: "travel_options",
  description: 'The trains from a station that arrive on a date ("day <n>"), with their times and prices, and the hotels near the venues with rooms left the night before, with their prices.',
  parameters: { type: "object", properties: { from: { type: "string" }, date: { type: "string" } }, required: ["from", "date"] },
  durationMs: (state, call) => ({ worldSeconds: state.settings.durations.travel_options * 60 * awayFactorOf(state, call.agent) }),
  sense: (state, _agent, { from, date }, _sinceStartMs, world) => {
    const day = dayOfDate(date);
    const today = (world as WorldTime).day;
    const night = `day ${day - 1}`;
    return JSON.stringify({
      trains: state.travel.material.trains
        .filter((train) => train.from === from)
        .map((train) => ({ id: train.id, option: `${train.id} day ${day}`, arrives: train.arrives, price: trainPrice(train, day, today), sold_out: soldOut(state, train, day, today) })),
      hotels: state.travel.material.hotels.map((hotel) => ({ id: hotel.id, near: hotel.near, option: `${hotel.id} ${night}`, rooms_left: roomsLeft(state, hotel, `${hotel.id} ${night}`), price: hotel.price })),
    });
  },
};

/** An option no train or hotel of the travel has. */
const NO_SUCH_OPTION = "no_such_option";
/** A train sold out, or a hotel with no room left. */
const SOLD_OUT = "sold_out";

/** What a travel option books, "<train or hotel> day <n>", and its price on the world's day; undefined when there is no such option. */
function optionOf(state: Congress, option: unknown, today: number): { price: number; full: boolean } | undefined {
  const [, id, day] = /^(\S+) day (\d+)$/.exec(String(option)) ?? [];
  const train = state.travel.material.trains.find((each) => each.id === id);
  if (train !== undefined) return { price: trainPrice(train, Number(day), today), full: soldOut(state, train, Number(day), today) };
  const hotel = state.travel.material.hotels.find((each) => each.id === id);
  if (hotel !== undefined) return { price: hotel.price, full: roomsLeft(state, hotel, String(option)) <= 0 };
  return undefined;
}

/** "book_travel option traveller": books a train or a hotel night for a traveller; the travel's account invoices the organiser for it. */
const bookTravel: Effector<Congress> = {
  kind: "effector",
  name: "book_travel",
  description: 'Book a travel option, as travel_options gives it ("t1 day 26"), for a traveller; the travel invoices you for it.',
  parameters: { type: "object", properties: { option: { type: "string" }, traveller: { type: "string" } }, required: ["option", "traveller"] },
  durationMs: (state) => ({ worldSeconds: state.settings.durations.book_travel * 60 }),
  action: {
    precondition: (state, { arguments: { option }, world }) => {
      const found = optionOf(state, option, (world as WorldTime).day);
      if (found === undefined) return { holds: false, reason: NO_SUCH_OPTION };
      return found.full ? { holds: false, reason: SOLD_OUT } : { holds: true };
    },
    effect: (state, { agent, arguments: { option, traveller }, world }) => {
      const today = (world as WorldTime).day;
      const { price } = optionOf(state, option, today) as { price: number };
      return {
        ...state,
        travel: { ...state.travel, booked: [...state.travel.booked, { option: String(option), traveller: String(traveller), price }] },
        money: invoiced(state.money, { from: TRAVEL, to: agent, amount: price, due: `day ${today}`, for: `${String(option)} ${String(traveller)}` }),
      };
    },
  },
  texts: { success: "Booked; the travel invoices you for it.", [NO_SUCH_OPTION]: "no_such_option: there is no such travel option", [SOLD_OUT]: "sold_out: that option is sold out" },
  readTarget: () => "not_sensed",
};

/** "similar_events": the similar congresses of the topic, with their prices and sizes, as JSON. */
const similarEventsTool: Sensor<Congress> = {
  kind: "sensor",
  name: "similar_events",
  description: "The similar congresses of your congress's topic, with their ticket prices and sizes.",
  parameters: { type: "object", properties: {} },
  durationMs: (state, call) => ({ worldSeconds: state.settings.durations.similar_events * 60 * awayFactorOf(state, call.agent) }),
  sense: (state) => JSON.stringify(state.similar),
};

/** The organiser's own tools, besides the mail's and the phone's. */
const TOOLS: readonly Tool<Congress>[] = [checkTime, look, go, writeNote, readNotes, wait, travelOptions, bookTravel, similarEventsTool];

/** The configuration's placement; one that names a text the congress does not have, or no place, is refused, naming it. */
function placementOf(configuration: Configuration): Readonly<Record<string, Place>> {
  const placement = configuration.placement as Record<string, string>;
  for (const [text, place] of Object.entries(placement)) {
    if (!(TEXTS as readonly string[]).includes(text)) throw refused(`placement.${text}`, place, `the congress's texts are ${TEXTS.join(", ")}`);
    if (place !== "system" && place !== "person") throw refused(`placement.${text}`, place, 'a text goes to "system" or "person"');
  }
  return placement as Record<string, Place>;
}

/** The configuration's texts placed in a place, in order, each that holds something, joined with a blank line between them. */
function textsIn(configuration: Configuration, place: Place): string {
  const placement = placementOf(configuration);
  return TEXTS.filter((key) => placement[key] === place)
    .map((key) => configuration[key] as string)
    .filter((text) => text !== "")
    .join("\n\n");
}

/** How each of the organiser's tools takes its time, for the inventory. */
function describeDuration(configuration: Configuration, tool: string): string {
  const durations = configuration.durations as Record<string, number>;
  const described: Record<string, string> = {
    check_time: `${durations.check_time} world minutes.`,
    look: `${durations.look} world minutes.`,
    go: "The passage's length, in world minutes; no time when there is no passage to that place or its venue is closed.",
    write_note: `${durations.write_note} world minutes.`,
    read_notes: `${durations.read_notes} world minutes.`,
    wait: `The minutes it is given, in world minutes, up to ${String(configuration.wait_max_minutes)}; it ends early at a stimulus or when someone comes into sight.`,
    travel_options: `${durations.travel_options} world minutes.`,
    book_travel: `${durations.book_travel} world minutes.`,
    similar_events: `${durations.similar_events} world minutes.`,
  };
  if (!Object.hasOwn(described, tool)) throw new Error(`The congress has no tool "${tool}"`);
  return described[tool];
}

/** What the inventory gives of the congress's world. */
function worldInventory(configuration: Configuration): Readonly<Record<string, unknown>> {
  const calendar = configuration.calendar === undefined ? undefined : readCalendar(configuration.calendar);
  const city = cityOf(configuration, calendar);
  return {
    places: city.places,
    venues: city.venues,
    passages: city.passages,
    draw: textOf(configuration, "draw"),
    kinds: configuration.kinds ?? {},
    durations: configuration.durations,
    wait_max_minutes: configuration.wait_max_minutes,
    away_factor: configuration.away_factor,
    prompt: Object.fromEntries(TEXTS.map((key) => [key, configuration[key]])),
    placement: configuration.placement,
  };
}

/** The congress's base configuration: a city of one office, one topic and a fixed attendance, no party, and what the organiser knows. */
const BASE_CONFIGURATION = [
  'task = ""',
  'limits = ""',
  'restrictions = ""',
  // The engine refuses an empty system prompt: the base gives the organiser one text there.
  'knowledge = "You organise a congress."',
  'guidance = ""',
  'task_giver = "The board"',
  'organiser_place = "office"',
  "city = '''",
  "[[places]]",
  'id = "office"',
  "'''",
  "pools = '''",
  'topics = ["congress"]',
  "venue = []",
  "board = []",
  "speaker = []",
  "partner = []",
  "caterer = []",
  "sponsor = []",
  "agency = []",
  "'''",
  "draw = '''",
  "attendance = [100, 100]",
  "'''",
  "event_day = 26",
  "travel = '''",
  "stations = []",
  "trains = []",
  "hotels = []",
  "sold_out_probability = 0",
  "'''",
  "similar_events = '''",
  "events = []",
  "'''",
  "away_factor = 1.0",
  "wait_max_minutes = 60",
  "[calendar]",
  'start = "day 1 Monday 09:00"',
  "[[calendar.segments]]",
  "scale = 60",
  "[mail]",
  'mailboxes = ["organiser"]',
  "delivery_minutes = [1, 1]",
  "send_minutes = 0",
  "check_minutes = 0",
  "read_minutes = 0",
  'notice_source = "mail client"',
  'notice = "New mail from {from}: {subject}"',
  "[phone]",
  'lines = ["organiser"]',
  "ring_minutes = 5",
  "call_minutes = 4",
  'ring = "{from} calls ({call}): {act}. {fields}{text}"',
  "[money]",
  "discretionary_limit = 300",
  // The world's travel, which invoices the organiser for what it books (FR-CONGRESS-05).
  "[money.accounts.travel]",
  "unlimited = true",
  "[money.accounts.organiser]",
  "opening = 0",
  'tools = ["ledger", "pay", "issue_invoice"]',
  "[kinds.venue]",
  'rules = "venue"',
  'tools = ["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "ledger", "commit", "release", "issue_invoice"]',
  'channels = ["mail_notice", "phone"]',
  "reply_minutes = [0, 0]",
  'account = "unlimited"',
  "[kinds.board]",
  'rules = "board"',
  'tools = ["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "approve", "transfer"]',
  'channels = ["mail_notice", "phone"]',
  "reply_minutes = [0, 0]",
  'account = "funds"',
  ...[
    ["caterer", '["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "ledger", "commit", "release", "issue_invoice"]', '["mail_notice", "phone"]', '"unlimited"'],
    ["sponsor", '["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "ledger", "pay"]', `["mail_notice", "phone", "${SPONSOR_PERTURBATION}", "${INVOICE_NOTICE}"]`, '"amount"'],
    ["agency", '["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "ledger", "commit", "release"]', '["mail_notice", "phone"]', '"unlimited"'],
  ].flatMap(([kind, tools, channels, account]) => [`[kinds.${kind}]`, `rules = "${kind}"`, `tools = ${tools}`, `channels = ${channels}`, "reply_minutes = [0, 0]", `account = ${account}`]),
  ...["speaker", "partner"].flatMap((kind) => [
    `[kinds.${kind}]`,
    `rules = "${kind}"`,
    'tools = ["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "commit", "issue_invoice"]',
    `channels = ["mail_notice", "phone", ${SPEAKER_PERTURBATIONS.map((name) => `"${name}"`).join(", ")}]`,
    "reply_minutes = [0, 0]",
    'account = "unlimited"',
  ]),
  "[perturbations]",
  "[durations]",
  "check_time = 0",
  "look = 0",
  "write_note = 0",
  "read_notes = 0",
  "travel_options = 0",
  "book_travel = 0",
  "similar_events = 0",
  "[rhythm]",
  'source = "rhythm"',
  'text = "You wake up."',
  "min_ms = 0",
  "max_ms = 1000",
  "[placement]",
  'task = "person"',
  'limits = "system"',
  'restrictions = "system"',
  'knowledge = "system"',
  'guidance = "system"',
  "",
].join("\n");

/**
 * The congress scenario (FR-CONGRESS-01): one organiser in a city and its venues, read from the configuration's texts,
 * with the parties a replica's variant draws from the pools as participants.
 */
export const congressScenario: Scenario<Congress> = {
  name: "congress",
  agents: () => [ORGANISER],
  initialState,
  tools: TOOLS,
  channels: (configuration): Channel[] => [
    ...rhythmChannels(configuration),
    { name: PERSON_CHANNEL, source: configuration.task_giver as string, stimulus: textsIn(configuration, "person") },
    // What makes a speaker cancel: an illness, which reaches it on the perturbation's own channel (FR-CONGRESS-04).
    ...SPEAKER_PERTURBATIONS.map((name) => ({ name, source: "illness", stimulus: "You are ill and cannot give your session." })),
    { name: SPONSOR_PERTURBATION, source: "the sponsor's board", stimulus: "Your board withdraws the sponsorship." },
    // An invoice reaches its recipient from its issuer, as a message does (FR-CONGRESS-05).
    { name: INVOICE_NOTICE, source: "money", stimulus: "New invoice from {from}: {for}" },
  ],
  metrics: {},
  firstStimuli: (configuration) => (textsIn(configuration, "person") === "" ? [] : [PERSON_CHANNEL]),
  systemPrompt: (configuration) => textsIn(configuration, "system"),
  rhythm: uniformRhythm,
  describeDuration,
  describeRhythm: describeUniformRhythm,
  mail: { of: (state) => state.mail, with: (state, mail) => ({ ...state, mail }) },
  phone: { of: (state) => state.phone, with: (state, phone) => ({ ...state, phone }) },
  money: { of: (state) => state.money, with: (state, money) => ({ ...state, money }) },
  components,
  worldAccounts: [TRAVEL],
  ruleSets: { venue: venueRules, board: boardRules, speaker: speakerRules, partner: partnerRules, caterer: catererRules, sponsor: sponsorRules, agency: agencyRules },
  variant,
  slowedBy: awayFactorOf,
  worldInventory,
  baseConfiguration: BASE_CONFIGURATION,
};
