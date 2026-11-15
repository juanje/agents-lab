import type { WorldTime } from "../engine/calendar.ts";
import type { Component, Step } from "../engine/components.ts";
import { type Mail, withSent } from "../engine/mail.ts";
import { type Money, stamped, withTransfer } from "../engine/money.ts";
import type { Random } from "../engine/random.ts";
import type { Effector, Sensor, Tool } from "../engine/tools.ts";

/** A person the material gives in every replica, with the window in which they register (FR-POPULATION-01). */
export interface FixedPerson {
  id: string;
  diet?: string;
  access?: string;
  between: [string, string];
}

/** A group that registers together, of a drawn size, with a shared diet. */
export interface Group {
  size: [number, number];
  diet: string;
  between: [string, string];
}

/** The attendees material (FR-POPULATION-01): the pool's shares, the registration rates and the fixed people. */
export interface AttendeesMaterial {
  pool_factor: number;
  base_per_day: number;
  unannounced: number;
  promotion_factor: number;
  payment_fee_share: number;
  cancel_share: number;
  consent_share: number;
  pay_share?: number;
  no_show_share?: number;
  /** The share of registrants who mail the organiser a question (FR-CONGRESS-09); none without it. */
  question_share?: number;
  diets: Record<string, number>;
  access?: Record<string, number>;
  fixed?: FixedPerson[];
  group?: Group;
}

/** A person of the pool: who they are, and what happens to them. */
export interface Person {
  id: string;
  diet: string;
  access: string;
  pays: boolean;
  consents: boolean;
  /** Whether they would not come, when asked to cancel if they cannot. */
  no_show: boolean;
  /** For a fixed person or a group's member, when they register, in world minutes since day 1's midnight. */
  registersAt?: number;
  group?: true;
  registered?: number;
  waiting?: true;
  cancelled?: number;
  /** When they cancel, drawn as they register. */
  cancelsAt?: number;
  /** What they gave the page: diet, access need, consent. */
  given: { diet?: string; access?: string; consent?: boolean };
  /** The programme version they believe. */
  believes?: number;
}

/** The ticket page's settings. */
export interface Page {
  open: boolean;
  price: number;
  cap?: number;
  close_date?: string;
  required_fields: string[];
  info: string[];
  waiting_list: boolean;
}

/** A session of a programme. */
export interface Session {
  start: string;
  end: string;
  title: string;
  speakers: string[];
  room: string;
}

/** A published version of the programme. */
export interface Programme {
  version: number;
  sessions: Session[];
  breaks: unknown[];
  sponsor_slots: { sponsor: string; start: string; end?: string }[];
  logos: string[];
  /** When it was published, in world minutes since day 1's midnight (FR-CONGRESS-06). */
  published?: number;
}

/** The population as the world keeps it (FR-POPULATION-01). */
export interface Population {
  material: AttendeesMaterial;
  eventDay: number;
  referencePrice: number;
  /** Each speaker's draw, by its id. */
  draws: Record<string, number>;
  people: Person[];
  page: Page;
  /** Whether registration_open was announced to the association. */
  announced: boolean;
  promotions: { start: number; factor: number }[];
  programme: Programme[];
  /** Whose data each sponsor holds, and whether each consented. */
  sponsorData: Record<string, { ids: string[]; consented: string[]; without: string[] }>;
  /** When registrants were last asked for their needs, or to cancel if they cannot come, in world minutes. */
  needsRequested?: number;
  cancelRequested?: number;
  /** Every change it went through, in order, for the run's log. */
  events?: PopulationEvent[];
  /** Each announcement, with its audience, kind and world minutes (FR-CONGRESS-06). */
  announcements?: { audience: string; kind: string; at: number }[];
  /** Each price the page was set to, with its world minutes (FR-CONGRESS-06). */
  edits?: { at: number; price?: number; open?: boolean; required_fields?: string[] }[];
}

/** World minutes since day 1's midnight of "day <n> HH:MM". */
export function minutesOfTime(text: string): number {
  const [, day, hours, minutes] = /^day (\d+)(?: [A-Z][a-z]+day)? (\d\d):(\d\d)$/.exec(text) ?? [];
  return (Number(day) - 1) * 1440 + Number(hours) * 60 + Number(minutes);
}

/** A choice drawn by its shares. */
function choose(shares: Readonly<Record<string, number>>, draw: number): string {
  let sum = 0;
  for (const [choice, share] of Object.entries(shares)) {
    sum += share;
    if (draw < sum) return choice;
  }
  return Object.keys(shares).at(-1) as string;
}

/**
 * The pool (FR-POPULATION-01), from the population's sequence: pool_factor × the target attendance people, a-1 onwards,
 * each with a diet, an access need, whether they would pay, consent and come; then the fixed people, each registering at
 * a time drawn in their window; then a group of a drawn size with a shared diet, all registering at one drawn time.
 */
export function drawPool(material: AttendeesMaterial, target: number, random: Random): Person[] {
  const access = material.access ?? { none: 1 };
  const pool: Person[] = Array.from({ length: Math.round(material.pool_factor * target) }, (_, index) => {
    const [diet, need, pays, consents, noShow] = [random.next(), random.next(), random.next(), random.next(), random.next()];
    return {
      id: `a-${index + 1}`,
      diet: choose(material.diets, diet),
      access: choose(access, need),
      pays: pays < (material.pay_share ?? 1),
      consents: consents < material.consent_share,
      no_show: noShow < (material.no_show_share ?? 0),
      given: {},
    };
  });
  const within = ([from, to]: [string, string]) => minutesOfTime(from) + random.next() * (minutesOfTime(to) - minutesOfTime(from));
  for (const fixed of material.fixed ?? []) {
    pool.push({ id: fixed.id, diet: fixed.diet ?? "none", access: fixed.access ?? "none", pays: true, consents: false, no_show: false, registersAt: within(fixed.between), given: {} });
  }
  if (material.group !== undefined) {
    const [fewest, most] = material.group.size;
    const size = fewest + Math.floor(random.next() * (most - fewest + 1));
    const registersAt = within(material.group.between);
    const first = pool.length;
    for (let member = 0; member < size; member += 1) {
      pool.push({ id: `a-${first + member + 1}`, diet: material.group.diet, access: "none", pays: true, consents: false, no_show: false, registersAt, group: true, given: {} });
    }
  }
  return pool;
}

/** How long a promotion runs, in world minutes. */
const PROMOTION_MINUTES = 2 * 1440;

/**
 * A person's probability of registering in a world hour (FR-POPULATION-01): base_per_day / 24 × f × g × h × r × m, at
 * most 1; 0 while the page is closed.
 */
export function registrationProbability({ population }: { population?: Population }, minutes: number): number {
  if (population === undefined || !population.page.open) return 0;
  const { material, page } = population;
  const f = population.announced ? 1 : material.unannounced;
  const g = page.price <= population.referencePrice || page.price === 0 ? 1 : Math.exp(-2.5 * (page.price / population.referencePrice - 1));
  const latest = population.programme.at(-1);
  const speakers = new Set(latest?.sessions.flatMap(({ speakers: named }) => named) ?? []);
  const h = 1 + 0.1 * [...speakers].reduce((sum, speaker) => sum + (population.draws[speaker] ?? 0), 0);
  const daysLeft = population.eventDay - (Math.floor(minutes / 1440) + 1);
  const r = daysLeft > 14 ? 1 : daysLeft > 7 ? 1 + (2 * (14 - daysLeft)) / 7 : 3;
  const m = population.promotions.filter(({ start }) => start <= minutes && minutes < start + PROMOTION_MINUTES).reduce((product, { factor }) => product * factor, 1);
  return Math.min(1, (material.base_per_day / 24) * f * g * h * r * m);
}

/** A change the population's world went through, for the run's log (FR-POPULATION-01). */
export interface PopulationEvent {
  event: "registration" | "payment" | "waiting_list" | "cancellation" | "cancel_draw" | "belief" | "answer";
  person?: string;
  worldTime?: WorldTime;
  [key: string]: unknown;
}

/** What the population's tools and component work on: the population, the money and the mail of the world. */
export interface PopulationWorld {
  population?: Population;
  money: Money;
  mail: Mail;
  /** The rooms a session may be in, for a world that gives them as a list. */
  rooms?: unknown;
  /** Each tool's duration in world minutes, for a world that gives them here. */
  durations?: Record<string, number>;
}

/** The fields a ticket page may require, and the information it may give. */
const REQUIRED_FIELDS = ["diet", "access", "consent_sponsors"];
const INFO = ["date", "address", "outline", "inclusions", "refund_policy"];
/** Who an announcement may go to, and what it may be. */
const AUDIENCES = ["registrants", "association_list", "speakers", "sponsors"];
const KINDS = ["registration_open", "programme", "change", "reminder", "promotion", "request_needs", "request_cancel_if_not_coming"];

/** A value a tool cannot take. */
const INVALID_VALUE = "invalid_value";

/** World minutes since day 1's midnight of a world time. */
const minutesOfWorld = ({ day, seconds }: WorldTime) => (day - 1) * 1440 + seconds / 60;
/** World minutes since midnight of "HH:MM". */
const clockMinutes = (text: string) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
/** The day of "day <n>". */
const dayNumber = (text: unknown) => Number(/^day (\d+)$/.exec(String(text))?.[1]);

/** How the population's tools read their world: the organiser, the rooms a session may be in, durations and audiences. */
export interface PopulationToolOptions<State> {
  organiser: string;
  roomsOf?: (state: State) => readonly string[];
  durationOf?: (state: State, tool: string) => number;
  /** The speakers or sponsors an announcement goes to, by its audience. */
  membersOf?: (state: State, audience: "speakers" | "sponsors") => readonly string[];
  /** The drawn ids a programme may name as speakers or sponsors (FR-CONGRESS-09); without it, any name. */
  idsOf?: (state: State, kind: "speakers" | "sponsors") => readonly string[];
}

/** The registrants: people registered and not cancelled. */
const registrantsOf = (population: Population) => population.people.filter(({ registered, cancelled }) => registered !== undefined && cancelled === undefined);

/** Counts of a field's values among those who gave it. */
function countsOf(values: readonly (string | undefined)[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) if (value !== undefined) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/** The days of the registrations, "day <n>", counted. */
const byDay = (people: readonly Person[]) => countsOf(people.map(({ registered }) => (registered === undefined ? undefined : `day ${Math.floor(registered / 1440) + 1}`)));

/**
 * The tools of the population (FR-POPULATION-01): the organiser's edit_ticket_page, ticket_page, publish_programme and
 * announce, and read_programme, which sponsors read the programme with, each taking the duration its world gives.
 */
export function populationTools<State extends PopulationWorld>(options: PopulationToolOptions<State>): Tool<State>[] {
  const roomsOf = options.roomsOf ?? ((state: State) => (state.rooms ?? []) as string[]);
  const durationOf = options.durationOf ?? ((state: State, tool: string) => state.durations?.[tool] ?? 0);
  const duration = (tool: string) => (state: State) => ({ worldSeconds: durationOf(state, tool) * 60 });
  const withPopulation = (state: State, change: (population: Population) => Population): State => ({ ...state, population: change(state.population as Population) });
  const invalid = (reason: string) => ({ outcome: INVALID_VALUE, reason });
  const nowOf = (world: WorldTime | undefined) => (world === undefined ? 0 : minutesOfWorld(world));
  // A congress without attendees has no ticket page.
  const noPage = invalid("the congress has no ticket page");

  const readProgramme: Sensor<State> = {
    kind: "sensor",
    name: "read_programme",
    description: "Read the latest programme published on the ticket page.",
    parameters: { type: "object", properties: {} },
    durationMs: duration("read_programme"),
    sense: (state) => {
      const latest = state.population?.programme.at(-1);
      return latest === undefined ? "No programme is published." : JSON.stringify(latest);
    },
  };

  const editTicketPage: Effector<State> = {
    kind: "effector",
    name: "edit_ticket_page",
    description: 'Change the ticket page: open (true or false), price, cap, close_date ("day <n>"), required_fields (any of diet, access, consent_sponsors), info (any of date, address, outline, inclusions, refund_policy), waiting_list (true or false).',
    parameters: {
      type: "object",
      properties: {
        open: { type: "boolean" },
        price: { type: "number" },
        cap: { type: "integer" },
        close_date: { type: "string" },
        required_fields: { type: "array", items: { type: "string" } },
        info: { type: "array", items: { type: "string" } },
        waiting_list: { type: "boolean" },
      },
    },
    refuses: (state, { arguments: args }) => {
      if (state.population === undefined) return noPage;
      if (args.price !== undefined && !(typeof args.price === "number" && args.price >= 0)) return invalid("the price is not an amount of at least 0");
      if (args.cap !== undefined && !(Number.isInteger(args.cap) && (args.cap as number) >= 0)) return invalid("the cap is not a whole number of at least 0");
      if (args.close_date !== undefined && !/^day \d+$/.test(String(args.close_date))) return invalid('the close date is not "day <n>"');
      if (args.required_fields !== undefined && !(Array.isArray(args.required_fields) && args.required_fields.every((field) => REQUIRED_FIELDS.includes(field)))) return invalid(`the required fields are not among ${REQUIRED_FIELDS.join(", ")}`);
      if (args.info !== undefined && !(Array.isArray(args.info) && args.info.every((field) => INFO.includes(field)))) return invalid(`the info is not among ${INFO.join(", ")}`);
      return undefined;
    },
    durationMs: duration("edit_ticket_page"),
    action: {
      precondition: () => ({ holds: true }),
      effect: (state, { arguments: args, world }) =>
        withPopulation(state, (population) => ({
          ...population,
          page: { ...population.page, ...Object.fromEntries(Object.entries(args).filter(([key]) => ["open", "price", "cap", "close_date", "required_fields", "info", "waiting_list"].includes(key))) } as Page,
          // Each edit with its time: the price (FR-CONGRESS-06), whether the page is open and the fields it requires (FR-CONGRESS-10).
          ...(world === undefined
            ? {}
            : {
                edits: [
                  ...(population.edits ?? []),
                  {
                    at: nowOf(world),
                    ...(typeof args.price === "number" ? { price: args.price } : {}),
                    ...(typeof args.open === "boolean" ? { open: args.open } : {}),
                    ...(Array.isArray(args.required_fields) ? { required_fields: args.required_fields as string[] } : {}),
                  },
                ],
              }),
        })),
    },
    texts: { success: "The ticket page is changed.", [INVALID_VALUE]: "invalid_value: the page cannot take that value" },
    readTarget: () => "not_sensed",
  };

  const ticketPage: Sensor<State> = {
    kind: "sensor",
    name: "ticket_page",
    description: "Read the ticket page: summary (its settings, registrations by day, and diets and access needs among those who gave them) or list (each registrant with the fields the page collected, and the waiting list).",
    parameters: { type: "object", properties: { detail: { type: "string", enum: ["summary", "list"] } }, required: ["detail"] },
    durationMs: duration("ticket_page"),
    sense: (state, _agent, { detail }) => {
      if (state.population === undefined) return "There is no ticket page.";
      const population = state.population;
      const registrants = registrantsOf(population);
      const waiting = population.people.filter(({ waiting: onList }) => onList === true).map(({ id }) => id);
      if (detail === "list") return JSON.stringify({ registrants: registrants.map(({ id, given }) => ({ id, ...given })), waiting_list: waiting });
      const { waiting_list: keeps, ...page } = population.page;
      return JSON.stringify({
        ...page,
        keeps_waiting_list: keeps,
        registrations: registrants.length,
        by_day: byDay(registrants),
        diets: countsOf(registrants.map(({ given }) => given.diet)),
        access: countsOf(registrants.map(({ given }) => given.access)),
        waiting_list: waiting.length,
      });
    },
  };

  /** The speakers and sponsors a programme names that are no drawn id, refused as invalid_value naming them (FR-CONGRESS-09). */
  const strangers = (state: State, sessions: readonly Session[], slots: unknown, logos: unknown) => {
    if (options.idsOf === undefined) return undefined;
    const speakers = options.idsOf(state, "speakers");
    const sponsors = options.idsOf(state, "sponsors");
    const named = [
      ...sessions.flatMap(({ speakers: given = [] }) => given.filter((speaker) => !speakers.includes(speaker))),
      ...((Array.isArray(slots) ? slots : []) as { sponsor?: string }[]).map(({ sponsor }) => String(sponsor)).filter((sponsor) => !sponsors.includes(sponsor)),
      ...((Array.isArray(logos) ? logos : []) as string[]).filter((logo) => !sponsors.includes(logo)),
    ];
    return named.length === 0 ? undefined : invalid(`${[...new Set(named)].map((name) => `"${name}"`).join(", ")} ${named.length === 1 ? "is" : "are"} no speaker or sponsor id`);
  };

  const publishProgramme: Effector<State> = {
    kind: "effector",
    name: "publish_programme",
    description:
      "Publish a new version of the programme on the ticket page: sessions (each start and end \"HH:MM\", title, speakers and room), breaks, sponsor_slots (each sponsor, start, end) and logos (the sponsors whose logo it shows). It names speakers and sponsors by id.",
    parameters: {
      type: "object",
      properties: {
        sessions: { type: "array", items: { type: "object" } },
        breaks: { type: "array", items: { type: "object" } },
        sponsor_slots: { type: "array", items: { type: "object" } },
        logos: { type: "array", items: { type: "string" } },
      },
      required: ["sessions"],
    },
    refuses: (state, { arguments: { sessions, sponsor_slots: slots = [], logos = [] } }) => {
      if (state.population === undefined) return noPage;
      const given = (Array.isArray(sessions) ? sessions : []) as Session[];
      const rooms = roomsOf(state);
      const stranger = given.find(({ room }) => !rooms.includes(room));
      if (stranger !== undefined) return invalid(`no chosen venue has the room "${stranger.room}"`);
      const clash = given.find((one, index) => given.some((other, before) => before < index && other.room === one.room && clockMinutes(one.start) < clockMinutes(other.end) && clockMinutes(other.start) < clockMinutes(one.end)));
      if (clash !== undefined) return invalid(`two sessions are in "${clash.room}" at once`);
      return strangers(state, given, slots, logos);
    },
    durationMs: duration("publish_programme"),
    action: {
      precondition: () => ({ holds: true }),
      effect: (state, { arguments: { sessions, breaks = [], sponsor_slots: slots = [], logos = [] }, world }) =>
        withPopulation(state, (population) => ({
          ...population,
          programme: [
            ...population.programme,
            { version: population.programme.length + 1, sessions: sessions as Session[], breaks: breaks as unknown[], sponsor_slots: slots as Programme["sponsor_slots"], logos: logos as string[], ...(world === undefined ? {} : { published: nowOf(world) }) },
          ],
        })),
    },
    texts: { success: "Published.", [INVALID_VALUE]: "invalid_value: the programme cannot be followed" },
    readTarget: () => "not_sensed",
  };

  const announce: Effector<State> = {
    kind: "effector",
    name: "announce",
    description: `Announce something: to an audience (${AUDIENCES.join(", ")}), of a kind (${KINDS.join(", ")}), with an optional text; one mail to each member of the audience.`,
    parameters: { type: "object", properties: { audience: { type: "string" }, kind: { type: "string" }, text: { type: "string" } }, required: ["audience", "kind"] },
    refuses: (state, { arguments: { audience, kind } }) => (state.population === undefined ? noPage : AUDIENCES.includes(String(audience)) && KINDS.includes(String(kind)) ? undefined : invalid("no such audience or kind")),
    durationMs: duration("announce"),
    action: {
      precondition: () => ({ holds: true }),
      effect: (state, { arguments: { audience, kind, text }, world }) => {
        const now = nowOf(world);
        // Each announcement, with its audience, kind and time (FR-CONGRESS-06).
        const recorded = withPopulation(state, (population) => ({ ...population, announcements: [...(population.announcements ?? []), { audience: String(audience), kind: String(kind), at: now }] }));
        let next = withPopulation(recorded, (population) => {
          if (audience === "association_list" && kind === "registration_open") return { ...population, announced: true };
          // A promotion while the page is open also opens registration (FR-CONGRESS-11).
          if (audience === "association_list" && kind === "promotion") return { ...population, announced: population.announced || population.page.open, promotions: [...population.promotions, { start: now, factor: population.material.promotion_factor }] };
          if (audience !== "registrants") return population;
          if (kind === "request_needs") return { ...population, needsRequested: now };
          if (kind === "request_cancel_if_not_coming") return { ...population, cancelRequested: now };
          if (kind !== "programme" && kind !== "change") return population;
          // Registrants believe the latest version they are told of.
          const latest = population.programme.at(-1)?.version;
          if (latest === undefined) return population;
          const told = registrantsOf(population).map(({ id }) => id);
          return {
            ...population,
            people: population.people.map((person) => (told.includes(person.id) ? { ...person, believes: latest } : person)),
            events: [...(population.events ?? []), ...told.map((person) => ({ event: "belief" as const, person, version: latest, ...(world === undefined ? {} : { worldTime: world }) }))],
          };
        });
        // Speakers and sponsors get a mail each.
        if (audience === "speakers" || audience === "sponsors") {
          for (const member of options.membersOf?.(next, audience) ?? []) next = { ...next, mail: withSent(next.mail, options.organiser, { to: member, act: String(kind), ...(text === undefined ? {} : { text: String(text) }) }, world) };
        }
        return next;
      },
    },
    texts: { success: "Announced.", [INVALID_VALUE]: "invalid_value: no such audience or kind" },
    readTarget: () => "not_sensed",
  };

  return [editTicketPage, ticketPage, publishProgramme, announce, readProgramme];
}

/** How the population's component reads its world: the organiser, the target attendance, and run milliseconds for world minutes. */
export interface PopulationOptions {
  organiser: string;
  target: number;
  /** The run milliseconds from a moment of the run until so many world minutes later. */
  msFor: (minutes: number, sinceStartMs: number) => number;
}

/** The share that a registrant asked to cancel if they would not come does so. */
const CANCEL_IF_NOT_COMING = 0.5;
/** How long a person takes to answer a request, or to ask what the page did not, in world minutes. */
const WITHIN_A_DAY = 1440;

/** What a registrant asks the organiser about, and within how many world minutes of registering (FR-CONGRESS-09). */
const QUESTIONS = ["address", "access", "diet", "refund"];
const WITHIN_THREE_DAYS = 3 * 1440;
/** The population's account, which pays the organiser for each paying registrant. */
const ATTENDEES = "attendees";

/**
 * The population (FR-POPULATION-01), a component with its own sequence: it draws its pool first, then, each world hour,
 * registers each person by their probability, and fixed people and groups at their drawn times, while the page lets
 * them; pays for each paying registrant, collects only the fields the page requires, cancels registrants at the times
 * drawn, answers requests, starts speakers' promotions and records sponsors' attendee lists from the world's mail, and
 * tells each speaker of a new programme version its session.
 */
export function populationComponent<State extends PopulationWorld>(options: PopulationOptions): Component<State> {
  return {
    name: ATTENDEES,
    kind: "world",
    description: "The attendees: they register through the ticket page, each world hour by the published formula, pay, cancel and answer requests.",
    cycle: (random) => {
      let pool: Person[] | undefined;
      let nextTick = 0;
      const seen = new Set<string>();
      let toldVersion = 0;
      let needsHandled: number | undefined;
      let cancelHandled: number | undefined;
      /** When each person answers a request for needs, or mails a question, in world minutes. */
      const needsAt = new Map<string, number>();
      const mailAt = new Map<string, { at: number; about: string }>();
      const questionsAt = new Map<string, { at: number; about: string }>();
      const deliveries: Step<State>[] = [];

      return {
        next: (state, _outcome, sinceStartMs, world) => {
          const population = state.population as Population;
          const now = minutesOfWorld(world as WorldTime);
          if (pool === undefined) {
            pool = drawPool(population.material, options.target, random);
            nextTick = (Math.floor(now / 60) + 1) * 60;
            const drawn = pool;
            return { kind: "action", name: "draw the pool", durationMs: 0, action: { precondition: () => ({ holds: true }), effect: (current) => ({ ...current, population: { ...(current.population as Population), people: (current.population as Population).people.length === 0 ? drawn : (current.population as Population).people } }) } };
          }
          // A new programme version: each speaker in it is told its session.
          const latest = population.programme.at(-1);
          if (latest !== undefined && latest.version > toldVersion) {
            toldVersion = latest.version;
            for (const session of latest.sessions) for (const speaker of session.speakers) deliveries.push({ kind: "deliver", agent: speaker, channel: "programme", held: false, values: { time: session.start, room: session.room } });
          }
          const delivery = deliveries.shift();
          if (delivery !== undefined) return delivery;

          const changes: ((current: Population, money: Money, mail: Mail, landing: WorldTime | undefined) => { population: Population; money: Money; mail: Mail })[] = [];
          const page = population.page;
          const required = (field: string) => page.required_fields.includes(field);
          const allows = () => page.open && (page.close_date === undefined || Math.floor(now / 1440) + 1 < dayNumber(page.close_date));

          // The world's mail: speakers' promotions and sponsors' attendee lists.
          for (const message of [...state.mail.inTransit, ...Object.values(state.mail.mailboxes).flat()]) {
            // A mail is read once it is sent.
            const sent = minutesOfWorld(("sent" in message ? message.sent : undefined) ?? (message as { received: WorldTime }).received);
            if (seen.has(message.id) || sent > now) continue;
            seen.add(message.id);
            if (message.act === "promoting" && Object.hasOwn(population.draws, message.from)) {
              const start = sent;
              const factor = population.material.promotion_factor * (1 + 0.25 * population.draws[message.from]);
              changes.push((current, money, mail) => ({ population: { ...current, promotions: [...current.promotions, { start, factor }] }, money, mail }));
            }
            // The organiser's answer to a registrant: one to a question about a diet or an access need makes it known (FR-CONGRESS-11).
            if (message.act === "answer" && message.from === options.organiser && population.people.some(({ id }) => id === message.to)) {
              const asked = [...state.mail.inTransit, ...Object.values(state.mail.mailboxes).flat()].filter(({ from, act }) => from === message.to && act === "question").map(({ fields }) => String(fields.about));
              changes.push((current, money, mail, landing) => {
                const person = current.people.find(({ id }) => id === message.to) as Person;
                const known = Object.fromEntries((["diet", "access"] as const).filter((need) => asked.includes(need)).map((need) => [need, person[need]]));
                return {
                  population: {
                    ...current,
                    people: current.people.map((each) => (each.id === person.id ? { ...each, given: { ...each.given, ...known } } : each)),
                    events: [...(current.events ?? []), { event: "answer", person: person.id, known, ...(landing === undefined ? {} : { worldTime: landing }) }],
                  },
                  money,
                  mail,
                };
              });
            }
            if (message.act === "send_attendee_list" && message.from === options.organiser) {
              const listed = String(message.fields.list ?? "").split(/,\s*/);
              changes.push((current, money, mail) => {
                const held = registrantsOf(current).filter(({ id }) => listed.includes(id));
                const data = { ids: held.map(({ id }) => id), consented: held.filter(({ given }) => given.consent === true).map(({ id }) => id), without: held.filter(({ given }) => given.consent !== true).map(({ id }) => id) };
                return { population: { ...current, sponsorData: { ...current.sponsorData, [message.to]: data } }, money, mail };
              });
            }
          }

          // Registrations: each world hour by the probability, and fixed people and groups at their times.
          const registering: Person[] = [];
          const consider = (person: Person) => {
            if (allows()) registering.push(person);
          };
          const waiting = (person: Person) => person.registered !== undefined || person.waiting === true;
          if (now >= nextTick) {
            nextTick = (Math.floor(now / 60) + 1) * 60;
            const probability = registrationProbability(state, now);
            for (const person of population.people) if (!waiting(person) && person.registersAt === undefined && random.next() < probability) consider(person);
          }
          for (const person of population.people) if (!waiting(person) && person.registersAt !== undefined && person.registersAt <= now) consider(person);
          let registered = registrantsOf(population).length;
          for (const person of registering) {
            // Above the cap, onto the waiting list if the page keeps one.
            const full = page.cap !== undefined && registered >= page.cap;
            if (full && !page.waiting_list) continue;
            if (full) {
              changes.push((current, money, mail, landing) => ({
                population: { ...current, people: current.people.map((each) => (each.id === person.id ? { ...each, waiting: true } : each)), events: [...(current.events ?? []), { event: "waiting_list", person: person.id, ...(landing === undefined ? {} : { worldTime: landing }) }] },
                money,
                mail,
              }));
              continue;
            }
            registered += 1;
            const cancels = random.next() < population.material.cancel_share;
            const eventStart = (population.eventDay - 1) * 1440;
            const cancelsAt = cancels ? now + random.next() * Math.max(0, eventStart - now) : undefined;
            const need = person.access !== "none" && !required("access") ? "access" : person.diet === "gluten_free" && !required("diet") ? "diet" : undefined;
            if (need !== undefined) mailAt.set(person.id, { at: now + random.next() * WITHIN_A_DAY, about: need });
            // A registrant's own question, drawn only when the material gives a share (FR-CONGRESS-09).
            const share = population.material.question_share ?? 0;
            if (share > 0 && random.next() < share) questionsAt.set(person.id, { at: now + random.next() * WITHIN_THREE_DAYS, about: QUESTIONS[Math.floor(random.next() * QUESTIONS.length)] });
            const given = { ...(required("diet") ? { diet: person.diet } : {}), ...(required("access") ? { access: person.access } : {}), ...(required("consent_sponsors") ? { consent: person.consents } : {}) };
            const amount = Math.round(page.price * (1 - population.material.payment_fee_share) * 100) / 100;
            changes.push((current, money, mail, landing) => {
              const at = landing === undefined ? {} : { worldTime: landing };
              const paying = person.pays && amount > 0;
              // A registrant believes the latest published version (FR-CONGRESS-22).
              const latest = current.programme.at(-1)?.version;
              return {
                population: {
                  ...current,
                  people: current.people.map((each) => (each.id === person.id ? { ...each, registered: now, given, ...(cancelsAt === undefined ? {} : { cancelsAt }), ...(latest === undefined ? {} : { believes: latest }) } : each)),
                  events: [...(current.events ?? []), { event: "registration", person: person.id, diet: person.diet, ...(person.group === true ? { group: true } : {}), ...at }, ...(paying ? [{ event: "payment" as const, person: person.id, amount, ...at }] : [])],
                },
                money: paying ? withTransfer(money, { from: ATTENDEES, to: options.organiser, amount, for: `ticket ${person.id}` }) : money,
                mail,
              };
            });
          }

          // Cancellations at their drawn times.
          for (const person of population.people) {
            if (person.cancelsAt !== undefined && person.cancelled === undefined && person.cancelsAt <= now) changes.push(cancelling(person.id));
          }
          // A request for needs: each registrant who has not given a required field gives it within a day.
          if (population.needsRequested !== undefined && population.needsRequested <= now && population.needsRequested !== needsHandled) {
            needsHandled = population.needsRequested;
            for (const person of registrantsOf(population)) needsAt.set(person.id, now + random.next() * WITHIN_A_DAY);
          }
          for (const [id, at] of needsAt) {
            if (at > now) continue;
            needsAt.delete(id);
            changes.push((current, money, mail) => ({
              population: {
                ...current,
                people: current.people.map((each) =>
                  each.id !== id
                    ? each
                    : { ...each, given: { ...each.given, ...(current.page.required_fields.includes("diet") ? { diet: each.diet } : {}), ...(current.page.required_fields.includes("access") ? { access: each.access } : {}), ...(current.page.required_fields.includes("consent_sponsors") ? { consent: each.consents } : {}) } },
                ),
              },
              money,
              mail,
            }));
          }
          // A request to cancel if they cannot come: each who would not come cancels with probability 0.5.
          if (population.cancelRequested !== undefined && population.cancelRequested <= now && population.cancelRequested !== cancelHandled) {
            cancelHandled = population.cancelRequested;
            for (const person of registrantsOf(population).filter(({ no_show: noShow }) => noShow)) {
              const draw = random.next();
              changes.push((current, money, mail, landing) => ({ population: { ...current, events: [...(current.events ?? []), { event: "cancel_draw", person: person.id, draw, ...(landing === undefined ? {} : { worldTime: landing }) }] }, money, mail }));
              if (draw < CANCEL_IF_NOT_COMING) changes.push(cancelling(person.id));
            }
          }
          // Questions about a need the page did not ask about, mailed from the person's id.
          for (const asking of [mailAt, questionsAt]) for (const [id, { at, about }] of asking) {
            if (at > now) continue;
            asking.delete(id);
            changes.push((current, money, mail, landing) => ({ population: current, money, mail: withSent(mail, id, { to: options.organiser, act: "question", fields: { about } }, landing) }));
          }

          if (changes.length > 0) {
            return {
              kind: "action",
              name: "the attendees act",
              durationMs: 0,
              action: {
                precondition: () => ({ holds: true }),
                effect: (current, { world: landing }) => {
                  let next = { population: current.population as Population, money: current.money, mail: current.mail };
                  for (const change of changes) next = change(next.population, next.money, next.mail, landing);
                  return { ...current, ...next, money: stamped(current.money, next.money, landing) };
                },
              },
            };
          }
          // Until its next hour, or the next time something it drew is due.
          const due = [nextTick, ...population.people.flatMap(({ registersAt, registered, cancelsAt, cancelled }) => [...(registered === undefined && registersAt !== undefined && registersAt > now ? [registersAt] : []), ...(cancelled === undefined && cancelsAt !== undefined ? [cancelsAt] : [])]), ...needsAt.values(), ...[...mailAt.values(), ...questionsAt.values()].map(({ at }) => at)].filter((at) => at > now);
          return { kind: "wait", ms: options.msFor(Math.min(...due) - now, sinceStartMs) };
        },
      };
    },
    outcome: (state) => {
      const population = state.population as Population;
      const registered = population.people.filter(({ registered: at }) => at !== undefined);
      const versions = countsOf(registrantsOf(population).map(({ believes }) => (believes === undefined ? undefined : String(believes))));
      return {
        registrations: registered.length,
        registrations_by_day: JSON.stringify(byDay(registered)),
        registrations_by_diet: JSON.stringify(countsOf(registered.map(({ diet }) => diet))),
        registrations_by_access: JSON.stringify(countsOf(registered.map(({ access }) => access))),
        payments: (population.events ?? []).filter(({ event }) => event === "payment").length,
        cancellations: population.people.filter(({ cancelled }) => cancelled !== undefined).length,
        waiting_list: population.people.filter(({ waiting }) => waiting === true).length,
        consents: registered.filter(({ given }) => given.consent === true).length,
        believed_versions: JSON.stringify(versions),
      };
    },
  };
}

/** A registrant's cancellation, now. */
function cancelling(id: string) {
  return (current: Population, money: Money, mail: Mail, landing: WorldTime | undefined) => ({
    population: {
      ...current,
      people: current.people.map((each) => (each.id === id ? { ...each, cancelled: landing === undefined ? 0 : minutesOfWorld(landing) } : each)),
      events: [...(current.events ?? []), { event: "cancellation" as const, person: id, ...(landing === undefined ? {} : { worldTime: landing }) }],
    },
    money,
    mail,
  });
}
