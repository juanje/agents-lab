import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, type TomlValue, parse, stringify } from "smol-toml";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { run } from "../../src/engine/run.ts";
import { type Condition, type LoadedScenario, type Scenario, loadScenario } from "../../src/engine/scenario.ts";
import { RHYTHM_CHANNEL } from "../../src/engine/stimuli.ts";
import { type Slots, rhythmOf, slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { asRead, userTexts } from "./stimulus.steps.ts";
import { modelOf, script } from "./tool.steps.ts";

Given(
  "the test scenario {string}, whose base configuration has {int} slots, none held",
  function (this: Context, name: string, count: number) {
    // The scenario lives in the fixture; these checks keep the scenario's words and the fixture from drifting apart.
    assert.equal(slotsScenario.name, name);
    const { slots } = parse(slotsScenario.baseConfiguration) as { slots: { count: number; held: number } };
    assert.equal(slots.count, count);
    assert.equal(slots.held, 0);
    this.scenario = slotsScenario;
  },
);

Given("a condition {string} that sets the number of slots to {int}", function (this: Context, name: string, count: number) {
  this.condition = { name, change: `[slots]\ncount = ${count}\n` };
});

/** A condition whose change, in TOML, sets one value at a dotted path such as "slots.held". */
function setAt(name: string, path: string, value: TomlValue): Condition {
  const change = path.split(".").reduceRight<TomlValue>((inner, key) => ({ [key]: inner }), value) as TomlTable;
  return { name, change: stringify(change) };
}

Given("a condition {string} that sets {string} to {int}", function (this: Context, name: string, path: string, value: number) {
  this.condition = setAt(name, path, value);
});

Given(
  "a condition {string} that sets {string} to the text {string}",
  function (this: Context, name: string, path: string, text: string) {
    this.condition = setAt(name, path, text);
  },
);

/** The scenario's words for each part, and the scenario's property that holds it. */
const parts: Readonly<Record<string, keyof Scenario<Slots>>> = {
  "initial state": "initialState",
  tools: "tools",
  "stimulus channels": "channels",
  metrics: "metrics",
  "system prompt": "systemPrompt",
  "base configuration": "baseConfiguration",
};

Given("the test scenario {string} without its {}", function (this: Context, name: string, part: string) {
  assert.equal(slotsScenario.name, name);
  const property = parts[part];
  assert.ok(property !== undefined, `no scenario part is called "${part}"`);
  assert.ok(slotsScenario[property] !== undefined, `the test scenario has no ${part} to leave out`);
  const { [property]: _left, ...rest } = slotsScenario;
  this.scenario = rest;
});

/** A text part that holds nothing: a system prompt of whitespace only, a base configuration that sets no key. */
const emptyParts: Readonly<Record<string, Partial<Scenario<Slots>>>> = {
  "system prompt": { systemPrompt: () => " \n\t\r\n" },
  "base configuration": { baseConfiguration: "# no key is set\n\n" },
};

Given("the test scenario {string} with an empty {}", function (this: Context, name: string, part: string) {
  assert.equal(slotsScenario.name, name);
  const empty = emptyParts[part];
  assert.ok(empty !== undefined, `no text part of a scenario is called "${part}"`);
  this.scenario = { ...slotsScenario, ...empty };
});

Given(
  "the test scenario {string}, whose stimulus channels do not include one named {string}",
  function (this: Context, name: string, channel: string) {
    assert.equal(slotsScenario.name, name);
    // Another channel stays, so the scenario still declares stimulus channels and lacks only the named one.
    const channels = (configuration: TomlTable) => [
      ...slotsScenario.channels(configuration).filter((declared) => declared.name !== channel),
      { name: "notice", source: "board", stimulus: "A notice is posted." },
    ];
    this.scenario = { ...slotsScenario, channels };
  },
);

/** Loads the scenario as the engine does before a run, keeping what loading gave: the loaded scenario or its error. */
function load(context: Context, condition?: Condition): void {
  try {
    // Any seed: the slots test scenario draws nothing from it.
    context.loaded = loadScenario(context.scenario, 1, condition);
  } catch (error) {
    context.loadingError = error as Error;
  }
}

When("the engine loads it", function (this: Context) {
  load(this);
});

When("the engine loads it with the condition {string}", function (this: Context, name: string) {
  assert.equal(this.condition?.name, name, "the scenario gives the condition before loading with it");
  load(this, this.condition);
});

/** The scenario as the engine loaded it, which no run has used yet. */
function loadedOf(context: Context): LoadedScenario<Slots> {
  const { loaded } = context;
  assert.ok(loaded !== undefined, `expected a loaded scenario, but loading failed: ${context.loadingError?.message}`);
  return loaded;
}

Then("it loads", function (this: Context) {
  assert.equal(this.loadingError, undefined, `expected the scenario to load, but it failed: ${this.loadingError?.message}`);
});

Then("its world starts with {int} empty slots", function (this: Context, slots: number) {
  const { world } = loadedOf(this);
  assert.deepEqual({ state: world.state, version: world.version }, { state: Array.from({ length: slots }, () => null), version: 0 });
});

Then("its world starts with {int} slots, {int} of them held", function (this: Context, count: number, held: number) {
  const { world } = loadedOf(this);
  assert.equal(world.state.length, count, `expected ${count} slots, got ${world.state.length}`);
  assert.equal(world.state.filter((holder) => holder !== null).length, held);
  assert.equal(world.version, 0);
});

/** Checks that loading failed with an error whose message names each of the given names. */
function assertRefusedNaming(context: Context, names: readonly string[]): void {
  const error = context.loadingError;
  if (error === undefined) assert.fail("expected loading to fail, but it loaded");
  const unnamed = names.filter((name) => !error.message.includes(name));
  if (unnamed.length > 0) {
    assert.fail(`expected the error to name ${unnamed.map((name) => `"${name}"`).join(", ")}, got: ${error.message}`);
  }
}

Then("loading fails with an error that names {string}", function (this: Context, name: string) {
  assertRefusedNaming(this, [name]);
});

Then(
  "loading fails with an error that names {string}, {string} and {string}",
  function (this: Context, first: string, second: string, third: string) {
    assertRefusedNaming(this, [first, second, third]);
  },
);

Then("no model was called", function (this: Context) {
  // A run takes only a loaded scenario: a refused one leaves nothing a run could start from. A loaded one must have
  // been refused by the run itself.
  if (this.loaded !== undefined) assert.ok(this.runError !== undefined, "expected the run of the loaded scenario to be refused");
  for (const [agent, model] of this.models) {
    assert.equal(model.received.length, 0, `expected no call to agent "${agent}"'s model, but it made ${model.received.length}`);
  }
});

/** Runs the loaded scenario with the scenario's scripted agents, each for one activation that starts at once. */
async function runLoaded(context: Context): Promise<void> {
  const agents = [...context.models].map(([name, model]) => ({ name, model, activations: 1, rhythm: () => 0 }));
  await run(loadedOf(context), agents, context.seed, {
    logDirectory: context.logDirectory,
    modelTurnTimeoutMs: context.modelTurnTimeoutMs,
    parallelismLimit: context.parallelismLimit,
    timeLimitMs: context.timeLimitMs,
  });
}

When("the loaded scenario runs", async function (this: Context) {
  await runLoaded(this);
});

Then("agent {string}'s model was offered exactly the scenario's tools", function (this: Context, agent: string) {
  const declared = loadedOf(this).scenario.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  for (const [turn, messages] of modelOf(this, agent).received.entries()) {
    assert.deepEqual(getCurrentTools(messages), declared, `turn ${turn + 1} was offered other tools`);
  }
});

Then("the system prompt agent {string}'s model received is exactly the scenario's", function (this: Context, agent: string) {
  const systemPrompt = loadedOf(this).systemPrompts.get(agent);
  assert.ok(systemPrompt !== undefined, `the loaded scenario has no agent "${agent}"`);
  for (const [turn, messages] of modelOf(this, agent).received.entries()) {
    assert.equal(getCurrentSystemPrompt(messages), systemPrompt, `turn ${turn + 1} received another system prompt`);
  }
});

Then("agent {string}'s activation began with the scenario's rhythm stimulus", function (this: Context, agent: string) {
  const rhythm = loadedOf(this).channels.find((channel) => channel.name === RHYTHM_CHANNEL);
  assert.ok(rhythm !== undefined, "the loaded scenario declares no rhythm channel");
  const [first] = userTexts(modelOf(this, agent).received[0] ?? []);
  assert.equal(first, asRead(rhythm.source, rhythm.stimulus), `agent "${agent}"'s activation began with another message`);
});

Given(
  "the test scenario {string}, whose system prompt names the agent it describes",
  function (this: Context, name: string) {
    // The fixture's prompt names its agent; the steps that read what each agent received check that it does.
    assert.equal(slotsScenario.name, name);
    this.scenario = slotsScenario;
  },
);

/** The scenario with its base configuration declaring these agents, so a run of exactly them is the scenario's. */
function declaring(scenario: Partial<Scenario<Slots>>, agents: readonly string[]): Partial<Scenario<Slots>> {
  const base = parse(scenario.baseConfiguration ?? "");
  return { ...scenario, baseConfiguration: stringify({ ...base, agents: [...agents] }) };
}

When(
  "agents {string} and {string} run on scripted models that end their first turn without a tool call",
  async function (this: Context, first: string, second: string) {
    for (const agent of [first, second]) script(this, agent, [{ text: "Nothing to do.", delayMs: 0 }]);
    this.loaded = loadScenario(declaring(this.scenario, [first, second]), this.seed, this.condition);
    await runLoaded(this);
  },
);

/** The system prompt agent's model received on each of its turns, which must be one and the same. */
function systemPromptOf(context: Context, agent: string): string | undefined {
  const prompts = new Set(modelOf(context, agent).received.map(getCurrentSystemPrompt));
  assert.equal(prompts.size, 1, `agent "${agent}"'s turns received different system prompts`);
  return [...prompts][0];
}

Then("agent {string}'s system prompt names {string}", function (this: Context, agent: string, name: string) {
  const prompt = systemPromptOf(this, agent) ?? "";
  // A name is quoted where a prompt names it, so a name that is also a word (such as "a") is not found by chance.
  if (!prompt.includes(`"${name}"`)) assert.fail(`expected agent "${agent}"'s system prompt to name "${name}", got: ${prompt}`);
  for (const other of this.models.keys()) {
    if (other === name) continue;
    if (prompt.includes(`"${other}"`)) assert.fail(`expected agent "${agent}"'s system prompt not to name "${other}", got: ${prompt}`);
  }
});

Given(
  "the test scenario {string}, whose rhythm channel's text is {string} in its configuration",
  function (this: Context, name: string, path: string) {
    assert.equal(slotsScenario.name, name);
    // The fixture's [rhythm] table holds the channel's source and text; the text is the one the scenario names.
    assert.equal(path, "rhythm.text");
    assert.equal(typeof rhythmOf(parse(slotsScenario.baseConfiguration)).text, "string");
    this.scenario = slotsScenario;
  },
);

Given("a condition {string} that sets {string} to {string}", function (this: Context, name: string, path: string, text: string) {
  this.condition = setAt(name, path, text);
});

When(
  "agent {string} runs with the condition {string} on a scripted model that ends its first turn without a tool call",
  async function (this: Context, agent: string, name: string) {
    assert.equal(this.condition?.name, name, "the scenario gives the condition before running with it");
    script(this, agent, [{ text: "Nothing to do.", delayMs: 0 }]);
    this.loaded = loadScenario(this.scenario, this.seed, this.condition);
    await runLoaded(this);
  },
);

Then("agent {string}'s rhythm stimulus has the content {string}", function (this: Context, agent: string, content: string) {
  const { source } = rhythmOf(loadedOf(this).configuration);
  const [first] = userTexts(modelOf(this, agent).received[0] ?? []);
  assert.equal(first, asRead(source, content), `agent "${agent}"'s activation began with another stimulus`);
});

Given(
  "the test scenario {string}, whose configuration declares agents {string} and {string}",
  function (this: Context, name: string, first: string, second: string) {
    assert.equal(slotsScenario.name, name);
    this.scenario = declaring(slotsScenario, [first, second]);
  },
);

When("a run is given agents {string} and {string}", async function (this: Context, first: string, second: string) {
  for (const agent of [first, second]) script(this, agent, [{ text: "Nothing to do.", delayMs: 0 }]);
  this.loaded = loadScenario(this.scenario, this.seed);
  try {
    await runLoaded(this);
  } catch (error) {
    this.runError = error as Error;
  }
});

Then("the run fails with an error that names {string} and {string}", function (this: Context, first: string, second: string) {
  const error = this.runError;
  if (error === undefined) assert.fail("expected the run to fail, but it ran");
  for (const name of [first, second]) {
    if (!error.message.includes(`"${name}"`)) assert.fail(`expected the error to name "${name}", got: ${error.message}`);
  }
});
