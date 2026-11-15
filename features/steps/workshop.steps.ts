import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { Random } from "../../src/engine/random.ts";
import { type LoadedScenario, loadScenario } from "../../src/engine/scenario.ts";
import { World } from "../../src/engine/world.ts";
import { scenarioLibrary } from "../../src/scenarios/library.ts";
import type { Workshop } from "../../src/scenarios/workshop.ts";
import type { Context } from "../support/context.ts";
import { configurationChanges } from "../support/changes.ts";
import { fencedAfter, under } from "./inventory.steps.ts";
import { assertRhythmWithin, lastLoaded } from "./neighbourhood.steps.ts";
import { logLines } from "./record.steps.ts";
import { script, scriptActivations } from "./tool.steps.ts";

/** The base configuration's workers, in the order it names them. */
const WORKERS = ["Dal", "Mik", "Nar", "Ren"];

/** What a workshop scenario sets up besides its configuration: the changes it makes to the world as the engine loads it. */
interface WorkshopSetup {
  /** Applied in order to the initial state, before any worker acts. */
  changes: ((state: Workshop) => Workshop)[];
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
  return { ...loaded, world };
}

Given("the workshop scenario with its base configuration", function (this: Context) {
  const workshop = scenarioLibrary.get("workshop");
  assert.ok(workshop !== undefined, 'the scenario library has no scenario "workshop"');
  this.libraryScenario = workshop;
  setups.set(this, { changes: [] });
  this.assembleRun = () => loadWorkshop(this) as LoadedScenario<unknown>;
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
  for (const worker of WORKERS) if (!this.models.has(worker)) script(this, worker, []);
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
