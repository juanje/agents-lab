import { type TomlTable, stringify } from "smol-toml";
import type { Random } from "../engine/random.ts";
import { type Configuration, type Scenario, isTable } from "../engine/scenario.ts";
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

/** The durations the configuration gives, in world minutes, by name (FR-WORKSHOP-01). */
const DURATIONS = ["look", "read_plan", "take", "put_back", "join", "take_apart", "mount", "mount_refused", "say", "say_words_per_minute"] as const;
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
export type Doing = "taking" | "putting back" | "joining" | "taking apart" | "mounting" | "waiting" | "nothing";

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
export interface Workshop {
  settings: { handPieces: number; durations: Readonly<Record<Duration, number>>; waitMaxMinutes: number };
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
  const { workers, plan, pile, benchPlaces, handPieces, durations, waitMaxMinutes } = settingsOf(configuration);
  const kinds = shuffled(Object.keys(pile).sort(), random);
  const modules = shuffled(Object.keys(plan).sort(), random);
  return {
    settings: { handPieces, durations, waitMaxMinutes },
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

/** "look": the room as it is when the call ends, in the drawn orders. */
const look: Sensor<Workshop> = {
  kind: "sensor",
  name: "look",
  description:
    "Look at the room, as JSON: the pile, with how many pieces of each kind it holds; the bench, with the modules mounted on the device in the order they were mounted and who occupies each of its places (null for a free one); and each worker, you included, with the loose pieces it holds, the module it holds (with the pieces joined into it so far and whether it is finished) and what it is doing.",
  parameters: { type: "object", properties: {} },
  durationMs: (state) => minutes(state.settings.durations.look),
  sense: (state) =>
    JSON.stringify({
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
      return withHands({ ...state, pile: { ...state.pile, [kind]: state.pile[kind] - 1 } }, call.agent, { loose: counted(handsOf(state, call.agent).loose, kind, 1) });
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
      return withHands(state, call.agent, { loose: counted(hands.loose, kind, -1), module: { name: module, joined: [...(hands.module?.joined ?? []), kind] } });
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
      const { module } = handsOf(state, call.agent);
      return withHands({ ...state, bench: { ...state.bench, mounted: [...state.bench.mounted, (module as HeldModule).name] } }, call.agent, { module: null });
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
  description: "Wait for a number of minutes, doing nothing; you stop waiting as soon as someone speaks.",
  parameters: { type: "object", properties: { minutes: { type: "number", description: "How many minutes to wait." } }, required: ["minutes"] },
  durationMs: (_state, call) => minutes(Number(call.arguments.minutes)),
  refuses: (state, call) => {
    const asked = Number(call.arguments.minutes);
    return asked > 0 && asked <= state.settings.waitMaxMinutes ? undefined : { outcome: "invalid_arguments", reason: `"minutes" must be above 0 and at most ${state.settings.waitMaxMinutes}` };
  },
  start: doing("waiting"),
  end: END,
  endsEarly: { outcome: "interrupted", byChange: () => false, byStimulus: () => true },
  texts: { success: "You have waited.", interrupted: "Someone spoke; you stopped waiting." },
  readTarget: NOT_SENSED,
};

/** The workers' tools (FR-WORKSHOP-02). */
const TOOLS: readonly Tool<Workshop>[] = [look, readPlan, take, putBack, join, takeApart, mount, wait];

/** How each tool takes its time, for the inventory, in world minutes. */
function describeDuration(configuration: Configuration, tool: string): string {
  const { durations, waitMaxMinutes } = settingsOf(configuration);
  if (tool === "mount") return `${durations.mount} world minutes; ${durations.mount_refused} world minutes when every bench place is taken as it starts.`;
  if (tool === "wait") return `The minutes it is given, above 0 and at most ${waitMaxMinutes} world minutes; it ends early when a stimulus reaches the worker.`;
  if (!TOOLS.some(({ name }) => name === tool)) throw new Error(`The workshop has no tool "${tool}"`);
  return `${durations[tool as Duration]} world minutes.`;
}

/** The workshop's channels: its workers' rhythm, and the order, when a text is placed there. */
function channels(configuration: Configuration): Channel[] {
  settingsOf(configuration);
  const order = textsIn(configuration, "first");
  return [...rhythmChannels(configuration), ...(order === "" ? [] : [{ name: ORDER_CHANNEL, source: configuration.order_source as string, stimulus: order }])];
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
  durations: { look: 0.5, read_plan: 1, take: 1, put_back: 0.5, join: 2, take_apart: 2, mount: 3, mount_refused: 0.5, say: 0.25, say_words_per_minute: 30 },
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
  metrics: {},
  firstStimuli: (configuration) => (textsIn(configuration, "first") === "" ? [] : [ORDER_CHANNEL]),
  systemPrompt: (configuration, agent) => textsIn(configuration, "system").replaceAll("{name}", agent),
  rhythm: uniformRhythm,
  describeDuration,
  describeRhythm: describeUniformRhythm,
  worldInventory,
  baseConfiguration: BASE_CONFIGURATION,
};
