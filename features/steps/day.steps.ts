import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { type TomlTable, parse, stringify } from "smol-toml";
import type { Component } from "../../src/engine/components.ts";
import { where } from "../../src/engine/places.ts";
import { type LoadedScenario, loadScenario } from "../../src/engine/scenario.ts";
import { ScriptedModel } from "../../src/engine/scripted-model.ts";
import { World } from "../../src/engine/world.ts";
import { type Workplace, workplaceScenario } from "../../src/scenarios/workplace.ts";
import type { Context } from "../support/context.ts";
import { stateAt } from "./acting.steps.ts";
import { itemOf, under } from "./inventory.steps.ts";
import { experimentFileOf, idleModels } from "./lab.steps.ts";
import { DURATIONS, MODEL } from "./measures.steps.ts";
import { withBase } from "./neighbourhood.steps.ts";
import { linesOf, logLines } from "./record.steps.ts";
import { runScenario } from "./tool.steps.ts";
import { editText } from "./workplace.steps.ts";
import { WORLD, holding, situations } from "./workplace-tools.steps.ts";

/** The worker, the workplace's one agent. */
const WORKER = "worker";

/** The seed the day runs with, unless the scenario gives one. */
const SEED = 42;

/** Less than this, two moments of the run are the same: running the engine takes a moment. */
const SAME_MOMENT_MS = 5;

/** A clock time as the contract writes it, such as "09:10", or a time it does not read. */
const CLOCK_TIME = /\b\d{1,2}[:.]\d{2}\b/;

/** What the scenario keeps of each run of the day: when it started, and each draw of each component's own random sequence. */
interface DayRun {
  startedAtMs: number;
  draws: Map<string, number[]>;
  actions: { component: string; action: string; startedAtMs: number }[];
}

const dayRuns = new WeakMap<Context, DayRun[]>();

function dayRunsOf(context: Context): DayRun[] {
  const runs = dayRuns.get(context) ?? [];
  dayRuns.set(context, runs);
  return runs;
}

Given(
  "the workplace scenario with the world and situations of FR-WORKPLACE-01, the tools' durations of FR-WORKPLACE-02, and {string} {int}",
  function (this: Context, key: string, value: number) {
    // FR-WORKPLACE-01's background chooses "open-box", which can be in "store" or "yard". The worker wakes at once.
    this.libraryScenario = withBase(workplaceScenario, {
      world: WORLD,
      situations: situations(JSON.stringify(["store", "yard"])),
      situation_keys: "",
      chosen_situations: ["open-box"],
      durations: { ...DURATIONS, [key]: value },
      rhythm: { min_ms: 0, max_ms: 0 },
    });
    // The worker ends its only activation at once unless the scenario scripts its turns.
    idleModels(this, [MODEL]);
    // "The run starts" runs it with "lab run"; "the run ends" runs it with the engine, watching its arbiter.
    this.experimentFile = experimentFileOf({
      id: "workplace-day",
      scenario: workplaceScenario.name,
      models: [MODEL],
      replicas: 1,
      seed: SEED,
      activationsPerAgent: 1,
      conditions: { base: {} },
    });
    this.seed = SEED;
    this.runInstead = () => runDay(this, this.libraryScenario as typeof workplaceScenario);
  },
);

/** Changes the world's text. */
function editWorld(context: Context, edit: (world: TomlTable) => void): void {
  editText(context, "world", edit);
}

/** The table a world's text gives under a key, which the edit may change. */
function tableOf(world: TomlTable, key: string): TomlTable {
  const table = (world[key] ?? {}) as TomlTable;
  world[key] = table;
  return table;
}

Given(
  "the world's {string} is {string} and the configuration's {string} is {int}, so one depot minute is {int} milliseconds of the run",
  function (this: Context, key: string, start: string, scaleKey: string, scale: number, minuteMs: number) {
    const [table, field] = /^\[(\w+)\] (\w+)$/.exec(key)?.slice(1) ?? [];
    assert.ok(table !== undefined && field !== undefined, `the steps do not read the world's key ${key}`);
    editWorld(this, (world) => {
      tableOf(world, table)[field] = start;
    });
    this.libraryScenario = withBase(this.libraryScenario, { [scaleKey]: scale });
    assert.equal((60 * 1000) / scale, minuteMs, `with "${scaleKey}" ${scale}, a depot minute is not ${minuteMs} ms`);
  },
);

Given(
  "the world's {string} is {string}, named {string}, who enters {string}, drops in {string} and has the rounds [{}]",
  function (this: Context, key: string, id: string, name: string, enters: string, dropsIn: string, rounds: string) {
    assert.equal(key, "[porter]");
    editWorld(this, (world) => {
      world.porter = { id, name, description: "The porter, bringing the day's deliveries.", enters, drops_in: dropsIn, rounds: listOf(rounds) };
    });
  },
);

Given("the world has the thing {string}, named {string}, that arrives {string}", function (this: Context, id: string, name: string, arrives: string) {
  editWorld(this, (world) => {
    world.things = [...((world.things ?? []) as TomlTable[]), { id, name, arrives }];
  });
});

/** A list as the contract writes it inside brackets, such as "09:10", "10:30". */
function listOf(items: string): string[] {
  return JSON.parse(`[${items}]`) as string[];
}

Given("the configuration's {string} is {int}", function (this: Context, key: string, value: number) {
  // A tool's duration is one of the configuration's durations, as every other tool's is.
  const durations = parse(this.libraryScenario.baseConfiguration ?? "").durations as TomlTable;
  this.libraryScenario = withBase(this.libraryScenario, Object.hasOwn(durations, key) ? { durations: { [key]: value } } : { [key]: value });
});

Given(
  "the configuration's {string} is {int} and its {string} is {int}, so one depot minute is {int} milliseconds of the run",
  function (this: Context, key: string, value: number, scaleKey: string, scale: number, minuteMs: number) {
    const durations = parse(this.libraryScenario.baseConfiguration ?? "").durations as TomlTable;
    assert.ok(Object.hasOwn(durations, key), `"${key}" is no duration of the configuration`);
    this.libraryScenario = withBase(this.libraryScenario, { durations: { [key]: value }, [scaleKey]: scale });
    assert.equal((60 * 1000) / scale, minuteMs, `with "${scaleKey}" ${scale}, a depot minute is not ${minuteMs} ms`);
  },
);

Given("the worker's scripted turns end at once, for {int} activation(s)", function (this: Context, activations: number) {
  idleModels(this, [MODEL]);
  this.activations.set(WORKER, activations);
});

/** Puts situations in the configuration's arrivals for a round, in place of any it listed for it. */
function arriving(context: Context, round: string, ids: readonly string[]): void {
  editText(context, "arrivals", (arrivals) => {
    arrivals[round] = [...ids];
  });
}

/** Chooses a situation, or leaves it out, keeping the others the configuration chooses. */
function choose(context: Context, id: string, chosen: boolean): void {
  const before = parse(context.libraryScenario.baseConfiguration ?? "").chosen_situations as string[];
  const others = before.filter((each) => each !== id);
  context.libraryScenario = withBase(context.libraryScenario, { chosen_situations: chosen ? [...others, id] : others });
}

Given("the configuration's {string} lists {string} for {string}", function (this: Context, key: string, id: string, round: string) {
  assert.equal(key, "arrivals");
  arriving(this, round, [id]);
});

Given(
  "the configuration's {string} lists {string} for {string}, {string} is chosen and can be only in {string}",
  function (this: Context, key: string, id: string, round: string, chosen: string, place: string) {
    assert.equal(key, "arrivals");
    assert.equal(chosen, id);
    arriving(this, round, [id]);
    choose(this, id, true);
    editSituation(this, id, (situation) => {
      situation.places = [place];
    });
  },
);

Given(
  "the configuration's {string} lists {string} for {string}, and it is not chosen",
  function (this: Context, key: string, id: string, round: string) {
    assert.equal(key, "arrivals");
    arriving(this, round, [id]);
    choose(this, id, false);
  },
);

/** Changes a declared situation in the configuration's situations. */
function editSituation(context: Context, id: string, edit: (situation: TomlTable) => void): void {
  editText(context, "situations", (text) => {
    const declared = (text.situations ?? {}) as Record<string, TomlTable>;
    assert.ok(Object.hasOwn(declared, id), `no situation "${id}" is declared`);
    edit(declared[id]);
  });
}

/** Marks a situation's thing as brought by someone. */
function bringing(context: Context, thing: string, by: string): void {
  editText(context, "situations", (text) => {
    const things = Object.values((text.situations ?? {}) as Record<string, TomlTable>).flatMap((situation) => (situation.things ?? []) as TomlTable[]);
    const declared = things.find((each) => each.id === thing);
    assert.ok(declared !== undefined, `no situation declares the thing "${thing}"`);
    declared.brought_by = by;
  });
}

/**
 * Makes a person of the world a visitor: the same id, name and description, who enters a place once, at a time drawn
 * between two times, waits there for a while, and comes for some things.
 */
function makeVisitor(context: Context, id: string, visitor: { enters?: string; arrivesBetween: [string, string]; waitsMinutes?: number; comesFor?: string[] }): void {
  editWorld(context, (world) => {
    const people = (world.people ?? []) as TomlTable[];
    const person = people.find((each) => each.id === id);
    assert.ok(person !== undefined, `the world has no person "${id}"`);
    world.people = people.filter((each) => each !== person);
    world.visitors = [
      ...((world.visitors ?? []) as TomlTable[]),
      {
        id,
        name: person.name,
        description: person.description,
        enters: visitor.enters ?? (person.place as string),
        arrives_between: visitor.arrivesBetween,
        waits_minutes: visitor.waitsMinutes ?? 20,
        comes_for: visitor.comesFor ?? [],
      },
    ];
  });
}

Given(
  "{string} is a visitor instead of a person: she enters {string}, arrives between {string} and {string}, waits {int} minutes, and comes for [{}]",
  function (this: Context, id: string, enters: string, from: string, to: string, waitsMinutes: number, comesFor: string) {
    makeVisitor(this, id, { enters, arrivesBetween: [from, to], waitsMinutes, comesFor: listOf(comesFor) });
  },
);

Given("the worker holds {string}", function (this: Context, id: string) {
  holding(this, id);
});

Given("the situation {string} is not chosen", function (this: Context, id: string) {
  choose(this, id, false);
});

Given("the situation {string} is chosen, and its thing {string} is brought by {string}", function (this: Context, id: string, thing: string, by: string) {
  choose(this, id, true);
  bringing(this, thing, by);
});

Given("the situation thing {string} is brought by {string}, who is no visitor", function (this: Context, thing: string, by: string) {
  bringing(this, thing, by);
});

Given("the porter's rounds are [{}]", function (this: Context, rounds: string) {
  editWorld(this, (world) => {
    world.porter = { ...tableOf(world, "porter"), rounds: listOf(rounds) };
  });
});

Given("the visitor {string} arrives between {string} and {string}", function (this: Context, id: string, from: string, to: string) {
  makeVisitor(this, id, { arrivesBetween: [from, to] });
});

Given("the porter's id is {string}", function (this: Context, id: string) {
  editWorld(this, (world) => {
    world.porter = { ...tableOf(world, "porter"), id };
  });
});

Given("the thing {string} also gives the place {string}", function (this: Context, id: string, place: string) {
  editWorld(this, (world) => {
    const thing = ((world.things ?? []) as TomlTable[]).find((each) => each.id === id);
    assert.ok(thing !== undefined, `the world declares no thing "${id}"`);
    thing.place = place;
  });
});

/**
 * Runs the day as the engine loads it with the scenario's seed, changed as the scenario sets it up, with the worker on its
 * scripted model, watching its arbiter and each component's draws and actions.
 */
async function runDay(context: Context, scenario: typeof workplaceScenario): Promise<void> {
  const loaded = loadScenario(scenario, context.seed) as LoadedScenario<Workplace>;
  const state = context.workplaceSetups.reduce((changed, setup) => setup(changed), loaded.world.state);
  context.workplaceWorld = new World(state);
  const draws = new Map<string, number[]>();
  // Watched, not changed: each component still draws from the sequence the engine gives it.
  const components = loaded.components.map(
    (component): Component<Workplace> => ({
      ...component,
      cycle: (random) => {
        const next = random.next.bind(random);
        random.next = () => {
          const drawn = next();
          draws.set(component.name, [...(draws.get(component.name) ?? []), drawn]);
          return drawn;
        };
        return component.cycle(random);
      },
    }),
  );
  const model = context.labModels.get(MODEL);
  assert.ok(model !== undefined, "the worker runs on no model");
  await runScenario(context, { ...loaded, world: context.workplaceWorld, components }, [{ name: WORKER, model, activations: context.activations.get(WORKER) ?? 1 }]);
  // This run's own log, among any an earlier run of the scenario wrote.
  const actions = linesOf(context, `${context.runId}.jsonl`)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.type === "component_action")
    .map((line) => line as unknown as DayRun["actions"][number]);
  dayRunsOf(context).push({ startedAtMs: context.runStartedAtMs as number, draws, actions });
}

When(
  "two replicas run with the seed {int}, the second with another visitor {string} added",
  async function (this: Context, seed: number, added: string) {
    this.seed = seed;
    const base = this.libraryScenario as typeof workplaceScenario;
    await runDay(this, base);
    // The added visitor is declared first, so a sequence shared among components, or derived by their order, would give
    // the others other draws.
    const world = parse(parse(base.baseConfiguration).world as string);
    const visitors = (world.visitors ?? []) as TomlTable[];
    assert.ok(visitors.length > 0, "the world has no visitor to add another like");
    world.visitors = [{ ...visitors[0], id: added, name: `Visitor ${added}` }, ...visitors];
    this.libraryScenario = withBase(base, { world: stringify(world) });
    this.workplaceWorld = undefined;
    this.applied.length = 0;
    await runDay(this, this.libraryScenario as typeof workplaceScenario);
  },
);

/** The workplace a moment into the run, replaying what the arbiter applied until then. */
function stateInto(context: Context, ms: number): Workplace {
  assert.ok(context.runStartedAtMs !== undefined, "the day did not run");
  return stateAt<Workplace>(context, context.runStartedAtMs + ms);
}

/** The workplace as the run left it. */
function stateAtEnd(context: Context): Workplace {
  assert.ok(context.workplaceWorld !== undefined, "the day did not run");
  return context.workplaceWorld.state;
}

/**
 * Checks that the workplace holds an entity, a thing or a person, in no place: neither it nor what it is inside, if
 * anything, is in the space or held by anyone.
 */
function assertNowhere(state: Workplace, id: string, when: string): void {
  let outermost = id;
  while (Object.hasOwn(state.inside, outermost)) outermost = state.inside[outermost];
  const what = outermost === id ? `"${id}"` : `"${outermost}", which "${id}" is inside,`;
  assert.equal(where(state.space, outermost), undefined, `${when}, ${what} was ${JSON.stringify(where(state.space, outermost))}`);
  assert.ok(!Object.hasOwn(state.held, outermost), `${when}, ${what} was held by "${state.held[outermost]}"`);
}

/** Checks that an entity is in a place. */
function assertIn(state: Workplace, id: string, place: string, when: string): void {
  assert.deepEqual(where(state.space, id), { place }, `${when}, "${id}" was not in "${place}"`);
}

Then("{int} milliseconds into the run, {string} was in no place", function (this: Context, ms: number, id: string) {
  assertNowhere(stateInto(this, ms), id, `${ms} ms into the run`);
});

Then("{int} milliseconds into the run, {string} and {string} were in no place", function (this: Context, ms: number, first: string, second: string) {
  for (const id of [first, second]) assertNowhere(stateInto(this, ms), id, `${ms} ms into the run`);
});

Then("{int} milliseconds into the run, {string} was in {string}", function (this: Context, ms: number, id: string, place: string) {
  assertIn(stateInto(this, ms), id, place, `${ms} ms into the run`);
});

Then(
  "{int} milliseconds into the run, {string} was in the passage between {string} and {string}, carrying {string}",
  function (this: Context, ms: number, id: string, one: string, other: string, thing: string) {
    const state = stateInto(this, ms);
    const at = where(state.space, id);
    assert.ok(at !== undefined && "passage" in at, `${ms} ms into the run, "${id}" was ${JSON.stringify(at)}`);
    assert.deepEqual([...at.passage].sort(), [one, other].sort());
    assert.equal(state.held[thing], id, `${ms} ms into the run, "${thing}" was not carried by "${id}"`);
  },
);

Then("{string} is in {string}", function (this: Context, id: string, place: string) {
  assertIn(stateAtEnd(this), id, place, "as the run ended");
});

Then("{string} is in no place", function (this: Context, id: string) {
  assert.equal(where(stateAtEnd(this).space, id), undefined, `"${id}" is ${JSON.stringify(where(stateAtEnd(this).space, id))}`);
});

Then("{string} is in {string}, with {string} inside it", function (this: Context, id: string, place: string, inside: string) {
  const state = stateAtEnd(this);
  assertIn(state, id, place, "as the run ended");
  assert.equal(state.inside[inside], id, `"${inside}" is not inside "${id}"`);
});

Then("{string} is in no place and holds {string}", function (this: Context, id: string, thing: string) {
  const state = stateAtEnd(this);
  assert.equal(where(state.space, id), undefined, `"${id}" is ${JSON.stringify(where(state.space, id))}`);
  assert.equal(state.held[thing], id, `"${id}" does not hold "${thing}"`);
});

Then("the predicate where {string} in [{}] holds", function (this: Context, thing: string, locations: string) {
  // Measured as the workplace measures a situation's predicate, on the world as the run left it.
  const state = stateAtEnd(this);
  const checked = { ...state, situations: { check: { place: "", keys: { where: { [thing]: listOf(locations) } }, things: [thing] } } };
  const values = workplaceScenario.metrics.predicates(checked, []) as Record<string, number>;
  assert.equal(values[`check.where.${thing}`], 1);
});

Then("the run's log has the porter's actions, each with when it started and ended and its outcome", function (this: Context) {
  const world = parse(parse(this.libraryScenario.baseConfiguration ?? "").world as string);
  const porter = (world.porter as TomlTable).id as string;
  const lines = logLines(this).filter((line) => line.type === "component_action" && line.component === porter);
  assert.ok(lines.length > 0, `the log has no action of "${porter}"`);
  for (const line of lines) {
    assert.equal(typeof line.action, "string");
    assert.ok(typeof line.startedAtMs === "number" && typeof line.endedAtMs === "number" && line.endedAtMs >= line.startedAtMs, JSON.stringify(line));
    assert.equal(line.outcome, "success", JSON.stringify(line));
  }
});

/** The worker's calls of a tool, as the run gave them. */
function workerCalls(context: Context, tool: string | undefined) {
  assert.ok(context.toolCalls !== undefined, "the worker did not run");
  return context.toolCalls.filter((call) => call.agent === WORKER && (tool === undefined || call.tool === tool));
}

Then("the {string} call's result is {string}", function (this: Context, tool: string, result: string) {
  const calls = workerCalls(this, tool);
  assert.equal(calls.length, 1, `the worker made ${calls.length} "${tool}" calls`);
  const timeline = workerCalls(this, undefined).map((call) => `${call.tool} ${Math.round(call.startedAtMs - (this.runStartedAtMs ?? 0))}–${Math.round(call.endedAtMs - (this.runStartedAtMs ?? 0))} ms`);
  assert.deepEqual({ outcome: calls[0].outcome, result: calls[0].result }, { outcome: "success", result }, `the worker's calls, into the run: ${timeline.join(", ")}`);
});

Then("the {string} call succeeded", function (this: Context, tool: string) {
  assert.deepEqual(workerCalls(this, tool).map((call) => call.outcome), ["success"]);
});

Then("the look's result gives no time", function (this: Context) {
  const [look] = workerCalls(this, "look");
  assert.ok(look?.result !== undefined, "the worker's look gave no result");
  assert.ok(!Object.hasOwn(JSON.parse(look.result), "time"), `the look gave a time: ${look.result}`);
  assert.doesNotMatch(look.result, CLOCK_TIME);
});

Then("the worker's system prompt and stimuli give no time", function (this: Context) {
  const model = this.labModels.get(MODEL);
  assert.ok(model instanceof ScriptedModel && model.received.length > 0, "the worker's model was never called");
  for (const messages of model.received) {
    assert.doesNotMatch(getCurrentSystemPrompt(messages) ?? "", CLOCK_TIME);
    // What reached the worker other than its tools' results: its stimuli.
    for (const message of messages.filter((each) => each.role === "user")) assert.doesNotMatch(JSON.stringify(message.content), CLOCK_TIME);
  }
});

Then(
  "{string} arrived at the same moment in both, between {string} and {string}",
  function (this: Context, id: string, from: string, to: string) {
    const runs = dayRunsOf(this);
    assert.equal(runs.length, 2, `the day ran ${runs.length} times`);
    const [first, second] = runs.map((each) => each.draws.get(id));
    assert.ok(first !== undefined && first.length > 0, `"${id}" drew nothing in the first replica`);
    assert.deepEqual(second, first, `"${id}" drew other values in the second replica`);
    // With the background's clock, a depot minute is 10 ms of the run, from "09:00".
    const runMs = (time: string) => (Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) - 9 * 60) * 10;
    const arrivals = runs.map((each) => {
      const arrival = each.actions.find((action) => action.component === id);
      assert.ok(arrival !== undefined, `"${id}" never arrived`);
      return arrival.startedAtMs - each.startedAtMs;
    });
    for (const ms of arrivals) assert.ok(ms >= runMs(from) && ms <= runMs(to) + SAME_MOMENT_MS, `"${id}" arrived ${ms} ms into the run`);
    assert.ok(Math.abs(arrivals[0] - arrivals[1]) < SAME_MOMENT_MS, `"${id}" arrived ${arrivals[0]} and ${arrivals[1]} ms into the runs`);
  },
);

Given("the thing {string} arrives {string} instead", function (this: Context, id: string, round: string) {
  editWorld(this, (world) => {
    const thing = ((world.things ?? []) as TomlTable[]).find((each) => each.id === id);
    assert.ok(thing !== undefined, `the world declares no thing "${id}"`);
    thing.arrives = round;
  });
});

Given("the world has no porter", function (this: Context) {
  editWorld(this, (world) => {
    delete world.porter;
  });
});

Given("the place {string} is added with no passage, and the porter enters {string}", function (this: Context, place: string, enters: string) {
  editWorld(this, (world) => {
    world.places = [...((world.places ?? []) as TomlTable[]), { name: place }];
    world.porter = { ...tableOf(world, "porter"), enters };
  });
});

Given("the visitor {string} is declared while the person {string} is also declared", function (this: Context, visitor: string, person: string) {
  assert.equal(visitor, person);
  editWorld(this, (world) => {
    const declared = ((world.people ?? []) as TomlTable[]).find((each) => each.id === person);
    assert.ok(declared !== undefined, `the world has no person "${person}"`);
    world.visitors = [
      ...((world.visitors ?? []) as TomlTable[]),
      { id: visitor, name: declared.name, description: declared.description, enters: declared.place, arrives_between: ["09:05", "09:05"], waits_minutes: 20, comes_for: [] },
    ];
  });
});

Then("it gives the clock's start time {string} and the time scale {int}", function (this: Context, start: string, scale: number) {
  const clock = under(under(this.labOutput ?? "", '## Condition "base"'), "### Clock");
  assert.equal(itemOf(clock, "Start"), start);
  assert.equal(itemOf(clock, "Time scale"), `${scale} depot seconds for each second of the run`);
});
