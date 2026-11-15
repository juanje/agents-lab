import { type TomlTable, stringify } from "smol-toml";
import type { ToolCall } from "../engine/adapter.ts";
import { type WorldTime, readCalendar, sinceDayOne } from "../engine/calendar.ts";
import type { Random } from "../engine/random.ts";
import { type Configuration, type MetricValue, type Scenario, isTable } from "../engine/scenario.ts";
import type { Sensing } from "../engine/sensings.ts";
import type { Channel } from "../engine/stimuli.ts";
import type { AgentCall, Effector, LandingCall, Sensor, Start, TargetAsSensed, Tool } from "../engine/tools.ts";
import type { Action, Check } from "../engine/world.ts";
import { describeUniformRhythm, rhythmChannels, uniformRhythm } from "./rhythm.ts";

/** The workshop's texts, in the order each place joins them (FR-WORKSHOP-01). */
const TEXTS = ["identity", "task", "world_rules"] as const;
type Text = (typeof TEXTS)[number];

/** Where a text goes: the system prompt, or one message as the worker first wakes. */
type Place = "system" | "first";

/** The channel of the message a worker receives once, as it first wakes, when a text is placed there. */
const ORDER_CHANNEL = "order";

/** The channel through which every other worker hears what a worker says (FR-WORKSHOP-03). */
const VOICE_CHANNEL = "voice";

/** The channel through which a worker learns what another handed it (FR-WORKSHOP-05). */
const HANDS_CHANNEL = "hands";

/** The durations the configuration gives, in world minutes, by name (FR-WORKSHOP-01, FR-WORKSHOP-05's hand). */
const DURATIONS = ["look", "read_plan", "take", "put_back", "join", "take_apart", "mount", "mount_refused", "say", "say_words_per_minute", "hand"] as const;
type Duration = (typeof DURATIONS)[number];

/** A module of the plan: the kinds of its pieces, a kind as many times as it is needed, and the modules mounted before it. */
export interface Module {
  recipe: readonly string[];
  after: readonly string[];
}

/** A module a worker holds: its name and the kinds joined into it so far, in the order joined. */
export interface HeldModule {
  name: string;
  joined: readonly string[];
}

/** What a worker is doing, as `look` shows it (FR-WORKSHOP-02). */
export type Doing = "taking" | "putting back" | "joining" | "taking apart" | "mounting" | "speaking" | "waiting" | "handing" | "nothing";

/** What a worker holds: its loose pieces, a count for each kind it holds, and at most one module; and what it is doing. */
export interface Hands {
  loose: Readonly<Record<string, number>>;
  module: HeldModule | null;
  doing: Doing;
}

/**
 * The workshop's state (FR-WORKSHOP-01): the pile's loose pieces, the bench, each worker's hands, and the orders in
 * which `look` lists the pile's kinds and the workers and `read_plan` lists the modules, drawn once for the run.
 */
/**
 * What the workshop keeps of its applied effects, for its measures (FR-WORKSHOP-04): each at the world minute it landed,
 * since the calendar's start.
 */
export interface Landed {
  takes: readonly { worker: string; at: number }[];
  /** Each applied join: whether it started a module (the worker held none) and whether it finished one. */
  joins: readonly { worker: string; module: string; at: number; started: boolean; finished: boolean }[];
  mounts: readonly { worker: string; module: string; at: number }[];
  /** Each applied say, with its start (its end less its duration) and its words. */
  speeches: readonly { speaker: string; start: number; end: number; words: number }[];
  /** Each applied hand (FR-WORKSHOP-05): a loose piece of a kind, or a module of a name. */
  handovers: readonly Handover[];
}

/** An applied hand: from a giver to a receiver, a piece of a kind or a module of a name, at the world minute it landed. */
export interface Handover {
  giver: string;
  receiver: string;
  sort: "piece" | "module";
  name: string;
  at: number;
}

export interface Workshop {
  /**
   * What the tools and the measures read of the configuration: the calendar's start, in world seconds since day 1's
   * midnight, and its one segment's scale, in world seconds per second of the run.
   */
  settings: { handPieces: number; durations: Readonly<Record<Duration, number>>; waitMaxMinutes: number; startSeconds: number; scale: number };
  landed: Landed;
  plan: Readonly<Record<string, Module>>;
  pile: Readonly<Record<string, number>>;
  bench: { mounted: readonly string[]; places: readonly (string | null)[] };
  workers: Readonly<Record<string, Hands>>;
  orders: { kinds: readonly string[]; workers: readonly string[]; modules: readonly string[] };
}

/** The workshop's configuration, checked: everything the workshop builds its world and its workers from. */
interface Settings {
  workers: readonly string[];
  plan: Readonly<Record<string, Module>>;
  pile: Readonly<Record<string, number>>;
  benchPlaces: number;
  handPieces: number;
  durations: Readonly<Record<Duration, number>>;
  waitMaxMinutes: number;
  startSeconds: number;
  scale: number;
}

/** A key of the configuration the workshop cannot build from: an error that names it, its value and why. */
function refused(key: string, value: unknown, why: string): Error {
  return new Error(`The workshop's configuration "${key}" ${JSON.stringify(value) ?? "(none)"} cannot be followed: ${why}`);
}

/** Whether a value is a whole number of at least the least given. */
function wholeFrom(value: unknown, least: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= least;
}

/**
 * The configuration, checked before any model call (FR-WORKSHOP-01): each key the workshop cannot build from is
 * refused, naming it.
 */
function settingsOf(configuration: Configuration): Settings {
  const workers = configuration.workers;
  if (!Array.isArray(workers) || workers.length === 0 || !workers.every((name) => typeof name === "string" && name !== "")) {
    throw refused("workers", workers, "the workshop needs at least one worker, each named");
  }
  const twice = workers.find((name, index) => workers.indexOf(name) !== index);
  if (twice !== undefined) throw refused("workers", workers, `the name "${String(twice)}" is given twice`);
  const pile = isTable(configuration.pile ?? []) ? (configuration.pile as TomlTable) : {};
  for (const [kind, count] of Object.entries(pile)) {
    if (!wholeFrom(count, 0)) throw refused(`pile.${kind}`, count, "a stock is a whole number of at least 0");
  }
  const plan = planOf(configuration.plan, pile as Record<string, number>);
  for (const key of ["bench_places", "hand_pieces"]) {
    if (!wholeFrom(configuration[key], 1)) throw refused(key, configuration[key], "it is a whole number of at least 1");
  }
  const durations = isTable(configuration.durations ?? []) ? (configuration.durations as TomlTable) : {};
  for (const name of DURATIONS) {
    const minutes = durations[name];
    if (typeof minutes !== "number" || minutes < 0) throw refused(`durations.${name}`, minutes, "a duration is a number of world minutes of at least 0");
  }
  const waitMax = configuration.wait_max_minutes;
  if (typeof waitMax !== "number" || waitMax <= 0) throw refused("wait_max_minutes", waitMax, "it is a number of world minutes above 0");
  const segments = isTable(configuration.calendar ?? []) ? (configuration.calendar as TomlTable).segments : undefined;
  if (!Array.isArray(segments) || segments.length !== 1) throw refused("calendar.segments", segments, "the workshop's calendar has one segment");
  const { min_ms: minMs, max_ms: maxMs } = configuration.rhythm as { min_ms: number; max_ms: number };
  if (minMs > maxMs) throw refused("rhythm", configuration.rhythm, "its min_ms is above its max_ms");
  placementOf(configuration);
  for (const text of TEXTS) {
    const named = [...String(configuration[text]).matchAll(/\{([^}]*)\}/g)].map(([written]) => written).filter((written) => written !== "{name}");
    if (named.length > 0) throw new Error(`The workshop's text "${text}" names ${named[0]} in braces; a text may name only {name}`);
  }
  return {
    workers: workers as string[],
    plan,
    pile: pile as Record<string, number>,
    benchPlaces: configuration.bench_places as number,
    handPieces: configuration.hand_pieces as number,
    durations: durations as Record<Duration, number>,
    waitMaxMinutes: waitMax,
    startSeconds: readCalendar(configuration.calendar).start,
    scale: Number((segments[0] as TomlTable).scale),
  };
}

/**
 * The configuration's plan, checked against the pile: at least one module; each recipe holds kinds the pile has; each
 * `after` names modules of the plan, in an order in which every module can be mounted.
 */
function planOf(value: unknown, pile: Readonly<Record<string, number>>): Record<string, Module> {
  const written = isTable((value ?? []) as never) ? (value as TomlTable) : {};
  if (Object.keys(written).length === 0) throw refused("plan", value, "the plan has no module");
  const plan: Record<string, Module> = {};
  for (const [name, module] of Object.entries(written)) {
    const { recipe = [], after = [] } = module as { recipe?: unknown; after?: unknown };
    if (!Array.isArray(recipe) || recipe.length === 0) throw refused(`plan.${name}.recipe`, recipe, "a recipe names at least one piece");
    const lacking = recipe.find((kind) => !Object.hasOwn(pile, String(kind)));
    if (lacking !== undefined) throw refused(`plan.${name}.recipe`, recipe, `the pile has no kind "${String(lacking)}"`);
    if (!Array.isArray(after)) throw refused(`plan.${name}.after`, after, "it lists modules of the plan");
    plan[name] = { recipe: recipe.map(String), after: after.map(String) };
  }
  for (const [name, { after }] of Object.entries(plan)) {
    const unknown = after.find((other) => !Object.hasOwn(plan, other));
    if (unknown !== undefined) throw refused(`plan.${name}.after`, after, `the plan has no module "${unknown}"`);
  }
  // A module that must be mounted after itself, through the modules it waits for, can never be mounted.
  const waitsFor = (name: string, target: string, seen: Set<string>): boolean =>
    plan[name].after.some((other) => other === target || (!seen.has(other) && (seen.add(other), waitsFor(other, target, seen))));
  for (const [name, { after }] of Object.entries(plan)) {
    if (waitsFor(name, name, new Set())) throw refused(`plan.${name}.after`, after, `"${name}" would have to be mounted after itself, so it could never be mounted`);
  }
  return plan;
}

/** The configuration's placement; one that names a text the workshop does not have, or no place, is refused, naming it. */
function placementOf(configuration: Configuration): Readonly<Record<Text, Place>> {
  const placement = (configuration.placement ?? {}) as Record<string, unknown>;
  for (const [text, place] of Object.entries(placement)) {
    if (!(TEXTS as readonly string[]).includes(text)) throw refused(`placement.${text}`, place, `the workshop's texts are ${TEXTS.join(", ")}`);
    if (place !== "system" && place !== "first") throw refused(`placement.${text}`, place, 'a text goes to "system" or "first"');
  }
  return placement as Record<Text, Place>;
}

/** The texts placed in a place, in order, each that holds something, joined with a blank line between them. */
function textsIn(configuration: Configuration, place: Place): string {
  const placement = placementOf(configuration);
  return TEXTS.filter((text) => placement[text] === place)
    .map((text) => configuration[text] as string)
    .filter((text) => text !== "")
    .join("\n\n");
}

/** A list in an order drawn from a random sequence (Fisher–Yates). */
function shuffled<Item>(items: readonly Item[], random: Random): Item[] {
  const order = [...items];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random.next() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  return order;
}

/**
 * The workshop at the start: every piece in the pile, the bench empty, no worker holding anything, and the listing
 * orders drawn from the replica's sequence for the initial state. The kinds' and the modules' orders are drawn first,
 * each from its sorted names, so a condition that changes the workers leaves them as they were.
 */
function initialState(configuration: Configuration, random: Random): Workshop {
  const { workers, plan, pile, benchPlaces, handPieces, durations, waitMaxMinutes, startSeconds, scale } = settingsOf(configuration);
  const kinds = shuffled(Object.keys(pile).sort(), random);
  const modules = shuffled(Object.keys(plan).sort(), random);
  return {
    settings: { handPieces, durations, waitMaxMinutes, startSeconds, scale },
    landed: { takes: [], joins: [], mounts: [], speeches: [], handovers: [] },
    plan,
    pile: { ...pile },
    bench: { mounted: [], places: Array.from({ length: benchPlaces }, () => null) },
    workers: Object.fromEntries(workers.map((name) => [name, { loose: {}, module: null, doing: "nothing" }])),
    orders: { kinds, workers: shuffled(workers, random), modules },
  };
}

/** A duration in world minutes, as a tool gives it to the engine. */
function minutes(value: number): { worldSeconds: number } {
  return { worldSeconds: value * 60 };
}

/** The world minutes since the calendar's start at a world time, which a run without a calendar does not give. */
function minutesSinceStart(state: Workshop, world: WorldTime | undefined): number {
  if (world === undefined) throw new Error("The workshop needs the world's time, which a run without a calendar does not give");
  return (sinceDayOne(world) - state.settings.startSeconds) / 60;
}

/** The world minute a call lands at, since the calendar's start (FR-WORKSHOP-04). */
function landedAt(state: Workshop, call: LandingCall): number {
  return minutesSinceStart(state, call.world);
}

/** The workshop with one more applied effect kept, of a kind. */
function keeping<Kind extends keyof Landed>(state: Workshop, kind: Kind, entry: Landed[Kind][number]): Workshop {
  return { ...state, landed: { ...state.landed, [kind]: [...state.landed[kind], entry] } };
}

/** A worker's hands, which the workshop must have. */
function handsOf(state: Workshop, worker: string): Hands {
  const hands = state.workers[worker];
  if (hands === undefined) throw new Error(`The workshop has no worker "${worker}"`);
  return hands;
}

/** The workshop with one worker's hands changed. */
function withHands(state: Workshop, worker: string, change: Partial<Hands>): Workshop {
  return { ...state, workers: { ...state.workers, [worker]: { ...handsOf(state, worker), ...change } } };
}

/** A count of loose pieces with one more, or one less, of a kind; a kind with none is left out. */
function counted(loose: Readonly<Record<string, number>>, kind: string, by: 1 | -1): Record<string, number> {
  const { [kind]: had = 0, ...others } = loose;
  return had + by === 0 ? others : { ...others, [kind]: had + by };
}

/** How many loose pieces a worker holds. */
function looseCount(hands: Hands): number {
  return Object.values(hands.loose).reduce((sum, count) => sum + count, 0);
}

/** How many more pieces of a kind a worker's module of a name needs: none for a module the plan does not have. */
function needed(state: Workshop, hands: Hands, module: string, kind: string): number {
  const recipe = state.plan[module]?.recipe ?? [];
  const joined = hands.module?.name === module ? hands.module.joined : [];
  return recipe.filter((each) => each === kind).length - joined.filter((each) => each === kind).length;
}

/** Whether every piece of a module's recipe is joined into it, in any order. */
function isFinished(state: Workshop, module: HeldModule): boolean {
  const sorted = (pieces: readonly string[]) => [...pieces].sort().join(",");
  return sorted(module.joined) === sorted(state.plan[module.name]?.recipe ?? []);
}

/** An action's check: the first refusal whose condition holds, in order, or none. */
function firstRefusal(refusals: readonly [boolean, string][]): Check {
  const refused = refusals.find(([holds]) => holds);
  return refused === undefined ? { holds: true } : { holds: false, reason: refused[1] };
}

/** The kind or module a call names, as free text. */
function named(call: AgentCall, argument: string): string {
  return String(call.arguments[argument]);
}

/** The bench place a worker occupies, from 0, or -1 when it occupies none. */
function placeOf(state: Workshop, worker: string): number {
  return state.bench.places.indexOf(worker);
}

/**
 * What a worker's effector shows it doing from its call's start (FR-WORKSHOP-02): a start that sets it, which the log
 * describes as what the worker began.
 */
function doing(activity: Doing): Start<Workshop> {
  return {
    precondition: () => ({ holds: true }),
    effect: (state, { agent }) => withHands(state, agent, { doing: activity }),
    describe: () => ({ began: activity }),
  };
}

/** Every effector's end: the worker is doing nothing, and leaves the bench place it occupied, if any. */
const END: Action<Workshop, LandingCall> = {
  precondition: () => ({ holds: true }),
  effect: (state, { agent }) => {
    const place = placeOf(state, agent);
    const done = withHands(state, agent, { doing: "nothing" });
    return place === -1 ? done : { ...done, bench: { ...done.bench, places: done.bench.places.map((each, index) => (index === place ? null : each)) } };
  },
};

/** The worker's last look, parsed, or undefined when it has not looked. */
function lastLook(lastBy: (tool: string) => Sensing | undefined): { pile: Record<string, number>; bench: { places: (string | null)[] } } | undefined {
  const look = lastBy("look");
  return look === undefined ? undefined : JSON.parse(look.result);
}

/** A target no look shows: what the worker last sensed says nothing of it. */
const NOT_SENSED = (): TargetAsSensed => "not_sensed";

/** The parameter of a piece's kind, as `look` names it. */
const KIND = { type: "string", description: "A kind of piece, as look names it." };

/** The parameter of a module's name, as `read_plan` names it. */
const MODULE = { type: "string", description: "A module's name, as read_plan names it." };

/** "look": the clock and the room as they are when the call ends, the room in the drawn orders. */
const look: Sensor<Workshop> = {
  kind: "sensor",
  name: "look",
  description:
    "Look at the room, as JSON: the clock, in whole minutes since the start; the pile, with how many pieces of each kind it holds; the bench, with the modules mounted on the device in the order they were mounted and who occupies each of its places (null for a free one); and each worker, you included, with the loose pieces it holds, the module it holds (with the pieces joined into it so far and whether it is finished) and what it is doing.",
  parameters: { type: "object", properties: {} },
  durationMs: (state) => minutes(state.settings.durations.look),
  sense: (state, _agent, _args, _sinceStartMs, world) =>
    JSON.stringify({
      clock: Math.floor(minutesSinceStart(state, world)),
      pile: Object.fromEntries(state.orders.kinds.map((kind) => [kind, state.pile[kind] ?? 0])),
      bench: { mounted: state.bench.mounted, places: state.bench.places },
      workers: state.orders.workers.map((name) => {
        const { loose, module, doing } = handsOf(state, name);
        return {
          name,
          loose: Object.fromEntries(state.orders.kinds.filter((kind) => (loose[kind] ?? 0) > 0).map((kind) => [kind, loose[kind]])),
          module: module === null ? null : { name: module.name, joined: module.joined, finished: isFinished(state, module) },
          doing,
        };
      }),
    }),
};

/** "read_plan": the plan's modules in the drawn order, each with its recipe and what it is mounted after. */
const readPlan: Sensor<Workshop> = {
  kind: "sensor",
  name: "read_plan",
  description: "Read the plan on the wall, as JSON: each module of the device, with its recipe (the kinds of its pieces, a kind given as many times as it is needed) and the modules that must be mounted before it.",
  parameters: { type: "object", properties: {} },
  durationMs: (state) => minutes(state.settings.durations.read_plan),
  sense: (state) => JSON.stringify({ modules: state.orders.modules.map((name) => ({ name, recipe: state.plan[name].recipe, after: state.plan[name].after })) }),
};

/** "take": one piece of a kind from the pile into the worker's hands. */
const take: Effector<Workshop> = {
  kind: "effector",
  name: "take",
  description: "Take one piece of a kind from the pile into your hands.",
  parameters: { type: "object", properties: { kind: KIND }, required: ["kind"] },
  durationMs: (state) => minutes(state.settings.durations.take),
  start: doing("taking"),
  action: {
    precondition: (state, call) =>
      firstRefusal([
        [(state.pile[named(call, "kind")] ?? 0) === 0, "none_left"],
        [looseCount(handsOf(state, call.agent)) >= state.settings.handPieces, "hands_full"],
      ]),
    effect: (state, call) => {
      const kind = named(call, "kind");
      const taken = withHands({ ...state, pile: { ...state.pile, [kind]: state.pile[kind] - 1 } }, call.agent, { loose: counted(handsOf(state, call.agent).loose, kind, 1) });
      return keeping(taken, "takes", { worker: call.agent, at: landedAt(state, call) });
    },
  },
  end: END,
  texts: { success: "You are holding it.", none_left: "The pile has no piece of that kind; you have taken nothing.", hands_full: "Your hands are full; you have taken nothing." },
  // Its kind as the worker's last look showed it in the pile.
  readTarget: (_sensing, call, _state, lastBy) => {
    const seen = lastLook(lastBy);
    if (seen === undefined) return "not_sensed";
    return (seen.pile[named(call, "kind")] ?? 0) > 0 ? "free" : "held";
  },
};

/** "put_back": one loose piece of a kind from the worker's hands to the pile. */
const putBack: Effector<Workshop> = {
  kind: "effector",
  name: "put_back",
  description: "Put one loose piece of a kind from your hands back on the pile.",
  parameters: { type: "object", properties: { kind: KIND }, required: ["kind"] },
  durationMs: (state) => minutes(state.settings.durations.put_back),
  start: doing("putting back"),
  action: {
    precondition: (state, call) => firstRefusal([[(handsOf(state, call.agent).loose[named(call, "kind")] ?? 0) === 0, "not_held"]]),
    effect: (state, call) => {
      const kind = named(call, "kind");
      return withHands({ ...state, pile: { ...state.pile, [kind]: state.pile[kind] + 1 } }, call.agent, { loose: counted(handsOf(state, call.agent).loose, kind, -1) });
    },
  },
  end: END,
  texts: { success: "You have put it back on the pile.", not_held: "You hold no loose piece of that kind; nothing has moved." },
  readTarget: NOT_SENSED,
};

/** "join": one loose piece of a kind into the worker's module of a name; the first join starts the module. */
const join: Effector<Workshop> = {
  kind: "effector",
  name: "join",
  description: "Join one loose piece of a kind from your hands into your module of that name. If you hold no module, this starts one.",
  parameters: { type: "object", properties: { module: MODULE, kind: KIND }, required: ["module", "kind"] },
  durationMs: (state) => minutes(state.settings.durations.join),
  start: doing("joining"),
  action: {
    precondition: (state, call) => {
      const hands = handsOf(state, call.agent);
      const [module, kind] = [named(call, "module"), named(call, "kind")];
      return firstRefusal([
        [(hands.loose[kind] ?? 0) === 0, "not_held"],
        [needed(state, hands, module, kind) <= 0, "not_needed"],
        [hands.module !== null && hands.module.name !== module, "other_module"],
      ]);
    },
    effect: (state, call) => {
      const hands = handsOf(state, call.agent);
      const [module, kind] = [named(call, "module"), named(call, "kind")];
      const held = { name: module, joined: [...(hands.module?.joined ?? []), kind] };
      const joined = withHands(state, call.agent, { loose: counted(hands.loose, kind, -1), module: held });
      return keeping(joined, "joins", { worker: call.agent, module, at: landedAt(state, call), started: hands.module === null, finished: isFinished(state, held) });
    },
  },
  end: END,
  texts: {
    success: "You have joined it.",
    not_held: "You hold no loose piece of that kind; nothing has been joined.",
    not_needed: "That module needs no more pieces of that kind; nothing has been joined.",
    other_module: "You are holding a module of another name; nothing has been joined.",
  },
  readTarget: NOT_SENSED,
};

/** "take_apart": every piece of the worker's module returns to the pile. */
const takeApart: Effector<Workshop> = {
  kind: "effector",
  name: "take_apart",
  description: "Take the module you hold apart: all its pieces go back on the pile.",
  parameters: { type: "object", properties: {} },
  durationMs: (state) => minutes(state.settings.durations.take_apart),
  start: doing("taking apart"),
  action: {
    precondition: (state, call) => firstRefusal([[handsOf(state, call.agent).module === null, "no_module"]]),
    effect: (state, call) => {
      const pile = { ...state.pile };
      for (const kind of handsOf(state, call.agent).module?.joined ?? []) pile[kind] = (pile[kind] ?? 0) + 1;
      return withHands({ ...state, pile }, call.agent, { module: null });
    },
  },
  end: END,
  texts: { success: "You have taken your module apart; its pieces are back on the pile.", no_module: "You are holding no module; nothing has changed." },
  readTarget: NOT_SENSED,
};

/**
 * "mount": the worker's finished module onto the device. As the call starts, the worker occupies a free bench place,
 * and keeps it until the call ends; with no place free, the call takes `mount_refused` and is refused when it lands.
 */
const mount: Effector<Workshop> = {
  kind: "effector",
  name: "mount",
  description: "Mount the finished module you hold on the device, at a free place of the bench, which you occupy while you mount.",
  parameters: { type: "object", properties: {} },
  durationMs: (state) => minutes(state.bench.places.includes(null) ? state.settings.durations.mount : state.settings.durations.mount_refused),
  start: {
    precondition: () => ({ holds: true }),
    effect: (state, call) => {
      const free = state.bench.places.indexOf(null);
      const mounting = withHands(state, call.agent, { doing: "mounting" });
      return free === -1 ? mounting : { ...mounting, bench: { ...mounting.bench, places: mounting.bench.places.map((each, index) => (index === free ? call.agent : each)) } };
    },
    // The place it occupies, numbered from 1, or null when every place was taken.
    describe: (state) => {
      const free = state.bench.places.indexOf(null);
      return { began: "mounting", place: free === -1 ? null : free + 1 };
    },
  },
  action: {
    precondition: (state, call) => {
      const { module } = handsOf(state, call.agent);
      return firstRefusal([
        [placeOf(state, call.agent) === -1, "bench_full"],
        [module === null, "no_module"],
        [module !== null && !isFinished(state, module), "not_finished"],
        [module !== null && (state.plan[module.name]?.after ?? []).some((before) => !state.bench.mounted.includes(before)), "out_of_order"],
        [module !== null && state.bench.mounted.includes(module.name), "already_mounted"],
      ]);
    },
    effect: (state, call) => {
      const { name } = handsOf(state, call.agent).module as HeldModule;
      const mounted = withHands({ ...state, bench: { ...state.bench, mounted: [...state.bench.mounted, name] } }, call.agent, { module: null });
      return keeping(mounted, "mounts", { worker: call.agent, module: name, at: landedAt(state, call) });
    },
  },
  end: END,
  texts: {
    success: "You have mounted your module on the device.",
    bench_full: "Every place at the bench was taken; you have mounted nothing.",
    no_module: "You are holding no module; you have mounted nothing.",
    not_finished: "Your module is not finished; you have mounted nothing.",
    out_of_order: "A module yours must be mounted after is not mounted yet; you have mounted nothing.",
    already_mounted: "A module of that name is already mounted; you have mounted nothing.",
  },
  // The bench as the worker's last look showed it.
  readTarget: (_sensing, _call, _state, lastBy) => {
    const seen = lastLook(lastBy);
    if (seen === undefined) return "not_sensed";
    return seen.bench.places.includes(null) ? "free" : "held";
  },
};

/** "wait": changes nothing for the minutes it is given, unless a stimulus reaches the worker first. */
const wait: Effector<Workshop> = {
  kind: "effector",
  name: "wait",
  description: "Wait for a number of minutes, doing nothing; you stop waiting as soon as something reaches you (someone speaks or hands you something).",
  parameters: { type: "object", properties: { minutes: { type: "number", description: "How many minutes to wait." } }, required: ["minutes"] },
  durationMs: (_state, call) => minutes(Number(call.arguments.minutes)),
  refuses: (state, call) => {
    const asked = Number(call.arguments.minutes);
    return asked > 0 && asked <= state.settings.waitMaxMinutes ? undefined : { outcome: "invalid_arguments", reason: `"minutes" must be above 0 and at most ${state.settings.waitMaxMinutes}` };
  },
  start: doing("waiting"),
  end: END,
  endsEarly: { outcome: "interrupted", byChange: () => false, byStimulus: () => true },
  texts: { success: "You have waited.", interrupted: "Something reached you; you stopped waiting." },
  readTarget: NOT_SENSED,
};

/** The words of a text: its runs of characters between whitespace. */
function wordsOf(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

/**
 * "say": the text, heard by every other worker through the channel voice as the call ends, with the speaker's name as
 * its source (FR-WORKSHOP-03). It takes `say` minutes plus one per `say_words_per_minute` words, in proportion.
 */
const say: Effector<Workshop> = {
  kind: "effector",
  name: "say",
  description: "Say something aloud. Everyone else in the room hears it, with your name, when you finish speaking; the longer it is, the longer it takes.",
  parameters: { type: "object", properties: { text: { type: "string", description: "What you say." } }, required: ["text"] },
  durationMs: (state, call) => minutes(state.settings.durations.say + wordsOf(String(call.arguments.text)) / state.settings.durations.say_words_per_minute),
  start: doing("speaking"),
  action: {
    precondition: (_state, call) => firstRefusal([[wordsOf(String(call.arguments.text)) === 0, "empty_text"]]),
    // The speech timeline keeps it (FR-WORKSHOP-04).
    effect: (state, call) => {
      const words = wordsOf(String(call.arguments.text));
      const end = landedAt(state, call);
      const duration = state.settings.durations.say + words / state.settings.durations.say_words_per_minute;
      return keeping(state, "speeches", { speaker: call.agent, start: end - duration, end, words });
    },
  },
  end: END,
  delivers: {
    channel: VOICE_CHANNEL,
    deliveries: (state, call) =>
      Object.keys(state.workers)
        .filter((worker) => worker !== call.agent)
        .map((worker) => ({ agent: worker, source: call.agent, values: { text: String(call.arguments.text) } })),
  },
  texts: { success: "You have said it.", empty_text: "You said nothing; nobody heard anything." },
  readTarget: NOT_SENSED,
};

/** Whether what a hand names is the giver's module: the name of the module it holds; otherwise it names a kind. */
function handsModule(hands: Hands, what: string): boolean {
  return hands.module?.name === what;
}

/**
 * "hand": one loose piece of a kind the giver holds, or the module it holds, into another worker's hands; the receiver
 * learns it through the channel hands, from the giver (FR-WORKSHOP-05).
 */
const hand: Effector<Workshop> = {
  kind: "effector",
  name: "hand",
  description:
    "Hand another worker, named as look names them, one loose piece of a kind you hold, or the module you hold, finished or not, with the pieces joined into it. They are told what you handed them.",
  parameters: {
    type: "object",
    properties: {
      worker: { type: "string", description: "The worker you hand it to, as look names them." },
      what: { type: "string", description: "The name of the module you hold, or a kind of loose piece you hold." },
    },
    required: ["worker", "what"],
  },
  durationMs: (state) => minutes(state.settings.durations.hand),
  start: doing("handing"),
  action: {
    precondition: (state, call) => {
      const [receiver, what] = [named(call, "worker"), named(call, "what")];
      const giver = handsOf(state, call.agent);
      const module = handsModule(giver, what);
      const taker = state.workers[receiver];
      return firstRefusal([
        [taker === undefined, "no_such_worker"],
        [receiver === call.agent, "to_self"],
        [!module && (giver.loose[what] ?? 0) === 0, "not_held"],
        [!module && taker !== undefined && looseCount(taker) >= state.settings.handPieces, "hands_full"],
        [module && taker?.module != null, "holds_module"],
      ]);
    },
    effect: (state, call) => {
      const [receiver, what] = [named(call, "worker"), named(call, "what")];
      const giver = handsOf(state, call.agent);
      const module = handsModule(giver, what);
      const moved = module
        ? withHands(withHands(state, call.agent, { module: null }), receiver, { module: giver.module })
        : withHands(withHands(state, call.agent, { loose: counted(giver.loose, what, -1) }), receiver, { loose: counted(handsOf(state, receiver).loose, what, 1) });
      return keeping(moved, "handovers", { giver: call.agent, receiver, sort: module ? "module" : "piece", name: what, at: landedAt(state, call) });
    },
  },
  end: END,
  // What the giver's applied hand moved, to its receiver alone.
  delivers: {
    channel: HANDS_CHANNEL,
    deliveries: (state, call) => {
      const handover = state.landed.handovers.filter(({ giver }) => giver === call.agent).at(-1);
      if (handover === undefined) throw new Error(`"${call.agent}" has handed nothing`);
      const what = handover.sort === "module" ? `the module ${handover.name}` : `a piece of ${handover.name}`;
      return [{ agent: handover.receiver, source: handover.giver, values: { what } }];
    },
  },
  texts: {
    success: "You have handed it over.",
    no_such_worker: "There is no worker of that name; nothing has been handed.",
    to_self: "That is you; nothing has been handed.",
    not_held: "You are not holding that; nothing has been handed.",
    hands_full: "Their hands are full; nothing has been handed.",
    holds_module: "They are already holding a module; nothing has been handed.",
  },
  readTarget: NOT_SENSED,
};

/** The workers' tools (FR-WORKSHOP-02, FR-WORKSHOP-03's say and FR-WORKSHOP-05's hand). */
const TOOLS: readonly Tool<Workshop>[] = [look, readPlan, take, putBack, join, takeApart, mount, wait, say, hand];

/** How each tool takes its time, for the inventory, in world minutes. */
function describeDuration(configuration: Configuration, tool: string): string {
  const { durations, waitMaxMinutes } = settingsOf(configuration);
  if (tool === "mount") return `${durations.mount} world minutes; ${durations.mount_refused} world minutes when every bench place is taken as it starts.`;
  if (tool === "wait") return `The minutes it is given, above 0 and at most ${waitMaxMinutes} world minutes; it ends early when a stimulus reaches the worker.`;
  if (tool === "say") return `${durations.say} world minutes plus one minute per ${durations.say_words_per_minute} words.`;
  if (!TOOLS.some(({ name }) => name === tool)) throw new Error(`The workshop has no tool "${tool}"`);
  return `${durations[tool as Duration]} world minutes.`;
}

/** Outcomes of calls the tool never ran, which take no time (FR-WORKSHOP-04). */
const UNRUN = ["invalid_arguments", "unknown_tool"];

/** Outcomes refused_by_cause does not count: the call was not refused. */
const NOT_REFUSED = ["success", "interrupted", "cut_off"];

/** A call's duration in world minutes: its run milliseconds at the calendar's scale; none for a call never run. */
function durationOf(state: Workshop, call: ToolCall): number {
  return UNRUN.includes(call.outcome) ? 0 : ((call.endedAtMs - call.startedAtMs) * state.settings.scale) / 60_000;
}

/** A table with a value for each worker of the workshop, from a function of the worker. */
function byWorker(state: Workshop, value: (worker: string) => number): Record<string, number> {
  return Object.fromEntries(Object.keys(state.workers).map((worker) => [worker, value(worker)]));
}

/** Adds one to a key of a table. */
function countIn(table: Record<string, number>, key: string, by = 1): void {
  table[key] = (table[key] ?? 0) + by;
}

/** Whether the device is complete: one module of each name of the plan is mounted. */
function isDone(state: Workshop): boolean {
  return Object.keys(state.plan).every((module) => state.bench.mounted.includes(module));
}

/** The time the first applied take of any worker landed, or null before one. */
function firstTakeTime(state: Workshop): number | null {
  return state.landed.takes.length === 0 ? null : Math.min(...state.landed.takes.map(({ at }) => at));
}

/** The workshop's measures (FR-WORKSHOP-04), from the world's state and the record of tool calls. */
const METRICS: Scenario<Workshop>["metrics"] = {
  done: (state) => (isDone(state) ? 1 : 0),
  modules_mounted: (state) => state.bench.mounted.length,
  time_to_done: (state) => (isDone(state) ? Math.max(...state.landed.mounts.map(({ at }) => at)) : null),
  effort_total: (state, calls) => calls.reduce((sum, call) => sum + durationOf(state, call), 0),
  effort_by_worker: (state, calls) => byWorker(state, (worker) => calls.filter(({ agent }) => agent === worker).reduce((sum, call) => sum + durationOf(state, call), 0)),
  pieces_wasted: (state) => Object.values(state.workers).reduce((sum, hands) => sum + looseCount(hands) + (hands.module?.joined.length ?? 0), 0),
  modules_taken_apart: (_state, calls) => calls.filter(({ tool, outcome }) => tool === "take_apart" && outcome === "success").length,
  first_take_time: firstTakeTime,
  speech_before_first_take: (state) => {
    const first = firstTakeTime(state);
    const before = state.landed.speeches.filter(({ end }) => first === null || end < first);
    return { calls: before.length, words: before.reduce((sum, { words }) => sum + words, 0) };
  },
  own_first_take_time: (state) => {
    const times: Record<string, number> = {};
    for (const { worker, at } of state.landed.takes) times[worker] = Math.min(times[worker] ?? Infinity, at);
    return times;
  },
  builders_by_module: (state) => {
    const builders: Record<string, number> = {};
    for (const { worker, module } of state.landed.joins) builders[`${module}.joined_by.${worker}`] = 1;
    for (const { worker, module } of state.landed.mounts) builders[`${module}.mounted_by.${worker}`] = 1;
    return builders;
  },
  joins_share_by_worker: (state) => {
    const total = state.landed.joins.length;
    return total === 0 ? null : byWorker(state, (worker) => state.landed.joins.filter((join) => join.worker === worker).length / total);
  },
  modules_by_worker: (state) => {
    const table: Record<string, number> = {};
    for (const worker of Object.keys(state.workers)) {
      table[`${worker}.finished`] = state.landed.joins.filter((join) => join.worker === worker && join.finished).length;
      table[`${worker}.mounted`] = state.landed.mounts.filter((mount) => mount.worker === worker).length;
    }
    return table;
  },
  module_switches: (state) =>
    byWorker(state, (worker) => {
      const modules = state.landed.joins.filter((join) => join.worker === worker).map(({ module }) => module);
      return modules.filter((module, index) => index > 0 && module !== modules[index - 1]).length;
    }),
  duplicated_modules: (state) => {
    const started: Record<string, number> = {};
    for (const join of state.landed.joins) if (join.started) countIn(started, join.module);
    return Object.values(started).reduce((sum, count) => sum + Math.max(count - 1, 0), 0);
  },
  refused_by_cause: (_state, calls) => {
    const refused: Record<string, number> = {};
    for (const { tool, outcome } of calls) if (!NOT_REFUSED.includes(outcome)) countIn(refused, `${tool}.${outcome}`);
    return refused;
  },
  bench_refusals: (_state, calls) => calls.filter(({ tool, outcome }) => tool === "mount" && outcome === "bench_full").length,
  // A mount that landed started its duration of `mount` minutes before; its module's last join is its mounter's last
  // applied join into a module of that name before then (a module never changes hands).
  finish_to_mount: (state) => {
    const table: Record<string, number> = {};
    for (const { worker, module, at } of state.landed.mounts) {
      const start = at - state.settings.durations.mount;
      const joins = state.landed.joins.filter((join) => join.worker === worker && join.module === module && join.at <= start);
      if (joins.length > 0) table[module] = start - Math.max(...joins.map((join) => join.at));
    }
    return table;
  },
  speech_by_worker: (state) => {
    const table: Record<string, number> = {};
    for (const worker of Object.keys(state.workers)) {
      const speeches = state.landed.speeches.filter(({ speaker }) => speaker === worker);
      table[`${worker}.calls`] = speeches.length;
      table[`${worker}.words`] = speeches.reduce((sum, { words }) => sum + words, 0);
    }
    return table;
  },
  time_by_activity: (state, calls) => {
    const table: Record<string, number> = {};
    for (const call of calls) countIn(table, `${call.agent}.${call.tool}`, durationOf(state, call));
    return table;
  },
} satisfies Record<string, (state: Workshop, calls: readonly ToolCall[]) => MetricValue>;

/**
 * The workshop's channels: its workers' rhythm; the voice, whose stimulus is what was said, from the speaker, and which
 * wakes a resting worker (FR-WORKSHOP-03); the hands, whose stimulus is what was handed, from the giver, and which wakes
 * too (FR-WORKSHOP-05); and the order, when a text is placed there.
 */
function channels(configuration: Configuration): Channel[] {
  settingsOf(configuration);
  const order = textsIn(configuration, "first");
  return [
    ...rhythmChannels(configuration),
    { name: VOICE_CHANNEL, source: "the speaker", stimulus: "{text}", described: "what was said", wakes: true },
    { name: HANDS_CHANNEL, source: "the giver", stimulus: "handed you {what}.", described: "handed you <what>.", wakes: true },
    ...(order === "" ? [] : [{ name: ORDER_CHANNEL, source: configuration.order_source as string, stimulus: order }]),
  ];
}

/** What the inventory gives of the workshop's world (FR-WORKSHOP-01). */
function worldInventory(configuration: Configuration): Readonly<Record<string, unknown>> {
  const { workers, plan, pile, benchPlaces, handPieces } = settingsOf(configuration);
  return {
    plan,
    pile,
    bench_places: benchPlaces,
    hands: { loose_pieces: handPieces, modules: 1 },
    workers,
    durations: configuration.durations,
    wait_max_minutes: configuration.wait_max_minutes,
    texts: Object.fromEntries(TEXTS.map((text) => [text, configuration[text]])),
    placement: configuration.placement,
    order_source: configuration.order_source,
  };
}

/** The three texts of the workshop's world, word for word (agents-lab-experiments, worlds/workshop). */
const IDENTITY = "You are {name}, one of the four workers of a small workshop that assembles devices to order.";
const TASK = "Today's order for the workshop: the device on the plan, left complete on the bench.\nThe order is the workshop's. It is done when the device is complete.";
const WORLD_RULES = [
  "How this place works:",
  "- The workshop is one room: the pile of pieces, the bench, the plan on the wall, and the four of you.",
  "- You know what is in the room by looking, and what the order needs by reading the plan. Things change while you work, because the others are working too.",
  "- Everything you do takes time, and so does looking, reading and speaking.",
  "- The pieces in the pile are counted. A piece joined into a module is in that module until the module is taken apart.",
  "- Your hands hold up to six loose pieces and one module.",
  "- The device is assembled on the bench by mounting finished modules. The bench has two places: two of you can mount at the same time, not more.",
  "- What you say is heard by everyone in the room. Nobody hears what you do not say.",
].join("\n");

/** The workshop's base configuration: the base of `world.md` (FR-WORKSHOP-01). */
const BASE_CONFIGURATION = stringify({
  workers: ["Dal", "Mik", "Nar", "Ren"],
  bench_places: 2,
  hand_pieces: 6,
  wait_max_minutes: 10,
  identity: IDENTITY,
  task: TASK,
  world_rules: WORLD_RULES,
  order_source: "the order",
  plan: {
    tessa: { recipe: ["arn", "arn", "bex", "cal", "dov"], after: [] },
    ulm: { recipe: ["bex", "eln"], after: ["tessa"] },
    vorn: { recipe: ["cal", "cal", "fim"], after: ["tessa"] },
    wick: { recipe: ["arn", "dov", "eln", "gor"], after: ["ulm", "vorn"] },
    yarl: { recipe: ["fim", "gor"], after: ["wick"] },
    zeth: { recipe: ["bex", "dov", "dov"], after: ["tessa"] },
  },
  pile: { arn: 4, bex: 3, cal: 4, dov: 5, eln: 2, fim: 2, gor: 2 },
  durations: { look: 0.5, read_plan: 1, take: 1, put_back: 0.5, join: 2, take_apart: 2, mount: 3, mount_refused: 0.5, say: 0.25, say_words_per_minute: 30, hand: 0.5 },
  calendar: { start: "day 1 Monday 09:00", segments: [{ scale: 4 }] },
  rhythm: { source: "your own pace", text: "You are ready to act.", min_ms: 1000, max_ms: 3000 },
  placement: { identity: "system", task: "system", world_rules: "system" },
});

/**
 * The workshop scenario (FR-WORKSHOP-01): workers who assemble a device from a plan, in one room, from a common pile
 * and at a bench of few places, with their tools (FR-WORKSHOP-02).
 */
export const workshopScenario: Scenario<Workshop> = {
  name: "workshop",
  agents: (configuration) => settingsOf(configuration).workers,
  initialState,
  tools: TOOLS,
  channels,
  metrics: METRICS,
  // The world is finished once the device is complete (FR-WORKSHOP-04, FR-RUN-08).
  finished: isDone,
  // Each applied speech is a line of the speech timeline as it lands.
  logLines: (before, after) => after.landed.speeches.slice(before.landed.speeches.length).map((speech) => ({ type: "speech", ...speech })),
  firstStimuli: (configuration) => (textsIn(configuration, "first") === "" ? [] : [ORDER_CHANNEL]),
  systemPrompt: (configuration, agent) => textsIn(configuration, "system").replaceAll("{name}", agent),
  rhythm: uniformRhythm,
  describeDuration,
  describeRhythm: describeUniformRhythm,
  worldInventory,
  baseConfiguration: BASE_CONFIGURATION,
};
