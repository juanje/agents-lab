import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import type { JsonObject } from "@earendil-works/pi-ai";
import { type TomlTable, parse, stringify } from "smol-toml";
import type { ToolCall } from "../../src/engine/adapter.ts";
import { Random } from "../../src/engine/random.ts";
import type { ScriptedAnswer } from "../../src/engine/scripted-model.ts";
import { type LoadedScenario, loadScenario } from "../../src/engine/scenario.ts";
import { World } from "../../src/engine/world.ts";
import { scenarioLibrary } from "../../src/scenarios/library.ts";
import type { Workshop } from "../../src/scenarios/workshop.ts";
import type { Context } from "../support/context.ts";
import { configurationChanges } from "../support/changes.ts";
import { fencedAfter, under } from "./inventory.steps.ts";
import { assertRhythmWithin, lastLoaded } from "./neighbourhood.steps.ts";
import { logLines } from "./record.steps.ts";
import { modelOf, script, scriptActivations } from "./tool.steps.ts";

/** The base configuration's workers, in the order it names them. */
const WORKERS = ["Dal", "Mik", "Nar", "Ren"];

/** What a workshop scenario sets up besides its configuration: the changes it makes to the world as the engine loads it. */
interface WorkshopSetup {
  /** Applied in order to the initial state, before any worker acts. */
  changes: ((state: Workshop) => Workshop)[];
  /** Whether every worker the scenario gives no turns ends every turn without a tool call. */
  othersIdle: boolean;
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
  return { ...loaded, world };
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
  setups.set(context, { changes: [], othersIdle: false });
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
  'it gives the durations in world minutes: "look" {float}, "read_plan" {int}, "take" {int}, "put_back" {float}, "join" {int}, "take_apart" {int}, "mount" {int}, "mount_refused" {float}, "say" {float} with "say_words_per_minute" {int}, and "wait_max_minutes" {int}',
  function (this: Context, look: number, readPlan: number, take: number, putBack: number, join: number, takeApart: number, mount: number, mountRefused: number, say: number, wordsPerMinute: number, waitMax: number) {
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

/** The texts of each effector's outcomes (FR-WORKSHOP-02, FR-WORKSHOP-03). */
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
  wait: { success: "You have waited.", interrupted: "Someone spoke; you stopped waiting." },
  say: { success: "You have said it.", empty_text: "You said nothing; nobody heard anything." },
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
    assert.deepEqual(tools.split("\n").filter((line) => line.startsWith("#### Tool ")), names.map((name) => `#### Tool "${name}"`));
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
  workers: { worker: string; loose?: string[]; module?: { name: string; joined?: string[]; finished: boolean } | null }[];
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
  const module = /(?:a|another) (finished )?module "(\w+)"(?: with (.+?) joined)?/.exec(said);
  const rest = module === null ? said : said.slice(0, module.index) + said.slice(module.index + module[0].length);
  const both = /both "(\w+)"/.exec(rest);
  const loose = both === null ? quoted(rest) : [both[1], both[1]];
  const hands: Omit<Holdings["workers"][number], "worker"> = loose.length > 0 || /loose/.test(rest) ? { loose } : {};
  if (module !== null) hands.module = { name: module[2], finished: module[1] !== undefined, ...(module[3] === undefined ? {} : { joined: quoted(module[3]) }) };
  else if (/no module/.test(rest)) hands.module = null;
  return hands;
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

/** Checks that the workshop holds what a step says: the modules mounted, and what each worker it names holds. */
function assertHoldings(state: Workshop, holdings: Holdings): void {
  for (const name of holdings.mounted) assert.ok(state.bench.mounted.includes(name), `"${name}" is not mounted: ${JSON.stringify(state.bench.mounted)}`);
  for (const name of holdings.notMounted) assert.ok(!state.bench.mounted.includes(name), `"${name}" is mounted`);
  for (const { worker, loose, module } of holdings.workers) {
    const hands = state.workers[worker];
    if (loose !== undefined) assert.deepEqual({ ...hands.loose }, counted(loose), `"${worker}"'s loose pieces`);
    if (module === null) assert.equal(hands.module, null, `"${worker}" holds a module`);
    else if (module !== undefined) assert.equal(hands.module?.name, module.name, `"${worker}" holds no module "${module.name}"`);
  }
}

// The contract says who holds what both to set up the workshop, as a Given, and to check it, as a Then.
Given(
  /^(nobody holds anything|(?:(?:"\w+"(?:, | and )?)+ (?:is|are) mounted, (?:and )?)?"\w+" holds (?:the loose|a |another |both |six |one "|no module).*)$/,
  function (this: Context, written: string) {
    const holdings = holdingsOf(written);
    if (this.checking) assertHoldings(workshopNow(this), holdings);
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
    else if ((found = take(` with the text of \\d+ words, ${QUOTED},?`)) !== null) args = { text: unquoted(found[1]) };
    else if ((found = take(` with the text ${QUOTED}`)) !== null) args = { text: unquoted(found[1]) };
    else if ((found = take(` with (-?[\\d.]+) minutes`)) !== null) args = { minutes: Number(found[1]) };
    else if ((found = take(` with ${QUOTED}`)) !== null) args = name === "say" ? { text: unquoted(found[1]) } : { kind: found[1] };
    const delay = take(` at once| after (\\d+) milliseconds`);
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
