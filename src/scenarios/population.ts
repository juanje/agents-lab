import type { Random } from "../engine/random.ts";

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
