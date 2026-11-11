import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { type TomlTable, type TomlValue, parse } from "smol-toml";
import { RHYTHM_CHANNEL } from "../../src/engine/stimuli.ts";
import type { Context } from "../support/context.ts";
import { tableAt, valueAt } from "./experiment.steps.ts";
import { completedIndex, experimentFileOf, failedNaming, logOf } from "./lab.steps.ts";

Given(
  "an experiment file {string} for the scenario {string}, with the model {string}, {int} replica, the base seed {int} and {int} activation per agent, and no conditions",
  function (this: Context, id: string, scenario: string, model: string, replicas: number, seed: number, activationsPerAgent: number) {
    const file = experimentFileOf({ id, scenario, models: [model], replicas, seed, activationsPerAgent, conditions: {} });
    delete file.conditions;
    this.experimentFile = file;
  },
);

/** Adds a factor to the experiment file, after those it has, with its levels in order, each a change. */
function addFactor(context: Context, name: string, levels: readonly [string, TomlTable][]): void {
  const factors = (context.experimentFile.factors ?? {}) as TomlTable;
  assert.ok(!Object.hasOwn(factors, name), `the experiment file already has the factor "${name}"`);
  context.experimentFile.factors = { ...factors, [name]: Object.fromEntries(levels) };
}

Given(
  "the factor {string} with the levels {string}, which sets {string} to {int}, and {string}, which sets {string} to {int}",
  function (this: Context, name: string, first: string, firstPath: string, firstValue: number, second: string, secondPath: string, secondValue: number) {
    addFactor(this, name, [
      [first, tableAt(firstPath, firstValue)],
      [second, tableAt(secondPath, secondValue)],
    ]);
  },
);

Given(
  "the factor {string} with the levels {string}, with no change, and {string}, which sets {string} to {int}",
  function (this: Context, name: string, first: string, second: string, path: string, value: number) {
    addFactor(this, name, [
      [first, {}],
      [second, tableAt(path, value)],
    ]);
  },
);

Given("the file declares no factors", function (this: Context) {
  assert.ok(Object.hasOwn(this.experimentFile, "factors"), "the experiment file declares no factors to leave out");
  assert.ok(!Object.hasOwn(this.experimentFile, "conditions"), "the experiment file gives conditions of its own");
  delete this.experimentFile.factors;
});

/** Sets a key of the experiment file's common change, by its dotted path, keeping what it already sets. */
function commonSets(context: Context, path: string, value: TomlValue): void {
  const common = (context.experimentFile.common ?? {}) as TomlTable;
  const [key] = path.split(".");
  const inner = tableAt(path, value)[key] as TomlTable;
  context.experimentFile.common = { ...common, [key]: { ...((common[key] as TomlTable | undefined) ?? {}), ...inner } };
}

Given("the common change sets {string} to {int} and {string} to {int}", function (this: Context, first: string, firstValue: number, second: string, secondValue: number) {
  commonSets(this, first, firstValue);
  commonSets(this, second, secondValue);
});

Given("the common change sets {string} to the material {string}", function (this: Context, path: string, file: string) {
  commonSets(this, path, { file });
});

/** Adds a condition of the file's own, after those it has. */
function addCondition(context: Context, name: string, change: TomlTable): void {
  const conditions = (context.experimentFile.conditions ?? {}) as TomlTable;
  assert.ok(!Object.hasOwn(conditions, name), `the experiment file already has the condition "${name}"`);
  context.experimentFile.conditions = { ...conditions, [name]: change };
}

Given("the condition {string}, which sets {string} to {int}", function (this: Context, name: string, path: string, value: number) {
  addCondition(this, name, tableAt(path, value));
});

Given("the condition {string}, with no change", function (this: Context, name: string) {
  addCondition(this, name, {});
});

Then(
  "{int} runs ran, with the conditions {string}, {string}, {string}, {string} and {string}, in that order",
  function (this: Context, count: number, first: string, second: string, third: string, fourth: string, fifth: string) {
    const conditions = [first, second, third, fourth, fifth];
    const index = completedIndex(this);
    assert.equal(index.length, count, `the index lists ${index.length} runs`);
    assert.deepEqual(
      index.map((line) => line.condition),
      conditions,
    );
  },
);

Then("{int} runs ran, none of them with the condition {string}", function (this: Context, count: number, condition: string) {
  const ran = completedIndex(this).map((line) => line.condition);
  assert.equal(ran.length, count, `the index lists ${ran.length} runs: ${ran.join(", ")}`);
  assert.ok(!ran.includes(condition), `a run had the condition "${condition}"`);
});

Then("{int} runs ran, the last with the condition {string}", function (this: Context, count: number, condition: string) {
  const ran = completedIndex(this).map((line) => line.condition);
  assert.equal(ran.length, count, `the index lists ${ran.length} runs: ${ran.join(", ")}`);
  assert.equal(ran.at(-1), condition);
});

/** A line of a run's log, as JSON gives it back. */
type LogLine = Record<string, unknown> & { type: string };

/** The index line of the only run of a condition. */
function indexLineOf(context: Context, condition: string): ReturnType<typeof completedIndex>[number] {
  const lines = completedIndex(context).filter((line) => line.condition === condition);
  assert.equal(lines.length, 1, `${lines.length} runs had the condition "${condition}"`);
  return lines[0];
}

/** The setup line of the only run of a condition. */
function setupLineOf(context: Context, condition: string): LogLine {
  const [first] = logOf(context, indexLineOf(context, condition).runId);
  assert.equal(first.type, "run_setup", `the first line of the run's log is a "${first.type}" line`);
  return first;
}

/** The resolved configuration the setup line of a condition's run gives. */
function configurationOf(context: Context, condition: string): TomlTable {
  return setupLineOf(context, condition).configuration as TomlTable;
}

Then("the run of {string} had {string} as {int}", function (this: Context, condition: string, path: string, value: number) {
  assert.equal(valueAt(configurationOf(this, condition), path), value);
});

Then(
  "the run of {string} had {string} as {int} and {string} as {int}",
  function (this: Context, condition: string, first: string, firstValue: number, second: string, secondValue: number) {
    const configuration = configurationOf(this, condition);
    assert.equal(valueAt(configuration, first), firstValue);
    assert.equal(valueAt(configuration, second), secondValue);
  },
);

Then("the run of {string} had the base configuration", function (this: Context, condition: string) {
  const scenario = this.library?.get(String(this.experimentFile.scenario));
  assert.ok(scenario !== undefined, "the scenario library has no scenario for the experiment");
  // Compared as JSON: smol-toml's tables have no prototype, which a strict deep comparison would count as a difference.
  assert.equal(JSON.stringify(configurationOf(this, condition)), JSON.stringify(parse(String(scenario.baseConfiguration))));
});

Then("every run had {string} as {int}", function (this: Context, path: string, value: number) {
  for (const { runId, condition } of completedIndex(this)) {
    const [setup] = logOf(this, runId);
    assert.equal(valueAt(setup.configuration as TomlTable, path), value, `the run of "${condition}" had another ${path}`);
  }
});

/** The levels a condition's run gives in its setup line and in its index line, or undefined where it gives none. */
function levelsOf(context: Context, condition: string): { setup: unknown; index: unknown } {
  const index = indexLineOf(context, condition) as unknown as Record<string, unknown>;
  return { setup: setupLineOf(context, condition).levels, index: index.levels };
}

Then(
  "the setup line and the index line of the run of {string} give the level {string} for {string} and {string} for {string}",
  function (this: Context, condition: string, firstLevel: string, firstFactor: string, secondLevel: string, secondFactor: string) {
    const expected = { [firstFactor]: firstLevel, [secondFactor]: secondLevel };
    const { setup, index } = levelsOf(this, condition);
    assert.deepEqual(setup, expected, "the setup line gives other levels");
    assert.deepEqual(index, expected, "the index line gives other levels");
  },
);

Then("those of the run of {string} give no levels", function (this: Context, condition: string) {
  const { setup, index } = levelsOf(this, condition);
  assert.equal(setup, undefined, "the setup line gives levels");
  assert.equal(index, undefined, "the index line gives levels");
});

Then("in every run agent {string}'s rhythm stimulus has the content {string}", function (this: Context, agent: string, content: string) {
  const index = completedIndex(this);
  assert.ok(index.length > 0, "no run ran");
  for (const { runId, condition } of index) {
    const stimulus = logOf(this, runId).find((line) => line.type === "stimulus" && line.agent === agent && line.channel === RHYTHM_CHANNEL);
    assert.ok(stimulus !== undefined, `the log of the run of "${condition}" has no rhythm stimulus for agent "${agent}"`);
    assert.equal(stimulus.content, content, `the run of "${condition}"`);
  }
});

Then("it fails with an error that names {string}, {string} and {string}", function (this: Context, first: string, second: string, third: string) {
  failedNaming(this, [first, second, third]);
});
