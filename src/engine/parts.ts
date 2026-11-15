import type { WorldTime } from "./calendar.ts";

/** One of an agent's structured acts: a tool call with its arguments and the world time it landed (FR-PARTS-01). */
export interface Act {
  agent: string;
  tool: string;
  arguments: Readonly<Record<string, unknown>>;
  world: WorldTime;
  /** The call's outcome, so a pattern can count only acts that succeeded (FR-CONGRESS-10). */
  outcome?: string;
}

/** What a scenario provides for parts (FR-PARTS-01): its predicates, its events and its misapplication patterns, by name. */
export interface PartsProvided<State> {
  /** Whether a part holds in a state, with its params; or that, with the values its line gives (FR-CONGRESS-06). */
  predicates: Readonly<Record<string, (state: State, params: Readonly<Record<string, unknown>>) => boolean | { holds: boolean; values?: Readonly<Record<string, unknown>>; reachedAt?: number }>>;
  /** The world time of an event's first record in a state, with its params; none when it has none. */
  events: Readonly<Record<string, (state: State, params: Readonly<Record<string, unknown>>) => WorldTime | undefined>>;
  /** Whether an act is a misapplication, with its params and the world's state at the act's time (FR-CONGRESS-06). */
  misapplications: Readonly<Record<string, (act: Act, params: Readonly<Record<string, unknown>>, state: State, latest: State) => boolean>>;
  /** Whether a trap holds, read from the world's records at evaluation, with its params and the evaluation's world minutes (FR-CONGRESS-06). */
  traps?: Readonly<Record<string, (state: State, params: Readonly<Record<string, unknown>>, at: number) => boolean>>;
  /** Why a predicate cannot follow a part's params, by the predicate's name; none when it can (FR-CONGRESS-24). */
  refusedParams?: Readonly<Record<string, (params: Readonly<Record<string, unknown>>) => string | undefined>>;
}

/** The kinds a part may be under a level of the kind factor. */
const KINDS = ["covered", "variant", "changed", "new"];

/** An event as a part names it: its name and params. */
export interface PartEvent {
  event: string;
  params: Readonly<Record<string, unknown>>;
}

/** A misapplication pattern of a part, with its params, and the event it is relative to, if one. */
export interface Misapplication {
  pattern: string;
  params: Readonly<Record<string, unknown>>;
  before?: PartEvent;
  after?: PartEvent;
}

/** A part as the engine reads it (FR-PARTS-01). */
export interface Part {
  id: string;
  predicate: string;
  params: Readonly<Record<string, unknown>>;
  activation: "always" | PartEvent;
  /** A world time, in world minutes since day 1's midnight; the run's end; or an event and the minutes after it. */
  evaluateAt: { at: number } | "end" | (PartEvent & { afterMinutes: number });
  /** The part's kind for each level of the kind factor the experiment runs; none for an outcome. */
  kinds?: Readonly<Record<string, string>>;
  /** Its group, the same for every condition, which stands for a level's missing kind (FR-PARTS-01's addition). */
  group?: string;
  actors: readonly string[];
  misapplications: readonly Misapplication[];
  /** The traps to read at evaluation, each with its params (FR-CONGRESS-06). */
  traps: readonly { trap: string; params: Readonly<Record<string, unknown>> }[];
}

/** What parts are read against: the participants, and the experiment's kind_factor with its levels when it is a factor. */
export interface PartsContext {
  participants: readonly string[];
  kindFactor?: { name: string; levels?: readonly string[] };
  /** The parties an actor may name by group, `role:<role>` or `kind:<kind>`, by the group's name (FR-CONGRESS-08). */
  groups?: Readonly<Record<string, readonly string[]>>;
}

/** A part's key that cannot be followed: an error that names the part, the key and why. */
function refused(id: string, key: string, value: unknown, why: string): Error {
  return new Error(`The parts' ${id}.${key} ${JSON.stringify(value) ?? "(none)"} cannot be followed: ${why}`);
}

/** World minutes since day 1's midnight of a world time. */
const minutesOf = ({ day, seconds }: WorldTime) => (day - 1) * 1440 + seconds / 60;

/** Whether an act took effect: it succeeded, or its outcome is not known. */
const tookEffect = ({ outcome }: Act) => outcome === undefined || outcome === "success";

/** A world time as a part line gives it: "day <n> HH:MM". */
function timeText(world: WorldTime): string {
  const minutes = Math.floor(world.seconds / 60);
  return `day ${world.day} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** An event a part names, refused, naming the part and the key, when the scenario provides no such event. */
function eventOf<State>(value: unknown, id: string, key: string, provided: PartsProvided<State>): PartEvent {
  const { event, params = {} } = (value ?? {}) as { event?: unknown; params?: Record<string, unknown> };
  if (typeof event !== "string" || !Object.hasOwn(provided.events, event)) throw refused(id, key, value, `the scenario provides no event "${String(event)}"`);
  return { event, params };
}

/**
 * The parts of a held-out material (FR-PARTS-01), read against what the scenario provides; refused, naming the part
 * and the key: a predicate, pattern or event the scenario does not provide, a kind other than the four, kinds that lack a
 * level of the kind factor or name one it does not have, a kind factor that is no factor while a part has kinds, an
 * evaluation time that does not follow its format, an actor that is no participant, params its predicate refuses, and
 * two parts with one id.
 */
export function readParts<State>(written: readonly Record<string, unknown>[], provided: PartsProvided<State>, context: PartsContext): Part[] {
  const ids = new Set<string>();
  return written.map((part) => {
    const id = String(part.id);
    if (ids.has(id)) throw new Error(`The parts cannot be followed: two parts have the id "${id}"`);
    ids.add(id);
    const predicate = String(part.predicate);
    if (!Object.hasOwn(provided.predicates, predicate)) throw refused(id, "predicate", part.predicate, `the scenario provides no predicate "${predicate}"`);
    const params = (part.params ?? {}) as Record<string, unknown>;
    const wrongParams = Object.hasOwn(provided.refusedParams ?? {}, predicate) ? provided.refusedParams?.[predicate](params) : undefined;
    if (wrongParams !== undefined) throw refused(id, "params", part.params, wrongParams);
    const activation = part.activation === "always" || part.activation === undefined ? "always" : eventOf(part.activation, id, "activation", provided);
    let evaluateAt: Part["evaluateAt"];
    if (part.evaluate_at === "end") evaluateAt = "end";
    else if (typeof part.evaluate_at === "string") {
      const [, day, hours, minutes] = /^day (\d+) (\d\d):(\d\d)$/.exec(part.evaluate_at) ?? [];
      if (day === undefined) throw refused(id, "evaluate_at", part.evaluate_at, 'it is not "day <n> HH:MM", "end" or an event');
      evaluateAt = { at: (Number(day) - 1) * 1440 + Number(hours) * 60 + Number(minutes) };
    } else {
      const after = (part.evaluate_at as { after_minutes?: unknown } | undefined)?.after_minutes ?? 0;
      if (!(typeof after === "number" && after >= 0)) throw refused(id, "evaluate_at", part.evaluate_at, "its after_minutes is not a number of at least 0");
      evaluateAt = { ...eventOf(part.evaluate_at, id, "evaluate_at", provided), afterMinutes: after };
    }
    const group = part.group as string | undefined;
    if (group !== undefined && !KINDS.includes(group)) throw refused(id, "group", group, `it is not one of ${KINDS.join(", ")}`);
    const written = part.kinds as Record<string, string> | undefined;
    let kinds: Record<string, string> | undefined;
    if (written !== undefined) {
      const factor = context.kindFactor;
      if (factor?.levels === undefined) throw new Error(`The experiment's kind_factor "${String(factor?.name)}" cannot be followed: it is no factor of the experiment, and part "${id}" has kinds`);
      const wrong = Object.values(written).find((kind) => !KINDS.includes(kind));
      if (wrong !== undefined) throw refused(id, "kinds", written, `"${wrong}" is not one of ${KINDS.join(", ")}`);
      // Kinds for levels the experiment does not run are ignored, so one parts material serves every experiment over them.
      kinds = Object.fromEntries(Object.entries(written).filter(([level]) => factor.levels?.includes(level)));
      // A level the experiment runs needs its kind, unless the group stands for it.
      const missing = factor.levels.find((level) => !Object.hasOwn(kinds as Record<string, string>, level));
      if (missing !== undefined && group === undefined) throw refused(id, "kinds", written, `they lack the level "${missing}" of ${factor.name}`);
    }
    // An actor given as role:<role> or kind:<kind> is the parties the replica's draw gave that group (FR-CONGRESS-08).
    const actors = ((part.actors ?? []) as string[]).flatMap((actor) => {
      const [, group] = /^(role|kind):/.exec(actor) ?? [];
      if (group === undefined) return [actor];
      const filled = context.groups?.[actor] ?? [];
      if (filled.length === 0) throw refused(id, "actors", part.actors, `"${actor}" is a ${group} no draw fills`);
      return [...filled];
    });
    const outsider = actors.find((actor) => !context.participants.includes(actor));
    if (outsider !== undefined) throw refused(id, "actors", actors, `"${outsider}" is no participant`);
    const misapplications = ((part.misapplications ?? []) as Record<string, unknown>[]).map((written) => {
      const pattern = String(written.pattern);
      if (!Object.hasOwn(provided.misapplications, pattern)) throw refused(id, "misapplications", written, `the scenario provides no misapplication pattern "${pattern}"`);
      return {
        pattern,
        params: (written.params ?? {}) as Record<string, unknown>,
        ...(written.before === undefined ? {} : { before: eventOf(written.before, id, "misapplications", provided) }),
        ...(written.after === undefined ? {} : { after: eventOf(written.after, id, "misapplications", provided) }),
      };
    });
    const traps = ((part.traps ?? []) as Record<string, unknown>[]).map((written) => {
      const trap = String(written.trap);
      if (!Object.hasOwn(provided.traps ?? {}, trap)) throw refused(id, "traps", written, `the scenario provides no trap "${trap}"`);
      return { trap, params: (written.params ?? {}) as Record<string, unknown> };
    });
    return { id, predicate, params, activation, evaluateAt, ...(kinds === undefined ? {} : { kinds }), ...(group === undefined ? {} : { group }), actors, misapplications, traps };
  });
}

/**
 * The money the agents committed or paid to a part's actors between two world times, in world minutes (FR-PARTS-01):
 * commitments net of their releases, a release only when the commitment it releases is counted (FR-CONGRESS-17), and
 * payments to an actor only when no commitment to it is counted, since those settle a commitment already counted
 * (FR-CONGRESS-10).
 */
export function effortMoney(money: readonly { event: Readonly<Record<string, unknown>>; at: number }[], agents: readonly string[], actors: readonly string[], from: number, until: number): number {
  const counted = money.filter(({ event, at }) => at >= from && at <= until && agents.includes(String(event.from)) && actors.includes(String(event.to)));
  const commitments = counted.filter(({ event }) => event.kind === "commitment");
  const committedTo = new Set(commitments.map(({ event }) => String(event.to)));
  const countedIds = new Set(commitments.map(({ event }) => event.commitment));
  const amount = ({ event }: (typeof counted)[number]) => {
    if (event.kind === "commitment") return Number(event.amount);
    if (event.kind === "release") return countedIds.has(event.commitment) ? -Number(event.amount) : 0;
    return event.kind === "payment" && !committedTo.has(String(event.to)) ? Number(event.amount) : 0;
  };
  return counted.reduce((sum, entry) => sum + amount(entry), 0);
}

/** What a parts book works with: the parts, what the scenario provides, the run's level of the kind factor, the agents, the money and the log. */
export interface PartsBookSettings<State> {
  parts: readonly Part[];
  provided: PartsProvided<State>;
  level?: string;
  agents: readonly string[];
  moneyOf?: (state: State) => { events: readonly Readonly<Record<string, unknown>>[] } | undefined;
  record(line: PartsLine): void;
}

/** An act a part line gives as a misapplication: its tool, its arguments and the world time it landed, "day <n> HH:MM". */
export interface MisappliedAct {
  tool: string;
  arguments: Readonly<Record<string, unknown>>;
  at: string;
}

/**
 * A line of the run's log the parts write (FR-PARTS-01): a part's result as it is evaluated, which gives its group, when
 * it has one, whether or not it was active; and, as the run ends, the parts not evaluated.
 */
export type PartsLine =
  | { type: "part"; part: string; evaluated_at: string; active: false; group?: string }
  | {
      type: "part";
      part: string;
      evaluated_at: string;
      active: true;
      held: boolean;
      reached_at?: string;
      effort: { calls: number; money: number };
      misapplications: MisappliedAct[];
      traps?: string[];
      values?: Readonly<Record<string, unknown>>;
      group?: string;
      kind?: string;
    }
  | { type: "parts_not_evaluated"; parts: string[] };

/** A part's state in a run: when it became active, the intervals in which it held, and whether it was evaluated. */
interface Tracked {
  part: Part;
  activeAt?: number;
  intervals: { from: number; to?: number }[];
  evaluated: boolean;
}

/**
 * A run's parts (FR-PARTS-01): it checks every active part's predicate after each change of the world, keeping the
 * intervals in which it held, keeps the agents' acts and the money they paid or committed, each with its world time, and
 * writes each part's result as a `part` line when it is evaluated; as the run ends, it evaluates the parts due then and
 * lists those not yet evaluated.
 */
export class PartsBook<State> {
  readonly #settings: PartsBookSettings<State>;
  readonly #tracked: Tracked[];
  /** The agents' acts, each with the world's state at its time. */
  readonly #acts: (Act & { state: State })[] = [];
  readonly #money: { event: Readonly<Record<string, unknown>>; at: number }[] = [];
  /** Each event's first time, by its name and params, once it happened. */
  readonly #events = new Map<string, number>();
  #seenMoney = 0;
  #state?: State;

  constructor(settings: PartsBookSettings<State>) {
    this.#settings = settings;
    this.#tracked = settings.parts.map((part) => ({ part, intervals: [], evaluated: false }));
  }

  /** The world as the run starts. */
  start(state: State, world: WorldTime): void {
    this.changed(state, world);
  }

  /** The world after a change, at the world time it was applied. */
  changed(state: State, world: WorldTime): void {
    this.#state = state;
    const now = minutesOf(world);
    const events = (this.#settings.moneyOf?.(state)?.events ?? []).slice(this.#seenMoney);
    this.#seenMoney += events.length;
    for (const event of events) this.#money.push({ event, at: now });
    for (const tracked of this.#tracked) {
      const { part } = tracked;
      if (tracked.activeAt === undefined) tracked.activeAt = part.activation === "always" ? now : this.#eventAt(part.activation);
      if (tracked.activeAt === undefined) continue;
      const given = this.#settings.provided.predicates[part.predicate](state, part.params);
      const holds = typeof given === "boolean" ? given : given.holds;
      const open = tracked.intervals.at(-1);
      if (holds && (open === undefined || open.to !== undefined)) tracked.intervals.push({ from: now });
      if (!holds && open !== undefined && open.to === undefined) open.to = now;
    }
  }

  /** One of an agent's acts, at the world time it landed; another party's is not the agent's. */
  acted(act: Act): void {
    if (this.#settings.agents.includes(act.agent) && this.#state !== undefined) this.#acts.push({ ...act, state: this.#state });
  }

  /** The world time of an event's first record, from the world as it is, kept once it happened. */
  #eventAt({ event, params }: PartEvent): number | undefined {
    const key = `${event} ${JSON.stringify(params)}`;
    if (!this.#events.has(key) && this.#state !== undefined) {
      const found = this.#settings.provided.events[event](this.#state, params);
      if (found !== undefined) this.#events.set(key, minutesOf(found));
    }
    return this.#events.get(key);
  }

  /** When a part is evaluated, in world minutes: its time, or its event's and the minutes after; none for the run's end or an event not yet happened. */
  #dueAt({ part }: Tracked): number | undefined {
    if (part.evaluateAt === "end") return undefined;
    if ("at" in part.evaluateAt) return part.evaluateAt.at;
    const event = this.#eventAt(part.evaluateAt);
    return event === undefined ? undefined : event + part.evaluateAt.afterMinutes;
  }

  /** The world time of the next evaluation it knows of; none when none is due. */
  nextAt(): WorldTime | undefined {
    const next = Math.min(...this.#tracked.filter(({ evaluated }) => !evaluated).map((tracked) => this.#dueAt(tracked) ?? Infinity));
    if (next === Infinity) return undefined;
    return { day: Math.floor(next / 1440) + 1, weekday: "Monday", seconds: Math.round((next % 1440) * 60) };
  }

  /** Whether an evaluation at a world time is still to come, which keeps the run going. */
  get busy(): boolean {
    return this.#tracked.some((tracked) => !tracked.evaluated && this.#dueAt(tracked) !== undefined);
  }

  /** Evaluates every part due by a world time, with the world as it is then. */
  due(state: State, world: WorldTime): void {
    this.changed(state, world);
    const now = minutesOf(world);
    for (const tracked of this.#tracked) {
      const due = this.#dueAt(tracked);
      if (!tracked.evaluated && due !== undefined && due <= now) this.#evaluate(tracked, due);
    }
  }

  /** As the run ends: evaluates the parts due by then and those evaluated at the end, and lists the others as not evaluated. */
  finish(state: State, world: WorldTime): void {
    this.due(state, world);
    const now = minutesOf(world);
    for (const tracked of this.#tracked) if (!tracked.evaluated && tracked.part.evaluateAt === "end") this.#evaluate(tracked, now);
    const left = this.#tracked.filter(({ evaluated }) => !evaluated).map(({ part }) => part.id);
    if (left.length > 0) this.#settings.record({ type: "parts_not_evaluated", parts: left });
  }

  /** A part's result at a world time, as its part line. */
  #evaluate(tracked: Tracked, at: number): void {
    tracked.evaluated = true;
    const { part } = tracked;
    const when = { day: Math.floor(at / 1440) + 1, weekday: "Monday" as const, seconds: Math.round((at % 1440) * 60) };
    const line = { type: "part" as const, part: part.id, evaluated_at: timeText(when) };
    // The group is in the line whether or not the part was active (FR-PARTS-01's addition).
    const grouped = part.group === undefined ? {} : { group: part.group };
    if (tracked.activeAt === undefined || tracked.activeAt > at) {
      this.#settings.record({ ...line, active: false, ...grouped });
      return;
    }
    const last = tracked.intervals.filter(({ from }) => from <= at).at(-1);
    const held = last !== undefined && (last.to === undefined || last.to > at);
    // A predicate may give the moment it was reached; otherwise it is the start of the interval in which it held (FR-CONGRESS-10).
    const reading = this.#settings.provided.predicates[part.predicate](this.#state as State, part.params);
    const reachedAt = held ? ((typeof reading === "boolean" ? undefined : reading.reachedAt) ?? last.from) : undefined;
    const until = reachedAt ?? at;
    const from = tracked.activeAt;
    const names = (value: unknown): boolean => (typeof value === "string" ? part.actors.includes(value) : typeof value === "object" && value !== null && Object.values(value).some(names));
    const calls = this.#acts.filter((act) => minutesOf(act.world) >= from && minutesOf(act.world) <= until && names(act.arguments)).length;
    const money = effortMoney(this.#money, this.#settings.agents, part.actors, from, until);
    const misapplications = part.misapplications.flatMap(({ pattern, params, before, after }) => {
      const beforeAt = before === undefined ? undefined : (this.#eventAt(before) ?? Infinity);
      const afterAt = after === undefined ? undefined : this.#eventAt(after);
      // Only acts that took effect: a call that failed with an outcome its tool names is none (FR-CONGRESS-18).
      return this.#acts
        .filter((act) => tookEffect(act) && minutesOf(act.world) <= at && this.#settings.provided.misapplications[pattern](act, params, act.state, this.#state as State))
        .filter((act) => (beforeAt === undefined || minutesOf(act.world) < beforeAt) && (after === undefined || (afterAt !== undefined && minutesOf(act.world) >= afterAt)))
        .map((act) => ({ tool: act.tool, arguments: act.arguments, at: timeText(act.world) }));
    });
    // The level's kind, or the group where the level has none.
    const levelKind = this.#settings.level === undefined ? undefined : (part.kinds?.[this.#settings.level] ?? part.group);
    const kind = levelKind === undefined ? {} : { kind: levelKind };
    const state = this.#state as State;
    const traps = part.traps.filter(({ trap, params }) => this.#settings.provided.traps?.[trap](state, params, at) === true).map(({ trap }) => trap);
    // The values a predicate gives besides whether it holds, read at evaluation (FR-CONGRESS-06).
    const given = this.#settings.provided.predicates[part.predicate](state, part.params);
    const values = typeof given === "boolean" || given.values === undefined ? {} : { values: given.values };
    this.#settings.record({ ...line, active: true, held, ...(reachedAt === undefined ? {} : { reached_at: timeText({ day: Math.floor(reachedAt / 1440) + 1, weekday: "Monday", seconds: Math.round((reachedAt % 1440) * 60) }) }), effort: { calls, money }, misapplications, ...(part.traps.length === 0 ? {} : { traps }), ...values, ...grouped, ...kind });
  }
}
