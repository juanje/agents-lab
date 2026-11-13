import { type TomlTable, parse } from "smol-toml";
import { type Calendar, type WorldTime, hoursAt, readCalendar, worldTimeText } from "../engine/calendar.ts";
import type { Mail } from "../engine/mail.ts";
import type { Money } from "../engine/money.ts";
import type { Phone } from "../engine/phone.ts";
import { type Places, arrive, exits, inSight, layout, leave, put, where } from "../engine/places.ts";
import type { Random } from "../engine/random.ts";
import type { Configuration, Scenario } from "../engine/scenario.ts";
import type { Channel } from "../engine/stimuli.ts";
import type { AgentCall, Effector, Sensor, Sight, Tool } from "../engine/tools.ts";
import type { Action } from "../engine/world.ts";
import { SPEAKER_CONDITIONS, SPEAKER_CONSTRAINTS, SPEAKER_PERTURBATIONS, boardRules, partnerRules, perturbationMinutes, speakerRules, venueRules } from "./congress-parties.ts";
import { describeUniformRhythm, rhythmChannels, uniformRhythm } from "./rhythm.ts";

/** The congress's one agent. */
const ORGANISER = "organiser";

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
const DURATION_KEYS = ["check_time", "look", "write_note", "read_notes"] as const;

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
    if (typeof count !== "number" || !(count >= 0 && count <= pool.length)) throw refused(`draw.${kind}`, count, `the pool of "${kind}" has ${pool.length} templates`);
    const chosen = chooseFrom(pool, count, random);
    drawn.chosen[kind] = chosen.map(({ id }) => id as string);
    if (Object.hasOwn(settings, kind)) templates.push(...chosen.map((template) => ({ ...template, kind })));
  }
  const calendar = configuration.calendar === undefined ? undefined : readCalendar(configuration.calendar);
  const city = cityOf(configuration, calendar);
  assertParties(kinds, settings, city);
  const perturbations = perturbationsOf(configuration, kinds.venue ?? []);
  const accounts: Record<string, TomlTable> = {};
  const participants = Object.fromEntries(
    templates.map(({ id, kind, reply_minutes: replyMinutes, hours, ...params }) => {
      const { account, ...kept } = settings[kind as string] as TomlTable;
      if (account === "unlimited") accounts[id as string] = { unlimited: true };
      else if (typeof account === "string") accounts[id as string] = { opening: params[account] as number };
      // A template's reply delay and hours are its participant's, in place of its kind's.
      const own = { ...(replyMinutes === undefined ? {} : { reply_minutes: replyMinutes }), ...(hours === undefined ? {} : { hours }) };
      return [id as string, { decides: "rules", ...kept, ...own, params: { ...params, ...worldOf(kept.rules, id as string, configuration, city, perturbations) } }];
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
  return { configuration: completed, drawn: { ...drawn } };
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

/** A perturbation as the configuration declares it (NFR-13): its name, kind, window or time, and the venue it is for, if one. */
interface Perturbation {
  name: string;
  kind?: string;
  between?: [string, string];
  at?: string;
  for?: string;
}

/** The configuration's perturbations, refused, naming them, when their times do not follow "day <n> HH:MM" or they are for no venue. */
function perturbationsOf(configuration: Configuration, venues: readonly TomlTable[]): Perturbation[] {
  return Object.entries((configuration.perturbations ?? {}) as TomlTable).map(([name, written]) => {
    const declared = { name, ...(written as TomlTable) } as unknown as Perturbation;
    const times = [...(declared.between ?? []), ...(declared.at === undefined ? [] : [declared.at])];
    if (times.length === 0 || times.some((time) => perturbationMinutes(time) === undefined)) throw refused(`perturbations.${name}`, written, 'its times do not follow "day <n> HH:MM"');
    if (declared.for !== undefined && !venues.some(({ id }) => id === declared.for)) throw refused(`perturbations.${name}`, written, `"${declared.for}" is no venue`);
    return declared;
  });
}

/**
 * What the world adds to a party's parameters, by its rule set: a venue gets the organiser it answers, the event's day,
 * its interior's true floor plan from the city and the perturbations for it; a board gets the organiser.
 */
function worldOf(rules: unknown, id: string, configuration: Configuration, city: City, perturbations: readonly Perturbation[]): TomlTable {
  if (rules === "board") return { organiser: ORGANISER_NAME };
  if (rules === "speaker" || rules === "partner") return { organiser: ORGANISER_NAME, event_day: configuration.event_day as number };
  if (rules !== "venue") return {};
  const venue = city.venues.find((each) => each.id === id) as Venue;
  const inside = [venue.entrance, ...venue.rooms.map((room) => room.id)];
  return {
    id,
    organiser: ORGANISER_NAME,
    event_day: configuration.event_day as number,
    floor_plan: city.passages.filter(({ between }) => between.every((place) => inside.includes(place))).map(({ between, step_free: stepFree }) => ({ between, step_free: stepFree })),
    perturbations: perturbations.filter((each) => !SPEAKER_PERTURBATIONS.includes(each.name) && (each.for === undefined || each.for === id)) as unknown as TomlTable[],
  };
}

/** The congress's world as a replica starts: the city's places, the chosen venues', the organiser in its place, no notes. */
function initialState(configuration: Configuration): Congress {
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

/** The organiser's own tools, besides the mail's and the phone's. */
const TOOLS: readonly Tool<Congress>[] = [checkTime, look, go, writeNote, readNotes, wait];

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
  "'''",
  "draw = '''",
  "attendance = [100, 100]",
  "'''",
  "event_day = 26",
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
  "[money.accounts.organiser]",
  "opening = 0",
  'tools = ["ledger", "pay", "issue_invoice"]',
  "[kinds.venue]",
  'rules = "venue"',
  'tools = ["send_mail", "check_mail", "read_mail", "answer_call", "check_time", "ledger", "commit", "release", "issue_invoice"]',
  'channels = ["mail_notice", "phone"]',
  "reply_minutes = [0, 0]",
  'account = "unlimited"',
  "[kinds.board]",
  'rules = "board"',
  'tools = ["send_mail", "check_mail", "read_mail", "answer_call", "approve", "transfer"]',
  'channels = ["mail_notice", "phone"]',
  "reply_minutes = [0, 0]",
  'account = "funds"',
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
  ruleSets: { venue: venueRules, board: boardRules, speaker: speakerRules, partner: partnerRules },
  variant,
  slowedBy: (state, agent) => (agent === ORGANISER && hereOf(state, agent) !== OFFICE ? state.settings.awayFactor : 1),
  worldInventory,
  baseConfiguration: BASE_CONFIGURATION,
};
