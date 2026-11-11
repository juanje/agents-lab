import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import type { TomlTable, TomlValue } from "smol-toml";
import type { Scenario } from "../../src/engine/scenario.ts";
import type { Context } from "../support/context.ts";
import { tableAt, valueAt } from "./experiment.steps.ts";
import { experimentFileOf, indexOf, logOf, runLab } from "./lab.steps.ts";

Given(
  "an experiment file {string} for the scenario {string}, with the model {string}, {int} replica, {int} activation per agent, and the condition {string}, with no change",
  function (this: Context, id: string, scenario: string, model: string, replicas: number, activationsPerAgent: number, condition: string) {
    this.experimentFile = experimentFileOf({ id, scenario, models: [model], replicas, seed: 1, activationsPerAgent, conditions: { [condition]: {} } });
  },
);

/** A file next to the experiment file, which "lab" writes into the experiments directory under the scenario's home. */
function besideExperimentFile(context: Context, path: string): string {
  return join(context.home, "experiments", path);
}

Given("the file {string}, next to the experiment file, holds {string}", function (this: Context, path: string, text: string) {
  const file = besideExperimentFile(this, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
});

Given("the file {string} now holds {string}", function (this: Context, path: string, text: string) {
  writeFileSync(besideExperimentFile(this, path), text);
});

/** Sets a key of a condition, by its dotted path, to a value, keeping what the condition already changes. */
function conditionSets(context: Context, condition: string, path: string, value: TomlValue): void {
  const conditions = context.experimentFile.conditions as TomlTable;
  assert.ok(Object.hasOwn(conditions, condition), `the experiment file has no condition "${condition}"`);
  conditions[condition] = { ...(conditions[condition] as TomlTable), ...tableAt(path, value) };
}

Given("the condition {string} sets {string} to the material {string}", function (this: Context, condition: string, path: string, file: string) {
  conditionSets(this, condition, path, { file });
});

Given(
  "the condition {string} sets {string} to the held-out material {string}",
  function (this: Context, condition: string, path: string, file: string) {
    conditionSets(this, condition, path, { file, held_out: true });
    // The library's scenario keeps each configuration it is given, so the steps can see what the scenario read.
    const name = String(this.experimentFile.scenario);
    const scenario = this.library?.get(name) as Scenario<unknown> | undefined;
    assert.ok(scenario !== undefined, `the scenario library has no scenario "${name}"`);
    const given = this.configurationsGiven;
    const keeping: Scenario<unknown> = {
      ...scenario,
      initialState: (configuration, random) => {
        given.push(configuration);
        return scenario.initialState(configuration, random);
      },
    };
    this.library = new Map([...(this.library ?? []), [name, keeping]]);
  },
);

/** The directory the scenario's second "lab run" runs in, apart from the first's. */
function anotherDirectory(context: Context): string {
  return join(context.home, "another");
}

Given('"lab run" ran the experiment file into one directory', async function (this: Context) {
  await runLab(this, "run");
  assert.equal(this.labError, undefined, `"lab run" failed: ${this.labError?.message}`);
});

When('"lab run" runs the experiment file into another directory', async function (this: Context) {
  await runLab(this, "run", anotherDirectory(this));
});

/** A material's hash, as the engine gives it, of a text. */
function hashOf(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/** A line of a run's log, as JSON gives it back. */
type LogLine = Record<string, unknown> & { type: string };

/** A material as a run's setup line lists it. */
interface ListedMaterial {
  path: string;
  hash: string;
}

/** The setup line of the only run "lab run" ran into a directory, once it completed. */
function setupLine(context: Context, directory = context.home): LogLine {
  assert.equal(context.labError, undefined, `"lab run" failed: ${context.labError?.message}`);
  const index = indexOf(context, directory);
  assert.equal(index.length, 1, `the index lists ${index.length} runs`);
  const [first] = logOf(context, index[0].runId, directory);
  assert.equal(first.type, "run_setup", `the first line of the run's log is a "${first.type}" line`);
  return first;
}

/** The material a run's setup line lists at a path. */
function listedIn(setup: LogLine, path: string): ListedMaterial {
  const listed = (setup.materials as ListedMaterial[] | undefined)?.find((material) => material.path === path);
  assert.ok(listed !== undefined, `the setup line lists no material "${path}": ${JSON.stringify(setup.materials)}`);
  return listed;
}

Then("the run's setup line lists {string} with the hash of {string}", function (this: Context, path: string, text: string) {
  assert.equal(listedIn(setupLine(this), path).hash, hashOf(text));
});

Then("the two runs' setup lines give different hashes for {string}", function (this: Context, path: string) {
  const [one, another] = [setupLine(this), setupLine(this, anotherDirectory(this))].map((setup) => listedIn(setup, path).hash);
  assert.notEqual(one, another);
});

/** The lines of what "lab inventory" printed, once it did not fail. */
function inventoryLines(context: Context): string[] {
  const printed = context.inventoryOutput;
  assert.ok(printed !== undefined, '"lab inventory" did not run');
  return printed.split("\n");
}

/** The line of the inventory that lists the material at a path. */
function inventoryLineOf(context: Context, path: string): string {
  const lines = inventoryLines(context).filter((line) => line.includes(path));
  assert.equal(lines.length, 1, `the inventory names "${path}" on ${lines.length} lines`);
  return lines[0];
}

Then("it lists the material {string} with the hash of {string}", function (this: Context, path: string, text: string) {
  const line = inventoryLineOf(this, path);
  assert.ok(line.includes(hashOf(text)), `the inventory lists "${path}" without the hash of its text: ${line}`);
});

Then("the inventory lists {string} by its path only", function (this: Context, path: string) {
  const line = inventoryLineOf(this, path);
  assert.ok(!line.includes("sha256:"), `the inventory lists "${path}" with a hash: ${line}`);
});

Then("the scenario was given {string} as {string}", function (this: Context, text: string, path: string) {
  assert.equal(this.labError, undefined, `"lab run" failed: ${this.labError?.message}`);
  assert.ok(this.configurationsGiven.length > 0, "the scenario was given no configuration");
  for (const configuration of this.configurationsGiven) assert.equal(valueAt(configuration, path), text);
});

Then("neither the inventory nor the run's setup line holds {string}", function (this: Context, text: string) {
  assert.ok(!inventoryLines(this).join("\n").includes(text), `the inventory holds "${text}"`);
  assert.ok(!JSON.stringify(setupLine(this)).includes(text), `the run's setup line holds "${text}"`);
});
