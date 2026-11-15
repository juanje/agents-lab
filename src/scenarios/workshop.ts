import { type TomlTable, stringify } from "smol-toml";
import type { Random } from "../engine/random.ts";
import { type Configuration, type Scenario, isTable } from "../engine/scenario.ts";
import type { Channel } from "../engine/stimuli.ts";
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

/** What a worker holds: its loose pieces, a count for each kind it holds, and at most one module. */
export interface Hands {
  loose: Readonly<Record<string, number>>;
  module: HeldModule | null;
}

/**
 * The workshop's state (FR-WORKSHOP-01): the pile's loose pieces, the bench, each worker's hands, and the orders in
 * which `look` lists the pile's kinds and the workers and `read_plan` lists the modules, drawn once for the run.
 */
export interface Workshop {
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
  return { workers: workers as string[], plan, pile: pile as Record<string, number>, benchPlaces: configuration.bench_places as number, handPieces: configuration.hand_pieces as number };
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
  const { workers, plan, pile, benchPlaces } = settingsOf(configuration);
  const kinds = shuffled(Object.keys(pile).sort(), random);
  const modules = shuffled(Object.keys(plan).sort(), random);
  return {
    plan,
    pile: { ...pile },
    bench: { mounted: [], places: Array.from({ length: benchPlaces }, () => null) },
    workers: Object.fromEntries(workers.map((name) => [name, { loose: {}, module: null }])),
    orders: { kinds, workers: shuffled(workers, random), modules },
  };
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
 * and at a bench of few places.
 */
export const workshopScenario: Scenario<Workshop> = {
  name: "workshop",
  agents: (configuration) => settingsOf(configuration).workers,
  initialState,
  tools: [],
  channels,
  metrics: {},
  firstStimuli: (configuration) => (textsIn(configuration, "first") === "" ? [] : [ORDER_CHANNEL]),
  systemPrompt: (configuration, agent) => textsIn(configuration, "system").replaceAll("{name}", agent),
  rhythm: uniformRhythm,
  describeDuration: (_configuration, tool) => {
    throw new Error(`The workshop has no tool "${tool}"`);
  },
  describeRhythm: describeUniformRhythm,
  worldInventory,
  baseConfiguration: BASE_CONFIGURATION,
};
