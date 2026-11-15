import { Random } from "../engine/random.ts";
import { otherCustomers } from "./congress-parties.ts";
import { type AttendeesMaterial, type Population, minutesOfTime, registrationProbability } from "./population.ts";

// FR-CONGRESS-21: the solvability check. From a replica's parties and its seed, the plans that complete the task, each
// meeting every check of FR-CONGRESS-20 as the world allows it. World times are world minutes since day 1's midnight.

/** A venue as the check reads it: its template, its entrance and the passages of its interior. */
export interface VenueOption {
  id: string;
  price: number;
  rooms: { id: string; seats: number }[];
  extras?: Record<string, number>;
  catering?: string;
  outside_fee_per_head?: number;
  outside_diet_fee_per_head?: number;
  enquiries_per_day?: number;
  booked_by_others?: string[];
  entrance: string;
  interior: { between: [string, string]; step_free: true | string }[];
}

/** A caterer as the check reads it. */
export interface CatererOption {
  id: string;
  price_per_head: number;
  diets?: Record<string, { limit?: number }>;
  minimum?: number;
  in_house_for?: string;
}

/** A speaker as the check reads it. */
export interface SpeakerOption {
  id: string;
  fee?: number;
  home?: string;
  available?: boolean;
  accepts?: boolean;
  condition?: string;
  constraint?: string;
  draw?: number;
}

/** What the check reads of a replica. */
export interface SolvabilityInput {
  seed: number;
  target: number;
  helpers: number;
  /** The organiser's budget; none, no limit. */
  budget?: number;
  eventDay: number;
  startsAt: number;
  endOfPreparation: number;
  referencePrice: number;
  venues: VenueOption[];
  caterers: CatererOption[];
  speakers: SpeakerOption[];
  /** Whether a sponsor insists on a morning slot, which then takes a morning session. */
  sponsorMorning: boolean;
  /** The partners drawn, whose sessions the plan does not fill. */
  partners: number;
  trains: { id: string; from: string; arrives: string; price: number }[];
  hotels: { id: string; near: string; price: number }[];
  attendees?: AttendeesMaterial;
}

/** An order of a plan: its caterer, its meals by diet ("standard" for none) and the venue's permits it needs. */
export interface Order {
  caterer: string;
  counts: Record<string, number>;
  permits: { diet?: string; price: number }[];
}

/** A plan that completes the task. */
export interface Plan {
  venue: string;
  room: string;
  ramp: boolean;
  orders: Order[];
  speakers: { id: string; session: string; fee: number; train?: string; hotel?: string }[];
  price: number;
  cost: number;
}

/** What the check gives: plans (the first PLANS_KEPT), each check's options on its own, and the global solutions. */
export interface Solved {
  plans: Plan[];
  counts: Record<string, number>;
  solutions: number;
  venues: string[];
  cheapest?: { cost: number; venue: string };
  /** Whether the counting stopped at COUNT_LIMIT, so the solutions are at least those counted. */
  at_least?: true;
}

/** The association's members the attendance counts (FR-CONGRESS-06). */
const MEMBERS = 3;
/** The event's sessions (FR-CONGRESS-20). */
const SESSIONS = 6;
/** The day's slots for sessions, morning and afternoon, which fit 09:00-17:30 with breaks and lunch; a sponsor that insists on a morning slot takes 11:00. */
const MORNING = ["09:00", "10:00", "11:00"];
const AFTERNOON = ["13:30", "14:30", "15:30", "16:30"];
/** By when a venue must still be free on the event day. */
const FREE_UNTIL = "day 7 18:00";
/** How many plans the check keeps, and how many it counts before it reports "at least". */
const PLANS_KEPT = 1000;
const COUNT_LIMIT = 1_000_000;

/** Minutes since midnight of "HH:MM". */
const clockOf = (text: string) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));

/** Every subset of a list of a size, in order. */
function* subsets<Item>(items: readonly Item[], size: number, from = 0): Generator<Item[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let index = from; index <= items.length - size; index += 1) for (const rest of subsets(items, size - 1, index + 1)) yield [items[index], ...rest];
}

/** Whether a venue is still free on the event day at FREE_UNTIL: not booked by others, and no other customer's enquiry books it by then. */
function freeOf(venue: VenueOption, input: SolvabilityInput): boolean {
  if ((venue.booked_by_others ?? []).includes(`day ${input.eventDay}`)) return false;
  const rate = venue.enquiries_per_day ?? 0;
  if (rate <= 0) return true;
  const until = minutesOfTime(FREE_UNTIL);
  for (const { at, books } of otherCustomers(Random.derive(input.seed, `enquiries of ${venue.id}`), input.startsAt, rate)) {
    if (at > until) return true;
    if (books) return false;
  }
  return true;
}

/** Whether a venue's room, toilets and catering area are reachable from its entrance, step-free or through any passage. */
function reaches(venue: VenueOption, room: string, anyPassage: boolean): boolean {
  const needed = [room, ...venue.rooms.map(({ id }) => id).filter((id) => /toilet|catering/.test(id)), ...venue.interior.flatMap(({ between }) => between).filter((id) => /toilet|catering/.test(id))];
  const reached = new Set([venue.entrance]);
  for (let grown = true; grown; ) {
    grown = false;
    for (const { between: [one, other], step_free: stepFree } of venue.interior) {
      if (stepFree !== true && !anyPassage) continue;
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
  return needed.every((place) => reached.has(place));
}

/** The attendance's meals by diet: each diet the target × its share rounded up, with the fixed attendees' and the group's; standard for the rest of the attendance. */
function mealsOf(input: SolvabilityInput, attendance: number): Record<string, number> {
  const material = input.attendees;
  const meals: Record<string, number> = {};
  for (const [diet, share] of Object.entries(material?.diets ?? {})) if (diet !== "none" && share > 0) meals[diet] = Math.ceil(input.target * share - 1e-9);
  for (const { diet } of material?.fixed ?? []) if (diet !== undefined && diet !== "none") meals[diet] = (meals[diet] ?? 0) + 1;
  if (material?.group !== undefined && material.group.diet !== "none") meals[material.group.diet] = (meals[material.group.diet] ?? 0) + material.group.size[1];
  const special = Object.values(meals).reduce((sum, count) => sum + count, 0);
  return { standard: Math.max(0, attendance - special), ...meals };
}

/** How many meals of a diet a caterer serves: standard meals without limit, a diet it lists up to its limit, none of another. */
const servesOf = (caterer: CatererOption, diet: string) => (diet === "standard" ? Infinity : Object.hasOwn(caterer.diets ?? {}, diet) ? (caterer.diets?.[diet]?.limit ?? Infinity) : 0);

/** The meals left of counts once a caterer takes what it serves of each, and what it takes. */
function take(caterer: CatererOption, counts: Record<string, number>): { taken: Record<string, number>; left: Record<string, number> } {
  const taken: Record<string, number> = {};
  const left: Record<string, number> = {};
  for (const [diet, count] of Object.entries(counts)) {
    const served = Math.min(count, servesOf(caterer, diet));
    if (served > 0) taken[diet] = served;
    if (count - served > 0) left[diet] = count - served;
  }
  return { taken, left };
}

/** The total of counts. */
const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, count) => sum + count, 0);

/**
 * The catering options at a venue (D5): a first caterer the venue's rule allows, taking what it serves of each diet
 * within its limits; then, for what is left, a second that serves all of it. An outside caterer at an outside_fee venue
 * carries the venue's permit at its fee a head of its meals; at an in_house venue only the venue's own caterer is first,
 * and a second carries a permit for each diet at the venue's fee a head of those meals. Each order meets its caterer's
 * minimum.
 */
function cateringOf(venue: VenueOption, caterers: readonly CatererOption[], meals: Record<string, number>): { orders: Order[]; cost: number }[] {
  const own = caterers.find(({ in_house_for: inHouse }) => inHouse === venue.id);
  const outside = caterers.filter(({ in_house_for: inHouse }) => inHouse === undefined);
  const rule = venue.catering ?? "outside_free";
  const firsts = rule === "in_house" ? (own === undefined ? [] : [own]) : [...(own === undefined ? [] : [own]), ...outside];
  const permitsOf = (caterer: CatererOption, counts: Record<string, number>): Order["permits"] => {
    if (caterer === own || rule === "outside_free") return [];
    if (rule === "outside_fee") return [{ price: (venue.outside_fee_per_head ?? 0) * total(counts) }];
    return Object.entries(counts).map(([diet, count]) => ({ diet, price: (venue.outside_diet_fee_per_head ?? 0) * count }));
  };
  const orderOf = (caterer: CatererOption, counts: Record<string, number>): Order | undefined => {
    if (total(counts) < (caterer.minimum ?? 0)) return undefined;
    // At an in_house venue, an outside caterer brings only diet meals (FR-CONGRESS-17).
    if (rule === "in_house" && caterer !== own && Object.hasOwn(counts, "standard")) return undefined;
    return { caterer: caterer.id, counts, permits: permitsOf(caterer, counts) };
  };
  const costOf = (orders: Order[]) => orders.reduce((sum, { caterer, counts, permits }) => sum + (caterers.find(({ id }) => id === caterer) as CatererOption).price_per_head * total(counts) + permits.reduce((fees, { price }) => fees + price, 0), 0);
  const options: { orders: Order[]; cost: number }[] = [];
  for (const first of firsts) {
    const { taken, left } = take(first, meals);
    const firstOrder = orderOf(first, taken);
    if (firstOrder === undefined) continue;
    if (total(left) === 0) {
      options.push({ orders: [firstOrder], cost: costOf([firstOrder]) });
      continue;
    }
    for (const second of outside.filter((each) => each !== first)) {
      if (total(take(second, left).left) > 0) continue;
      const secondOrder = orderOf(second, left);
      if (secondOrder !== undefined) options.push({ orders: [firstOrder, secondOrder], cost: costOf([firstOrder, secondOrder]) });
    }
  }
  return options;
}

/** A speaker set's sessions: morning-only speakers in the morning, afternoon-only in the afternoon, travellers in the latest slots; none when they do not fit. */
function sessionsOf(speakers: readonly SpeakerOption[], sponsorMorning: boolean): Map<string, string> | undefined {
  const morning = sponsorMorning ? MORNING.slice(0, -1) : [...MORNING];
  const afternoon = [...AFTERNOON];
  const morningOnly = (speaker: SpeakerOption) => speaker.condition === "morning_slot" || speaker.constraint === "morning";
  const afternoonOnly = (speaker: SpeakerOption) => speaker.constraint === "afternoon";
  const travels = (speaker: SpeakerOption) => speaker.home !== undefined && speaker.home !== "local";
  const sessions = new Map<string, string>();
  for (const speaker of speakers.filter(morningOnly)) {
    const slot = travels(speaker) ? morning.pop() : morning.shift();
    if (slot === undefined) return undefined;
    sessions.set(speaker.id, slot);
  }
  for (const speaker of speakers.filter(afternoonOnly)) {
    const slot = afternoon.pop();
    if (slot === undefined) return undefined;
    sessions.set(speaker.id, slot);
  }
  // The others: travellers in the latest slots left, then the rest.
  const rest = [...afternoon, ...morning].sort();
  for (const speaker of speakers.filter((each) => !morningOnly(each) && !afternoonOnly(each)).sort((one, other) => Number(travels(other)) - Number(travels(one)))) {
    const slot = travels(speaker) ? rest.pop() : rest.shift();
    if (slot === undefined) return undefined;
    sessions.set(speaker.id, slot);
  }
  return sessions;
}

/** The expected paying registrants at a price, with a programme of these speakers (FR-POPULATION-01's model), the page open and announced from the start. */
function expectedPaying(input: SolvabilityInput, speakers: readonly SpeakerOption[], price: number): number {
  const material = input.attendees;
  if (material === undefined || price <= 0) return 0;
  const population = {
    material,
    page: { open: true, price, required_fields: [], info: [], waiting_list: false },
    announced: true,
    referencePrice: input.referencePrice,
    programme: [{ version: 1, sessions: [{ start: "09:00", end: "09:45", title: "", speakers: speakers.map(({ id }) => id), room: "" }], breaks: [], sponsor_slots: [], logos: [] }],
    draws: Object.fromEntries(speakers.map(({ id, draw = 0 }) => [id, draw])),
    promotions: [],
    eventDay: input.eventDay,
  } as unknown as Population;
  let staying = 1;
  for (let hour = (Math.floor(input.startsAt / 60) + 1) * 60; hour < input.endOfPreparation; hour += 60) staying *= 1 - registrationProbability({ population }, hour);
  const pool = Math.round(material.pool_factor * input.target) * (1 - staying) * (material.pay_share ?? 1);
  const group = material.group === undefined ? 0 : (material.group.size[0] + material.group.size[1]) / 2;
  return (pool + (material.fixed ?? []).length + group) * (1 - material.cancel_share);
}

/** The highest whole price at which the expected paying registrants are within 0.75-1.10 of the target (D1); none when even 1 gives fewer. */
function priceOf(input: SolvabilityInput, speakers: readonly SpeakerOption[]): number | undefined {
  const enough = (price: number) => expectedPaying(input, speakers, price) >= 0.75 * input.target;
  if (!enough(1)) return undefined;
  let low = 1;
  let high = 2;
  while (enough(high) && high < 1_000_000) high *= 2;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (enough(middle)) low = middle;
    else high = middle;
  }
  return expectedPaying(input, speakers, low) <= 1.1 * input.target ? low : undefined;
}

/** A speaker set's speakers at a venue: their sessions, fees, trains and hotels, and what the plan pays; none when one cannot arrive. */
function travelOf(input: SolvabilityInput, venue: string, speakers: readonly SpeakerOption[], sessions: Map<string, string>): { speakers: Plan["speakers"]; cost: number } | undefined {
  const hotels = [...input.hotels.filter(({ near }) => near === venue), ...input.hotels].sort((one, other) => one.price - other.price);
  let cost = 0;
  const given: Plan["speakers"] = [];
  for (const speaker of speakers) {
    const session = sessions.get(speaker.id) as string;
    const fee = speaker.condition === "fee" ? (speaker.fee ?? 0) : 0;
    cost += fee;
    if (speaker.home === undefined || speaker.home === "local") {
      given.push({ id: speaker.id, session, fee });
      continue;
    }
    const train = input.trains.filter(({ from, arrives }) => from === speaker.home && clockOf(arrives) <= clockOf(session) - 30).sort((one, other) => one.price - other.price)[0];
    if (train !== undefined) {
      // The organiser pays the train of a speaker whose condition is travel_paid.
      if (speaker.condition === "travel_paid") cost += train.price;
      given.push({ id: speaker.id, session, fee, train: train.id });
      continue;
    }
    const hotel = hotels[0];
    if (hotel === undefined) return undefined;
    cost += hotel.price;
    given.push({ id: speaker.id, session, fee, hotel: hotel.id });
  }
  return { speakers: given, cost };
}

/** The plans that complete the task, each check's options on its own, and the global solutions (FR-CONGRESS-21). */
export function plansOf(input: SolvabilityInput): Solved {
  const attendance = input.target + SESSIONS + MEMBERS + input.helpers;
  const meals = mealsOf(input, attendance);
  const access = Object.entries(input.attendees?.access ?? {}).some(([need, share]) => need !== "none" && share > 0) || (input.attendees?.fixed ?? []).some(({ access: need }) => need !== undefined && need !== "none");
  const counts: Record<string, number> = { D0: 0, D1: 0, D2: 0, D3: 0, D4: 0, D5: 0, D6: 0, D7: 0, D8: 0, D9: 0 };
  // The venues' rooms that meet D0, D3 and D4, with what each costs.
  const rooms: { venue: VenueOption; room: string; ramp: boolean; cost: number }[] = [];
  for (const venue of input.venues) {
    const free = freeOf(venue, input);
    const seats = venue.rooms.reduce((sum, { seats: each }) => sum + each, 0);
    for (const { id, seats: held } of venue.rooms.filter(({ seats: each }) => each > 0)) {
      const fits = held >= attendance;
      const stepFree = !access || reaches(venue, id, false);
      const ramp = !stepFree && venue.extras?.ramp !== undefined && reaches(venue, id, true);
      if (free) counts.D0 += 1;
      if (fits) counts.D3 += 1;
      if (stepFree || ramp) counts.D4 += 1;
      if (free && fits && (stepFree || ramp)) rooms.push({ venue, room: id, ramp, cost: Math.round((venue.price * held) / seats) + (ramp ? (venue.extras?.ramp as number) : 0) });
    }
  }
  const catering = new Map(input.venues.map((venue) => [venue.id, cateringOf(venue, input.caterers, meals)]));
  counts.D5 = [...catering.values()].reduce((sum, options) => sum + options.length, 0);
  // The speaker sets that meet D2, with their sessions, D9's travel at each venue and D1's price.
  const eligible = input.speakers.filter(({ available, accepts }) => available === true && accepts !== false);
  const sets: { speakers: SpeakerOption[]; sessions: Map<string, string>; price?: number }[] = [];
  const prices = new Map<number, number | undefined>();
  for (const chosen of subsets(eligible, Math.max(0, SESSIONS - input.partners))) {
    const sessions = sessionsOf(chosen, input.sponsorMorning);
    if (sessions === undefined) continue;
    counts.D2 += 1;
    if (travelOf(input, "", chosen, sessions) !== undefined) counts.D9 += 1;
    const draws = chosen.reduce((sum, { draw = 0 }) => sum + draw, 0);
    if (!prices.has(draws)) prices.set(draws, priceOf(input, chosen));
    const price = prices.get(draws);
    if (price !== undefined) counts.D1 += 1;
    sets.push({ speakers: chosen, sessions, ...(price === undefined ? {} : { price }) });
  }
  // Six sessions fit the day, and a morning slot is left for a sponsor that insists on one (D7, D8).
  counts.D7 = MORNING.length + AFTERNOON.length - (input.sponsorMorning ? 1 : 0) >= SESSIONS ? 1 : 0;
  counts.D8 = counts.D7;
  const plans: Plan[] = [];
  const venues = new Set<string>();
  let solutions = 0;
  let cheapest: Solved["cheapest"];
  let atLeast = false;
  const budget = input.budget ?? Infinity;
  for (const { venue, room, ramp, cost: roomCost } of rooms) {
    // Each set's travel at this venue, whose hotels it reads.
    const travels = sets.map((set) => travelOf(input, venue.id, set.speakers, set.sessions));
    for (const { orders, cost: food } of catering.get(venue.id) ?? []) {
      for (const [index, set] of sets.entries()) {
        const travel = travels[index];
        if (travel === undefined) continue;
        const cost = roomCost + food + travel.cost;
        if (cost > budget) continue;
        counts.D6 += 1;
        if (set.price === undefined) continue;
        solutions += 1;
        venues.add(venue.id);
        if (cheapest === undefined || cost < cheapest.cost) cheapest = { cost, venue: venue.id };
        if (plans.length < PLANS_KEPT) plans.push({ venue: venue.id, room, ramp, orders, speakers: travel.speakers, price: set.price, cost });
        if (solutions >= COUNT_LIMIT) {
          atLeast = true;
          break;
        }
      }
      if (atLeast) break;
    }
    if (atLeast) break;
  }
  return { plans, counts, solutions, venues: [...venues].sort(), ...(cheapest === undefined ? {} : { cheapest }), ...(atLeast ? { at_least: true as const } : {}) };
}
