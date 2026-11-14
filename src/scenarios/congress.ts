import { type TomlTable, parse } from "smol-toml";
import { type Calendar, type WorldTime, hoursAt, reachedAfterMs, readCalendar, worldTimeText } from "../engine/calendar.ts";
import type { Mail } from "../engine/mail.ts";
import { INVOICE_NOTICE, invoiced, stamped, withCommitment, withRelease } from "../engine/money.ts";
import type { Money } from "../engine/money.ts";
import type { Phone } from "../engine/phone.ts";
import { type Places, arrive, exits, inSight, layout, leave, put, where } from "../engine/places.ts";
import { Random } from "../engine/random.ts";
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
  VENUE_CHANGE,
  agencyRules,
  boardRules,
  catererRules,
  partnerRules,
  perturbationMinutes,
  speakerRules,
  sponsorRules,
  venueRules,
} from "./congress-parties.ts";
import { actsOf as recordedActs, bookingsOf, congressParts } from "./congress-parts.ts";
import { type AttendeesMaterial, type Population, minutesOfTime, populationComponent, populationTools } from "./population.ts";
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
const DURATION_KEYS = ["check_time", "look", "write_note", "read_notes", "travel_options", "book_travel", "similar_events", "edit_ticket_page", "ticket_page", "publish_programme", "announce", "read_programme"] as const;

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

/** What the congress's parts read besides the records (FR-CONGRESS-06): world times are world minutes since day 1's midnight. */
export interface PartsContext {
  eventDay: number;
  helpers: number;
  target: number;
  endOfPreparation: number;
  roles: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  noShowCut: number;
  discretionaryLimit: number;
  /** Each travelling speaker's station, by its id. */
  homes?: Readonly<Record<string, string>>;
  /** Each chosen venue's catering rule and in-house caterer, by its id. */
  catering?: Readonly<Record<string, { rule?: string; inHouse?: string }>>;
  /** Each speaker's fee, by its id, against which a fee condition is met (FR-CONGRESS-10). */
  fees?: Readonly<Record<string, number>>;
  /** The drawn speakers, the partner's among them, and sponsors, by id (FR-CONGRESS-09). */
  ids?: { speakers: readonly string[]; sponsors: readonly string[] };
  /** The organiser's ceiling from the start, the budget when the draw gives one, and its opening balance (FR-CONGRESS-12). */
  ceiling?: number;
  opening?: number;
  /** The run's start, in world minutes (FR-CONGRESS-12). */
  start?: number;
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
  settings: { durations: Record<string, number>; waitMaxMinutes: number; awayFactor: number; discretionaryLimit: number };
  mail: Mail;
  phone: Phone;
  /** The money, which the engine puts here as a run starts when the configuration declares [money] (FR-MONEY-01). */
  money: Money;
  /** The travel material, each train's draw for selling out, and what was booked for whom (FR-CONGRESS-05). */
  travel: { material: Travel; soldOutDraws: Record<string, number>; booked: { option: string; traveller: string; price: number; at?: number }[] };
  /** Each perturbation as it fired: its name, its target and its world time, in world minutes (FR-CONGRESS-06). */
  perturbations: { name: string; target: string; at: number }[];
  /** What the congress's parts read besides the records (FR-CONGRESS-06). */
  context: PartsContext;
  /** Each place the organiser entered, with its world time, in world minutes (FR-CONGRESS-06). */
  visits?: { place: string; at: number }[];
  /** The similar congresses of the drawn topic (FR-CONGRESS-05). */
  similar: { name: string; price: number; size: number }[];
  /** The attendees, the ticket page and the programme, when the configuration gives an attendees material (FR-POPULATION-01). */
  population?: Population;
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
  // A commitment the world records counts toward overruns as the money's own do (FR-CONGRESS-05).
  const discretionaryLimit = ((configuration.money as TomlTable | undefined)?.discretionary_limit as number | undefined) ?? Infinity;
  return { durations, waitMaxMinutes, awayFactor, discretionaryLimit };
}

/** What a replica's variant drew: its topic, its target attendance and each kind's chosen template ids. */
interface Drawn {
  topic: string;
  attendance: number;
  chosen: Record<string, string[]>;
  /** Each kind's roles, each with the templates that fill it (FR-CONGRESS-01's addition). */
  roles?: Record<string, Record<string, string[]>>;
  /** The cost-covering price, the reference price and the gap between them, when the draw gives a price_gap. */
  cost_covering_price?: number;
  reference_price?: number;
  price_gap?: number;
  /** The spending limit and the money the association advances the organiser, when the draw gives them (FR-CONGRESS-11). */
  budget?: number;
  advance?: number;
  /** The cheapest feasible plan's cost at the target and its early deposits, and the share of the target the reference price breaks even at (FR-CONGRESS-13). */
  plan_cost?: number;
  early_deposits?: number;
  break_even_share?: number;
  /** Whether each chosen speaker accepts, drawn with the variant (FR-CONGRESS-11). */
  accepts?: Record<string, boolean>;
}

/** A kind's draw as `[draw.<kind>]` gives it: a count, roles with their counts, and a venue role priced as the cheapest fit. */
interface KindDraw {
  count?: number;
  roles?: Record<string, number>;
  cheapest_fit?: string;
  cheapest_margin?: [number, number];
  /** For the speakers: how many available ones must accept, redrawn until they do (FR-CONGRESS-11). */
  min_accepting?: number;
}

/** How many times the variant redraws the speakers to find min_accepting who accept (FR-CONGRESS-11). */
const SPEAKER_REDRAWS = 100;

/** Whether a value is two numbers above 0, the first not above the second. */
const isRange = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every((each) => typeof each === "number" && each > 0) && (value[0] as number) <= (value[1] as number);

/** The most seats one of a venue template's rooms has. */
const seatsOf = (template: TomlTable) => Math.max(0, ...((template.rooms ?? []) as { seats?: number }[]).map(({ seats = 0 }) => seats));

/**
 * A kind's templates by its draw, from the replica's sequence: each role filled by distinct templates that carry it, a
 * template filling one role at most, then the count from templates with no role; refused, naming it, when a role is asked
 * for more often than the pool carries it or the count is more than the pool has.
 */
function drawKind(kind: string, pool: readonly TomlTable[], draw: KindDraw, random: Random): { chosen: TomlTable[]; roles: Record<string, string[]> } {
  const taken: TomlTable[] = [];
  const roles: Record<string, string[]> = {};
  for (const [role, count] of Object.entries(draw.roles ?? {})) {
    const carriers = pool.filter((template) => ((template.roles ?? []) as string[]).includes(role));
    if (!(Number.isInteger(count) && count >= 0 && count <= carriers.length)) throw refused(`draw.${kind}.roles.${role}`, count, `the role "${role}" is carried by ${carriers.length} template${carriers.length === 1 ? "" : "s"} of the pool`);
    const filled = chooseFrom(
      carriers.filter((template) => !taken.includes(template)),
      count,
      random,
    );
    if (filled.length < count || filled.some((template) => template === undefined)) throw refused(`draw.${kind}.roles.${role}`, count, `the role "${role}" has too few templates left once the other roles are filled`);
    taken.push(...filled);
    roles[role] = filled.map(({ id }) => id as string);
  }
  const unroled = pool.filter((template) => ((template.roles ?? []) as string[]).length === 0);
  const count = draw.count ?? 0;
  if (!(typeof count === "number" && count >= 0 && count <= unroled.length)) throw refused(`draw.${kind}.count`, count, `the pool of "${kind}" has ${unroled.length} templates with no role`);
  return { chosen: [...taken, ...chooseFrom(unroled, count, random)], roles };
}

/**
 * The chosen speakers, each with its `accepts`, true with its acceptance, from a sequence of its own for each draw, derived
 * from the variant's (FR-CONGRESS-04, FR-CONGRESS-11):
 * with min_accepting, the speakers are drawn again, the whole draw, until at least that many available ones accept, up
 * to 100 times; refused, naming draw.speaker.min_accepting, when they never do.
 */
function withAcceptance(first: TomlTable[], drawAgain: () => TomlTable[], minAccepting: number | undefined, seed: number): TomlTable[] {
  if (minAccepting !== undefined && !(Number.isInteger(minAccepting) && minAccepting >= 0)) throw refused("draw.speaker.min_accepting", minAccepting, "it is not a whole number of at least 0");
  let chosen = first;
  for (let draws = 1; ; draws += 1) {
    const drawn: TomlTable[] = chosen.map((template) => ({ ...template, accepts: Random.derive(seed, `acceptance of ${String(template.id)}, draw ${draws}`).next() < ((template.acceptance as number | undefined) ?? 1) }));
    if (minAccepting === undefined || drawn.filter(({ available, accepts }) => available === true && accepts).length >= minAccepting) return drawn;
    if (draws >= SPEAKER_REDRAWS) throw refused("draw.speaker.min_accepting", minAccepting, `fewer available speakers accepted in each of ${SPEAKER_REDRAWS} draws`);
    chosen = drawAgain().map((template) => ({ ...template }));
  }
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

/** Draws n of a pool's templates, or of any items, each once, in the order drawn, from the replica's sequence. */
function chooseFrom<Item>(templates: readonly Item[], count: number, random: Random): Item[] {
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
  const { attendance = [0, 0], price_gap: priceGap, budget, advance, budget_over_plan: budgetOverPlan, advance_over_deposits: advanceOverDeposits, break_even_share: breakEvenShare, ...counts } = draw;
  if (priceGap !== undefined && !isRange(priceGap)) throw refused("draw.price_gap", priceGap, "it is not two numbers above 0, the first not above the second");
  // The money a draw may give from the cheapest feasible plan, in place of the numbers themselves (FR-CONGRESS-13).
  for (const [key, value, replaced, bounds] of [
    ["budget_over_plan", budgetOverPlan, ["budget", budget], "two numbers, the first at least 1 and not above the second"],
    ["advance_over_deposits", advanceOverDeposits, ["advance", advance], "two numbers, the first at least 1 and not above the second"],
    ["break_even_share", breakEvenShare, ["price_gap", priceGap], "two numbers from 0 to 1, the first not above the second"],
  ] as const) {
    if (value === undefined) continue;
    if (replaced[1] !== undefined) throw refused(`draw.${key}`, value, `the draw gives "${replaced[0]}" too, which it replaces`);
    const lowest = key === "break_even_share" ? 0 : 1;
    const highest = key === "break_even_share" ? 1 : Infinity;
    const fits = Array.isArray(value) && value.length === 2 && value.every((each) => typeof each === "number" && each >= lowest && each <= highest) && (value[0] as number) <= (value[1] as number);
    if (!fits) throw refused(`draw.${key}`, value, `it is not ${bounds}`);
  }
  const [fewest, most] = attendance as number[];
  if (!(typeof fewest === "number" && typeof most === "number" && fewest <= most)) throw refused("draw.attendance", attendance, "it is not two numbers, the first not above the second");
  const topics = (pools.topics ?? []) as string[];
  // The seed of each speaker's own acceptance sequence, the variant's first draw, so another speaker in the pool changes
  // no speaker's acceptance (FR-CONGRESS-04, FR-CONGRESS-11).
  const acceptances = Math.floor(random.next() * 2 ** 32);
  const drawn: Drawn = { topic: topics[Math.floor(random.next() * topics.length)], attendance: fewest + Math.floor(random.next() * (most - fewest + 1)), chosen: {} };
  // The budget and the advance, each a whole number between its two (FR-CONGRESS-11).
  for (const [key, range] of [["budget", budget], ["advance", advance]] as const) {
    if (range === undefined) continue;
    if (!isRange(range)) throw refused(`draw.${key}`, range, "it is not two numbers above 0, the first not above the second");
    drawn[key] = Math.ceil(range[0]) + Math.floor(random.next() * (Math.floor(range[1]) - Math.ceil(range[0]) + 1));
  }
  const templates: TomlTable[] = [];
  /** Every chosen template, by kind, whether or not its kind makes it a participant. */
  const chosenOf: Record<string, TomlTable[]> = {};
  for (const [kind, count] of Object.entries(counts)) {
    const pool = kinds[kind];
    if (kind === "partner" && typeof count === "number" && count > 1) throw refused("draw.partner", count, "the congress has one partner");
    if (pool === undefined) throw refused(`draw.${kind}`, count, `the pools have no template of the kind "${kind}"`);
    // A venue's in-house caterer comes with its venue, not from the draw (FR-CONGRESS-05).
    const drawable = pool.filter(({ in_house_for: inHouse }) => inHouse === undefined);
    const drawOnce = (): TomlTable[] => {
      if (typeof count === "number") {
        if (!(count >= 0 && count <= drawable.length)) throw refused(`draw.${kind}`, count, `the pool of "${kind}" has ${pool.length} templates`);
        return chooseFrom(drawable, count, random);
      }
      const byRole = count as unknown as KindDraw;
      if (byRole.cheapest_margin !== undefined && !isRange(byRole.cheapest_margin)) throw refused(`draw.${kind}.cheapest_margin`, byRole.cheapest_margin, "it is not two numbers above 0, the first not above the second");
      const drawnByRole = drawKind(kind, drawable, byRole, random);
      if (Object.keys(drawnByRole.roles).length > 0) drawn.roles = { ...drawn.roles, [kind]: drawnByRole.roles };
      return drawnByRole.chosen;
    };
    let chosen = drawOnce().map((template) => ({ ...template }));
    // Each speaker's acceptance is drawn once, with the variant; the whole speaker draw is redrawn until min_accepting
    // available speakers accept (FR-CONGRESS-11).
    if (kind === "speaker") chosen = withAcceptance(chosen, drawOnce, (count as unknown as KindDraw).min_accepting, acceptances);
    chosenOf[kind] = chosen;
    drawn.chosen[kind] = chosen.map(({ id }) => id as string);
    if (kind === "speaker") drawn.accepts = Object.fromEntries(chosen.map(({ id, accepts }) => [id as string, accepts as boolean]));
  }
  // The cheapest-fit role's venue is priced below the cheapest other chosen venue that seats the target (FR-CONGRESS-01's addition).
  const venueDraw = counts.venue as unknown as KindDraw | undefined;
  if (typeof venueDraw === "object" && venueDraw.cheapest_fit !== undefined) {
    const fitted = new Set(drawn.roles?.venue?.[venueDraw.cheapest_fit] ?? []);
    const others = (chosenOf.venue ?? []).filter(({ id }) => !fitted.has(id as string));
    const fitting = others.filter((template) => seatsOf(template) >= drawn.attendance).map(({ price }) => price as number);
    const [lowest, highest] = venueDraw.cheapest_margin ?? [1, 1];
    for (const template of chosenOf.venue ?? []) {
      if (fitted.has(template.id as string) && fitting.length > 0) template.price = Math.round(Math.min(...fitting) * (lowest + random.next() * (highest - lowest)));
    }
  }
  if ([priceGap, budgetOverPlan, advanceOverDeposits, breakEvenShare].some((given) => given !== undefined)) {
    const city = cityOf(configuration, configuration.calendar === undefined ? undefined : readCalendar(configuration.calendar));
    const plan = cheapestPlan(chosenOf, drawn.attendance, { city, travel: travelOf(configuration, city), helpers: (configuration.helpers as number | undefined) ?? 0, withdraws: drawn.roles?.sponsor?.withdraws ?? [] });
    const share = ([lowest, highest]: [number, number]) => lowest + random.next() * (highest - lowest);
    drawn.plan_cost = plan.costAt(drawn.attendance);
    drawn.early_deposits = plan.earlyDeposits;
    // The budget and the advance as shares of the plan's cost and early deposits, rounded to whole numbers (FR-CONGRESS-13).
    if (budgetOverPlan !== undefined) drawn.budget = Math.round(drawn.plan_cost * share(budgetOverPlan as [number, number]));
    if (advanceOverDeposits !== undefined) drawn.advance = Math.round(drawn.early_deposits * share(advanceOverDeposits as [number, number]));
    const covering = plan.coveringPrice(drawn.attendance, drawn.attendance, drawn.advance ?? 0, 0);
    drawn.cost_covering_price = covering;
    if (priceGap !== undefined) {
      const gap = share(priceGap as [number, number]);
      Object.assign(drawn, { reference_price: covering / (1 + gap), price_gap: gap });
    }
    if (breakEvenShare !== undefined) {
      // The plan's break-even price at a share of the target paying, net of the attendees' payment fees (FR-CONGRESS-13).
      const drawnShare = share(breakEvenShare as [number, number]);
      const paying = Math.max(1, Math.ceil(drawnShare * drawn.attendance));
      const feeShare = attendeesOf(configuration)?.payment_fee_share ?? 0;
      // At least the plan caterer's price per head (FR-CONGRESS-15).
      Object.assign(drawn, { reference_price: Math.max(plan.coveringPrice(paying, paying, drawn.advance ?? 0, feeShare), plan.perHead), break_even_share: drawnShare });
    }
  }
  for (const [kind, chosen] of Object.entries(chosenOf)) if (Object.hasOwn(settings, kind)) templates.push(...chosen.map((template) => ({ ...template, kind })));
  if (Object.hasOwn(settings, "caterer")) {
    const venues = drawn.chosen.venue ?? [];
    templates.push(...(kinds.caterer ?? []).filter(({ in_house_for: inHouse }) => venues.includes(inHouse as string)).map((template) => ({ ...template, kind: "caterer" })));
  }
  const calendar = configuration.calendar === undefined ? undefined : readCalendar(configuration.calendar);
  const city = cityOf(configuration, calendar);
  assertParties(kinds, settings, city);
  travelOf(configuration, city);
  const perturbations = perturbationsOf(configuration, kinds, drawn.roles ?? {});
  const chosenVenues = templates.filter(({ kind }) => kind === "venue");
  const accounts: Record<string, TomlTable> = {};
  const participants = Object.fromEntries(
    templates.map(({ id, kind, reply_minutes: replyMinutes, hours, ...params }) => {
      const { account, ...kept } = settings[kind as string] as TomlTable;
      if (account === "unlimited") accounts[id as string] = { unlimited: true };
      else if (typeof account === "string") accounts[id as string] = { opening: params[account] as number };
      // A template's reply delay and hours are its participant's, in place of its kind's.
      const own = { ...(replyMinutes === undefined ? {} : { reply_minutes: replyMinutes }), ...(hours === undefined ? {} : { hours }) };
      // A missed ring is called back from a world minute after the ring ends to the party's reply delay after that (FR-CONGRESS-07).
      const ring = (configuration.phone as TomlTable | undefined)?.ring_minutes as number | undefined;
      const [, slowest = 0] = ((replyMinutes ?? kept.reply_minutes ?? []) as number[]);
      const callBack: TomlTable = ring === undefined ? {} : { call_back_minutes: [ring + 1, ring + 1 + slowest] };
      const world = worldOf(kept.rules, id as string, configuration, city, perturbations, chosenVenues);
      // A party knows the hours it keeps, within which it writes its own mail and pays (FR-CONGRESS-09).
      const hoursKept = (hours ?? kept.hours) as string | undefined;
      const keeps = hoursKept === undefined ? undefined : (((configuration.calendar as TomlTable | undefined)?.hours as TomlTable | undefined)?.[hoursKept] as TomlTable | undefined);
      // Every party knows its own id, by which it names what it commits and invoices.
      return [id as string, { decides: "rules", ...kept, ...own, params: { id: id as string, ...params, ...callBack, ...world, ...(keeps === undefined ? {} : { keeps }) } }];
    }),
  );
  const names = Object.keys(participants);
  const mail = configuration.mail as TomlTable | undefined;
  const phone = configuration.phone as TomlTable | undefined;
  const money = configuration.money as TomlTable | undefined;
  const completed: Configuration = {
    ...configuration,
    participants: { ...((configuration.participants ?? {}) as TomlTable), ...participants },
    // Each perturbation as resolved, one for a role naming the template that filled it.
    perturbations: Object.fromEntries(perturbations.map(({ name, ...declared }) => [name, declared as unknown as TomlTable])),
    drawn: drawn as unknown as TomlTable,
    ...(mail === undefined
      ? {}
      : {
          mail: {
            ...mail,
            mailboxes: [...((mail.mailboxes ?? []) as string[]), ...names, ...registrantIds(configuration, drawn.attendance)],
            initial: [...((mail.initial ?? []) as TomlTable[]), ...partnerSession(templates, drawn, (configuration.calendar as TomlTable | undefined)?.start)],
            // Each party takes its rule set's acts, so a wrong act or a missing field fails at once (FR-CONGRESS-09).
            acts: { ...((mail.acts ?? {}) as TomlTable), ...actsOf(participants), ...Object.fromEntries(registrantIds(configuration, drawn.attendance).map((id) => [id, Object.fromEntries([actOf(REGISTRANT_ACT)])])) },
          },
        }),
    ...(phone === undefined ? {} : { phone: { ...phone, lines: [...((phone.lines ?? []) as string[]), ...names] } }),
    ...(money === undefined ? {} : { money: { ...money, accounts: { ...((money.accounts ?? {}) as TomlTable), ...accounts, ...organiserAccount(money, drawn) } } }),
  };
  // The texts name what the replica drew, filled in before the run (FR-CONGRESS-08); the directory's order is the
  // variant's last draw, so it gives the roles away no more than the seed does (FR-CONGRESS-09).
  const filled = withDrawnTexts(completed, drawn, calendar, chosenOf, templates, random);
  return { configuration: filled, drawn: { ...drawn, ...(drawn.reference_price === undefined ? referencePrice(configuration, drawn.topic) : {}) } };
}

/**
 * The organiser's account with what the draw gives (FR-CONGRESS-11): it opens with the advance, and its ceiling is the
 * budget from the start; as configured when the draw gives neither.
 */
function organiserAccount(money: TomlTable, drawn: Drawn): TomlTable {
  if (drawn.budget === undefined && drawn.advance === undefined) return {};
  const configured = (((money.accounts ?? {}) as TomlTable)[ORGANISER] ?? {}) as TomlTable;
  return { [ORGANISER]: { ...configured, ...(drawn.advance === undefined ? {} : { opening: drawn.advance }), ...(drawn.budget === undefined ? {} : { ceiling: drawn.budget }) } };
}

/** The act a registrant takes from the organiser, at its id (FR-CONGRESS-11). */
const REGISTRANT_ACT = "answer (text, diet?, access?)";

/**
 * The ids every person of the population may have (FR-CONGRESS-11): the pool's, a-1 onwards, the fixed people's, and
 * the group's largest size after them; none without an attendees material.
 */
function registrantIds(configuration: Configuration, target: number): string[] {
  const material = attendeesOf(configuration);
  if (material === undefined) return [];
  const pool = Math.round(material.pool_factor * target);
  const fixed = (material.fixed ?? []).map(({ id }) => id);
  const group = material.group === undefined ? 0 : material.group.size[1];
  return [...Array.from({ length: pool }, (_, index) => `a-${index + 1}`), ...fixed, ...Array.from({ length: group }, (_, index) => `a-${pool + fixed.length + index + 1}`)].filter((id, index, ids) => ids.indexOf(id) === index);
}

/** The weekdays, in order from Monday. */
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** What the texts may name of the replica's draw, in braces (FR-CONGRESS-08). */
const DRAWN_NAMES = ["topic", "target", "event_day", "funds", "budget", "advance", "directory"];

/**
 * The acts each rule set takes, with the fields each requires, as the directory lists them (FR-CONGRESS-02, -04, -05,
 * -07); a field marked "?" is one the act may give, not one it requires.
 */
const RULE_SET_ACTS: Readonly<Record<string, readonly string[]>> = {
  venue: ["ask_quote (date, attendance)", "request_document (kind)", "hold (date)", "book (date, rooms, hours)", "accept_contract (contract)", "change_booking (rooms, hours)", "request_extra (item)", "accept_extra (item)", "cancel_booking", "accept_change (option?)", "decline_change"],
  board: ["submit_budget (costs, income, contingency, funds_requested)", "request_approval (amount, reason)", "report"],
  speaker: ["invite (session, time, fee, travel_paid)", "accept_condition", "decline_condition", "confirm (time, room, length, travel)", "change", "withdraw_invitation", "ask_slides (by)", "ask_panel (slot)", "ask_promote"],
  partner: ["confirm (time, room, length, travel)", "change", "ask_slides (by)"],
  caterer: ["ask_quote (attendance, diets)", "order (counts, date, venue?)", "final_numbers (counts)", "cancel_order"],
  sponsor: ["ask_conditions", "accept_sponsorship (conditions)", "counter (conditions)", "send_attendee_list (list)", "send_evidence"],
  agency: ["ask_quote (date)", "book (date)", "cancel"],
};

/**
 * An act as the table writes it, "<act> (<field>, …)", as its name and required fields; a field marked "?" is one it
 * reads when given, not required: a price change's `accept_change` has no option, and an order may leave out its venue.
 */
function actOf(written: string): [string, string[]] {
  const [, act, fields = ""] = /^(\w+)(?: \((.*)\))?$/.exec(written) ?? [];
  return [act, fields === "" ? [] : fields.split(", ").filter((field) => !field.endsWith("?"))];
}

/** The acts each party decided by a rule set the table lists takes, with their required fields (FR-CONGRESS-09). */
function actsOf(participants: Readonly<Record<string, TomlTable>>): TomlTable {
  return Object.fromEntries(
    Object.entries(participants).flatMap(([id, { rules }]) => {
      const acts = RULE_SET_ACTS[String(rules)];
      return acts === undefined ? [] : [[id, Object.fromEntries(acts.map(actOf))]];
    }),
  );
}

/** An act with its required fields, as the directory writes it: the fields marked "?" left out. */
function requiredText(written: string): string {
  const [act, fields] = actOf(written);
  return fields.length === 0 ? act : `${act} (${fields.join(", ")})`;
}

/**
 * The directory of the drawn parties (FR-CONGRESS-08 and its addition): first, each kind's acts with their required
 * fields, once per kind, and how registrants are mailed (FR-CONGRESS-11); then one line per drawn party, grouped by kind,
 * each kind in an order drawn from the replica's sequence (FR-CONGRESS-09, FR-CONGRESS-11),
 * with its id, its kind, whether it has a mailbox and a line, and what its template says that anyone could know: a
 * speaker's or the partner's title and home (FR-CONGRESS-15), an in-house caterer's venue.
 */
function directoryOf(configuration: Configuration, chosenOf: Readonly<Record<string, TomlTable[]>>, templates: readonly TomlTable[], random: Random): string {
  const mailboxes = ((configuration.mail as TomlTable | undefined)?.mailboxes ?? []) as string[];
  const lines = ((configuration.phone as TomlTable | undefined)?.lines ?? []) as string[];
  const settings = (configuration.kinds ?? {}) as TomlTable;
  // The in-house caterers come with their venues, beside the drawn templates.
  const inHouse = templates.filter(({ kind, in_house_for: venue }) => kind === "caterer" && venue !== undefined).map((template) => ({ template, kind: "caterer" }));
  const parties = [...Object.entries(chosenOf).flatMap(([kind, chosen]) => chosen.map((template) => ({ template, kind }))), ...inHouse];
  const kinds = [...new Set(parties.map(({ kind }) => kind))];
  const article = (kind: string) => (/^[aeiou]/.test(kind) ? "An" : "A");
  const actsOfKind = kinds.map((kind) => {
    const acts = RULE_SET_ACTS[String((settings[kind] as TomlTable | undefined)?.rules)] ?? [];
    return `${article(kind)} ${kind} takes ${acts.length === 0 ? "no act the congress lists" : acts.map(requiredText).join(", ")}.`;
  });
  const known = ({ template, kind }: (typeof parties)[number]): string[] => {
    if (kind === "speaker" || kind === "partner") return [...(template.title === undefined ? [] : [`"${String(template.title)}"`]), ...(template.home === undefined ? [] : [template.home === "local" ? "local" : `from ${String(template.home)}`])];
    if (kind === "caterer" && template.in_house_for !== undefined) return [`in-house for ${String(template.in_house_for)}`];
    return [];
  };
  // Grouped by kind in a fixed order, the kinds it does not name after them; within each kind, an order drawn from the
  // replica's sequence (FR-CONGRESS-11).
  const order = (kind: string) => (DIRECTORY_KINDS.includes(kind) ? DIRECTORY_KINDS.indexOf(kind) : DIRECTORY_KINDS.length + kinds.indexOf(kind));
  const grouped = [...kinds].sort((one, other) => order(one) - order(other)).flatMap((kind) => {
    const ofKind = parties.filter((party) => party.kind === kind);
    return chooseFrom(ofKind, ofKind.length, random);
  });
  const partyLines = grouped.map((party) => {
    const id = String(party.template.id);
    const has = `with ${mailboxes.includes(id) ? "a mailbox" : "no mailbox"} and ${lines.includes(id) ? "a line" : "no line"}`;
    const facts = known(party);
    return `- ${id}: ${party.kind}, ${has}${facts.length === 0 ? "" : `; ${facts.join(", ")}`}`;
  });
  const registrants = attendeesOf(configuration) === undefined ? [] : [`Registrants are mailed at their id with the act ${requiredText(REGISTRANT_ACT)}.`];
  return [...actsOfKind, ...registrants, ...partyLines].join("\n");
}

/** The kinds the directory lists, in this order (FR-CONGRESS-11, FR-CONGRESS-15). */
const DIRECTORY_KINDS = ["venue", "speaker", "partner", "caterer", "sponsor", "agency"];

/**
 * The configuration with its texts filled with what the replica drew (FR-CONGRESS-08): {topic}, {target}, {event_day},
 * {funds}, {budget}, {advance} (FR-CONGRESS-11) and {directory}, and {{ and }} as braces; a name in braces that is none
 * of these, {funds} with no board drawn, or {budget} or {advance} the draw does not give, is refused, naming it and its
 * text.
 */
function withDrawnTexts(configuration: Configuration, drawn: Drawn, calendar: Calendar | undefined, chosenOf: Readonly<Record<string, TomlTable[]>>, templates: readonly TomlTable[], random: Random): Configuration {
  const day = configuration.event_day as number;
  const weekday = calendar === undefined ? undefined : WEEKDAYS[(((calendar.weekdayOfDayOne + day - 1) % 7) + 7) % 7];
  const board = chosenOf.board?.[0];
  const values: Record<string, () => string> = {
    topic: () => drawn.topic,
    target: () => String(drawn.attendance),
    event_day: () => `day ${day}${weekday === undefined ? "" : ` ${weekday}`}`,
    funds: () => String(board?.funds),
    budget: () => String(drawn.budget),
    advance: () => String(drawn.advance),
    directory: () => directoryOf(configuration, chosenOf, templates, random),
  };
  const texts = Object.fromEntries(
    TEXTS.filter((key) => typeof configuration[key] === "string").map((key) => {
      const text = configuration[key] as string;
      const result = text.replace(/\{\{|\}\}|\{(\w+)\}/g, (written, name: string | undefined) => {
        if (name === undefined) return written[0];
        if (!DRAWN_NAMES.includes(name)) throw refused(key, text, `it names {${name}}, which is none of {${DRAWN_NAMES.join("}, {")}}`);
        if (name === "funds" && board === undefined) throw refused(key, text, "it names {funds}, and the variant drew no board");
        if ((name === "budget" || name === "advance") && drawn[name] === undefined) throw refused(key, text, `it names {${name}}, and the draw gives no ${name}`);
        return values[name]();
      });
      return [key, result];
    }),
  );
  return { ...configuration, ...texts };
}

/**
 * The parties a part's actors may name by group (FR-CONGRESS-08): `role:<role>`, the templates that filled the role, and
 * `kind:<kind>`, every drawn party of that kind, the venues' in-house caterers among the caterers.
 */
function partyGroups(configuration: Configuration): Readonly<Record<string, readonly string[]>> {
  const drawn = configuration.drawn as unknown as Drawn | undefined;
  const groups: Record<string, string[]> = {};
  for (const [kind, ids] of Object.entries(drawn?.chosen ?? {})) groups[`kind:${kind}`] = [...ids];
  const inHouse = Object.entries((configuration.participants ?? {}) as TomlTable)
    .filter(([, participant]) => (participant as TomlTable).rules === "caterer" && ((participant as TomlTable).params as TomlTable | undefined)?.in_house_for !== undefined)
    .map(([name]) => name);
  if (inHouse.length > 0) groups["kind:caterer"] = [...(groups["kind:caterer"] ?? []), ...inHouse.filter((name) => !(groups["kind:caterer"] ?? []).includes(name))];
  for (const byRole of Object.values(drawn?.roles ?? {})) for (const [role, ids] of Object.entries(byRole)) groups[`role:${role}`] = [...(groups[`role:${role}`] ?? []), ...ids];
  return groups;
}

/** The speakers a cheapest feasible plan pays for: the five lowest-fee accepting available ones (FR-CONGRESS-11). */
const PLAN_SPEAKERS = 5;

/** The association's members the attendance counts (FR-CONGRESS-06, FR-CONGRESS-11). */
const ASSOCIATION_MEMBERS = 3;

/** The similar events' prices, as shares of the reference price, when the draw gives a price_gap. */
const SIMILAR_SHARES = [0.8, 1, 1.2];

/** What a cheapest feasible plan reads besides the chosen templates: the city, the travel, the helpers and the sponsors that withdraw. */
interface Plan {
  city: City;
  travel: Travel;
  helpers: number;
  withdraws: readonly string[];
}

/**
 * The cheapest feasible plan (FR-CONGRESS-11, FR-CONGRESS-13): the cheapest chosen venue that seats the target, plus its
 * ramp extra when an interior passage of it is not step-free; the attendance (the attendees, the five lowest-fee
 * accepting available speakers, the helpers and the association's 3 members) × the highest price per head of the chosen
 * caterers; the cheapest chosen agency's price; those five speakers' fees and, for each from a station, the cheapest
 * train from it at its base price. Its early deposits are its venue's deposit_share of the venue's cost and its
 * caterer's deposit_share of the catering at the target. Its covering price for so many attendees, so many of them
 * paying, is its cost less the advance, the chosen board's funds and the amounts of the chosen sponsors that do not
 * withdraw, over the paying attendees net of a payment fee share, at least 1. Its price per head is its caterer's.
 */
function cheapestPlan(chosenOf: Readonly<Record<string, TomlTable[]>>, target: number, plan: Plan) {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const venueCost = (template: TomlTable) => {
    const venue = plan.city.venues.find(({ id }) => id === template.id);
    const inside = venue === undefined ? [] : [venue.entrance, ...venue.rooms.map(({ id }) => id)];
    const steps = plan.city.passages.some(({ between, step_free: stepFree }) => stepFree !== true && between.every((place) => inside.includes(place)));
    return (template.price as number) + (steps ? (((template.extras ?? {}) as Record<string, number>).ramp ?? 0) : 0);
  };
  const venue = (chosenOf.venue ?? []).filter((template) => seatsOf(template) >= target).sort((one, other) => venueCost(one) - venueCost(other))[0];
  const caterer = [...(chosenOf.caterer ?? [])].sort((one, other) => (other.price_per_head as number) - (one.price_per_head as number))[0];
  const perHead = (caterer?.price_per_head as number | undefined) ?? 0;
  const speakers = (chosenOf.speaker ?? [])
    .filter(({ available, accepts }) => available === true && accepts === true)
    .sort((one, other) => ((one.fee as number | undefined) ?? 0) - ((other.fee as number | undefined) ?? 0))
    .slice(0, PLAN_SPEAKERS);
  const fees = sum(speakers.map(({ fee = 0 }) => fee as number));
  const trains = sum(
    speakers.map(({ home }) => {
      const prices = plan.travel.trains.filter(({ from }) => from === home).map(({ price }) => price);
      return home === undefined || home === "local" || prices.length === 0 ? 0 : Math.min(...prices);
    }),
  );
  const agencies = (chosenOf.agency ?? []).map(({ price }) => price as number);
  const agency = agencies.length === 0 ? 0 : Math.min(...agencies);
  const heads = (attendees: number) => attendees + speakers.length + plan.helpers + ASSOCIATION_MEMBERS;
  const funds = sum((chosenOf.board ?? []).map(({ funds: given = 0 }) => given as number));
  const amounts = sum((chosenOf.sponsor ?? []).filter(({ id }) => !plan.withdraws.includes(id as string)).map(({ amount = 0 }) => amount as number));
  const venuePrice = venue === undefined ? 0 : venueCost(venue);
  const costAt = (attendees: number) => venuePrice + heads(attendees) * perHead + agency + fees + trains;
  const earlyDeposits = ((venue?.deposit_share as number | undefined) ?? 0) * venuePrice + ((caterer?.deposit_share as number | undefined) ?? 0) * heads(target) * perHead;
  return {
    costAt,
    earlyDeposits,
    perHead,
    coveringPrice: (attendees: number, paying: number, advance: number, feeShare: number) => Math.max(1, (costAt(attendees) - advance - funds - amounts) / (paying * (1 - feeShare))),
  };
}

/**
 * The board's or the association's mail about the partner's session (FR-CONGRESS-04, FR-CONGRESS-11), in the organiser's mailbox at the calendar's start:
 * the partner drawn, and the session it prefers, with its template's mail as text (FR-CONGRESS-15); none when no partner is drawn.
 */
function partnerSession(templates: readonly TomlTable[], drawn: Drawn, start: unknown): TomlTable[] {
  const partner = templates.find(({ kind }) => kind === "partner");
  if (partner === undefined || start === undefined) return [];
  const fields = { speaker: partner.id as string, session: partner.session as number };
  // Its text is the template's mail, {speaker} and {session} filled in (FR-CONGRESS-15).
  const text = typeof partner.mail === "string" ? partner.mail.replace(/\{(speaker|session)\}/g, (_written, name: "speaker" | "session") => String(fields[name])) : undefined;
  // With no board drawn, the association sends it: a sender with no mailbox and no line (FR-CONGRESS-11).
  return [{ from: drawn.chosen.board?.[0] ?? ASSOCIATION, to: ORGANISER, act: "partner_session", fields, ...(text === undefined ? {} : { text }), received: start as string }];
}

/** Who gives the organiser a fixed budget and, with no board drawn, the partner's session (FR-CONGRESS-11). */
const ASSOCIATION = "association";

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
 * acceptance of its own, and its mail may name only {speaker} and {session} (FR-CONGRESS-15).
 */
function assertSpeaker(template: TomlTable, rules: "speaker" | "partner", naming: (key: string, why: string) => Error): void {
  if ((rules === "speaker" || template.acceptance !== undefined) && !isShare(template.acceptance)) throw naming("acceptance", "it is not a probability from 0 to 1");
  if (template.pick_up !== undefined && !isShare(template.pick_up)) throw naming("pick_up", "it is not a probability from 0 to 1");
  if (template.draw !== undefined && !(Number.isInteger(template.draw) && (template.draw as number) >= 0 && (template.draw as number) <= 3)) throw naming("draw", "it is not a whole number from 0 to 3");
  if (template.fee !== undefined && !(typeof template.fee === "number" && template.fee >= 0)) throw naming("fee", "it is not an amount of at least 0");
  if (template.condition !== undefined && !(SPEAKER_CONDITIONS as readonly unknown[]).includes(template.condition)) throw naming("condition", `it is none of ${SPEAKER_CONDITIONS.join(", ")}`);
  if (template.constraint !== undefined && !(SPEAKER_CONSTRAINTS as readonly unknown[]).includes(template.constraint)) throw naming("constraint", `it is none of ${SPEAKER_CONSTRAINTS.join(", ")}`);
  if (rules === "partner" && template.mail !== undefined) {
    if (typeof template.mail !== "string") throw naming("mail", "it is not a text");
    const other = [...template.mail.matchAll(/\{(\w*)\}/g)].find(([, name]) => !PARTNER_MAIL_NAMES.includes(name));
    if (other !== undefined) throw naming("mail", `it names ${other[0]}, which is none of {${PARTNER_MAIL_NAMES.join("}, {")}}`);
  }
}

/** What a partner's mail may name, in braces (FR-CONGRESS-15). */
const PARTNER_MAIL_NAMES = ["speaker", "session"];

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
function perturbationsOf(configuration: Configuration, kinds: Readonly<Record<string, TomlTable[]>>, roles: Readonly<Record<string, Record<string, string[]>>> = {}): Perturbation[] {
  return Object.entries((configuration.perturbations ?? {}) as TomlTable).map(([name, written]) => {
    const { for_role: forRole, ...rest } = written as TomlTable;
    const declared = { name, ...rest } as unknown as Perturbation;
    // A perturbation for a role is for the template that filled it (FR-CONGRESS-01's addition).
    if (forRole !== undefined) {
      const filled = Object.values(roles).flatMap((byRole) => byRole[forRole as string] ?? [])[0];
      if (filled === undefined) throw refused(`perturbations.${name}`, written, `its for_role "${String(forRole)}" is a role no draw fills`);
      declared.for = filled;
    }
    const times = [...(declared.between ?? []), ...(declared.at === undefined ? [] : [declared.at])];
    if (times.length === 0 || times.some((time) => perturbationMinutes(time) === undefined)) throw refused(`perturbations.${name}`, written, 'its times do not follow "day <n> HH:MM"');
    // A sponsor's withdrawal is for a sponsor; the others are a venue's.
    const kind = name === SPONSOR_PERTURBATION ? "sponsor" : "venue";
    if ((declared.for !== undefined || kind === "sponsor") && !(kinds[kind] ?? []).some(({ id }) => id === declared.for)) throw refused(`perturbations.${name}`, written, `"${String(declared.for)}" is no ${kind}`);
    return declared;
  });
}

/** The perturbation that cancels the hotel rooms booked for the night before the event (FR-CONGRESS-05's addition). */
const HOTEL_OVERBOOKS = "hotel_overbooks";

/** The perturbations that are no venue's: the speakers' cancellations, a sponsor's withdrawal and the hotels' overbooking. */
const NOT_A_VENUES = [...SPEAKER_PERTURBATIONS, SPONSOR_PERTURBATION, HOTEL_OVERBOOKS];

/** The venue perturbation every venue keeps for itself: its events office allocating its booked rooms. */
const ROOM_ALLOCATION = "room_allocation";

/** Whether a declared perturbation is the venue change: a venue's that is no room allocation (FR-CONGRESS-13). */
const isVenueChange = (name: string) => !NOT_A_VENUES.includes(name) && name !== ROOM_ALLOCATION;

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
    // Its rooms' allocation only: the venue change is the world's (FR-CONGRESS-13).
    perturbations: perturbations.filter((each) => each.name === ROOM_ALLOCATION && (each.for === undefined || each.for === id)) as unknown as TomlTable[],
    // The mail's delivery delay, from which its change's answer_by counts (FR-CONGRESS-16).
    ...((configuration.mail as TomlTable | undefined)?.delivery_minutes === undefined ? {} : { mail_delivery_minutes: (configuration.mail as TomlTable).delivery_minutes }),
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
    similar: similarOf(configuration),
    perturbations: [],
    context: contextOf(configuration, settings.discretionaryLimit),
    ...(attendeesOf(configuration) === undefined ? {} : { population: populationOf(configuration, attendeesOf(configuration) as AttendeesMaterial) }),
  };
}

/**
 * The similar congresses of the drawn topic, with their prices and sizes; with a price gap, their prices are the
 * reference price × 0.8, 1 and 1.2, in the material's order (FR-CONGRESS-01's addition).
 */
function similarOf(configuration: Configuration): Congress["similar"] {
  const drawn = configuration.drawn as unknown as Drawn | undefined;
  return similarEvents(configuration, drawn?.topic ?? "").map(({ name, price, size }, index) => ({
    name,
    price: (drawn?.price_gap === undefined && drawn?.break_even_share === undefined) || drawn.reference_price === undefined ? price : drawn.reference_price * (SIMILAR_SHARES[index] ?? 1),
    size,
  }));
}

/** The share keys of an attendees material, each a number from 0 to 1. */
const MATERIAL_SHARES = ["consent_share", "payment_fee_share", "cancel_share", "pay_share", "no_show_share", "question_share"] as const;

/**
 * The configuration's attendees material (FR-POPULATION-01), none when it gives none; refused, naming its key, when its
 * diet or access shares do not add up to 1, a rate is negative, a share is outside 0 to 1, a fixed person's window ends
 * before it begins, or the group's size is not two numbers, the first not above the second.
 */
function attendeesOf(configuration: Configuration): AttendeesMaterial | undefined {
  if (typeof configuration.attendees !== "string" || configuration.attendees.trim() === "") return undefined;
  const material = textOf(configuration, "attendees") as unknown as AttendeesMaterial;
  for (const key of ["diets", "access"] as const) {
    const shares = Object.values(material[key] ?? { none: 1 });
    if (Math.abs(shares.reduce((sum, share) => sum + share, 0) - 1) > 1e-9) throw refused(`attendees.${key}`, material[key], "its shares do not add up to 1");
  }
  for (const key of ["pool_factor", "base_per_day", "unannounced", "promotion_factor"] as const) {
    if (!(typeof material[key] === "number" && material[key] >= 0)) throw refused(`attendees.${key}`, material[key], "it is not a number of at least 0");
  }
  for (const key of MATERIAL_SHARES) if (material[key] !== undefined && !isShare(material[key])) throw refused(`attendees.${key}`, material[key], "it is not a share from 0 to 1");
  for (const fixed of material.fixed ?? []) {
    const [from, to] = fixed.between;
    if (!(perturbationMinutes(from) !== undefined && perturbationMinutes(to) !== undefined && minutesOfTime(from) <= minutesOfTime(to))) throw refused(`attendees.fixed "${fixed.id}"`, fixed.between, "its window ends before it begins");
  }
  const [fewest, most] = (material.group?.size ?? [0, 0]) as number[];
  if (!(fewest <= most)) throw refused("attendees.group_size", material.group?.size, "it is not two numbers, the first not above the second");
  return material;
}

/** The population as a replica starts (FR-POPULATION-01): its material, the event's day, the reference price, each chosen speaker's draw, and a closed page. */
function populationOf(configuration: Configuration, material: AttendeesMaterial): Population {
  const drawn = configuration.drawn as unknown as Drawn | undefined;
  const draws = Object.fromEntries(
    Object.entries((configuration.participants ?? {}) as TomlTable)
      .filter(([, participant]) => (participant as TomlTable).rules === "speaker")
      .map(([name, participant]) => [name, (((participant as TomlTable).params as TomlTable | undefined)?.draw as number | undefined) ?? 0]),
  );
  return {
    material,
    eventDay: configuration.event_day as number,
    referencePrice: drawn?.reference_price ?? referencePrice(configuration, drawn?.topic ?? "").reference_price ?? 0,
    draws,
    people: [],
    page: { open: false, price: 0, required_fields: [], info: [], waiting_list: false },
    announced: false,
    promotions: [],
    programme: [],
    sponsorData: {},
  };
}

/** What the congress's parts read besides the records (FR-CONGRESS-06), from the configuration and the variant. */
function contextOf(configuration: Configuration, discretionaryLimit: number): PartsContext {
  const drawn = configuration.drawn as unknown as Drawn | undefined;
  const eventDay = configuration.event_day as number;
  const until = ((configuration.calendar as TomlTable | undefined)?.segments as TomlTable[] | undefined)?.[0]?.until;
  return {
    eventDay,
    helpers: (configuration.helpers as number | undefined) ?? 0,
    target: drawn?.attendance ?? 0,
    // The end of preparation is the clock's first segment's until; the event day's start without one.
    endOfPreparation: typeof until === "string" ? minutesOfTime(until) : (eventDay - 1) * 1440,
    roles: drawn?.roles ?? {},
    noShowCut: (configuration.no_show_cut as number | undefined) ?? 0,
    discretionaryLimit,
    ...partiesContext(configuration),
    ...organiserContext(configuration),
  };
}

/** The organiser's ceiling from the start and opening balance, as its account gives them, and the run's start (FR-CONGRESS-12). */
function organiserContext(configuration: Configuration): Pick<PartsContext, "ceiling" | "opening" | "start"> {
  const account = ((((configuration.money as TomlTable | undefined)?.accounts ?? {}) as TomlTable)[ORGANISER] ?? {}) as TomlTable;
  const start = (configuration.calendar as TomlTable | undefined)?.start;
  return {
    ...(typeof account.ceiling === "number" ? { ceiling: account.ceiling } : {}),
    ...(typeof account.opening === "number" ? { opening: account.opening } : {}),
    ...(typeof start === "string" ? { start: minutesOfTime(start) } : {}),
  };
}

/** The travelling speakers' stations and fees, the chosen venues' catering rules and in-house caterers, and the speakers' and sponsors' ids, from the participants. */
function partiesContext(configuration: Configuration): Pick<PartsContext, "homes" | "catering" | "ids" | "fees"> {
  const parties = Object.entries((configuration.participants ?? {}) as TomlTable).map(([name, participant]) => ({ name, rules: (participant as TomlTable).rules, params: ((participant as TomlTable).params ?? {}) as TomlTable }));
  const homes = Object.fromEntries(parties.filter(({ rules, params }) => rules === "speaker" && typeof params.home === "string" && params.home !== "local").map(({ name, params }) => [name, params.home as string]));
  const catering = Object.fromEntries(
    parties
      .filter(({ rules }) => rules === "venue")
      .map(({ name, params }) => {
        const inHouse = parties.find(({ rules, params: caterer }) => rules === "caterer" && caterer.in_house_for === name)?.name;
        return [name, { ...(typeof params.catering === "string" ? { rule: params.catering } : {}), ...(inHouse === undefined ? {} : { inHouse }) }];
      }),
  );
  const named = (...rules: string[]) => parties.filter((party) => rules.includes(String(party.rules))).map(({ name }) => name);
  const fees = Object.fromEntries(parties.filter(({ rules, params }) => rules === "speaker" && typeof params.fee === "number").map(({ name, params }) => [name, params.fee as number]));
  return { homes, catering, ids: { speakers: named("speaker", "partner"), sponsors: named("sponsor") }, fees };
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
    // Each place the organiser enters is recorded with its time (FR-CONGRESS-06).
    effect: (state, call) => ({
      ...inSpace(arrive, () => ({ entity: call.agent })).effect(state, call),
      visits: [...(state.visits ?? []), ...(call.world === undefined ? [] : [{ place: String(call.arguments.place), at: minutesOfWorld(call.world) }])],
    }),
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

/** Whether a speaker has cancelled, by mail or on an answered call to the organiser, as the record of acts gives it (FR-CONGRESS-13). */
function hasCancelled(state: Congress, speaker: string): boolean {
  return recordedActs(state).some(({ from, to, act }) => from === speaker && to === ORGANISER && act === "cancel");
}

/**
 * When a speaker was confirmed, in world minutes: when the organiser's confirm reached it, by mail or on a call, once it
 * has accepted a session and acknowledged its confirmation (FR-CONGRESS-09, FR-CONGRESS-13); none until then.
 */
function confirmedAt(state: Congress, speaker: string): number | undefined {
  const acts = recordedActs(state);
  const sent = acts.filter(({ from, to }) => from === speaker && to === ORGANISER);
  if (!sent.some(({ act }) => act === "accept") || !sent.some(({ act }) => act === "acknowledged")) return undefined;
  return acts.find(({ from, to, act }) => from === ORGANISER && to === speaker && act === "confirm")?.at;
}

/** How long two days are after a speaker is confirmed when early_cancel found none confirmed at its time. */
const NEXT_CONFIRMED_DELAY_MINUTES = 2 * 1440;

/** How often a cancellation that waits for the next speaker to be confirmed looks again at the world's mail, in world minutes. */
const LOOK_AGAIN_MINUTES = 60;

/**
 * A speaker's cancellation (FR-CONGRESS-04), a perturbation component: from its own sequence it draws its time (in its
 * window, or at its time) and an order of the speakers; at that time it takes the first speaker in that order who is
 * confirmed (accepted and acknowledged) and has not cancelled, and delivers it the illness on its own channel, not
 * held. early_cancel, finding none, waits for the next to be confirmed and delivers 2 days after it was confirmed;
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
      let pending: Step<Congress> | undefined;
      const waitUntil = (minutes: number, now: number, sinceStartMs: number): Step<Congress> => ({ kind: "wait", ms: reachedAfterMs(calendar, sinceStartMs, (minutes - now) * 60) });
      return {
        next: (state, _outcome, sinceStartMs, world) => {
          const now = minutesOfWorld(world as WorldTime);
          if (pending !== undefined) {
            const next = pending;
            pending = undefined;
            return next;
          }
          if (done) return { kind: "end" };
          if (now < time) return waitUntil(time, now, sinceStartMs);
          const standing = order.filter((speaker) => !hasCancelled(state, speaker));
          const confirmed = standing.filter((speaker) => (confirmedAt(state, speaker) ?? Infinity) <= time);
          // It records itself, then tells its speaker.
          const hit = (speaker: string): Step<Congress> => {
            done = true;
            pending = { kind: "deliver", agent: speaker, channel: declared.name, held: false };
            return recording(declared.name, [speaker]);
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
 * The venue change (FR-CONGRESS-13), a perturbation component: once per replica, at a time drawn in its window from its
 * own sequence, or at its time, it records itself for the venue holding the organiser's live booking (contracted or
 * confirmed, as the record of acts gives it) and tells that venue, not held, the kind declared; with no live booking it
 * does nothing.
 */
function venueChange(declared: Perturbation, calendar: Calendar): Component<Congress> {
  return {
    name: declared.name,
    kind: "perturbation",
    description: `At a time drawn between ${String(declared.between?.join(" and ") ?? declared.at)}, makes the venue holding the organiser's live booking lose a room or raise its price; with no live booking, nothing.`,
    cycle: (random) => {
      const [from, to] = (declared.between ?? [declared.at, declared.at]).map((time) => perturbationMinutes(time) as number);
      const time = from + random.next() * (to - from);
      let venue: string | undefined;
      let done = false;
      return {
        next: (state, _outcome, sinceStartMs, world) => {
          const now = minutesOfWorld(world as WorldTime);
          if (done) return { kind: "end" };
          if (now < time) return { kind: "wait", ms: reachedAfterMs(calendar, sinceStartMs, (time - now) * 60) };
          if (venue !== undefined) {
            done = true;
            return { kind: "deliver", agent: venue, channel: VENUE_CHANGE, held: false, values: { kind: declared.kind ?? "" } };
          }
          venue = bookingsOf(state).filter(({ cancelledAt }) => cancelledAt === undefined).at(-1)?.venue;
          if (venue === undefined) {
            done = true;
            return { kind: "end" };
          }
          // It records itself, then tells its venue.
          return recording(declared.name, [venue]);
        },
      };
    },
  };
}

/** A perturbation's record of itself, as it fires, for each of its targets (FR-CONGRESS-06): an action that takes no time. */
function recording(name: string, targets: readonly string[]): Step<Congress> {
  return {
    kind: "action",
    name: `${name} fires`,
    durationMs: 0,
    action: {
      precondition: () => ({ holds: true }),
      effect: (state, { world }) => ({ ...state, perturbations: [...state.perturbations, ...targets.map((target) => ({ name, target, at: minutesOfWorld(world as WorldTime) }))] }),
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
      let step = 0;
      return {
        next: (_state, _outcome, sinceStartMs, world) => {
          const now = minutesOfWorld(world as WorldTime);
          if (step === 2) return { kind: "end" };
          if (now < time) return { kind: "wait", ms: reachedAfterMs(calendar, sinceStartMs, (time - now) * 60) };
          step += 1;
          // It records itself, then tells its sponsor.
          return step === 1 ? recording(declared.name, [declared.for as string]) : { kind: "deliver", agent: declared.for as string, channel: declared.name, held: false };
        },
      };
    },
  };
}

/**
 * The hotels' overbooking (FR-CONGRESS-05's addition), a perturbation component: at its time, it cancels every hotel room
 * booked for the night before the event, releasing its commitment, then tells each traveller it hits, not held.
 */
function hotelOverbooking(declared: Perturbation, calendar: Calendar, eventDay: number): Component<Congress> {
  const night = `day ${eventDay - 1}`;
  const hit = (state: Congress, booking: { option: string }) => state.travel.material.hotels.some(({ id }) => booking.option === `${id} ${night}`);
  return {
    name: declared.name,
    kind: "perturbation",
    description: `At ${String(declared.at)}, cancels every hotel room booked for the night before the event, and tells each traveller it hits.`,
    cycle: () => {
      const time = perturbationMinutes(declared.at) as number;
      let travellers: string[] | undefined;
      return {
        next: (state, _outcome, sinceStartMs, world) => {
          const now = minutesOfWorld(world as WorldTime);
          if (travellers === undefined && now < time) return { kind: "wait", ms: reachedAfterMs(calendar, sinceStartMs, (time - now) * 60) };
          if (travellers === undefined) {
            travellers = state.travel.booked.filter((booking) => hit(state, booking)).map(({ traveller }) => traveller);
            return {
              kind: "action",
              name: "cancel the rooms of the night before the event",
              durationMs: 0,
              action: {
                precondition: () => ({ holds: true }),
                effect: (current) => {
                  const cancelled = current.travel.booked.filter((booking) => hit(current, booking));
                  const commitments = current.money.commitments.filter((commitment) => !commitment.released && commitment.by === TRAVEL && cancelled.some(({ option, traveller }) => commitment.for === `${option} ${traveller}`));
                  const at = minutesOfWorld(world as WorldTime);
                  return {
                    ...current,
                    travel: { ...current.travel, booked: current.travel.booked.filter((booking) => !cancelled.includes(booking)) },
                    money: stamped(current.money, commitments.reduce((money, { id }) => withRelease(money, id), current.money), world as WorldTime),
                    perturbations: [...current.perturbations, ...cancelled.map(({ traveller }) => ({ name: declared.name, target: traveller, at }))],
                  };
                },
              },
            };
          }
          const traveller = travellers.shift();
          return traveller === undefined ? { kind: "end" } : { kind: "deliver", agent: traveller, channel: HOTEL_OVERBOOKS, held: false };
        },
      };
    },
  };
}

/** The speakers' cancellations, a sponsor's withdrawal, the hotels' overbooking and the venue change the configuration declares. */
function components(configuration: Configuration): Component<Congress>[] {
  const declared = Object.entries((configuration.perturbations ?? {}) as TomlTable)
    .filter(([name]) => name !== ROOM_ALLOCATION)
    .map(([name, written]) => ({ name, ...(written as TomlTable) }) as unknown as Perturbation);
  const calendar = readCalendar(configuration.calendar);
  // The attendees, when the configuration gives their material (FR-POPULATION-01).
  const target = (configuration.drawn as unknown as Drawn | undefined)?.attendance ?? 0;
  const attendees = attendeesOf(configuration) === undefined ? [] : [populationComponent<Congress>({ organiser: ORGANISER, target, msFor: (minutes, sinceStartMs) => reachedAfterMs(calendar, sinceStartMs, minutes * 60) })];
  if (declared.length === 0) return attendees;
  const speakers = Object.entries((configuration.participants ?? {}) as TomlTable)
    .filter(([, participant]) => (participant as TomlTable).rules === "speaker")
    .map(([name]) => name);
  return [...attendees, ...declared.map((each) => {
    if (each.name === SPONSOR_PERTURBATION) return sponsorWithdrawal(each, calendar);
    if (each.name === HOTEL_OVERBOOKS) return hotelOverbooking(each, calendar, configuration.event_day as number);
    if (isVenueChange(each.name)) return venueChange(each, calendar);
    return cancellation(each, speakers, calendar);
  })];
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

/** How many days before a night a hotel's rooms start to grow scarce (FR-CONGRESS-05's addition). */
const SCARCE_DAYS = 14;

/**
 * The rooms of a hotel left on a night, "<hotel> day <n>", on the world's day: its rooms × days left / 14, rounded down,
 * in the last 14 days before that night, less those booked.
 */
function roomsLeft(state: Congress, hotel: Hotel, option: string, today: number): number {
  const daysLeft = Math.max(0, dayOfDate(/day \d+$/.exec(option)?.[0]) - today);
  return Math.max(0, Math.floor((hotel.rooms * Math.min(SCARCE_DAYS, daysLeft)) / SCARCE_DAYS) - state.travel.booked.filter((booking) => booking.option === option).length);
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
      hotels: state.travel.material.hotels.map((hotel) => ({ id: hotel.id, near: hotel.near, option: `${hotel.id} ${night}`, rooms_left: roomsLeft(state, hotel, `${hotel.id} ${night}`, today), price: hotel.price })),
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
  if (hotel !== undefined) return { price: hotel.price, full: roomsLeft(state, hotel, String(option), today) <= 0 };
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
      const what = `${String(option)} ${String(traveller)}`;
      return {
        ...state,
        travel: { ...state.travel, booked: [...state.travel.booked, { option: String(option), traveller: String(traveller), price, at: minutesOfWorld(world as WorldTime) }] },
        // The travel's account commits the price with the organiser before it invoices it (FR-CONGRESS-05's addition).
        money: stamped(state.money, invoiced(withCommitment(state.money, { by: TRAVEL, with: agent, amount: price, for: what }, state.settings.discretionaryLimit), { from: TRAVEL, to: agent, amount: price, due: `day ${today}`, for: what }), world),
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
const TOOLS: readonly Tool<Congress>[] = [
  checkTime,
  look,
  go,
  writeNote,
  readNotes,
  wait,
  travelOptions,
  bookTravel,
  similarEventsTool,
  // The ticket page, the programme and announcements (FR-POPULATION-01).
  ...populationTools<Congress>({
    organiser: ORGANISER,
    roomsOf: (state) => Object.keys(state.rooms),
    idsOf: (state, kind) => state.context.ids?.[kind] ?? [],
    durationOf: (state, tool) => state.settings.durations[tool] * awayFactorOf(state, ORGANISER),
  }),
];

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
    edit_ticket_page: `${durations.edit_ticket_page} world minutes.`,
    ticket_page: `${durations.ticket_page} world minutes, longer away from the office.`,
    publish_programme: `${durations.publish_programme} world minutes.`,
    announce: `${durations.announce} world minutes.`,
    read_programme: `${durations.read_programme} world minutes.`,
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
    perturbations: configuration.perturbations ?? {},
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
  // The population and the parts an experiment may give, as materials; empty, none (FR-CONGRESS-08).
  'attendees = ""',
  'parts = ""',
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
  // The helpers counted in the attendance, and the share of no-shows final numbers may leave out (FR-CONGRESS-06).
  "helpers = 0",
  "no_show_cut = 0.05",
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
  // An open table: an experiment adds the hours its venues and parties keep (FR-CONGRESS-08).
  "[calendar.hours]",
  "[mail]",
  'mailboxes = ["organiser"]',
  "delivery_minutes = [1, 1]",
  "send_minutes = 0",
  "check_minutes = 0",
  "read_minutes = 0",
  "send_minutes_per_field = 0",
  "send_words_per_minute = 0",
  "read_words_per_minute = 0",
  'notice_source = "mail client"',
  'notice = "New mail from {from}: {subject}"',
  "[phone]",
  'lines = ["organiser"]',
  "ring_minutes = 5",
  "call_minutes = 4",
  'ring = "{from} calls ({call}): {act}. {fields}{text}"',
  // A ring reaches a resting organiser at once; a mail's notice waits for its next activation (FR-CONGRESS-08).
  "wakes = true",
  "[money]",
  "discretionary_limit = 300",
  // The world's travel, which invoices the organiser for what it books (FR-CONGRESS-05).
  "[money.accounts.travel]",
  "unlimited = true",
  // The attendees, who pay the organiser for each ticket (FR-POPULATION-01).
  "[money.accounts.attendees]",
  "unlimited = true",
  "[money.accounts.organiser]",
  "opening = 0",
  'tools = ["ledger", "pay", "issue_invoice"]',
  "[kinds.venue]",
  'rules = "venue"',
  'tools = ["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "ledger", "commit", "release", "issue_invoice", "void_invoice"]',
  `channels = ["mail_notice", "phone", "${VENUE_CHANGE}"]`,
  "reply_minutes = [0, 0]",
  'account = "unlimited"',
  "[kinds.board]",
  'rules = "board"',
  'tools = ["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "approve", "transfer", "issue_invoice"]',
  'channels = ["mail_notice", "phone"]',
  "reply_minutes = [0, 0]",
  'account = "funds"',
  ...[
    ["caterer", '["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "ledger", "commit", "release", "issue_invoice", "void_invoice"]', '["mail_notice", "phone"]', '"unlimited"'],
    ["sponsor", '["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "ledger", "pay", "read_programme"]', `["mail_notice", "phone", "${SPONSOR_PERTURBATION}", "${INVOICE_NOTICE}"]`, '"amount"'],
    ["agency", '["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "ledger", "commit", "release"]', '["mail_notice", "phone"]', '"unlimited"'],
  ].flatMap(([kind, tools, channels, account]) => [`[kinds.${kind}]`, `rules = "${kind}"`, `tools = ${tools}`, `channels = ${channels}`, "reply_minutes = [0, 0]", `account = ${account}`]),
  ...["speaker", "partner"].flatMap((kind) => [
    `[kinds.${kind}]`,
    `rules = "${kind}"`,
    // A speaker releases the commitment of its fee as it cancels, reading its ledger for it (FR-CONGRESS-13).
    'tools = ["send_mail", "check_mail", "read_mail", "call", "answer_call", "check_time", "ledger", "commit", "release", "issue_invoice"]',
    `channels = ["mail_notice", "phone", ${[...SPEAKER_PERTURBATIONS, HOTEL_OVERBOOKS, "programme"].map((name) => `"${name}"`).join(", ")}]`,
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
  "edit_ticket_page = 0",
  "ticket_page = 0",
  "publish_programme = 0",
  "announce = 0",
  "read_programme = 0",
  "ledger = 0",
  "pay = 0",
  "issue_invoice = 0",
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
    { name: HOTEL_OVERBOOKS, source: "the hotel", stimulus: "Your hotel room for the night before the event is cancelled: the hotel is overbooked." },
    // The venue change reaches the venue holding the live booking, with the kind declared (FR-CONGRESS-13).
    { name: VENUE_CHANGE, source: "the venue's management", stimulus: "{kind}" },
    // A published programme tells each of its speakers its session (FR-POPULATION-01).
    { name: "programme", source: "the programme", stimulus: "Your session in the programme: {time} in {room}." },
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
  // Its parts, read only from the world's records (FR-CONGRESS-06).
  parts: congressParts,
  worldAccounts: [TRAVEL, "attendees"],
  // Each change of the population is a line of the run's log (FR-POPULATION-01).
  logLines: (before, after) => (after.population?.events ?? []).slice(before.population?.events?.length ?? 0).map((event) => ({ type: "population", ...event })),
  ruleSets: { venue: venueRules, board: boardRules, speaker: speakerRules, partner: partnerRules, caterer: catererRules, sponsor: sponsorRules, agency: agencyRules },
  variant,
  slowedBy: awayFactorOf,
  // The organiser invoices only sponsors (FR-CONGRESS-11); outside catering is quoted only for an attendance (FR-CONGRESS-16).
  refuses: (state, call, tool) => {
    if (tool === "issue_invoice" && call.agent === ORGANISER && !(state.context.ids?.sponsors ?? []).includes(String(call.arguments.to))) return { outcome: "invalid_arguments", reason: "only sponsors are invoiced" };
    const { to, act, fields = {} } = call.arguments as { to?: unknown; act?: unknown; fields?: Record<string, unknown> };
    const outsideCatering = (tool === "send_mail" || tool === "call") && act === "request_extra" && fields.item === "outside_catering" && state.venues[String(to)] !== undefined;
    return outsideCatering && !Object.hasOwn(fields, "attendance") ? { outcome: "missing_field", reason: 'the act "request_extra" with the item "outside_catering" requires the field "attendance"' } : undefined;
  },
  worldInventory,
  baseConfiguration: BASE_CONFIGURATION,
  // An experiment adds hours and perturbations the base does not have (FR-CONGRESS-08).
  openTables: ["calendar.hours", "perturbations"],
  partyGroups,
};
