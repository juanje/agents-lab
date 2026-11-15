import assert from "node:assert/strict";
import { type DataTable, Given, Then, When } from "@cucumber/cucumber";
import type { JsonObject } from "@earendil-works/pi-ai";
import { type TomlTable, parse, stringify } from "smol-toml";
import type { ToolCall } from "../../src/engine/adapter.ts";
import { worldTimeAt } from "../../src/engine/calendar.ts";
import { Random } from "../../src/engine/random.ts";
import type { ScriptedAnswer } from "../../src/engine/scripted-model.ts";
import { type LoadedScenario, type MetricValue, loadScenario } from "../../src/engine/scenario.ts";
import type { LandingCall } from "../../src/engine/tools.ts";
import { type Check, World } from "../../src/engine/world.ts";
import { scenarioLibrary } from "../../src/scenarios/library.ts";
import type { Workshop } from "../../src/scenarios/workshop.ts";
import type { Context } from "../support/context.ts";
import { configurationChanges } from "../support/changes.ts";
import { fencedAfter, under } from "./inventory.steps.ts";
import { assertRhythmWithin, lastLoaded } from "./neighbourhood.steps.ts";
import { logLines } from "./record.steps.ts";
import { asRead, userTexts } from "./stimulus.steps.ts";
import { modelOf, script, scriptActivations } from "./tool.steps.ts";

/** The base configuration's workers, in the order it names them. */
const WORKERS = ["Dal", "Mik", "Nar", "Ren"];

/** What a workshop scenario sets up besides its configuration: the changes it makes to the world as the engine loads it. */
interface WorkshopSetup {
  /** Applied in order to the initial state, before any worker acts. */
  changes: ((state: Workshop) => Workshop)[];
  /** Whether every worker the scenario gives no turns ends every turn without a tool call. */
  othersIdle: boolean;
  /** How long a worker rests before each activation, for a worker the scenario gives a rest of its own. */
  rests: Map<string, number>;
}

const setups = new WeakMap<Context, WorkshopSetup>();

/** What the scenario set up of the workshop; a step that needs it fails when no workshop was set up. */
export function workshopSetupOf(context: Context): WorkshopSetup {
  const setup = setups.get(context);
  assert.ok(setup !== undefined, "the scenario set up no workshop");
  return setup;
}

/** The workshop's configuration as the steps set it up: the library scenario's base configuration. */
export function workshopConfiguration(context: Context): TomlTable {
  return parse(context.libraryScenario.baseConfiguration ?? "");
}

/** Changes the workshop's configuration, as a base configuration the run loads. */
export function changeWorkshop(context: Context, changing: (configuration: TomlTable) => void): void {
  const configuration = workshopConfiguration(context);
  changing(configuration);
  context.libraryScenario = { ...context.libraryScenario, baseConfiguration: stringify(configuration) };
}

/** The workshop as the engine loads it for a run, with the scenario's seed and condition, its setup applied to its world. */
export function loadWorkshop(context: Context): LoadedScenario<Workshop> {
  const loaded = loadScenario(context.libraryScenario, context.seed, context.condition) as LoadedScenario<Workshop>;
  const state = workshopSetupOf(context).changes.reduce((changed, change) => change(changed), loaded.world.state);
  const world = new World(state);
  context.libraryLoads.push({ ...loaded, world });
  if (workshopSetupOf(context).othersIdle) for (const worker of loaded.systemPrompts.keys()) if (!context.models.has(worker)) idle(context, worker);
  const rhythms = new Map(loaded.rhythms);
  for (const [worker, restMs] of workshopSetupOf(context).rests) rhythms.set(worker, () => restMs);
  return { ...loaded, world, rhythms };
}

/** Gives a worker a scripted model that ends every turn without a tool call. */
function idle(context: Context, worker: string): void {
  script(context, worker, Array.from({ length: 50 }, () => ({ text: "Nothing to do.", delayMs: 0 })));
}

/** Sets up the library's workshop with its base configuration, which the engine loads for a run with the setup's changes. */
function setUpWorkshop(context: Context): void {
  const workshop = scenarioLibrary.get("workshop");
  assert.ok(workshop !== undefined, 'the scenario library has no scenario "workshop"');
  context.libraryScenario = workshop;
  setups.set(context, { changes: [], othersIdle: false, rests: new Map() });
  context.assembleRun = () => loadWorkshop(context) as LoadedScenario<unknown>;
}

Given("the workshop scenario with its base configuration", function (this: Context) {
  setUpWorkshop(this);
});

/** The workshop's world in the last load. */
function loadedWorkshop(context: Context): LoadedScenario<Workshop> {
  return lastLoaded(context) as unknown as LoadedScenario<Workshop>;
}

/** The inventory's description of the world, for the base condition. */
function inventoryWorld(context: Context): Record<string, unknown> {
  const world = under(under(context.labOutput ?? "", '## Condition "base"'), "### World");
  return JSON.parse(world.slice(world.indexOf("```json") + 7, world.lastIndexOf("```"))) as Record<string, unknown>;
}

Then("the inventory lists the agents {string}, {string}, {string} and {string}", function (this: Context, a: string, b: string, c: string, d: string) {
  const agents = under(under(this.labOutput ?? "", '## Condition "base"'), "### Agents");
  const listed = agents.split("\n").filter((line) => line.startsWith("#### Agent "));
  assert.deepEqual(listed, [a, b, c, d].map((name) => `#### Agent "${name}"`));
});

Then(
  "it gives the plan with its six modules, their recipes and what each is mounted after, the pile's stock, {int} bench places, and hands of {int} loose pieces and one module",
  function (this: Context, benchPlaces: number, handPieces: number) {
    const world = inventoryWorld(this);
    assert.deepEqual(world.plan, {
      tessa: { recipe: ["arn", "arn", "bex", "cal", "dov"], after: [] },
      ulm: { recipe: ["bex", "eln"], after: ["tessa"] },
      vorn: { recipe: ["cal", "cal", "fim"], after: ["tessa"] },
      wick: { recipe: ["arn", "dov", "eln", "gor"], after: ["ulm", "vorn"] },
      yarl: { recipe: ["fim", "gor"], after: ["wick"] },
      zeth: { recipe: ["bex", "dov", "dov"], after: ["tessa"] },
    });
    assert.deepEqual(world.pile, { arn: 4, bex: 3, cal: 4, dov: 5, eln: 2, fim: 2, gor: 2 });
    assert.equal(world.bench_places, benchPlaces);
    assert.deepEqual(world.hands, { loose_pieces: handPieces, modules: 1 });
  },
);

Then(
  'it gives the durations in world minutes: "look" {float}, "read_plan" {int}, "take" {int}, "put_back" {float}, "join" {int}, "take_apart" {int}, "mount" {int}, "mount_refused" {float}, "say" {float} with "say_words_per_minute" {int}, "hand" {float}, and "wait_max_minutes" {int}',
  function (this: Context, look: number, readPlan: number, take: number, putBack: number, join: number, takeApart: number, mount: number, mountRefused: number, say: number, wordsPerMinute: number, hand: number, waitMax: number) {
    const world = inventoryWorld(this);
    assert.deepEqual(world.durations, {
      look,
      read_plan: readPlan,
      take,
      put_back: putBack,
      join,
      take_apart: takeApart,
      mount,
      mount_refused: mountRefused,
      say,
      say_words_per_minute: wordsPerMinute,
      hand,
    });
    assert.equal(world.wait_max_minutes, waitMax);
  },
);

Then("it gives the calendar's start {string} and one segment of scale {int} {string}", function (this: Context, start: string, scale: number, lasts: string) {
  const calendar = under(under(this.labOutput ?? "", '## Condition "base"'), "### Calendar");
  const lines = calendar.split("\n").filter((line) => line.startsWith("- "));
  assert.deepEqual(lines, [`- Start: ${start}`, `- Segment 1: ${scale} world seconds for each second of the run, ${lasts}`]);
});

Then(
  "it gives each worker's rhythm as an interval drawn uniformly between {int} and {int} ms, and the channel {string} with the source {string} and the text {string}",
  function (this: Context, minMs: number, maxMs: number, channel: string, source: string, text: string) {
    const printed = under(this.labOutput ?? "", '## Condition "base"');
    for (const worker of WORKERS) {
      const agent = under(printed, `#### Agent "${worker}"`);
      assert.ok(agent.includes(`- Rhythm: An interval drawn uniformly between ${minMs} and ${maxMs} ms before each activation.`), `worker "${worker}"'s rhythm:\n${agent}`);
    }
    const listed = under(printed, `#### Channel "${channel}"`);
    assert.ok(listed.includes(`- Source: ${source}`), `the channel "${channel}":\n${listed}`);
    assert.equal(fencedAfter(listed, "Delivers"), text);
  },
);

Then(
  'the pile holds "arn" {int}, "bex" {int}, "cal" {int}, "dov" {int}, "eln" {int}, "fim" {int} and "gor" {int}',
  function (this: Context, arn: number, bex: number, cal: number, dov: number, eln: number, fim: number, gor: number) {
    assert.deepEqual({ ...loadedWorkshop(this).world.state.pile }, { arn, bex, cal, dov, eln, fim, gor });
  },
);

Then("no module is mounted, and both bench places are free", function (this: Context) {
  const { bench } = loadedWorkshop(this).world.state;
  assert.deepEqual(bench.mounted, []);
  assert.deepEqual(bench.places, [null, null]);
});

Then("no worker holds a loose piece or a module", function (this: Context) {
  const { workers } = loadedWorkshop(this).world.state;
  assert.deepEqual(Object.keys(workers).sort(), [...WORKERS].sort());
  for (const [name, hands] of Object.entries(workers)) {
    assert.deepEqual(hands.loose, {}, `worker "${name}" holds loose pieces`);
    assert.equal(hands.module, null, `worker "${name}" holds a module`);
  }
});

/** The configuration's text, by the name a step gives its material: "identity.md", "task.md" or "world-rules.md". */
function textOf(context: Context, material: string): string {
  const key = { "identity.md": "identity", "task.md": "task", "world-rules.md": "world_rules" }[material];
  assert.ok(key !== undefined, `the steps know no material "${material}"`);
  return workshopConfiguration(context)[key] as string;
}

/** A worker's system prompt, in the last load. */
function promptOf(context: Context, worker: string): string {
  const prompt = loadedWorkshop(context).systemPrompts.get(worker);
  assert.ok(prompt !== undefined, `worker "${worker}" has no system prompt`);
  return prompt;
}

Then(
  'worker {string}\'s system prompt is the text of "identity.md" with "\\{name}" as {string}, then the text of "task.md", then the text of "world-rules.md", each separated by a blank line',
  function (this: Context, worker: string, name: string) {
    const identity = textOf(this, "identity.md");
    assert.ok(identity.includes("{name}"), "the identity has no {name} to fill in");
    assert.equal(promptOf(this, worker), [identity.replaceAll("{name}", name), textOf(this, "task.md"), textOf(this, "world-rules.md")].join("\n\n"));
  },
);

Then("it begins {string}", function (this: Context, beginning: string) {
  assert.ok(promptOf(this, "Dal").startsWith(beginning), promptOf(this, "Dal"));
});

Then("worker {string}'s system prompt begins {string}", function (this: Context, worker: string, beginning: string) {
  assert.ok(promptOf(this, worker).startsWith(beginning), promptOf(this, worker));
});

Then(
  'no worker\'s system prompt holds any of "arn", "bex", "cal", "dov", "eln", "fim", "gor", "tessa", "ulm", "vorn", "wick", "yarl" or "zeth"',
  function (this: Context) {
    const words = ["arn", "bex", "cal", "dov", "eln", "fim", "gor", "tessa", "ulm", "vorn", "wick", "yarl", "zeth"];
    for (const worker of WORKERS) {
      const prompt = promptOf(this, worker);
      // As words: "cal" is in "small", "arn" in "learn".
      const held = words.filter((word) => new RegExp(`\\b${word}\\b`).test(prompt));
      assert.deepEqual(held, [], `worker "${worker}"'s system prompt holds ${held.join(", ")}`);
    }
  },
);

Then("worker {string}'s system prompt holds none of {string}, {string} or {string}", function (this: Context, worker: string, a: string, b: string, c: string) {
  const prompt = promptOf(this, worker);
  const held = [a, b, c].filter((word) => prompt.includes(word));
  assert.deepEqual(held, [], `worker "${worker}"'s system prompt holds ${held.join(", ")}`);
});

/** The changes to the workshop's configuration the steps read, each by its words. */
const workshopChanges: [RegExp, (context: Context, ...values: string[]) => void][] = [
  [/^the plan has no module$/, (context) => changeWorkshop(context, (configuration) => (configuration.plan = {}))],
  [/^the recipe of "(\w+)" is empty$/, (context, module) => changeWorkshop(context, (configuration) => (moduleOf(configuration, module).recipe = []))],
  [
    /^the recipe of "(\w+)" names the kind "(\w+)", which the pile lacks$/,
    (context, module, kind) => changeWorkshop(context, (configuration) => (moduleOf(configuration, module).recipe = [...(moduleOf(configuration, module).recipe as string[]), kind])),
  ],
  [/^"(\w+)" is mounted after "(\w+)", which is no module$/, (context, module, after) => changeWorkshop(context, (configuration) => (moduleOf(configuration, module).after = [after]))],
  [
    /^"(\w+)" is mounted after "(\w+)", which is mounted after "\w+"$/,
    (context, module, after) => changeWorkshop(context, (configuration) => (moduleOf(configuration, module).after = [after])),
  ],
  [/^the pile holds (-?[\d.]+) "(\w+)"$/, (context, count, kind) => changeWorkshop(context, (configuration) => ((configuration.pile as TomlTable)[kind] = Number(count)))],
  [/^"(bench_places|hand_pieces|wait_max_minutes)" is (-?\d+)$/, (context, key, value) => changeWorkshop(context, (configuration) => (configuration[key] = Number(value)))],
  [/^"workers" is \[(.*)\]$/, (context, items) => changeWorkshop(context, (configuration) => (configuration.workers = parse(`workers = [${items}]`).workers))],
  [/^the duration of "(\w+)" is (-?[\d.]+)$/, (context, name, value) => changeWorkshop(context, (configuration) => ((configuration.durations as TomlTable)[name] = Number(value)))],
  [
    /^the calendar has a second segment$/,
    (context) =>
      changeWorkshop(context, (configuration) => {
        const calendar = configuration.calendar as TomlTable;
        calendar.segments = [{ scale: 4, until: "day 1 Monday 10:00" }, { scale: 60 }];
      }),
  ],
  [/^"rhythm\.min_ms" is (\d+)$/, (context, value) => changeWorkshop(context, (configuration) => ((configuration.rhythm as TomlTable).min_ms = Number(value)))],
  [/^"(\w+)" is placed as "(\w+)"$/, (context, text, place) => changeWorkshop(context, (configuration) => ((configuration.placement as TomlTable)[text] = place))],
  [/^the placement names the text "(\w+)"$/, (context, text) => changeWorkshop(context, (configuration) => ((configuration.placement as TomlTable)[text] = "system"))],
  [/^"(\w+)" holds "(\{\w+\})"$/, (context, text, braces) => changeWorkshop(context, (configuration) => (configuration[text] = `${configuration[text] as string} ${braces}`))],
];

/** A module of the configuration's plan, as a table a step changes. */
function moduleOf(configuration: TomlTable, module: string): TomlTable {
  const found = (configuration.plan as TomlTable)[module];
  assert.ok(found !== undefined, `the plan has no module "${module}"`);
  return found as TomlTable;
}

configurationChanges.push({
  applies: (context) => context.libraryScenario?.name === "workshop",
  read: (context, change) => {
    const known = workshopChanges.find(([written]) => written.test(change));
    assert.ok(known !== undefined, `the steps do not read the workshop's change "${change}"`);
    const [written, apply] = known;
    apply(context, ...(written.exec(change) ?? []).slice(1));
  },
});

Given("the configuration places {string} as {string} and sets {string} to {string}", function (this: Context, text: string, place: string, key: string, value: string) {
  changeWorkshop(this, (configuration) => {
    (configuration.placement as TomlTable)[text] = place;
    assert.ok(Object.hasOwn(configuration, key), `the workshop's configuration has no "${key}"`);
    configuration[key] = value;
  });
});

Given(
  /^worker "(\w+)" makes (\d+) activations?, (?:each )?ending its first turn without a tool call$/,
  function (this: Context, worker: string, activations: string) {
    scriptActivations(this, worker, Number(activations), () => [{ text: "Nothing to do.", delayMs: 0 }]);
  },
);

Given("the other workers' scripted models end every turn without a tool call", function (this: Context) {
  for (const worker of WORKERS) if (!this.models.has(worker)) idle(this, worker);
});

Then(
  'worker {string}\'s system prompt holds the texts of "identity.md" and "world-rules.md", and not the text of "task.md"',
  function (this: Context, worker: string) {
    const prompt = promptOf(this, worker);
    assert.ok(prompt.includes(textOf(this, "identity.md").replaceAll("{name}", worker)), prompt);
    assert.ok(prompt.includes(textOf(this, "world-rules.md")), prompt);
    assert.ok(!prompt.includes(textOf(this, "task.md")), prompt);
  },
);

/** A worker's stimulus lines in the run's log, in the order delivered. */
function stimuliOf(context: Context, worker: string) {
  return logLines(context).filter((line) => line.type === "stimulus" && line.agent === worker) as unknown as { channel: string; source: string; content: string }[];
}

Then(
  'worker {string}\'s first activation received, right after its rhythm\'s stimulus, the text of "task.md" from {string} on the channel {string}',
  function (this: Context, worker: string, source: string, channel: string) {
    const [first, second] = stimuliOf(this, worker);
    assert.equal(first?.channel, "rhythm", `worker "${worker}"'s first stimulus: ${JSON.stringify(first)}`);
    assert.deepEqual({ ...second }, { ...second, channel, source, content: textOf(this, "task.md") });
  },
);

Then("its second activation received nothing on the channel {string}", function (this: Context, channel: string) {
  const stimuli = stimuliOf(this, "Dal");
  const rhythms = stimuli.flatMap((stimulus, index) => (stimulus.channel === "rhythm" ? [index] : []));
  assert.equal(rhythms.length, 2, `worker "Dal" woke ${rhythms.length} times`);
  assert.deepEqual(stimuli.slice(rhythms[1]).filter((stimulus) => stimulus.channel === channel), []);
});

Then("worker {string} received nothing on the channel {string}", function (this: Context, worker: string, channel: string) {
  const stimuli = stimuliOf(this, worker);
  assert.ok(stimuli.length > 0, `worker "${worker}" received no stimulus at all`);
  assert.deepEqual(stimuli.filter((stimulus) => stimulus.channel === channel), []);
});

/** The listing orders a load drew: the pile's kinds, the workers and the modules. */
function ordersOf(loaded: LoadedScenario<Workshop>) {
  const { kinds, workers, modules } = loaded.world.state.orders;
  return { kinds: [...kinds], workers: [...workers], modules: [...modules] };
}

Then("the order of the pile's kinds, the order of the workers and the order of the modules are the same both times", function (this: Context) {
  const [first, second] = this.libraryLoads as LoadedScenario<Workshop>[];
  assert.ok(second !== undefined, "the workshop was not loaded twice");
  assert.deepEqual(ordersOf(second), ordersOf(first));
});

Then("over the seeds {int} to {int}, the order of the workers is not always the same, nor the order of the kinds, nor the order of the modules", function (this: Context, from: number, to: number) {
  const drawn = Array.from({ length: to - from + 1 }, (_, index) => ordersOf(loadScenario(this.libraryScenario, from + index) as LoadedScenario<Workshop>));
  for (const list of ["workers", "kinds", "modules"] as const) {
    const distinct = new Set(drawn.map((orders) => orders[list].join(",")));
    assert.ok(distinct.size > 1, `the order of the ${list} is always ${[...distinct][0]}`);
  }
});

Then("the order of the pile's kinds is the same both times, and so is the order of the modules", function (this: Context) {
  const [base, changed] = this.libraryLoads as LoadedScenario<Workshop>[];
  assert.ok(changed !== undefined, "the workshop was not loaded twice");
  assert.deepEqual(ordersOf(changed).kinds, ordersOf(base).kinds);
  assert.deepEqual(ordersOf(changed).modules, ordersOf(base).modules);
});

Then("under the condition {string} the agents are {string}, {string} and {string}", function (this: Context, name: string, a: string, b: string, c: string) {
  assert.equal(this.condition?.name, name);
  assert.deepEqual([...loadedWorkshop(this).systemPrompts.keys()], [a, b, c]);
  assert.deepEqual(ordersOf(loadedWorkshop(this)).workers.sort(), [a, b, c].sort());
});

Then("every interval each worker's rhythm draws is from {int} to {int} milliseconds", function (this: Context, minMs: number, maxMs: number) {
  const loaded = lastLoaded(this);
  assert.deepEqual([...loaded.rhythms.keys()], WORKERS);
  assertRhythmWithin(this, WORKERS, minMs, maxMs);
});

Then("worker {string}'s intervals are the same as under the condition {string}, which leaves out {string}", function (this: Context, worker: string, name: string, left: string) {
  const base = lastLoaded(this);
  const condition = { name, change: stringify({ workers: WORKERS.filter((each) => each !== left) }) };
  const changed = loadScenario(this.libraryScenario, 42, condition);
  assert.ok(!changed.rhythms.has(left), `worker "${left}" is still an agent under the condition "${name}"`);
  // Each worker draws from its own sequence, by the seed and its name, as the run gives it.
  const draws = (loaded: LoadedScenario<unknown>) => {
    const rhythm = loaded.rhythms.get(worker);
    assert.ok(rhythm !== undefined, `worker "${worker}" has no rhythm`);
    const random = Random.derive(42, `rhythm of ${worker}`);
    return Array.from({ length: 20 }, () => rhythm(random));
  };
  assert.deepEqual(draws(changed), draws(base));
});

// FR-WORKSHOP-02: the workers' tools.

Given(
  "the workshop scenario with its base configuration, but the calendar's scale is {int}, so one world minute is {int} milliseconds of the run",
  function (this: Context, scale: number, minuteMs: number) {
    setUpWorkshop(this);
    setScale(this, scale, minuteMs);
  },
);

/** Sets the calendar's one segment's scale, which must make a world minute the run milliseconds the contract says. */
function setScale(context: Context, scale: number, minuteMs: number): void {
  assert.equal(60_000 / scale, minuteMs, `at scale ${scale}, a world minute is not ${minuteMs} ms of the run`);
  changeWorkshop(context, (configuration) => ((configuration.calendar as TomlTable).segments = [{ scale }]));
}

Given("the calendar's scale is {int}, so one world minute is {int} milliseconds of the run", function (this: Context, scale: number, minuteMs: number) {
  setScale(this, scale, minuteMs);
});

Given('the rhythm\'s "min_ms" and "max_ms" are {int}', function (this: Context, ms: number) {
  changeWorkshop(this, (configuration) => Object.assign(configuration.rhythm as TomlTable, { min_ms: ms, max_ms: ms }));
});

Given("the replica's draw lists the kinds as {string}, the workers as {string} and the modules as {string}", function (this: Context, kinds: string, workers: string, modules: string) {
  const list = (written: string) => written.split(", ");
  workshopSetupOf(this).changes.push((state) => {
    // The orders the seed could draw: the same names, in another order.
    assert.deepEqual([...list(kinds)].sort(), [...state.orders.kinds].sort());
    assert.deepEqual([...list(workers)].sort(), [...state.orders.workers].sort());
    assert.deepEqual([...list(modules)].sort(), [...state.orders.modules].sort());
    return { ...state, orders: { kinds: list(kinds), workers: list(workers), modules: list(modules) } };
  });
});

Given("every worker whose turns are not given ends every turn without a tool call", function (this: Context) {
  workshopSetupOf(this).othersIdle = true;
});

/** The texts of each effector's outcomes (FR-WORKSHOP-02, FR-WORKSHOP-03, FR-WORKSHOP-05). */
const EFFECTOR_TEXTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  take: { success: "You are holding it.", none_left: "The pile has no piece of that kind; you have taken nothing.", hands_full: "Your hands are full; you have taken nothing." },
  put_back: { success: "You have put it back on the pile.", not_held: "You hold no loose piece of that kind; nothing has moved." },
  join: {
    success: "You have joined it.",
    not_held: "You hold no loose piece of that kind; nothing has been joined.",
    not_needed: "That module needs no more pieces of that kind; nothing has been joined.",
    other_module: "You are holding a module of another name; nothing has been joined.",
  },
  take_apart: { success: "You have taken your module apart; its pieces are back on the pile.", no_module: "You are holding no module; nothing has changed." },
  mount: {
    success: "You have mounted your module on the device.",
    bench_full: "Every place at the bench was taken; you have mounted nothing.",
    no_module: "You are holding no module; you have mounted nothing.",
    not_finished: "Your module is not finished; you have mounted nothing.",
    out_of_order: "A module yours must be mounted after is not mounted yet; you have mounted nothing.",
    already_mounted: "A module of that name is already mounted; you have mounted nothing.",
  },
  wait: { success: "You have waited.", interrupted: "Something reached you; you stopped waiting." },
  say: { success: "You have said it.", empty_text: "You said nothing; nobody heard anything." },
  hand: {
    success: "You have handed it over.",
    no_such_worker: "There is no worker of that name; nothing has been handed.",
    to_self: "That is you; nothing has been handed.",
    not_held: "You are not holding that; nothing has been handed.",
    hands_full: "Their hands are full; nothing has been handed.",
    holds_module: "They are already holding a module; nothing has been handed.",
  },
};

/** The inventory's part on one tool, in the base condition. */
function toolListed(context: Context, tool: string): string {
  return under(under(under(context.labOutput ?? "", '## Condition "base"'), "### Tools"), `#### Tool "${tool}"`);
}

Then(
  'each worker\'s tools are "look", "read_plan", "take", "put_back", "join", "take_apart", "mount" and "wait", each with its duration in world minutes and its texts',
  function (this: Context) {
    const names = ["look", "read_plan", "take", "put_back", "join", "take_apart", "mount", "wait"];
    const tools = under(under(this.labOutput ?? "", '## Condition "base"'), "### Tools");
    // These, in this order, before any tool a later FR adds (FR-WORKSHOP-03's "say").
    const listed = tools.split("\n").filter((line) => line.startsWith("#### Tool "));
    assert.deepEqual(listed.slice(0, names.length), names.map((name) => `#### Tool "${name}"`));
    for (const name of names) assertToolListed(this, name);
  },
);

/** Checks that the inventory lists a tool with its duration in world minutes and, for an effector, the text of each outcome. */
function assertToolListed(context: Context, name: string): void {
  const listed = toolListed(context, name);
  const duration = listed.split("\n").find((line) => line.startsWith("- Duration: ")) ?? "";
  assert.ok(duration.includes("world minutes"), `the duration of "${name}" is not in world minutes: ${duration}`);
  for (const [outcome, text] of Object.entries(EFFECTOR_TEXTS[name] ?? {})) {
    assert.ok(listed.includes(`- ${outcome}: ${text}`), `the inventory does not give "${name}"'s text for "${outcome}":\n${listed}`);
  }
}

Then(
  'no tool\'s description or parameters hold any of "arn", "bex", "cal", "dov", "eln", "fim", "gor", "tessa", "ulm", "vorn", "wick", "yarl" or "zeth"',
  function (this: Context) {
    const tools = under(under(this.labOutput ?? "", '## Condition "base"'), "### Tools");
    for (const word of ["arn", "bex", "cal", "dov", "eln", "fim", "gor", "tessa", "ulm", "vorn", "wick", "yarl", "zeth"]) {
      assert.ok(!new RegExp(`\\b${word}\\b`).test(tools), `the tools name "${word}":\n${tools}`);
    }
  },
);

/** What a step says workers hold and what is mounted: each worker's loose pieces and module, where it says them. */
interface Holdings {
  mounted: string[];
  notMounted: string[];
  /** Whether the step says the pile is as it was before the call it speaks of. */
  pileAsBefore?: boolean;
  /**
   * What each worker it names holds: loose "as before" when the step says the worker keeps its loose pieces, and a
   * module "not finished" when the step says so.
   */
  workers: { worker: string; loose?: string[] | "as before"; module?: { name: string; joined?: string[]; finished: boolean; notFinished?: boolean } | null }[];
}

/** The quoted words of a text, in order. */
function quoted(text: string): string[] {
  return [...text.matchAll(/"(\w+)"/g)].map(([, word]) => word);
}

/** Reads what a step says workers hold and what is mounted. */
function holdingsOf(written: string): Holdings {
  let text = written.replace(/^with /, "");
  const holdings: Holdings = { mounted: [], notMounted: [], workers: [] };
  const mounted = /^((?:"\w+"(?:, | and )?)+) (?:is|are) mounted,? (?:and )?/.exec(text);
  if (mounted !== null) {
    holdings.mounted = quoted(mounted[1]);
    text = text.slice(mounted[0].length);
  }
  text = text.replace(/,? (?:and )?(?:the pile holds the rest|the rest in the pile)$/, "").replace(/, so the pile holds one$/, "");
  const pileAsBefore = /,? and the pile is as it was before it$/.exec(text);
  if (pileAsBefore !== null) {
    holdings.pileAsBefore = true;
    text = text.slice(0, pileAsBefore.index);
  }
  const notMounted = /,? and "(\w+)" is not mounted$/.exec(text);
  if (notMounted !== null) {
    holdings.notMounted.push(notMounted[1]);
    text = text.slice(0, notMounted.index);
  }
  if (text === "nobody holds anything") return holdings;
  const mentions = [...text.matchAll(/"(\w+)" (?:holds|holding) /g)];
  assert.ok(mentions.length > 0 && mentions[0].index === 0, `the steps do not read who holds what in: ${written}`);
  mentions.forEach((mention, index) => {
    const end = mentions[index + 1]?.index ?? text.length;
    const said = text.slice(mention.index + mention[0].length, end).replace(/(?:,? and |, )$/, "");
    holdings.workers.push({ worker: mention[1], ...handsOf(said) });
  });
  return holdings;
}

/** What one worker holds, as a step says it after "holds". */
function handsOf(said: string): Omit<Holdings["workers"][number], "worker"> {
  if (said === "nothing") return { loose: [], module: null };
  const module = /(?:a|another) (finished )?module "(\w+)"(?: with (.+?) joined)?(, not finished)?/.exec(said);
  const rest = module === null ? said : said.slice(0, module.index) + said.slice(module.index + module[0].length);
  if (/^,? and its \w+ loose pieces$/.test(rest)) return { loose: "as before", ...(module === null ? {} : { module: moduleSaid(module) }) };
  const both = /both "(\w+)"/.exec(rest);
  const loose = both === null ? quoted(rest) : [both[1], both[1]];
  const hands: Omit<Holdings["workers"][number], "worker"> = loose.length > 0 || /loose/.test(rest) ? { loose } : {};
  if (module !== null) hands.module = moduleSaid(module);
  else if (/no module/.test(rest)) hands.module = null;
  return hands;
}

/** A module as a step says a worker holds it: its name, whether finished, the pieces joined, and "not finished". */
function moduleSaid(found: RegExpExecArray): NonNullable<Holdings["workers"][number]["module"]> {
  const [, finished, name, joined, notFinished] = found;
  return { name, finished: finished !== undefined, ...(joined === undefined ? {} : { joined: quoted(joined) }), ...(notFinished === undefined ? {} : { notFinished: true }) };
}

/** A count of each kind in a list of pieces. */
function counted(pieces: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const piece of pieces) counts[piece] = (counts[piece] ?? 0) + 1;
  return counts;
}

/** The workshop with what a step says workers hold and what is mounted, every piece of it taken from the pile. */
function withHoldings(state: Workshop, holdings: Holdings): Workshop {
  const taken: string[] = holdings.mounted.flatMap((name) => [...state.plan[name].recipe]);
  const workers = { ...state.workers };
  for (const { worker, loose, module } of holdings.workers) {
    assert.ok(Object.hasOwn(workers, worker), `the workshop has no worker "${worker}"`);
    assert.ok(loose !== "as before", `a setup cannot say "${worker}" keeps its loose pieces`);
    const held = module == null ? null : { name: module.name, joined: module.joined ?? (module.finished ? [...state.plan[module.name].recipe] : []) };
    workers[worker] = { ...workers[worker], ...(loose === undefined ? {} : { loose: counted(loose) }), ...(module === undefined ? {} : { module: held }) };
    taken.push(...(loose ?? []), ...(held?.joined ?? []));
  }
  const pile = { ...state.pile };
  for (const piece of taken) {
    pile[piece] = (pile[piece] ?? 0) - 1;
    assert.ok(pile[piece] >= 0, `the workshop has not enough "${piece}" for what the step says is held and mounted`);
  }
  for (const name of holdings.notMounted) assert.ok(!state.bench.mounted.includes(name), `"${name}" is mounted`);
  return { ...state, pile, workers, bench: { ...state.bench, mounted: [...state.bench.mounted, ...holdings.mounted] } };
}

/** The workshop's state now: as the run left it, or as the engine loaded it. */
function workshopNow(context: Context): Workshop {
  return loadedWorkshop(context).world.state;
}

/**
 * Checks that the workshop holds what a step says: the modules mounted, what each worker it names holds and, when the
 * step says so, the pile as it was before.
 */
function assertHoldings(state: Workshop, holdings: Holdings, before: Workshop): void {
  for (const name of holdings.mounted) assert.ok(state.bench.mounted.includes(name), `"${name}" is not mounted: ${JSON.stringify(state.bench.mounted)}`);
  for (const name of holdings.notMounted) assert.ok(!state.bench.mounted.includes(name), `"${name}" is mounted`);
  if (holdings.pileAsBefore === true) assert.deepEqual(state.pile, before.pile, "the pile");
  for (const { worker, loose, module } of holdings.workers) {
    const hands = state.workers[worker];
    if (loose === "as before") assert.deepEqual({ ...hands.loose }, { ...before.workers[worker].loose }, `"${worker}"'s loose pieces`);
    else if (loose !== undefined) assert.deepEqual({ ...hands.loose }, counted(loose), `"${worker}"'s loose pieces`);
    if (module === null) assert.equal(hands.module, null, `"${worker}" holds a module`);
    else if (module !== undefined) {
      assert.equal(hands.module?.name, module.name, `"${worker}" holds no module "${module.name}"`);
      if (module.joined !== undefined) assert.deepEqual(hands.module?.joined, module.joined, `the pieces joined into "${worker}"'s module`);
      if (module.notFinished === true) assert.ok(!isFinished(state, hands.module as NonNullable<Workshop["workers"][string]["module"]>), `"${worker}"'s module is finished`);
    }
  }
}

/** Whether every piece of a module's recipe is joined into it, in any order. */
function isFinished(state: Workshop, module: { name: string; joined: readonly string[] }): boolean {
  return [...module.joined].sort().join() === [...state.plan[module.name].recipe].sort().join();
}

// The contract says who holds what both to set up the workshop, as a Given, and to check it, as a Then.
Given(
  /^(nobody holds anything|(?:(?:"\w+"(?:, | and )?)+ (?:is|are) mounted, (?:and )?)?"\w+" holds (?:the loose|a |another |both |five |six |one "|no module|nothing(?=$|, "\w+" holds )).*)$/,
  function (this: Context, written: string) {
    const holdings = holdingsOf(written);
    if (this.checking) assertHoldings(workshopNow(this), holdings, this.stateBefore as Workshop);
    else workshopSetupOf(this).changes.push((state) => withHoldings(state, holdings));
  },
);

Given(/^the workshop starts (with .+|as its base configuration gives it)$/, function (this: Context, written: string) {
  if (written === "as its base configuration gives it") return;
  const holdings = holdingsOf(written);
  workshopSetupOf(this).changes.push((state) => withHoldings(state, holdings));
});

/** Reads a quoted text of a step, as the feature file writes it: "\n" is a new line. */
function unquoted(text: string): string {
  return text.replace(/\\(.)/g, (_, escaped: string) => (escaped === "n" ? "\n" : escaped));
}

/** A text in quotes, which may hold commas and escaped characters. */
const QUOTED = String.raw`"((?:[^"\\]|\\.)*)"`;

/** Reads the turns a step scripts for a worker: each call with its arguments and the delay before it, then the end. */
function turnsOf(written: string): ScriptedAnswer[] {
  const answers: ScriptedAnswer[] = [];
  let rest = written;
  const take = (pattern: string): RegExpExecArray | null => {
    const found = new RegExp(`^(?:${pattern})`).exec(rest);
    if (found !== null) rest = rest.slice(found[0].length);
    return found;
  };
  for (;;) {
    take("call ");
    const tool = take(`"(\\w+)"`);
    assert.ok(tool !== null, `the steps do not read the turns "${written}" at "${rest}"`);
    const name = tool[1];
    let args: Record<string, unknown> = {};
    let found: RegExpExecArray | null;
    if ((found = take(` with the module "(\\w+)" and the kind "(\\w+)"`)) !== null) args = { module: found[1], kind: found[2] };
    else if ((found = take(` with "(\\w+)" to "(\\w+)"`)) !== null) args = { worker: found[2], what: found[1] };
    else if ((found = take(` with the text of \\d+ words, ${QUOTED}`)) !== null) args = { text: unquoted(found[1]) };
    else if ((found = take(` with the text ${QUOTED}`)) !== null) args = { text: unquoted(found[1]) };
    else if ((found = take(` with (-?[\\d.]+) minutes`)) !== null) args = { minutes: Number(found[1]) };
    else if ((found = take(` with ${QUOTED}`)) !== null) args = name === "say" ? { text: unquoted(found[1]) } : { kind: found[1] };
    const delay = take(`,? at once|,? after (\\d+) milliseconds`);
    answers.push({ toolCalls: [{ name, arguments: args as JsonObject }], delayMs: Number(delay?.[1] ?? 0) });
    if (take(`, then end$|, then the text "Done\\." with no tool call$`) !== null) break;
    assert.ok(take(`, then |, `) !== null, `the steps do not read the turns "${written}" at "${rest}"`);
  }
  answers.push({ text: "Done.", delayMs: 0 });
  return answers;
}

/**
 * Gives a worker the turns a step scripts: "… scripted turns call …" is the mail's step, which hands the workshop's turns
 * here (FR-WORKSHOP-02).
 */
export function scriptWorkshopTurns(context: Context, worker: string, written: string): void {
  script(context, worker, turnsOf(written));
  context.lastAgent = worker;
}

/** Each call of a worker, in the order it made them. */
function callsOfWorker(context: Context, worker: string): ToolCall[] {
  assert.ok(context.toolCalls !== undefined, "the workers did not run");
  return context.toolCalls.filter((call) => call.agent === worker);
}

/** A worker's calls of a tool, in order; the one a step names becomes the call the next step speaks of. */
function callsOfTool(context: Context, worker: string, tool: string): ToolCall[] {
  return callsOfWorker(context, worker).filter((call) => call.tool === tool);
}

/** A worker's only call of a tool, or its nth, which becomes the call the next step speaks of. */
function callOfWorker(context: Context, worker: string, tool: string, nth?: number): ToolCall {
  const calls = callsOfTool(context, worker, tool);
  if (nth === undefined) assert.equal(calls.length, 1, `"${worker}" made ${calls.length} "${tool}" calls`);
  const call = calls[nth ?? 0];
  assert.ok(call !== undefined, `"${worker}" made no such "${tool}" call`);
  context.lastToolCall = call;
  return call;
}

/** The only call of a tool any worker made, which becomes the call the next step speaks of. */
function onlyCallOf(context: Context, tool: string): ToolCall {
  assert.ok(context.toolCalls !== undefined, "the workers did not run");
  const calls = context.toolCalls.filter((call) => call.tool === tool);
  assert.equal(calls.length, 1, `the workers made ${calls.length} "${tool}" calls`);
  context.lastToolCall = calls[0];
  return calls[0];
}

/**
 * The call a step that says "the call" or "it" speaks of: the one a step named last, or else the last call of the worker
 * whose turns the scenario gave last.
 */
export function workshopCall(context: Context): ToolCall {
  if (context.lastToolCall !== undefined) return context.lastToolCall;
  assert.ok(context.lastAgent !== undefined, "no worker's turns were given");
  const last = callsOfWorker(context, context.lastAgent).at(-1);
  assert.ok(last !== undefined, `"${context.lastAgent}" made no call`);
  context.lastToolCall = last;
  return last;
}

/** A call's duration, in milliseconds of the run. */
function tookMs(call: ToolCall): number {
  return call.endedAtMs - call.startedAtMs;
}

/** Checks that a call took at least the least and less than the most, in milliseconds of the run. */
function assertTook(call: ToolCall, leastMs: number, belowMs: number): void {
  const took = tookMs(call);
  assert.ok(took >= leastMs && took < belowMs, `the "${call.tool}" call took ${took} ms, not at least ${leastMs} and less than ${belowMs}`);
}

/** A sensor call's result, as JSON, re-written with its keys in order, so two results compare key order too. */
function jsonText(text: string | undefined): string {
  assert.ok(text !== undefined, "the call gave no result");
  return JSON.stringify(JSON.parse(text));
}

Then("{string}'s {string} result is this JSON:", function (this: Context, worker: string, tool: string, json: string) {
  assert.equal(jsonText(callOfWorker(this, worker, tool).result), jsonText(json));
});

Then("its result is this JSON:", function (this: Context, json: string) {
  assert.equal(jsonText(workshopCall(this).result), jsonText(json));
});

/** What a look showed, parsed. */
interface Looked {
  clock: number;
  pile: Record<string, number>;
  bench: { mounted: string[]; places: (string | null)[] };
  workers: { name: string; loose: Record<string, number>; module: { name: string; joined: string[]; finished: boolean } | null; doing: string }[];
}

/** A worker's nth look, or its only one, parsed. */
function lookOf(context: Context, worker: string, nth?: number): Looked {
  return JSON.parse(callOfWorker(context, worker, "look", nth).result ?? "null") as Looked;
}

/** A worker as a look showed it. */
function shownIn(looked: Looked, worker: string): Looked["workers"][number] {
  const shown = looked.workers.find(({ name }) => name === worker);
  assert.ok(shown !== undefined, `the look shows no worker "${worker}"`);
  return shown;
}

/** A place as a step names it: a worker's name in quotes, or null. */
function placeOf(written: string): string | null {
  return written === "null" ? null : JSON.parse(written);
}

Then(
  /^"(\w+)"'s (first|second) "look" shows the bench places as ("\w+"|null) and ("\w+"|null), (nothing|"\w+") mounted, and "(\w+)" doing "([\w ]+)" with (?:the module "(\w+)"|no module)$/,
  function (this: Context, worker: string, nth: string, first: string, second: string, mounted: string, other: string, doing: string, module?: string) {
    const looked = lookOf(this, worker, nth === "first" ? 0 : 1);
    assert.deepEqual(looked.bench.places, [placeOf(first), placeOf(second)]);
    assert.deepEqual(looked.bench.mounted, mounted === "nothing" ? [] : [JSON.parse(mounted)]);
    const shown = shownIn(looked, other);
    assert.equal(shown.doing, doing);
    assert.equal(shown.module?.name ?? null, module ?? null);
  },
);

Then("the {string} call took at least {int} milliseconds and less than {int}", function (this: Context, tool: string, leastMs: number, belowMs: number) {
  assertTook(onlyCallOf(this, tool), leastMs, belowMs);
});

Then("every call of {string} succeeded, with the texts {string}, {string} and {string}", function (this: Context, worker: string, a: string, b: string, c: string) {
  const calls = callsOfWorker(this, worker);
  assert.deepEqual(calls.map(({ outcome }) => outcome), calls.map(() => "success"));
  assert.deepEqual(calls.map(({ text }) => text), [a, b, c]);
});

Then(
  'the "take" call took at least {int} milliseconds and less than {int}, the "join" call at least {int} and less than {int}, and the "mount" call at least {int} and less than {int}',
  function (this: Context, takeLeast: number, takeBelow: number, joinLeast: number, joinBelow: number, mountLeast: number, mountBelow: number) {
    assertTook(onlyCallOf(this, "take"), takeLeast, takeBelow);
    assertTook(onlyCallOf(this, "join"), joinLeast, joinBelow);
    assertTook(onlyCallOf(this, "mount"), mountLeast, mountBelow);
  },
);

Then("{string} is mounted, {string} holds nothing, and the pile holds {int} {string}", function (this: Context, module: string, worker: string, count: number, kind: string) {
  const state = workshopNow(this);
  assert.ok(state.bench.mounted.includes(module), `"${module}" is not mounted`);
  assert.deepEqual(state.workers[worker], { ...state.workers[worker], loose: {}, module: null });
  assert.equal(state.pile[kind], count);
});

Then(
  'every call of {string} succeeded, the "put_back" with the text {string} and the "take_apart" with the text {string}',
  function (this: Context, worker: string, putBack: string, takeApart: string) {
    const calls = callsOfWorker(this, worker);
    assert.deepEqual(calls.map(({ outcome }) => outcome), calls.map(() => "success"));
    assert.equal(callOfWorker(this, worker, "put_back").text, putBack);
    assert.equal(callOfWorker(this, worker, "take_apart").text, takeApart);
  },
);

/** The workshop's state at a moment of the run, by performance.now(): the effects the arbiter applied until then, replayed. */
function stateAt(context: Context, atMs: number): Workshop {
  return context.applied.filter((applied) => applied.atMs <= atMs).reduce((state, { action, args }) => (action as never as { effect: (s: Workshop, a: unknown) => Workshop }).effect(state, args), context.stateBefore as Workshop);
}

Then(
  'after the "join" call {string} held a module {string} with {string} joined, not finished',
  function (this: Context, worker: string, module: string, kind: string) {
    const join = callOfWorker(this, worker, "join");
    assert.deepEqual(stateAt(this, join.endedAtMs).workers[worker].module, { name: module, joined: [kind] });
    const finished = [...workshopNow(this).plan[module].recipe].sort().join() === kind;
    assert.equal(finished, false);
  },
);

Then("at the end {string} holds nothing and the pile holds its starting stock", function (this: Context, worker: string) {
  const state = workshopNow(this);
  assert.deepEqual({ loose: state.workers[worker].loose, module: state.workers[worker].module }, { loose: {}, module: null });
  assert.deepEqual(state.pile, (this.stateBefore as Workshop).pile);
});

Then("it took at least {int} milliseconds and less than {int} + {int}", function (this: Context, leastMs: number, base: number, more: number) {
  assertTook(workshopCall(this), leastMs, base + more);
});

Then("it took at least {int} milliseconds and less than {int}", function (this: Context, leastMs: number, belowMs: number) {
  assertTook(workshopCall(this), leastMs, belowMs);
});

/** The pile, the bench and what each worker holds: the world but for what each worker is doing. */
function heldIn(state: Workshop) {
  return { pile: state.pile, bench: state.bench, hands: Object.fromEntries(Object.entries(state.workers).map(([name, { loose, module }]) => [name, { loose, module }])) };
}

Then("the pile, the bench and every worker's hands are as they were before it", function (this: Context) {
  assert.deepEqual(heldIn(workshopNow(this)), heldIn(this.stateBefore as Workshop));
});

Then("{string}'s {string} call succeeded", function (this: Context, worker: string, tool: string) {
  assert.equal(callOfWorker(this, worker, tool).outcome, "success");
});

Then(
  "{string}'s {string} call failed with {string}, and recorded its target as {string} and {int} change since sensing, applied by {string}",
  function (this: Context, worker: string, tool: string, outcome: string, target: string, changes: number, by: string) {
    const call = callOfWorker(this, worker, tool);
    assert.deepEqual(
      { outcome: call.outcome, targetAsSensed: call.targetAsSensed, changesSinceSensing: call.changesSinceSensing, changesSinceSensingBy: call.changesSinceSensingBy },
      { outcome, targetAsSensed: target, changesSinceSensing: changes, changesSinceSensingBy: [by] },
    );
  },
);

Then('{string} holds no {string}', function (this: Context, worker: string, kind: string) {
  assert.equal(workshopNow(this).workers[worker].loose[kind] ?? 0, 0);
});

Then("{string}'s {string} call failed with {string} and the text {string}", function (this: Context, worker: string, tool: string, outcome: string, text: string) {
  const call = callOfWorker(this, worker, tool);
  assert.deepEqual({ outcome: call.outcome, text: call.text }, { outcome, text });
});

Then("{string}'s {string} shows the bench places as {string} and {string}, and {string} doing {string}", function (this: Context, worker: string, tool: string, first: string, second: string, other: string, doing: string) {
  assert.equal(tool, "look");
  const looked = lookOf(this, worker);
  assert.deepEqual(looked.bench.places, [first, second]);
  assert.equal(shownIn(looked, other).doing, doing);
});

Then(
  "{string}'s and {string}'s {string} calls succeeded, {string} still holds {string}, and {string} and {string} are mounted",
  function (this: Context, one: string, other: string, tool: string, holder: string, module: string, first: string, second: string) {
    for (const worker of [one, other]) assert.equal(callOfWorker(this, worker, tool).outcome, "success", `"${worker}"'s "${tool}" call`);
    const state = workshopNow(this);
    assert.equal(state.workers[holder].module?.name, module);
    assert.deepEqual([...state.bench.mounted].sort(), [first, second].sort());
  },
);

Then("at the end both bench places are free", function (this: Context) {
  assert.deepEqual(workshopNow(this).bench.places, [null, null]);
});

Then("{string}'s {string} shows {string} doing {string}", function (this: Context, worker: string, tool: string, other: string, doing: string) {
  assert.equal(tool, "look");
  assert.equal(shownIn(lookOf(this, worker), other).doing, doing);
});

Then("no worker's hands, the pile or the bench changed during it", function (this: Context) {
  const call = workshopCall(this);
  assert.deepEqual(heldIn(stateAt(this, call.endedAtMs)), heldIn(stateAt(this, call.startedAtMs)));
  assert.deepEqual(heldIn(workshopNow(this)), heldIn(this.stateBefore as Workshop));
});

Then("the {string} call has the outcome {string}", function (this: Context, tool: string, outcome: string) {
  assert.equal(onlyCallOf(this, tool).outcome, outcome);
});

Then("the log has a tool call line for each of {string}'s calls, with its outcome and the text {string} received", function (this: Context, worker: string, receiver: string) {
  assert.equal(worker, receiver);
  const lines = logLines(this).filter((line) => line.type === "tool_call" && line.agent === worker);
  const calls = callsOfWorker(this, worker);
  assert.ok(calls.length > 0, `"${worker}" made no call`);
  // The last turn's transcript holds every earlier call's result, in order.
  const received = (modelOf(this, worker).received.at(-1) ?? []).flatMap((message) =>
    message.role === "toolResult" ? [message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")] : [],
  );
  assert.deepEqual(
    lines.map((line) => ({ tool: line.tool, outcome: line.outcome, text: line.text })),
    calls.map((call, index) => ({ tool: call.tool, outcome: call.outcome, text: received[index] })),
  );
});

Then(
  'it has an "effector_start" line for each, the first naming that {string} began taking, the second that {string} began mounting and the bench place it occupies',
  function (this: Context, taker: string, mounter: string) {
    const starts = logLines(this).filter((line) => line.type === "effector_start");
    assert.deepEqual(
      starts.map((line) => ({ agent: line.agent, tool: line.tool, change: line.change })),
      [
        { agent: taker, tool: "take", change: { began: "taking" } },
        { agent: mounter, tool: "mount", change: { began: "mounting", place: 1 } },
      ],
    );
  },
);

// FR-WORKSHOP-03: workers speak to the room.

Given(
  "{string}, {string} and {string} each run on scripted models whose turns are: the text {string} with no tool call, after {int} milliseconds; the text {string} with no tool call",
  function (this: Context, a: string, b: string, c: string, text: string, delayMs: number, then: string) {
    // A turn without a tool call ends its activation, so each turn is one activation.
    const turns = [
      { text, delayMs },
      { text: then, delayMs: 0 },
    ];
    for (const worker of [a, b, c]) scriptActivations(this, worker, turns.length, (index) => [turns[index]]);
  },
);

/** The texts of the user messages a worker's nth model turn received, from 0. */
function receivedIn(context: Context, worker: string, turn: number): string[] {
  const messages = modelOf(context, worker).received[turn];
  assert.ok(messages !== undefined, `"${worker}" made no model turn ${turn + 1}`);
  return userTexts(messages);
}

Then(
  "{string}'s, {string}'s and {string}'s second model turns each received {string} from {string}, which the worker reads as {string}",
  function (this: Context, a: string, b: string, c: string, content: string, source: string, read: string) {
    assert.equal(asRead(source, content), read);
    for (const worker of [a, b, c]) assert.ok(receivedIn(this, worker, 1).includes(read), `"${worker}"'s second model turn received ${JSON.stringify(receivedIn(this, worker, 1))}`);
  },
);

Then("{string}'s second model turn received {string} from {string}", function (this: Context, worker: string, content: string, source: string) {
  assert.ok(receivedIn(this, worker, 1).includes(asRead(source, content)), `"${worker}"'s second model turn received ${JSON.stringify(receivedIn(this, worker, 1))}`);
});

Then("{string} received nothing on the channel {string}", function (this: Context, worker: string, channel: string) {
  assert.ok(this.toolCalls !== undefined, "the workers did not run");
  assert.deepEqual(stimuliOf(this, worker).filter((stimulus) => stimulus.channel === channel), []);
});

/** The stimulus lines of a channel in the run's log, with when each was delivered. */
function voiceLines(context: Context, channel: string) {
  return logLines(context).filter((line) => line.type === "stimulus" && line.channel === channel) as unknown as { agent: string; channel: string; source: string; content: string; deliveredAtMs: number }[];
}

Then(
  "the log has a stimulus line for each of {string}, {string} and {string}, with the channel {string}, the source {string} and the content {string}",
  function (this: Context, a: string, b: string, c: string, channel: string, source: string, content: string) {
    const lines = voiceLines(this, channel);
    assert.deepEqual(
      lines.map(({ agent, source: from, content: said }) => ({ agent, source: from, content: said })).sort((x, y) => x.agent.localeCompare(y.agent)),
      [a, b, c].sort().map((agent) => ({ agent, source, content })),
    );
  },
);

Then('each was delivered no earlier than the end of the "say" call, and within {int} milliseconds of it', function (this: Context, withinMs: number) {
  const { endedAtMs } = onlyCallOf(this, "say");
  const lines = voiceLines(this, "voice");
  assert.ok(lines.length > 0, "the log has no stimulus line on the channel voice");
  for (const { agent, deliveredAtMs } of lines) {
    const after = deliveredAtMs - endedAtMs;
    assert.ok(after >= 0 && after <= withinMs, `the speech reached "${agent}" ${after} ms after the call ended`);
  }
});

Then("the log has no stimulus line on the channel {string} for {string}", function (this: Context, channel: string, worker: string) {
  assert.deepEqual(voiceLines(this, channel).filter(({ agent }) => agent === worker), []);
});

Then("the {string} call took at least {int} milliseconds and less than {int} + {int}", function (this: Context, tool: string, leastMs: number, base: number, more: number) {
  assertTook(onlyCallOf(this, tool), leastMs, base + more);
});

Given(
  "{string}'s rhythm keeps it resting {int} milliseconds before each activation, and the others' {int}",
  function (this: Context, worker: string, restMs: number, othersMs: number) {
    // The Background's rhythm already gives the others theirs.
    assert.equal((workshopConfiguration(this).rhythm as TomlTable).max_ms, othersMs);
    workshopSetupOf(this).rests.set(worker, restMs);
  },
);

/** A worker's activation lines in the run's log, in order. */
function activationsOfWorker(context: Context, worker: string) {
  return logLines(context).filter((line) => line.type === "activation" && line.agent === worker) as unknown as { wokeAtMs: number }[];
}

Then(
  "{string} started an activation within {int} milliseconds after the {string} call ended, with {string} from {string} among its stimuli",
  function (this: Context, worker: string, withinMs: number, tool: string, content: string, source: string) {
    const { endedAtMs } = onlyCallOf(this, tool);
    const [first] = activationsOfWorker(this, worker);
    assert.ok(first !== undefined, `"${worker}" made no activation`);
    const after = first.wokeAtMs - endedAtMs;
    assert.ok(after >= 0 && after <= withinMs, `"${worker}"'s activation began ${after} ms after the call ended`);
    assert.ok(receivedIn(this, worker, 0).includes(asRead(source, content)), `"${worker}" woke to ${JSON.stringify(receivedIn(this, worker, 0))}`);
  },
);

Then("{string}'s {string} call ended with the outcome {string} and the text {string}", function (this: Context, worker: string, tool: string, outcome: string, text: string) {
  const call = callOfWorker(this, worker, tool);
  assert.deepEqual({ outcome: call.outcome, text: call.text }, { outcome, text });
});

Then("it ended within {int} milliseconds after the {string} call ended", function (this: Context, withinMs: number, tool: string) {
  const call = workshopCall(this);
  const other = onlyCallOf(this, tool);
  this.lastToolCall = call;
  const after = call.endedAtMs - other.endedAtMs;
  assert.ok(after >= 0 && after <= withinMs, `the "${call.tool}" call ended ${after} ms after the "${tool}" call`);
});

/** Whether a worker received a speech, by the log's stimulus lines. */
function heard(context: Context, worker: string, content: string, source: string): boolean {
  return voiceLines(context, "voice").some((line) => line.agent === worker && line.content === content && line.source === source);
}

Then(
  "{string} and {string} each received {string} from {string} and {string} from {string}",
  function (this: Context, a: string, b: string, first: string, firstSource: string, second: string, secondSource: string) {
    for (const worker of [a, b]) {
      assert.ok(heard(this, worker, first, firstSource), `"${worker}" did not hear "${first}" from "${firstSource}"`);
      assert.ok(heard(this, worker, second, secondSource), `"${worker}" did not hear "${second}" from "${secondSource}"`);
    }
  },
);

Then(
  "{string} received {string} from {string}, and {string} received {string} from {string}",
  function (this: Context, a: string, first: string, firstSource: string, b: string, second: string, secondSource: string) {
    assert.ok(heard(this, a, first, firstSource), `"${a}" did not hear "${first}" from "${firstSource}"`);
    assert.ok(heard(this, b, second, secondSource), `"${b}" did not hear "${second}" from "${secondSource}"`);
    assert.ok(!heard(this, a, second, secondSource) && !heard(this, b, first, firstSource), "a speaker heard itself");
  },
);

Then(
  'each worker\'s tools include "say", with its duration as {float} world minutes plus one minute per {int} words, and its texts',
  function (this: Context, minutes: number, words: number) {
    const listed = toolListed(this, "say");
    assert.ok(listed.includes(`- Duration: ${minutes} world minutes plus one minute per ${words} words.`), `the inventory lists "say" as:\n${listed}`);
    assertToolListed(this, "say");
  },
);

Then(
  "it lists the channel {string} with the source {string}, the text {string}, and that it wakes",
  function (this: Context, channel: string, source: string, text: string) {
    const listed = under(under(this.labOutput ?? "", '## Condition "base"'), `#### Channel "${channel}"`);
    assert.ok(listed.includes(`- Source: ${source}`), `the channel "${channel}":\n${listed}`);
    assert.ok(listed.includes("- Wakes: a resting agent at once"), `the channel "${channel}" is not listed as waking:\n${listed}`);
    assert.equal(fencedAfter(listed, "Delivers"), text);
  },
);

Then("the {string} call failed with {string} and the text {string}", function (this: Context, tool: string, outcome: string, text: string) {
  const call = onlyCallOf(this, tool);
  assert.deepEqual({ outcome: call.outcome, text: call.text }, { outcome, text });
});

// FR-WORKSHOP-04: done, and the workshop's measures.

/** The world minutes a call's run milliseconds span, at the workshop's one scale. */
function runMsPerMinute(context: Context): number {
  const [{ scale }] = (workshopConfiguration(context).calendar as { segments: { scale: number }[] }).segments;
  return 60_000 / scale;
}

Then('{string}\'s {string} call succeeded, and {string} made no model turn after it', function (this: Context, worker: string, tool: string, same: string) {
  assert.equal(worker, same);
  const call = callOfWorker(this, worker, tool);
  assert.equal(call.outcome, "success");
  const turns = logLines(this).filter((line) => line.type === "model_turn" && line.agent === worker) as unknown as { startedAtMs: number }[];
  const after = turns.filter(({ startedAtMs }) => startedAtMs >= call.endedAtMs);
  assert.deepEqual(after, [], `"${worker}" made ${after.length} model turns after its "${tool}" call`);
});

Then(
  "the log has a {string} line, giving as the moment the world was finished the end of {string}'s {string} call, within {int} milliseconds",
  function (this: Context, type: string, worker: string, tool: string, withinMs: number) {
    const lines = logLines(this).filter((line) => line.type === type) as unknown as { atMs: number }[];
    assert.equal(lines.length, 1, `the log has ${lines.length} "${type}" lines`);
    const { endedAtMs } = callOfWorker(this, worker, tool);
    assert.ok(Math.abs(lines[0].atMs - endedAtMs) <= withinMs, `the world was finished ${lines[0].atMs - endedAtMs} ms from the end of the call`);
  },
);

Then("{string}'s {string} call has the outcome {string}", function (this: Context, worker: string, tool: string, outcome: string) {
  assert.equal(callOfWorker(this, worker, tool).outcome, outcome);
});

/** The run's metric samples, in order. */
function samples(context: Context): Record<string, MetricValue>[] {
  const lines = logLines(context).filter((line) => line.type === "metric_sample") as unknown as { metrics: Record<string, MetricValue> }[];
  assert.ok(lines.length > 0, "the log has no metric sample");
  return lines.map(({ metrics }) => metrics);
}

/** The measures the scenario checks: the last sample's, the first's, or those computed from a record. */
function measuresOf(context: Context, which: "first" | "last"): Record<string, MetricValue> {
  const computed = measured.get(context);
  if (computed !== undefined) return computed;
  return which === "first" ? samples(context)[0] : (samples(context).at(-1) as Record<string, MetricValue>);
}

/** The measures computed from a record, for a scenario that gives one. */
const measured = new WeakMap<Context, Record<string, MetricValue>>();

Then(
  'the last metric sample gives "done" as {int}, "modules_mounted" as {int}, and "time_to_done" as {float}, within {float}',
  function (this: Context, done: number, mounted: number, time: number, within: number) {
    const last = measuresOf(this, "last");
    assert.deepEqual({ done: last.done, modules_mounted: last.modules_mounted }, { done, modules_mounted: mounted });
    assertNear(last.time_to_done, time, within, "time_to_done");
  },
);

/** Checks that a measure is a number near another. */
function assertNear(value: MetricValue | undefined, expected: number, within: number, name: string): void {
  assert.equal(typeof value, "number", `"${name}" is ${JSON.stringify(value)}`);
  assert.ok(Math.abs((value as number) - expected) <= within, `"${name}" is ${String(value)}, not ${expected} within ${within}`);
}

Then('the last metric sample gives "done" as {int}, "modules_mounted" as {int} and "time_to_done" as null', function (this: Context, done: number, mounted: number) {
  const last = measuresOf(this, "last");
  assert.deepEqual({ done: last.done, modules_mounted: last.modules_mounted, time_to_done: last.time_to_done }, { done, modules_mounted: mounted, time_to_done: null });
});


Then(
  'the first metric sample gives "done" {int}, "modules_mounted" {int}, "time_to_done" null, "effort_total" {int}, "pieces_wasted" {int}, "modules_taken_apart" {int}, "first_take_time" null, "joins_share_by_worker" null, "duplicated_modules" {int} and "bench_refusals" {int}',
  function (this: Context, done: number, mounted: number, effort: number, wasted: number, takenApart: number, duplicated: number, benchRefusals: number) {
    const [first] = samples(this);
    assert.deepEqual(
      Object.fromEntries(["done", "modules_mounted", "time_to_done", "effort_total", "pieces_wasted", "modules_taken_apart", "first_take_time", "joins_share_by_worker", "duplicated_modules", "bench_refusals"].map((name) => [name, first[name]])),
      { done, modules_mounted: mounted, time_to_done: null, effort_total: effort, pieces_wasted: wasted, modules_taken_apart: takenApart, first_take_time: null, joins_share_by_worker: null, duplicated_modules: duplicated, bench_refusals: benchRefusals },
    );
  },
);

Then('it gives "effort_by_worker" as {int} for each of {string}, {string}, {string} and {string}', function (this: Context, value: number, a: string, b: string, c: string, d: string) {
  assert.deepEqual({ ...(samples(this)[0].effort_by_worker as object) }, Object.fromEntries([a, b, c, d].map((worker) => [worker, value])));
});

Then('it gives "speech_before_first_take" as "calls" {int} and "words" {int}', function (this: Context, calls: number, words: number) {
  assert.deepEqual({ ...(samples(this)[0].speech_before_first_take as object) }, { calls, words });
});

/** A call of a record, as a row of its table gives it: times in world minutes. */
interface RecordRow {
  worker: string;
  start: string;
  end: string;
  tool: string;
  arguments: string;
  outcome: string;
}

/** A row's arguments, as the tool takes them. */
function rowArguments({ tool, arguments: written }: RecordRow): Record<string, unknown> {
  if (written === "") return {};
  if (tool === "join") {
    const [module, kind] = written.split(", ");
    return { module, kind };
  }
  if (tool === "say") return { text: written };
  if (tool === "wait") return { minutes: Number(written) };
  if (tool === "hand") {
    const [worker, what] = written.split(", ");
    return { worker, what };
  }
  return { kind: written };
}

Given("the record holds these calls:", function (this: Context, table: DataTable) {
  records.set(this, table.hashes() as unknown as RecordRow[]);
});

const records = new WeakMap<Context, RecordRow[]>();

/** Outcomes of calls the tool never ran: they change nothing and take no time. */
const UNRUN = ["invalid_arguments", "unknown_tool"];

When("the measures are computed", function (this: Context) {
  const rows = records.get(this);
  assert.ok(rows !== undefined, "the scenario gave no record");
  const loaded = loadWorkshop(this);
  const { scenario, calendar } = loaded;
  assert.ok(calendar !== undefined, "the workshop has no calendar");
  const msPerMinute = runMsPerMinute(this);
  const toolOf = (name: string) => {
    const tool = scenario.tools.find((each) => each.name === name);
    assert.ok(tool !== undefined, `the workshop has no tool "${name}"`);
    return tool;
  };
  // Each call's start and landing, in the order of their times; at one time, landings come before starts.
  const events = rows.flatMap((row) => {
    const call = { agent: row.worker, arguments: rowArguments(row) };
    if (UNRUN.includes(row.outcome)) return [];
    return [
      { at: Number(row.start), order: 1, row, call, kind: "start" as const },
      ...(row.outcome === "cut_off" ? [] : [{ at: Number(row.end), order: 0, row, call, kind: "land" as const }]),
    ];
  });
  events.sort((one, other) => one.at - other.at || one.order - other.order);
  let state: Workshop = loaded.world.state;
  for (const { at, row, call, kind } of events) {
    const tool = toolOf(row.tool);
    if (tool.kind !== "effector") continue;
    if (kind === "start") {
      state = tool.start === undefined ? state : tool.start.effect(state, call);
      continue;
    }
    const landing: LandingCall = { ...call, atMs: at * msPerMinute, world: worldTimeAt(calendar, at * msPerMinute) };
    const check: Check = tool.action?.precondition(state, landing) ?? { holds: true };
    // The record is built to match the world: each call's outcome is the one its landing gives.
    assert.equal(check.holds ? "success" : check.reason, row.outcome === "interrupted" ? "success" : row.outcome, `the record's ${row.worker} ${row.tool} at ${row.end} does not match the world`);
    if (check.holds && tool.action !== undefined) state = tool.action.effect(state, landing);
    if (tool.end !== undefined) state = tool.end.effect(state, landing);
  }
  const toolCalls: ToolCall[] = rows.map((row) => ({
    agent: row.worker,
    tool: row.tool,
    arguments: rowArguments(row),
    outcome: row.outcome,
    startedAtMs: Number(row.start) * msPerMinute,
    endedAtMs: Number(row.end) * msPerMinute,
  }));
  // In the order the calls ended, as the run gives them.
  toolCalls.sort((one, other) => one.endedAtMs - other.endedAtMs);
  measured.set(this, Object.fromEntries(Object.entries(scenario.metrics).map(([name, metric]) => [name, metric(state, toolCalls)])));
});

/** The workshop's measures, by name. */
export const WORKSHOP_MEASURES = [
  "done",
  "modules_mounted",
  "time_to_done",
  "effort_total",
  "effort_by_worker",
  "pieces_wasted",
  "modules_taken_apart",
  "first_take_time",
  "speech_before_first_take",
  "own_first_take_time",
  "builders_by_module",
  "joins_share_by_worker",
  "modules_by_worker",
  "module_switches",
  "duplicated_modules",
  "refused_by_cause",
  "bench_refusals",
  "finish_to_mount",
  "speech_by_worker",
  "time_by_activity",
  "handovers",
];

/** A value as a step writes it: a number, a fraction, or null. */
function valueOf(written: string): number | null {
  if (written === "null") return null;
  const [over, under] = written.split("/").map(Number);
  return under === undefined ? over : over / under;
}

/** Checks a measure's value against what a step says of it after "is" or "gives". */
function assertMeasure(measures: Record<string, MetricValue>, name: string, verb: string, said: string): void {
  const value = measures[name];
  if (verb === "is") {
    const expected = valueOf(said);
    if (expected === null || typeof value !== "number") assert.equal(value, expected, `"${name}"`);
    else assert.ok(Math.abs(value - expected) < 1e-9, `"${name}" is ${value}, not ${expected}`);
    return;
  }
  assert.ok(value !== null && typeof value === "object", `"${name}" gives ${JSON.stringify(value)}`);
  const table = value as Record<string, number>;
  const exactly = said.startsWith("exactly ");
  const expected: Record<string, number> = {};
  if (said !== "no key") for (const [, key, written] of said.matchAll(/"([\w.]+)" (-?\d+(?:\.\d+)?(?:\/\d+)?)/g)) expected[key] = valueOf(written) as number;
  const zeros = /and 0 for ((?:"\w+"(?:, | and )?)+)$/.exec(said);
  for (const key of zeros === null ? [] : quoted(zeros[1])) expected[key] = 0;
  if (/and 0 for every other worker's "finished" and for every worker's "mounted"$/.test(said)) {
    for (const worker of WORKERS) {
      expected[`${worker}.finished`] ??= 0;
      expected[`${worker}.mounted`] ??= 0;
    }
  }
  const absent = /no key for ((?:"\w+"(?:, | or )?)+)/.exec(said);
  for (const key of absent === null ? [] : quoted(absent[1])) assert.ok(!Object.hasOwn(table, key), `"${name}" gives "${key}" ${table[key]}`);
  if (exactly || said === "no key") assert.deepEqual(Object.keys(table).sort(), Object.keys(expected).sort(), `"${name}" gives ${JSON.stringify(table)}`);
  for (const [key, number] of Object.entries(expected)) {
    assert.ok(Object.hasOwn(table, key) && Math.abs(table[key] - number) < 1e-9, `"${name}" gives "${key}" ${table[key]}, not ${number}: ${JSON.stringify(table)}`);
  }
}

// A value follows "is", so the congress's '"done" is evaluated …' is not read here.
Then(new RegExp(`^("(?:${WORKSHOP_MEASURES.join("|")})" (?:is (?:-?[\\d.]+|null)|gives )(?:.+)?)$`), function (this: Context, written: string) {
  const measures = measuresOf(this, "last");
  const mentions = [...written.matchAll(new RegExp(`"(${WORKSHOP_MEASURES.join("|")})" (is|gives) `, "g"))];
  mentions.forEach((mention, index) => {
    const end = mentions[index + 1]?.index ?? written.length;
    const said = written.slice(mention.index + mention[0].length, end).replace(/(?:,? and |, )$/, "");
    assertMeasure(measures, mention[1], mention[2], said);
  });
});

Then("the last metric sample gives {string} as exactly {string} {int}", function (this: Context, name: string, key: string, count: number) {
  assert.deepEqual({ ...(measuresOf(this, "last")[name] as object) }, { [key]: count });
});

Then("it gives {string} as exactly {string} {int}", function (this: Context, name: string, key: string, count: number) {
  assert.deepEqual({ ...(measuresOf(this, "last")[name] as object) }, { [key]: count });
});

Then("the first metric sample gives {string} as no key", function (this: Context, name: string) {
  const value = measuresOf(this, "first")[name];
  assert.ok(value !== null && typeof value === "object", `"${name}" is ${JSON.stringify(value)}`);
  assert.deepEqual({ ...value }, {});
});

Then('it gives "effort_by_worker" for {string} as {int}', function (this: Context, worker: string, value: number) {
  assert.equal((measuresOf(this, "last").effort_by_worker as Record<string, number>)[worker], value);
});

/** The run's speech lines. */
function speechLines(context: Context) {
  return logLines(context).filter((line) => line.type === "speech") as unknown as { speaker: string; start: number; end: number; words: number; atMs: number }[];
}

Then("the log has exactly one {string} line", function (this: Context, type: string) {
  assert.equal(type, "speech");
  assert.equal(speechLines(this).length, 1, `the log has ${speechLines(this).length} "speech" lines`);
});

Then(
  "it gives the speaker {string}, the start {float} and the end {float}, each within {float}, and {int} words",
  function (this: Context, speaker: string, start: number, end: number, within: number, words: number) {
    const [line] = speechLines(this);
    assert.equal(line.speaker, speaker);
    assert.ok(Math.abs(line.start - start) <= within, `the speech starts at ${line.start}`);
    assert.ok(Math.abs(line.end - end) <= within, `the speech ends at ${line.end}`);
    assert.equal(line.words, words);
  },
);

Then("it was written when the {string} call ended", function (this: Context, tool: string) {
  const [line] = speechLines(this);
  const applied = callsOfWorker(this, "Dal").filter((call) => call.tool === tool && call.outcome === "success");
  assert.equal(applied.length, 1, `"Dal" made ${applied.length} applied "${tool}" calls`);
  const lines = logLines(this);
  const speechAt = lines.findIndex((each) => each.type === "speech");
  const callAt = lines.findIndex((each) => each.type === "tool_call" && each.tool === tool && each.outcome === "success");
  assert.ok(Math.abs(line.atMs - applied[0].endedAtMs) <= 20, `the speech line was written ${line.atMs - applied[0].endedAtMs} ms from the call's end`);
  assert.ok(speechAt < callAt, "the speech line comes after the call's line");
});

// FR-WORKSHOP-05: handing over, a clock on the wall, and the character and limits texts.

Then("{string}'s {string} shows the clock as {int}", function (this: Context, worker: string, tool: string, clock: number) {
  assert.equal(tool, "look");
  assert.equal(lookOf(this, worker).clock, clock);
});

Then("the tool {string}'s description says it gives the clock, in whole minutes since the start", function (this: Context, tool: string) {
  const description = fencedAfter(toolListed(this, tool), "Description");
  assert.match(description, /\bclock\b/, `the description of "${tool}":\n${description}`);
  assert.match(description, /whole minutes since the start/, `the description of "${tool}":\n${description}`);
});

Given("{string} takes {int} world minutes", function (this: Context, tool: string, minutes: number) {
  changeWorkshop(this, (configuration) => {
    const durations = configuration.durations as TomlTable;
    assert.ok(Object.hasOwn(durations, tool), `the workshop's durations have no "${tool}"`);
    durations[tool] = minutes;
  });
});

Given(
  "{string} runs on a scripted model whose turns are: the text {string} with no tool call, after {int} milliseconds; the text {string} with no tool call",
  function (this: Context, worker: string, text: string, delayMs: number, then: string) {
    // A turn without a tool call ends its activation, so each turn is one activation.
    const turns = [
      { text, delayMs },
      { text: then, delayMs: 0 },
    ];
    scriptActivations(this, worker, turns.length, (index) => [turns[index]]);
  },
);

Then("{string}'s second model turn received {string} from {string}, which the worker reads as {string}", function (this: Context, worker: string, content: string, source: string, read: string) {
  assert.equal(asRead(source, content), read);
  assert.ok(receivedIn(this, worker, 1).includes(read), `"${worker}"'s second model turn received ${JSON.stringify(receivedIn(this, worker, 1))}`);
});

Then("{string}, {string} and {string} received nothing on the channel {string}", function (this: Context, a: string, b: string, c: string, channel: string) {
  assert.ok(this.toolCalls !== undefined, "the workers did not run");
  for (const worker of [a, b, c]) assert.deepEqual(stimuliOf(this, worker).filter((stimulus) => stimulus.channel === channel), [], `"${worker}" received on the channel "${channel}"`);
});

/** The stimulus line a step named last, which "it was delivered" speaks of. */
const lastStimulusLines = new WeakMap<Context, { deliveredAtMs: number }>();

Then(
  "the log has a stimulus line for {string} with the channel {string}, the source {string} and the content {string}",
  function (this: Context, worker: string, channel: string, source: string, content: string) {
    const lines = voiceLines(this, channel).filter((line) => line.agent === worker);
    assert.deepEqual(lines.map((line) => ({ source: line.source, content: line.content })), [{ source, content }], `"${worker}"'s stimulus lines on the channel "${channel}"`);
    lastStimulusLines.set(this, lines[0]);
  },
);

Then("it was delivered no earlier than the end of the {string} call, and within {int} milliseconds of it", function (this: Context, tool: string, withinMs: number) {
  const line = lastStimulusLines.get(this);
  assert.ok(line !== undefined, "no stimulus line was named");
  const after = line.deliveredAtMs - onlyCallOf(this, tool).endedAtMs;
  assert.ok(after >= 0 && after <= withinMs, `the stimulus was delivered ${after} ms after the "${tool}" call ended`);
});

Then("the log has no stimulus line on the channel {string} for {string}, {string} or {string}", function (this: Context, channel: string, a: string, b: string, c: string) {
  assert.ok(this.toolCalls !== undefined, "the workers did not run");
  assert.deepEqual(voiceLines(this, channel).filter(({ agent }) => [a, b, c].includes(agent)), []);
});

Then("{string}'s {string} call succeeded, and {string} is mounted", function (this: Context, worker: string, tool: string, module: string) {
  assert.equal(callOfWorker(this, worker, tool).outcome, "success");
  assert.ok(workshopNow(this).bench.mounted.includes(module), `"${module}" is not mounted`);
});

Then("the log has a tool call line for {string}'s {string} call, with its outcome and the text {string} received", function (this: Context, worker: string, tool: string, receiver: string) {
  assert.equal(worker, receiver);
  const call = callOfWorker(this, worker, tool);
  const lines = logLines(this).filter((line) => line.type === "tool_call" && line.agent === worker && line.tool === tool);
  // The worker's last turn's transcript holds the call's result.
  const received = (modelOf(this, worker).received.at(-1) ?? []).flatMap((message) =>
    message.role === "toolResult" && message.toolName === tool ? [message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")] : [],
  );
  assert.deepEqual(lines.map((line) => ({ outcome: line.outcome, text: line.text })), [{ outcome: call.outcome, text: received[0] }]);
  assert.equal(received.length, 1, `"${worker}" received ${received.length} "${tool}" results`);
});

Then("it has an {string} line naming that {string} began handing", function (this: Context, type: string, worker: string) {
  const starts = logLines(this).filter((line) => line.type === type && line.agent === worker);
  assert.deepEqual(starts.map((line) => ({ tool: line.tool, change: line.change })), [{ tool: "hand", change: { began: "handing" } }]);
});

Then("each worker's tools include {string}, with its duration as {float} world minutes, and its texts", function (this: Context, tool: string, minutes: number) {
  const listed = toolListed(this, tool);
  assert.ok(listed.includes(`- Duration: ${minutes} world minutes.`), `the inventory lists "${tool}" as:\n${listed}`);
  assert.ok(EFFECTOR_TEXTS[tool] !== undefined, `the steps know no texts of "${tool}"`);
  assertToolListed(this, tool);
});

Then("it gives the duration {string} as {float} world minutes among the durations", function (this: Context, name: string, minutes: number) {
  assert.equal((inventoryWorld(this).durations as Record<string, number>)[name], minutes);
});

Then("no tool's description or parameters hold any of {string}, {string}, {string} or {string}", function (this: Context, a: string, b: string, c: string, d: string) {
  const tools = under(under(this.labOutput ?? "", '## Condition "base"'), "### Tools");
  for (const word of [a, b, c, d]) assert.ok(!new RegExp(`\\b${word}\\b`).test(tools), `the tools name "${word}":\n${tools}`);
});

/** Sets texts or values the workshop's base configuration already has, as a step gives them. */
function setInWorkshop(context: Context, values: Record<string, string>): void {
  changeWorkshop(context, (configuration) => {
    for (const [key, value] of Object.entries(values)) {
      assert.ok(Object.hasOwn(configuration, key), `the workshop's configuration has no "${key}"`);
      configuration[key] = value;
    }
  });
}

Given("the configuration sets {string} to {string} and {string} to {string}", function (this: Context, first: string, firstValue: string, second: string, secondValue: string) {
  setInWorkshop(this, { [first]: firstValue, [second]: secondValue });
});

Given(
  "the configuration places {string} as {string}, places {string} as {string} and sets {string} to {string}",
  function (this: Context, first: string, firstPlace: string, second: string, secondPlace: string, key: string, value: string) {
    changeWorkshop(this, (configuration) => Object.assign(configuration.placement as TomlTable, { [first]: firstPlace, [second]: secondPlace }));
    setInWorkshop(this, { [key]: value });
  },
);

Then("the inventory gives the texts {string} and {string} as empty, each placed as {string}", function (this: Context, first: string, second: string, place: string) {
  const { scenario, configuration } = loadedWorkshop(this);
  const world = scenario.worldInventory?.(configuration) as { texts: Record<string, string>; placement: Record<string, string> };
  for (const text of [first, second]) assert.deepEqual([text, world.texts[text], world.placement[text]], [text, "", place]);
});

/** The worker whose system prompt a step named last, which "it holds" speaks of. */
const promptsNamed = new WeakMap<Context, string>();

Then(/^worker "(\w+)"'s system prompt is, each separated by a blank line: (.+)$/, function (this: Context, worker: string, written: string) {
  const parts = [...written.matchAll(new RegExp(`the identity with "\\{name\\}" as "(\\w+)"|the task|the world rules|${QUOTED}`, "g"))].map(([part, name, text]) => {
    if (name !== undefined) return textOf(this, "identity.md").replaceAll("{name}", name);
    if (part === "the task") return textOf(this, "task.md");
    if (part === "the world rules") return textOf(this, "world-rules.md");
    return unquoted(text);
  });
  assert.ok(parts.length >= 3, `the steps do not read the parts of: ${written}`);
  assert.equal(promptOf(this, worker), parts.join("\n\n"));
  promptsNamed.set(this, worker);
});

Then("it holds no three line breaks in a row", function (this: Context) {
  const worker = promptsNamed.get(this);
  assert.ok(worker !== undefined, "no worker's system prompt was named");
  assert.ok(!promptOf(this, worker).includes("\n\n\n"), promptOf(this, worker));
});

Then("worker {string}'s system prompt holds {string} and {string}", function (this: Context, worker: string, first: string, second: string) {
  const prompt = promptOf(this, worker);
  for (const text of [first, second]) assert.ok(prompt.includes(text), `worker "${worker}"'s system prompt does not hold ${JSON.stringify(text)}:\n${prompt}`);
});

Then(
  'worker {string}\'s first activation received, right after its rhythm\'s stimulus, {string}, a blank line and the text of "task.md", from {string} on the channel {string}',
  function (this: Context, worker: string, first: string, source: string, channel: string) {
    const [rhythm, second] = stimuliOf(this, worker);
    assert.equal(rhythm?.channel, "rhythm", `worker "${worker}"'s first stimulus: ${JSON.stringify(rhythm)}`);
    assert.deepEqual({ ...second }, { ...second, channel, source, content: `${first}\n\n${textOf(this, "task.md")}` });
    // In one message, as the worker reads it.
    assert.ok(receivedIn(this, worker, 0).includes(asRead(source, `${first}\n\n${textOf(this, "task.md")}`)), `"${worker}" woke to ${JSON.stringify(receivedIn(this, worker, 0))}`);
  },
);
