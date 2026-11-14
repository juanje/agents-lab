import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import type { JsonObject } from "@earendil-works/pi-ai";
import type { TomlTable } from "smol-toml";
import { where } from "../../src/engine/places.ts";
import { type ScriptedAnswer, ScriptedModel } from "../../src/engine/scripted-model.ts";
import { scenarioLibrary } from "../../src/scenarios/library.ts";
import { type Workplace, workplaceScenario } from "../../src/scenarios/workplace.ts";
import type { Context } from "../support/context.ts";
import { stateAt } from "./acting.steps.ts";
import { completedIndex, experimentFileOf, idleModels, logOf, runLab } from "./lab.steps.ts";
import { samplesIn } from "./metric.steps.ts";
import { withBase } from "./neighbourhood.steps.ts";
import { script } from "./tool.steps.ts";
import { editText } from "./workplace.steps.ts";
import { WORLD, situations } from "./workplace-tools.steps.ts";

/** The worker, the workplace's one agent. */
const WORKER = "worker";

/** The scripted model the worker runs on, as "lab run" resolves it. */
export const MODEL = "faux/scripted";

/** FR-WORKPLACE-02's durations, as its contract's background gives them. */
export const DURATIONS = { look_ms: 10, examine_ms: 10, take_ms: 10, put_ms: 10, give_ms: 10, ms_per_word: 5, ms_per_length: 20 };

/** The workplace's metrics, as the contract names them. */
const METRICS = ["holds", "predicates", "sensed_at_ms", "acted_at_ms", "settled_at_ms", "exploration", "entries_after", "notes_after"];

Given(
  "the workplace scenario with the world and situations of FR-WORKPLACE-01, both situations chosen, {string} placed in {string}, {string} {int}, and the tools' durations of FR-WORKPLACE-02",
  function (this: Context, situation: string, place: string, limitKey: string, limit: number) {
    assert.equal(situation, "open-box", 'the steps place only FR-WORKPLACE-01\'s situation "open-box"');
    // The situation can be only in that place, so whatever the seed draws places it there. The worker wakes at once.
    this.libraryScenario = withBase(workplaceScenario, {
      world: WORLD,
      situations: situations(JSON.stringify([place])),
      situation_keys: "",
      chosen_situations: ["open-box", "jar"],
      [limitKey]: limit,
      durations: DURATIONS,
      rhythm: { min_ms: 0, max_ms: 0 },
    });
    // The worker ends its only activation at once unless the scenario scripts its turns.
    idleModels(this, [MODEL]);
    this.experimentFile = experimentFileOf({
      id: "workplace-measures",
      scenario: workplaceScenario.name,
      models: [MODEL],
      replicas: 1,
      seed: 42,
      activationsPerAgent: 1,
      conditions: { base: {} },
    });
    this.runInstead = async () => {
      await runMeasured(this);
      assert.equal(this.labError, undefined, `"lab run" failed: ${this.labError?.message}`);
    };
  },
);

/**
 * Runs the workplace with "lab run", in the world the scenario set up: each change it makes to the world as the engine
 * builds it is made before anything happens in it.
 */
async function runMeasured(context: Context): Promise<void> {
  const base = context.libraryScenario as typeof workplaceScenario;
  const setUp: typeof workplaceScenario = {
    ...base,
    initialState: (configuration, random) =>
      context.workplaceSetups.reduce((state: Workplace, setup) => setup(state), base.initialState(configuration, random)),
  };
  context.library = new Map([...scenarioLibrary, [setUp.name, setUp]]);
  await runLab(context, "run");
}

/** A list as the contract writes it inside brackets, such as "shelf", "person:ferrer". */
function listOf(items: string): string[] {
  return JSON.parse(`[${items}]`) as string[];
}

/** Gives a situation these reserved keys in "situation_keys", in place of any it had. */
function giveKeys(context: Context, situation: string, keys: TomlTable): void {
  editText(context, "situation_keys", (text) => {
    text[situation] = keys;
  });
}

Given(
  '"situation_keys" gives {string} the predicates where {string} in [{}] and not_given [{}]',
  function (this: Context, situation: string, thing: string, locations: string, things: string) {
    giveKeys(this, situation, { where: { [thing]: listOf(locations) }, not_given: listOf(things) });
  },
);

Given("it gives {string} the predicate not_where {string} in [{}]", function (this: Context, situation: string, thing: string, locations: string) {
  giveKeys(this, situation, { not_where: { [thing]: listOf(locations) } });
});

Given('"situation_keys" gives {string} the predicate where {string} in [{}]', function (this: Context, situation: string, thing: string, locations: string) {
  giveKeys(this, situation, { where: { [thing]: listOf(locations) } });
});

Given("the experiment's {string} is {int}", function (this: Context, key: string, value: number) {
  this.experimentFile[key] = value;
});

/** The argument the first value of each tool's call names, and the one after "into" or "to". */
const ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  go: ["place"],
  look: [],
  read: ["thing"],
  examine: ["thing"],
  check_time: [],
  take: ["thing"],
  put: ["thing", "into"],
  give: ["thing", "person"],
  record: ["entry"],
  note: ["text"],
  wait: ["minutes"],
};

/**
 * A call as the contract writes it, such as "go" to "store", "look", "put" with "note" into "shelf", or "wait" with 20
 * minutes, whose minutes are a number.
 */
function callOf(written: string): { tool: string; arguments: JsonObject } {
  const minutes = /^"([^"]+)" with (\d+) minutes$/.exec(written.trim());
  if (minutes !== null) {
    const [, tool, value] = minutes;
    assert.deepEqual(ARGUMENTS[tool], ["minutes"], `the workplace's "${tool}" takes no minutes`);
    return { tool, arguments: { minutes: Number(value) } };
  }
  // An argument may be written with its kind, as in "read" with the thing "book" or "record" with the entry "…".
  const match = /^"([^"]+)"(?: (?:with|to)(?: the \w+)? "([^"]+)")?(?: (?:into|to)(?: the \w+)? "([^"]+)")?$/.exec(written.trim());
  assert.ok(match !== null, `the steps do not read the call ${written}`);
  const [, tool, first, second] = match;
  const names = ARGUMENTS[tool];
  assert.ok(names !== undefined, `the workplace has no tool "${tool}"`);
  const values = [first, second].filter((value) => value !== undefined);
  assert.equal(values.length, names.length, `the call ${written} gives ${values.length} of the ${names.length} arguments of "${tool}"`);
  return { tool, arguments: Object.fromEntries(names.map((name, index) => [name, values[index]])) };
}

/**
 * What the contract says of one of the worker's calls after it, as in "go" with "counter", which leaves "store" at once
 * and arrives 40 milliseconds into the run: the call is the tool's nth by the worker, counted from 0.
 */
interface Claim {
  tool: string;
  nth: number;
  claim: string;
}

/**
 * The worker's answers as the contract writes its turns, such as call "look", then wait 130 milliseconds, then call
 * "check_time": each call in an answer of its own, after the wait written before it, if any; and what the contract
 * says of a call after it, with ", which", checked once the run has ended.
 */
function answersOf(turns: string): { answers: ScriptedAnswer[]; claims: Claim[] } {
  const answers: ScriptedAnswer[] = [];
  const claims: Claim[] = [];
  let delayMs = 0;
  for (const written of turns.split(", then ")) {
    const wait = /^wait (\d+) milliseconds$/.exec(written);
    if (wait !== null) {
      delayMs = Number(wait[1]);
      continue;
    }
    const [call, claim] = written.split(", which ");
    const { tool, arguments: args } = callOf(call.replace(/^call /, ""));
    if (claim !== undefined) claims.push({ tool, nth: answers.filter(({ toolCalls }) => toolCalls?.[0]?.name === tool).length, claim });
    answers.push({ toolCalls: [{ name: tool, arguments: args }], delayMs });
    delayMs = 0;
  }
  return { answers, claims };
}

/** Less than this after the moment the contract gives, a call ended at it: the engine takes a moment to end a call. */
const ENDED_WITHIN_MS = 20;

/**
 * Checks, once the run has ended, what the contract says of a call: that it leaves a place at once, as the run starts,
 * and arrives a while into the run.
 */
function checkClaim(context: Context, { tool, nth, claim }: Claim): void {
  const match = /^(?:leaves "([^"]+)" at once and )?arrives (\d+) milliseconds into the run$/.exec(claim);
  assert.ok(match !== null, `the steps do not read what the contract says of the "${tool}" call: ${claim}`);
  const [, leaves, arrivesAtMs] = match;
  const call = context.toolCalls?.filter((each) => each.agent === WORKER && each.tool === tool)[nth];
  assert.ok(call !== undefined && context.runStartedAtMs !== undefined, `the worker made no "${tool}" call number ${nth + 1}`);
  const startedAtMs = call.startedAtMs - context.runStartedAtMs;
  const endedAtMs = call.endedAtMs - context.runStartedAtMs;
  if (leaves !== undefined) {
    assert.ok(startedAtMs <= ENDED_WITHIN_MS, `the "${tool}" call started ${Math.round(startedAtMs)} ms into the run, not at once`);
    const at = where(stateAt<Workplace>(context, call.startedAtMs).space, WORKER);
    assert.deepEqual(at, { place: leaves }, `the worker was not in "${leaves}" as the "${tool}" call started`);
  }
  const arrives = Number(arrivesAtMs);
  assert.ok(endedAtMs >= arrives && endedAtMs <= arrives + ENDED_WITHIN_MS, `the "${tool}" call arrived ${Math.round(endedAtMs)} ms into the run, not ${arrives}`);
}

/** Scripts the worker's turns as the contract writes them, such as `call "look", then wait 130 milliseconds`, then ends. */
export function scriptWorker(context: Context, turns: string): void {
  const { answers, claims } = answersOf(turns);
  for (const claim of claims) context.setupChecks.push(() => checkClaim(context, claim));
  // FR-WORKPLACE-02 assembles its run around the worker's own model, by the worker's name.
  if (context.assembleRun !== undefined) {
    script(context, WORKER, [...answers, { text: "Done.", delayMs: 0 }]);
    return;
  }
  const model = new ScriptedModel([...answers, { text: "Done.", delayMs: 0 }], MODEL.split("/")[1]);
  context.models.set(MODEL, model);
  context.labModels.set(MODEL, model);
}

Given(/^the worker's scripted turns ((?:call|wait) .+), then end$/, function (this: Context, turns: string) {
  scriptWorker(this, turns);
});

When("the run's first metric sample is taken", async function (this: Context) {
  this.firstSampleOnly = true;
  await this.runInstead?.();
});

/** The lines of the log of the experiment's only run. */
function runLog(context: Context): ReturnType<typeof logOf> {
  const index = completedIndex(context);
  assert.equal(index.length, 1, `the index lists ${index.length} runs`);
  return logOf(context, index[0].runId);
}

/** The metrics of the sample the scenario checks: the run's first, when it takes only that one; its last otherwise. */
function measured(context: Context): Record<string, unknown> {
  const samples = samplesIn(runLog(context));
  const sample = context.firstSampleOnly ? samples[0] : samples.at(-1);
  assert.ok(sample !== undefined, "the run's log has no metric sample");
  return sample.metrics;
}

/** A metric's value for a key, a situation's id or a predicate's, or undefined when it gives none. */
function valueOf(context: Context, metric: string, key: string): unknown {
  const values = measured(context)[metric];
  assert.ok(typeof values === "object" && values !== null, `the sample gives "${metric}" as ${JSON.stringify(values)}, not values by key`);
  return (values as Record<string, unknown>)[key];
}

function assertValue(context: Context, metric: string, key: string, expected: number): void {
  assert.equal(valueOf(context, metric, key), expected, `"${metric}" gives "${key}" ${JSON.stringify(valueOf(context, metric, key))}`);
}

Then("{string} gives {int} for {string} and {int} for {string}", function (this: Context, metric: string, first: number, firstKey: string, second: number, secondKey: string) {
  assertValue(this, metric, firstKey, first);
  assertValue(this, metric, secondKey, second);
});

Then(
  "{string} gives {int} for {string}, {int} for {string} and {int} for {string}",
  function (this: Context, metric: string, first: number, firstKey: string, second: number, secondKey: string, third: number, thirdKey: string) {
    assertValue(this, metric, firstKey, first);
    assertValue(this, metric, secondKey, second);
    assertValue(this, metric, thirdKey, third);
  },
);

Then("{string} gives {int} for {string}", function (this: Context, metric: string, value: number, key: string) {
  assertValue(this, metric, key, value);
});

Then(
  "{string}, {string}, {string} and {string} give no value for either situation",
  function (this: Context, first: string, second: string, third: string, fourth: string) {
    for (const metric of [first, second, third, fourth]) {
      for (const situation of ["open-box", "jar"]) {
        assert.equal(valueOf(this, metric, situation), undefined, `"${metric}" gives "${situation}" a value`);
      }
    }
  },
);

/** The worker's calls of a tool, as the run's log records them, in the order it made them. */
function callsOf(context: Context, tool: string): { startedAtMs: number; endedAtMs: number }[] {
  return runLog(context).filter((line) => line.type === "tool_call" && line.agent === WORKER && line.tool === tool) as never;
}

/**
 * Less than this after a moment, a value is that moment: computing it takes the engine a moment, and under the gate's
 * parallel load on a slow machine a call's end is recorded several milliseconds after the world changed.
 */
const SAME_MOMENT_MS = 20;

/** Checks that a metric gives a key the moment the nth call of a tool ended: within the call, at its end. */
function assertEndOf(context: Context, metric: string, key: string, tool: string, nth = 0): void {
  const call = callsOf(context, tool)[nth];
  assert.ok(call !== undefined, `the worker made no call ${nth + 1} of "${tool}"`);
  const value = valueOf(context, metric, key);
  assert.equal(typeof value, "number", `"${metric}" gives "${key}" ${JSON.stringify(value)}`);
  const atMs = value as number;
  assert.ok(atMs >= call.startedAtMs && atMs <= call.endedAtMs && call.endedAtMs - atMs < SAME_MOMENT_MS, `"${metric}" gives "${key}" ${atMs}, not the end of the "${tool}" call from ${call.startedAtMs} to ${call.endedAtMs}`);
}

Then("{string} gives {string} the moment the look ended, and {string} the same moment", function (this: Context, metric: string, first: string, second: string) {
  assertEndOf(this, metric, first, "look");
  assert.equal(valueOf(this, metric, second), valueOf(this, metric, first));
});

Then("{string} gives {string} the moment the {word} ended", function (this: Context, metric: string, key: string, tool: string) {
  assertEndOf(this, metric, key, tool);
});

Then("{string} gives {string} the moment the second {word} ended, when {string} last changed", function (this: Context, metric: string, key: string, tool: string, _predicate: string) {
  assertEndOf(this, metric, key, tool, 1);
});

Then("{string} gives {string} {int} tool calls", function (this: Context, metric: string, key: string, value: number) {
  assertValue(this, metric, key, value);
});

Then("{string} gives {string} {int}", function (this: Context, metric: string, key: string, value: number) {
  assertValue(this, metric, key, value);
});

Then(
  "{string} gives {string} {int}, since the book is not in {string}, and {string} gives it {int}",
  function (this: Context, metric: string, key: string, value: number, place: string, other: string, otherValue: number) {
    // The worker's entry was refused: the book is elsewhere.
    const records = runLog(this).filter((line) => line.type === "tool_call" && line.tool === "record");
    assert.deepEqual(records.map((line) => line.outcome), ["not_here"], `the worker's record in "${place}" was not refused`);
    assertValue(this, metric, key, value);
    assertValue(this, other, key, otherValue);
  },
);

Then(
  "every metric sample in the log gives {string}, {string}, {string}, {string}, {string}, {string}, {string} and {string}",
  // Cucumber gives each parameter its own argument.
  function (this: Context, m1: string, m2: string, m3: string, m4: string, m5: string, m6: string, m7: string, m8: string) {
    assert.deepEqual([m1, m2, m3, m4, m5, m6, m7, m8], METRICS);
    const samples = samplesIn(runLog(this));
    assert.ok(samples.length >= 2, `the log has ${samples.length} metric samples`);
    for (const sample of samples) {
      for (const metric of METRICS) assert.ok(Object.hasOwn(sample.metrics, metric), `a sample at ${sample.atMs} gives no "${metric}"`);
    }
  },
);
