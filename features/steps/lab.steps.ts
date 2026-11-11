import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";
import type { Api, Model } from "@earendil-works/pi-ai";
import { type TomlTable, stringify } from "smol-toml";
import { lab } from "../../src/cli/lab.ts";
import { replicaSeed } from "../../src/engine/experiment.ts";
import { type ConditionInventory, inventoryMarkdown } from "../../src/engine/inventory.ts";
import { type Scenario, loadScenario } from "../../src/engine/scenario.ts";
import { ScriptedModel } from "../../src/engine/scripted-model.ts";
import { scenarioLibrary } from "../../src/scenarios/library.ts";
import { slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { tableAt } from "./experiment.steps.ts";
import { declaring } from "./scenario.steps.ts";

/** How many answers each scripted model holds: more than all the turns of an experiment here. */
const ANSWERS = 50;

Given(
  "the test scenario {string} is in the scenario library, with agents {string} and {string}",
  function (this: Context, name: string, first: string, second: string) {
    assert.equal(slotsScenario.name, name);
    this.library = new Map([...scenarioLibrary, [name, declaring(slotsScenario, [first, second])]]);
  },
);

/** Scripted models by name, whose agents end every turn without a tool call, for "lab" to resolve. */
function idleModels(context: Context, names: readonly string[]): void {
  for (const name of names) {
    const model = new ScriptedModel(Array.from({ length: ANSWERS }, () => ({ text: "Nothing to do.", delayMs: 0 })), name.split("/")[1]);
    // Kept by name, so "no model was called" checks every one of them.
    context.models.set(name, model);
    context.labModels.set(name, model);
  }
}

Given(
  "the scripted models {string} and {string}, whose agents end every turn without a tool call",
  function (this: Context, first: string, second: string) {
    idleModels(this, [first, second]);
  },
);

Given("the scripted model {string}, whose agents end every turn without a tool call", function (this: Context, name: string) {
  idleModels(this, [name]);
});

Given(
  "an experiment file {string} for the scenario {string}, with the model {string}, {int} replica, the base seed {int}, {int} activation per agent, and the condition {string}, which sets {string} to {int}",
  function (this: Context, id: string, scenario: string, model: string, replicas: number, seed: number, activationsPerAgent: number, condition: string, path: string, value: number) {
    this.experimentFile = {
      id,
      scenario,
      models: [model],
      replicas,
      seed,
      // Limits no run here reaches but its activations.
      limits: { time_limit_ms: 60_000, activations_per_agent: activationsPerAgent, parallelism_limit: 10, model_turn_timeout_ms: 10_000 },
      conditions: { [condition]: tableAt(path, value) },
    };
  },
);

Given(
  "an experiment file {string} for the scenario {string}, with the models {string} and {string}, {int} replicas, the base seed {int}, {int} activation per agent, and the conditions {string}, with no change, and {string}, which sets {string} to {int}",
  function (
    this: Context,
    id: string,
    scenario: string,
    first: string,
    second: string,
    replicas: number,
    seed: number,
    activationsPerAgent: number,
    unchanged: string,
    changed: string,
    path: string,
    value: number,
  ) {
    this.experimentFile = {
      id,
      scenario,
      models: [first, second],
      replicas,
      seed,
      // Limits no run here reaches but its activations.
      limits: { time_limit_ms: 60_000, activations_per_agent: activationsPerAgent, parallelism_limit: 10, model_turn_timeout_ms: 10_000 },
      conditions: { [unchanged]: {}, [changed]: tableAt(path, value) },
    };
  },
);

Given("the experiment file names the scenario {string}", function (this: Context, name: string) {
  this.experimentFile.scenario = name;
});

Given("the experiment file names the model {string}", function (this: Context, name: string) {
  this.experimentFile.models = [...(this.experimentFile.models as string[]), name];
});

Given(
  "the experiment file has a condition {string} that sets {string} to {int}",
  function (this: Context, name: string, path: string, value: number) {
    this.experimentFile.conditions = { ...(this.experimentFile.conditions as TomlTable), [name]: tableAt(path, value) };
  },
);

Given("the scripted model {string}'s session fails to open", function (this: Context, name: string) {
  assert.ok(this.labModels.has(name), `there is no scripted model "${name}"`);
  this.labModels.set(name, {
    // Opening the session asks for its model, and this one has none to give.
    get model(): Model<Api> {
      throw new Error("this model cannot be given to a session");
    },
  });
});

/**
 * Runs "lab" with a command on the scenario's experiment file, written under its home, from its home, with its scenario
 * library and its models by name; it keeps what the command printed, or the error it failed with.
 */
export async function runLab(context: Context, command: string): Promise<void> {
  const library = context.library;
  assert.ok(library !== undefined, "the scenario gives no scenario library");
  const directory = join(context.home, "experiments");
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${String(context.experimentFile.id)}.toml`);
  writeFileSync(file, stringify(context.experimentFile));
  const model = async (name: string) => {
    const found = context.labModels.get(name);
    if (found === undefined) throw new Error(`No model is named "${name}"`);
    return found;
  };
  let printed = "";
  try {
    await lab([command, file], { directory: context.home, print: (text) => (printed += text), scenarios: library, model });
    context.labOutput = printed;
  } catch (error) {
    context.labError = error as Error;
  }
}

When('"lab run" runs the experiment file', async function (this: Context) {
  await runLab(this, "run");
});

/** The experiment's runs directory, under the directory "lab run" ran in. */
function runsDirectory(context: Context): string {
  return join(context.home, "runs", String(context.experimentFile.id));
}

/** A line of the experiment's index. */
interface IndexLine {
  runId: string;
  condition: string;
  model: string;
  replica: number;
  seed: number;
  status: string;
}

/** The lines of the experiment's index, parsed. */
function indexOf(context: Context): IndexLine[] {
  const path = join(runsDirectory(context), "index.jsonl");
  assert.ok(existsSync(path), `"lab run" wrote no index${context.labError === undefined ? "" : `; it failed: ${context.labError.message}`}`);
  const text = readFileSync(path, "utf8");
  assert.ok(text.endsWith("\n"), "the index does not end with a line break");
  return text.slice(0, -1).split("\n").map((line) => JSON.parse(line) as IndexLine);
}

/** The index of an experiment that completed: "lab run" did not fail. */
function completedIndex(context: Context): IndexLine[] {
  assert.equal(context.labError, undefined, `"lab run" failed: ${context.labError?.message}`);
  return indexOf(context);
}

/** The file names of the run logs in the experiment's runs directory: every JSONL file but the index. */
export function runLogs(context: Context): string[] {
  const directory = runsDirectory(context);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((file) => file.endsWith(".jsonl") && file !== "index.jsonl");
}

/** A line of a run's log, as JSON gives it back. */
type LogLine = Record<string, unknown> & { type: string };

/** The lines of a run's log, by its run id. */
export function logOf(context: Context, runId: string): LogLine[] {
  const text = readFileSync(join(runsDirectory(context), `${runId}.jsonl`), "utf8");
  return text.slice(0, -1).split("\n").map((line) => JSON.parse(line) as LogLine);
}

/** Every time a log line gives, by performance.now(). */
function timesOf(line: LogLine): number[] {
  return ["wokeAtMs", "endedAtMs", "startedAtMs", "deliveredAtMs"].flatMap((field) => (typeof line[field] === "number" ? [line[field]] : []));
}

/** The names of the experiment file's conditions. */
function conditionNames(context: Context): string[] {
  return Object.keys(context.experimentFile.conditions as TomlTable);
}

Then("{int} runs ran, one for each condition, model and replica", function (this: Context, count: number) {
  const index = completedIndex(this);
  assert.equal(index.length, count, `the index lists ${index.length} runs`);
  const expected = conditionNames(this).flatMap((condition) =>
    (this.experimentFile.models as string[]).flatMap((model) =>
      Array.from({ length: this.experimentFile.replicas as number }, (_, replica) => `${condition} | ${model} | ${replica + 1}`),
    ),
  );
  assert.deepEqual(index.map((line) => `${line.condition} | ${line.model} | ${line.replica}`).sort(), expected.sort());
  assert.equal(runLogs(this).length, count, `the runs directory holds ${runLogs(this).length} run logs`);
});

Then("no two runs overlapped in time", function (this: Context) {
  const spans = completedIndex(this).map(({ runId }) => {
    const times = logOf(this, runId).flatMap(timesOf);
    assert.ok(times.length > 0, `run ${runId}'s log gives no time`);
    return { runId, fromMs: Math.min(...times), toMs: Math.max(...times) };
  });
  spans.sort((one, other) => one.fromMs - other.fromMs);
  for (let index = 1; index < spans.length; index += 1) {
    const [before, after] = [spans[index - 1], spans[index]];
    assert.ok(after.fromMs >= before.toMs, `run ${after.runId} started before run ${before.runId} ended`);
  }
});

Then("every agent of each run used that run's model", function (this: Context) {
  for (const { runId, model } of completedIndex(this)) {
    const scripted = this.models.get(model);
    assert.ok(scripted !== undefined, `the index names a model "${model}" the scenario did not set up`);
    // The log names the model that answered in Pi's provider/id form, which for a scripted model is its own provider's.
    const answered = `${scripted.model.provider}/${scripted.model.id}`;
    const turns = logOf(this, runId).filter((line) => line.type === "model_turn");
    assert.deepEqual([...new Set(turns.map((turn) => turn.agent))].sort(), ["a", "b"], `not every agent of run ${runId} made a turn`);
    for (const turn of turns) assert.equal(turn.model, answered, `agent "${String(turn.agent)}" of run ${runId} used another model`);
  }
});

Then("replica {int} and replica {int} have different seeds", function (this: Context, first: number, second: number) {
  const seedOf = (replica: number) => completedIndex(this).find((line) => line.replica === replica)?.seed;
  assert.notEqual(seedOf(first), undefined, `no run of replica ${first}`);
  assert.notEqual(seedOf(first), seedOf(second));
});

Then("each replica has the same seed in every condition and model", function (this: Context) {
  const seeds = new Map<number, Set<number>>();
  for (const { replica, seed } of completedIndex(this)) seeds.set(replica, (seeds.get(replica) ?? new Set()).add(seed));
  for (const [replica, given] of seeds) assert.equal(given.size, 1, `replica ${replica} has the seeds ${[...given].join(", ")}`);
});

Then("{string} holds {int} run logs", function (this: Context, directory: string, count: number) {
  assert.equal(directory, `runs/${String(this.experimentFile.id)}/`);
  assert.equal(this.labError, undefined, `"lab run" failed: ${this.labError?.message}`);
  assert.equal(runLogs(this).length, count, `it holds ${runLogs(this).length} run logs`);
});

Then(
  "{string} has one line per run, with its run id, condition, model, replica, seed and {string}",
  function (this: Context, path: string, status: string) {
    assert.equal(path, `runs/${String(this.experimentFile.id)}/index.jsonl`);
    const index = completedIndex(this);
    assert.equal(index.length, runLogs(this).length, "the index does not list one line per run");
    for (const line of index) {
      assert.deepEqual(Object.keys(line).sort(), ["condition", "model", "replica", "runId", "seed", "status"]);
      assert.equal(line.status, status);
    }
  },
);

Then("each line's run id names one of the run logs", function (this: Context) {
  const logs = new Set(runLogs(this));
  for (const { runId } of completedIndex(this)) assert.ok(logs.has(`${runId}.jsonl`), `no run log is named for run ${runId}`);
});

Then("each agent's log in every run has exactly {int} activation(s)", function (this: Context, count: number) {
  for (const { runId } of completedIndex(this)) {
    const activations = logOf(this, runId).filter((line) => line.type === "activation");
    for (const agent of ["a", "b"]) {
      const made = activations.filter((line) => line.agent === agent).length;
      assert.equal(made, count, `agent "${agent}" made ${made} activations in run ${runId}`);
    }
  }
});

Then("it fails with an error that names {string}", function (this: Context, name: string) {
  assert.ok(this.labError !== undefined, '"lab run" did not fail');
  assert.ok(this.labError.message.includes(name), `the error does not name "${name}": ${this.labError.message}`);
});

Then("no run log was written", function (this: Context) {
  assert.deepEqual(runLogs(this), []);
});

Then('{string} ends with a line that says that run stopped', function (this: Context, path: string) {
  assert.equal(path, `runs/${String(this.experimentFile.id)}/index.jsonl`);
  const last = indexOf(this).at(-1);
  assert.ok(last !== undefined, "the index is empty");
  assert.equal(last.status, "stopped");
});

Then("no run started after it", function (this: Context) {
  const index = indexOf(this);
  assert.equal(index.at(-1)?.status, "stopped");
  assert.equal(runLogs(this).length, index.length, "a run wrote a log the index does not list");
});

/** The first line of the log of the experiment's only run, once "lab run" completed. */
function firstLine(context: Context): LogLine {
  const index = completedIndex(context);
  assert.equal(index.length, 1, `the index lists ${index.length} runs`);
  const first = logOf(context, index[0].runId)[0];
  assert.equal(first.type, "run_setup", `the first line of the run's log is a "${first.type}" line`);
  return first;
}

/** Runs git in this repository, the code "lab run" ran, and gives what it prints. */
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: fileURLToPath(new URL("../..", import.meta.url)), encoding: "utf8" });
}

Then(
  "the first line of the run's log gives its run id, the experiment {string}, the condition {string} and the resolved configuration, with {string} as {int}",
  function (this: Context, experiment: string, condition: string, path: string, value: number) {
    const first = firstLine(this);
    const [{ runId, seed }] = completedIndex(this);
    assert.equal(first.runId, runId);
    assert.equal(first.experiment, experiment);
    assert.equal(first.condition, condition);
    const scenario = this.library?.get(String(this.experimentFile.scenario)) as Partial<Scenario<unknown>>;
    const change = stringify((this.experimentFile.conditions as TomlTable)[condition] as TomlTable);
    // Compared as JSON gives it back, as the log holds it.
    const resolved = loadScenario(scenario, seed, { name: condition, change }).configuration;
    assert.deepEqual(first.configuration, JSON.parse(JSON.stringify(resolved)));
    assert.equal(path.split(".").reduce<unknown>((table, key) => (table as TomlTable)[key], first.configuration), value);
  },
);

Then(
  "it gives replica {int}, the replica's seed, the model {string} and the sampling settings its sessions use",
  function (this: Context, replica: number, model: string) {
    const first = firstLine(this);
    assert.equal(first.replica, replica);
    assert.equal(first.seed, replicaSeed(this.experimentFile.seed as number, replica));
    assert.equal(first.model, model);
    // The scripted model cannot reason, so Pi gives each session the thinking level "off"; the engine sends no other
    // sampling parameter.
    assert.deepEqual(first.sampling, { thinkingLevels: { a: "off", b: "off" }, otherParameters: "the provider's defaults" });
  },
);

Then("the first line of the run's log gives the commit of the code that ran", function (this: Context) {
  assert.equal((firstLine(this).code as { commit: unknown }).commit, git("rev-parse", "HEAD").trim());
});

Then("it says whether that code's working tree had changes not committed", function (this: Context) {
  assert.equal((firstLine(this).code as { uncommittedChanges: unknown }).uncommittedChanges, git("status", "--porcelain").trim() !== "");
});

Then(
  "the first line of the run's log holds, as data, the inventory {string} prints for the condition {string}",
  async function (this: Context, command: string, condition: string) {
    const logged = firstLine(this).inventory as ConditionInventory;
    assert.equal(command, "lab inventory");
    await runLab(this, "inventory");
    assert.equal(this.labError, undefined, `"lab inventory" failed: ${this.labError?.message}`);
    const section = (markdown: string) => markdown.slice(markdown.indexOf(`## Condition "${condition}"`));
    const { id, scenario } = this.experimentFile as { id: string; scenario: string };
    assert.equal(section(inventoryMarkdown({ experiment: id, scenario, conditions: [logged] })), section(this.labOutput ?? ""));
  },
);
