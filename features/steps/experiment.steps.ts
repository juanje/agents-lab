import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, type TomlValue, parse, stringify } from "smol-toml";
import { type Experiment, readExperiment } from "../../src/engine/experiment.ts";
import { slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";

/** A table that sets one value at a dotted path such as "slots.count". */
export function tableAt(path: string, value: TomlValue): TomlTable {
  return path.split(".").reduceRight<TomlValue>((inner, key) => ({ [key]: inner }), value) as TomlTable;
}

/** The value at a dotted path of a table, or undefined when the table has none there. */
export function valueAt(table: TomlTable, path: string): TomlValue | undefined {
  let value: TomlValue | undefined = table;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value) || value instanceof Date) return undefined;
    value = Object.hasOwn(value, key) ? value[key] : undefined;
  }
  return value;
}

Given(
  "a valid experiment file {string} for the test scenario {string}, with the model {string}, {int} replicas, the base seed {int}, a time limit of {int} milliseconds, {int} activations per agent, a parallelism limit of {int}, a model turn timeout of {int} milliseconds, and the conditions {string}, with no change, and {string}, which sets {string} to {int}",
  function (
    this: Context,
    id: string,
    scenario: string,
    model: string,
    replicas: number,
    seed: number,
    timeLimitMs: number,
    activationsPerAgent: number,
    parallelismLimit: number,
    modelTurnTimeoutMs: number,
    unchanged: string,
    changed: string,
    path: string,
    value: number,
  ) {
    // The scenario lives in the fixture; these checks keep the scenario's words and the fixture from drifting apart.
    assert.equal(slotsScenario.name, scenario);
    assert.equal(typeof valueAt(parse(slotsScenario.baseConfiguration), path), "number", `the test scenario has no ${path}`);
    this.experimentFile = {
      id,
      scenario,
      models: [model],
      thinking_level: "off",
      replicas,
      seed,
      limits: {
        time_limit_ms: timeLimitMs,
        activations_per_agent: activationsPerAgent,
        parallelism_limit: parallelismLimit,
        model_turn_timeout_ms: modelTurnTimeoutMs,
      },
      conditions: { [unchanged]: {}, [changed]: tableAt(path, value) },
    };
  },
);

Given("the file has no {word}", function (this: Context, field: string) {
  assert.ok(Object.hasOwn(this.experimentFile, field), `the valid file has no field "${field}" to leave out`);
  delete this.experimentFile[field];
});

/** The value a scenario's words give: the text "…", an empty list, or a number written as TOML writes one. */
function valueOf(words: string): TomlValue {
  const text = /^the text "(.*)"$/.exec(words);
  if (text !== null) return text[1];
  if (words === "an empty list") return [];
  assert.match(words, /^-?\d+(\.\d+)?$/, `"${words}" is not a value the steps know`);
  return Number(words);
}

Given("the file sets {string} to {}", function (this: Context, field: string, words: string) {
  this.experimentFile[field] = valueOf(words);
});

When("the engine reads it", function (this: Context) {
  try {
    this.experiment = readExperiment(stringify(this.experimentFile));
  } catch (error) {
    this.readingError = error as Error;
  }
});

/** The experiment as the engine read it. */
function experimentOf(context: Context): Experiment {
  const { experiment } = context;
  assert.ok(experiment !== undefined, `expected the experiment to be read, but reading failed: ${context.readingError?.message}`);
  return experiment;
}

Then(
  "it gives the id {string}, the scenario {string}, {int} conditions, {int} model and {int} replicas with the base seed {int}",
  function (this: Context, id: string, scenario: string, conditions: number, models: number, replicas: number, seed: number) {
    const experiment = experimentOf(this);
    assert.equal(experiment.id, id);
    assert.equal(experiment.scenario, scenario);
    assert.equal(experiment.conditions.length, conditions);
    assert.equal(experiment.models.length, models);
    assert.equal(experiment.replicas, replicas);
    assert.equal(experiment.seed, seed);
  },
);

Then(
  "its limits are a time limit of {int} milliseconds, {int} activations per agent, a parallelism limit of {int} and a model turn timeout of {int} milliseconds",
  function (
    this: Context,
    timeLimitMs: number,
    activationsPerAgent: number,
    parallelismLimit: number,
    modelTurnTimeoutMs: number,
  ) {
    assert.deepEqual(experimentOf(this).limits, { timeLimitMs, activationsPerAgent, parallelismLimit, modelTurnTimeoutMs });
  },
);

/** The change of the condition the experiment names, as a table. */
function changeOf(context: Context, name: string): TomlTable {
  const condition = experimentOf(context).conditions.find((candidate) => candidate.name === name);
  assert.ok(condition !== undefined, `the experiment has no condition "${name}"`);
  return parse(condition.change);
}

Then("its condition {string} sets {string} to {int}", function (this: Context, name: string, path: string, value: number) {
  // Compared as JSON: smol-toml's tables have no prototype, which a strict deep comparison would count as a difference.
  assert.equal(JSON.stringify(changeOf(this, name)), JSON.stringify(tableAt(path, value)));
});

Then("its condition {string} changes nothing", function (this: Context, name: string) {
  assert.deepEqual(Object.keys(changeOf(this, name)), []);
});

/** The error reading gave, which must be a refusal and not a read experiment. */
function readingErrorOf(context: Context): Error {
  assert.equal(context.experiment, undefined, "expected reading to fail, but the engine read the experiment");
  assert.ok(context.readingError !== undefined);
  return context.readingError;
}

Then("reading fails with an error that names {string}", function (this: Context, field: string) {
  // The field is named in quotes, so a short name such as "id" is not found inside another word.
  assert.ok(readingErrorOf(this).message.includes(`"${field}"`), `the error does not name "${field}": ${this.readingError?.message}`);
});

Then(
  "reading fails with an error that names {string} and {string}",
  function (this: Context, field: string, expected: string) {
    const { message } = readingErrorOf(this);
    assert.ok(message.includes(`"${field}"`), `the error does not name "${field}": ${message}`);
    assert.ok(message.includes(expected), `the error does not say "${expected}": ${message}`);
  },
);
