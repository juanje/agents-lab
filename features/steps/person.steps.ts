import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { type TomlTable, parse } from "smol-toml";
import { ScriptedModel } from "../../src/engine/scripted-model.ts";
import { RHYTHM_CHANNEL } from "../../src/engine/stimuli.ts";
import type { Tool } from "../../src/engine/tools.ts";
import { scenarioLibrary } from "../../src/scenarios/library.ts";
import { type Workplace, workplaceScenario } from "../../src/scenarios/workplace.ts";
import type { Context } from "../support/context.ts";
import { fencedAfter, under } from "./inventory.steps.ts";
import { completedIndex, experimentFileOf, failedNaming, firstLine, idleModels, logOf, runLab } from "./lab.steps.ts";
import { inTables, withBase } from "./neighbourhood.steps.ts";
import { logLines } from "./record.steps.ts";
import { asRead, userTexts } from "./stimulus.steps.ts";

/** The worker, the workplace's one agent. */
const WORKER = "worker";

/** The scripted model the worker runs on, as "lab run" resolves it. */
const MODEL = "faux/scripted";

/** How many answers the worker's scripted model holds: more than all its turns here. */
const ANSWERS = 50;

/** The worker's answer that ends a turn without a tool call. */
const IDLE = { text: "Nothing to do.", delayMs: 0 };

Given(
  "the workplace scenario, whose configuration sets {string} to {string}, {string} to {string}, {string} to {string}, {string} to {string}, {string} to {string} and {string} to {string}",
  // Cucumber gives each parameter its own argument.
  function (this: Context, k1: string, v1: string, k2: string, v2: string, k3: string, v3: string, k4: string, v4: string, k5: string, v5: string, k6: string, v6: string) {
    const values: TomlTable = { [k1]: v1, [k2]: v2, [k3]: v3, [k4]: v4, [k5]: v5, [k6]: v6 };
    // The worker wakes at once before each activation, so a run takes no longer than its model turns.
    this.libraryScenario = withBase(workplaceScenario, { ...values, rhythm: { min_ms: 0, max_ms: 0 } });
  },
);

Given(
  "the worker runs on a scripted model that ends every turn without a tool call, for {int} activations",
  function (this: Context, activations: number) {
    idleModels(this, [MODEL]);
    this.experimentFile = experimentFileOf({
      id: "workplace-person",
      scenario: workplaceScenario.name,
      models: [MODEL],
      replicas: 1,
      seed: 42,
      activationsPerAgent: activations,
      conditions: { base: {} },
    });
    this.runInstead = async () => {
      await runWorkplace(this);
      assert.equal(this.labError, undefined, `"lab run" failed: ${this.labError?.message}`);
    };
  },
);

/**
 * Runs the workplace, as the scenario configured it, with "lab run", watching the state each applied effect gives. It
 * keeps the error "lab run" failed with, if it failed.
 */
async function runWorkplace(context: Context): Promise<void> {
  const scenario = watched(context.libraryScenario as typeof workplaceScenario, (state) => {
    context.workplaceLastState = state;
  });
  context.library = new Map([...scenarioLibrary, [scenario.name, scenario]]);
  await runLab(context, "run");
}

/** The workplace with each effect watched, not changed: the arbiter still decides, and the step sees what it applied. */
function watched(scenario: typeof workplaceScenario, keep: (state: Workplace) => void): typeof workplaceScenario {
  const kept = <Call>(effect: (state: Workplace, call: Call) => Workplace) => (state: Workplace, call: Call) => {
    const changed = effect(state, call);
    keep(changed);
    return changed;
  };
  const tools = scenario.tools.map((tool): Tool<Workplace> => {
    if (tool.kind === "sensor") return tool;
    const start = tool.start === undefined ? {} : { start: { ...tool.start, effect: kept(tool.start.effect) } };
    const action = tool.action === undefined ? {} : { action: { ...tool.action, effect: kept(tool.action.effect) } };
    return { ...tool, ...action, ...start };
  });
  return { ...scenario, tools };
}

When("the run starts", async function (this: Context) {
  // A congress runs as its steps set it up (FR-CONGRESS-11); the workplace otherwise.
  if (this.runInstead !== undefined) await this.runInstead();
  else await runWorkplace(this);
});

Given("{string} is {string} and {string} is {string}", function (this: Context, key: string, text: string, other: string, otherText: string) {
  this.libraryScenario = withBase(this.libraryScenario, inTables([[key, text], [other, otherText]]));
});

Given(
  "{string}, {string}, {string} and {string} are all {string}",
  function (this: Context, first: string, second: string, third: string, fourth: string, text: string) {
    this.libraryScenario = withBase(this.libraryScenario, inTables([first, second, third, fourth].map((key) => [key, text] as const)));
  },
);

Given("the worker's first turn calls {string} with the text {string}", function (this: Context, tool: string, text: string) {
  const model = new ScriptedModel([{ toolCalls: [{ name: tool, arguments: { text } }], delayMs: 0 }, ...Array.from({ length: ANSWERS }, () => IDLE)], MODEL.split("/")[1]);
  this.models.set(MODEL, model);
  this.labModels.set(MODEL, model);
});

/** The worker's scripted model. */
function workerModel(context: Context): ScriptedModel {
  const model = context.models.get(MODEL);
  assert.ok(model instanceof ScriptedModel, "the worker runs on no scripted model");
  assert.ok(model.received.length > 0, "the worker's model was never called");
  return model;
}

/** Checks that every model turn of the worker received this system prompt. */
function assertSystemPrompt(context: Context, matches: (prompt: string) => boolean, expected: string): void {
  for (const [turn, messages] of workerModel(context).received.entries()) {
    const prompt = getCurrentSystemPrompt(messages) ?? "";
    assert.ok(matches(prompt), `turn ${turn + 1} received the system prompt ${JSON.stringify(prompt)}, expected ${expected}`);
  }
}

Then(
  "the worker's system prompt is {string}, then {string}, then {string}, then {string}, each separated by a blank line",
  function (this: Context, first: string, second: string, third: string, fourth: string) {
    const expected = [first, second, third, fourth].join("\n\n");
    assertSystemPrompt(this, (prompt) => prompt === expected, JSON.stringify(expected));
  },
);

Then("the worker's system prompt is {string}, then {string}, separated by a blank line", function (this: Context, first: string, second: string) {
  const expected = [first, second].join("\n\n");
  assertSystemPrompt(this, (prompt) => prompt === expected, JSON.stringify(expected));
});

Then("the worker's system prompt ends with {string}, then {string}, separated by a blank line", function (this: Context, first: string, second: string) {
  const expected = [first, second].join("\n\n");
  assertSystemPrompt(this, (prompt) => prompt.endsWith(`\n\n${expected}`), `one that ends with ${JSON.stringify(expected)}`);
});

/** The lines of the log of the experiment's only run, once "lab run" completed. */
function runLog(context: Context): ReturnType<typeof logOf> {
  const index = completedIndex(context);
  assert.equal(index.length, 1, `the index lists ${index.length} runs`);
  return logOf(context, index[0].runId);
}

/** The stimuli the worker received in each of its activations, in order, as its run's log gives them. */
function stimuliByActivation(context: Context): { channel: string; source: string; content: string }[][] {
  const activations: { channel: string; source: string; content: string }[][] = [[]];
  for (const line of runLog(context)) {
    if (line.agent !== WORKER) continue;
    if (line.type === "stimulus") activations.at(-1)?.push({ channel: String(line.channel), source: String(line.source), content: String(line.content) });
    if (line.type === "activation") activations.push([]);
  }
  // What follows the last activation's line is no activation.
  return activations.slice(0, -1);
}

/** The rhythm's stimulus as the workplace's configuration gives it. */
function rhythmStimulus(context: Context): { channel: string; source: string; content: string } {
  const { rhythm } = parse(context.libraryScenario.baseConfiguration ?? "") as { rhythm: { source: string; text: string } };
  return { channel: RHYTHM_CHANNEL, source: rhythm.source, content: rhythm.text };
}

Then(
  "the worker's first activation received the rhythm's stimulus, then {string} from {string} on the channel {string}",
  function (this: Context, content: string, source: string, channel: string) {
    const rhythm = rhythmStimulus(this);
    const [first] = stimuliByActivation(this);
    assert.deepEqual(first, [rhythm, { channel, source, content }], "the log gives other stimuli for the first activation");
    // The model read them in that order, before its first answer.
    const [firstTurn] = workerModel(this).received;
    assert.deepEqual(userTexts(firstTurn), [asRead(rhythm.source, rhythm.content), asRead(source, content)]);
  },
);

Then("its second activation received no stimulus on the channel {string}", function (this: Context, channel: string) {
  const second = stimuliByActivation(this)[1];
  assert.ok(second !== undefined, "the worker made no second activation");
  assert.deepEqual(second, [rhythmStimulus(this)], `the second activation received other stimuli than its rhythm's, not on "${channel}" alone`);
  assert.ok(!second.some((stimulus) => stimulus.channel === channel));
});

Then("the person's first message is {string}, then {string}, then {string}, each separated by a blank line", function (this: Context, first: string, second: string, third: string) {
  const texts = [first, second, third];
  const person = stimuliByActivation(this)
    .flat()
    .filter((stimulus) => stimulus.channel === "person");
  assert.deepEqual(
    person.map(({ content }) => content),
    [texts.join("\n\n")],
  );
});

Then("the worker received no stimulus on the channel {string}", function (this: Context, channel: string) {
  // Every stimulus of the run, a stimulus delivered after the worker's last activation ended included; the run ran by
  // "lab run", or by the engine, which gives its run id.
  const lines = this.runId === undefined ? runLog(this) : logLines(this);
  assert.ok(lines.some((line) => line.type === "activation" && line.agent === WORKER), "the worker made no activation");
  const received = lines.filter((line) => line.type === "stimulus" && line.agent === WORKER && line.channel === channel);
  assert.deepEqual(received, [], `the worker received stimuli on "${channel}"`);
});

Then("the world holds the note {string} to {string}", function (this: Context, text: string, to: string) {
  const state = this.workplaceLastState;
  assert.ok(state !== undefined, "no effect was applied in the workplace");
  assert.deepEqual(
    state.notes.map(({ text: written, to: addressee }) => ({ text: written, to: addressee })),
    [{ text, to }],
  );
});

/** The worker's part of the inventory "lab inventory" printed. */
function workerInInventory(context: Context): string {
  return under(context.labOutput ?? "", `#### Agent "${WORKER}"`);
}

Then("the inventory gives the system prompt without {string}", function (this: Context, text: string) {
  const prompt = fencedAfter(workerInInventory(this), "System prompt");
  assert.ok(prompt.trim() !== "", "the inventory gives an empty system prompt");
  assert.ok(!prompt.includes(text), `the inventory's system prompt holds "${text}": ${prompt}`);
});

Then("it gives the person's first message, {string}, then {string}, from {string}", function (this: Context, first: string, second: string, source: string) {
  const part = workerInInventory(this);
  const labels = part.split("\n").filter((line) => line.startsWith("First stimulus") && line.includes(source));
  assert.equal(labels.length, 1, `the worker's part of the inventory gives ${labels.length} first stimuli from "${source}":\n${part}`);
  assert.equal(fencedAfter(part, labels[0].replace(/:$/, "")), [first, second].join("\n\n"));
});

Then("the run's setup line gives {string} as {string}", function (this: Context, path: string, value: string) {
  const configuration = firstLine(this).configuration as TomlTable;
  const given = path.split(".").reduce<unknown>((table, key) => (table as TomlTable | undefined)?.[key], configuration);
  assert.equal(given, value);
});

Then("it fails with an error that names the system prompt", function (this: Context) {
  failedNaming(this, ["system prompt"]);
});
