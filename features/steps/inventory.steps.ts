import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { type LoadedScenario, type Scenario, loadScenario } from "../../src/engine/scenario.ts";
import { ScriptedModel } from "../../src/engine/scripted-model.ts";
import { scenarioLibrary } from "../../src/scenarios/library.ts";
import { type Slots, slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { tableAt } from "./experiment.steps.ts";
import { runLab } from "./lab.steps.ts";
import { declaring } from "./scenario.steps.ts";

/** The texts the test scenario's effector "take" declares, so the inventory has texts to list for its outcomes. */
const TAKE_TEXTS = { success: "You took the slot.", slot_taken: "Someone holds that slot." };

Given(
  "an experiment file {string} for the test scenario {string}, with agents {string} and {string}, the model {string}, {int} activations per agent, a time limit of {int} milliseconds, a parallelism limit of {int}, a model turn timeout of {int} milliseconds, and the conditions {string}, with no change, and {string}, which sets {string} to {int}, with the thinking level {string}",
  function (
    this: Context,
    id: string,
    scenario: string,
    first: string,
    second: string,
    model: string,
    activationsPerAgent: number,
    timeLimitMs: number,
    parallelismLimit: number,
    modelTurnTimeoutMs: number,
    unchanged: string,
    changed: string,
    path: string,
    value: number,
    thinkingLevel: string,
  ) {
    assert.equal(slotsScenario.name, scenario);
    const declared = declaring(slotsScenario, [first, second]);
    const tools = slotsScenario.tools.map((tool) => (tool.kind === "effector" && tool.name === "take" ? { ...tool, texts: TAKE_TEXTS } : tool));
    this.library = new Map([...scenarioLibrary, [scenario, { ...declared, tools }]]);
    // A scripted model with answers to give, since it records only the calls it answers: "no model was called" checks
    // it was never called.
    const scripted = new ScriptedModel(
      Array.from({ length: 50 }, () => ({ text: "Nothing to do.", delayMs: 0 })),
      model.split("/")[1],
    );
    this.models.set(model, scripted);
    this.labModels.set(model, scripted);
    this.experimentFile = {
      id,
      scenario,
      models: [model],
      thinking_level: thinkingLevel,
      replicas: 1,
      seed: 1,
      limits: {
        time_limit_ms: timeLimitMs,
        activations_per_agent: activationsPerAgent,
        parallelism_limit: parallelismLimit,
        model_turn_timeout_ms: modelTurnTimeoutMs,
      },
      compaction: { enabled: false },
      conditions: { [unchanged]: {}, [changed]: tableAt(path, value) },
    };
  },
);

When('"lab inventory" runs on the experiment file', async function (this: Context) {
  await runLab(this, "inventory");
  // Kept apart, since a "lab run" after it prints over what "lab" printed.
  if (this.labError === undefined) this.inventoryOutput = this.labOutput;
});

/** What "lab inventory" printed: it did not fail. */
function printed(context: Context): string {
  assert.equal(context.labError, undefined, `"lab inventory" failed: ${context.labError?.message}`);
  assert.ok(context.labOutput !== undefined, '"lab inventory" did not run');
  return context.labOutput;
}

/** The level of a Markdown heading line, or 0 for a line that is not a heading. */
function headingLevel(line: string): number {
  return /^(#+) /.exec(line)?.[1].length ?? 0;
}

/** The heading level of each line of a Markdown text: 0 inside a fenced block, where a "#" line is a text's, not a heading. */
function headingLevels(lines: readonly string[]): number[] {
  let fence: string | undefined;
  return lines.map((line) => {
    const run = /^(`{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      if (line.trim() === fence) fence = undefined;
      return 0;
    }
    if (run !== undefined) {
      fence = run;
      return 0;
    }
    return headingLevel(line);
  });
}

/**
 * The part of a Markdown text under a heading, given as the whole heading line, up to the next heading of the same
 * level or higher; it fails when the text has no such heading, or more than one.
 */
export function under(text: string, heading: string): string {
  const lines = text.split("\n");
  const levels = headingLevels(lines);
  const found = lines.flatMap((line, index) => (line === heading && levels[index] > 0 ? [index] : []));
  assert.equal(found.length, 1, `expected one heading ${JSON.stringify(heading)}, found ${found.length} in:\n${text}`);
  const level = headingLevel(heading);
  const end = levels.findIndex((each, index) => index > found[0] && each > 0 && each <= level);
  return lines.slice(found[0] + 1, end === -1 ? lines.length : end).join("\n");
}

/** The headings of a level in a Markdown text, in order. */
export function headings(text: string, level: number): string[] {
  const lines = text.split("\n");
  const levels = headingLevels(lines);
  return lines.filter((_, index) => levels[index] === level);
}

/** The value of a "- Label: value" line of a part. */
export function itemOf(part: string, label: string): string {
  const prefix = `- ${label}: `;
  const lines = part.split("\n").filter((line) => line.startsWith(prefix));
  assert.equal(lines.length, 1, `expected one line "${prefix}…", found ${lines.length} in:\n${part}`);
  return lines[0].slice(prefix.length);
}

/** The content of the fenced block that follows a "Label:" line of a part. */
export function fencedAfter(part: string, label: string): string {
  const lines = part.split("\n");
  const at = lines.indexOf(`${label}:`);
  assert.ok(at !== -1, `expected a line "${label}:" in:\n${part}`);
  const open = lines.slice(at + 1).findIndex((line) => line.trim() !== "");
  const fence = /^(`{3,})/.exec(lines[at + 1 + open])?.[1];
  assert.ok(fence !== undefined, `expected a fenced block after "${label}:" in:\n${part}`);
  const body = lines.slice(at + 2 + open);
  const close = body.indexOf(fence);
  assert.ok(close !== -1, `the fenced block after "${label}:" is not closed in:\n${part}`);
  return body.slice(0, close).join("\n");
}

/** The section the inventory prints for a condition. */
function sectionOf(context: Context, condition: string): string {
  return under(printed(context), `## Condition "${condition}"`);
}

/** Each condition of the experiment file, with its section and the scenario as the engine loads it in that condition. */
function conditionsOf(context: Context): { name: string; section: string; loaded: LoadedScenario<Slots> }[] {
  const scenario = context.library?.get(String(context.experimentFile.scenario)) as Partial<Scenario<Slots>>;
  return Object.entries(context.experimentFile.conditions as TomlTable).map(([name, change]) => ({
    name,
    section: sectionOf(context, name),
    loaded: loadScenario(scenario, 1, { name, change: stringify(change as TomlTable) }),
  }));
}

Then("it prints a section for the condition {string} and one for {string}", function (this: Context, first: string, second: string) {
  assert.deepEqual(headings(printed(this), 2), [`## Condition "${first}"`, `## Condition "${second}"`]);
});

Then(
  "each section gives agent {string}'s and agent {string}'s system prompts and rhythms, as the scenario gives them in that condition",
  function (this: Context, first: string, second: string) {
    for (const { name, section, loaded } of conditionsOf(this)) {
      const agents = under(section, "### Agents");
      for (const agent of [first, second]) {
        const part = under(agents, `#### Agent "${agent}"`);
        assert.equal(fencedAfter(part, "System prompt"), loaded.systemPrompts.get(agent), `condition "${name}", agent "${agent}"`);
        assert.equal(itemOf(part, "Rhythm"), loaded.scenario.describeRhythm(loaded.configuration, agent), `condition "${name}", agent "${agent}"`);
      }
    }
  },
);

Then(
  "each section lists the tools {string} and {string}, each with its kind, the description and parameters its agents see, its duration as the scenario describes it, and the text its agents receive for each outcome",
  function (this: Context, first: string, second: string) {
    for (const { name, section, loaded } of conditionsOf(this)) {
      const tools = under(section, "### Tools");
      assert.deepEqual(headings(tools, 4), [`#### Tool "${first}"`, `#### Tool "${second}"`], `condition "${name}"`);
      for (const tool of loaded.scenario.tools) {
        const part = under(tools, `#### Tool "${tool.name}"`);
        const where = `condition "${name}", tool "${tool.name}"`;
        assert.equal(itemOf(part, "Kind"), tool.kind, where);
        assert.equal(fencedAfter(part, "Description"), tool.description, where);
        assert.deepEqual(JSON.parse(fencedAfter(part, "Parameters")), tool.parameters, where);
        assert.equal(itemOf(part, "Duration"), loaded.scenario.describeDuration(loaded.configuration, tool.name), where);
        const texts = part.slice(part.indexOf("Texts for each outcome:"));
        assert.ok(texts.startsWith("Texts for each outcome:"), `${where} lists no texts for its outcomes`);
        if (tool.kind === "effector") {
          for (const [outcome, text] of Object.entries(tool.texts ?? {})) assert.equal(itemOf(texts, outcome), text, where);
        } else {
          assert.equal(itemOf(texts, "success"), "the part of the world it senses", where);
        }
        assert.equal(itemOf(texts, "any other outcome"), "the outcome's name", where);
      }
    }
  },
);

Then("each section lists the channel {string} with its source and text", function (this: Context, channel: string) {
  for (const { name, section, loaded } of conditionsOf(this)) {
    const declared = loaded.channels.find((each) => each.name === channel);
    assert.ok(declared !== undefined, `the scenario declares no channel "${channel}" in condition "${name}"`);
    const part = under(under(section, "### Stimulus channels"), `#### Channel "${channel}"`);
    assert.equal(itemOf(part, "Source"), declared.source, `condition "${name}"`);
    assert.equal(fencedAfter(part, "Delivers"), declared.stimulus, `condition "${name}"`);
  }
});

Then("each section gives the model {string}, the thinking level {string} and the limits", function (this: Context, model: string, thinkingLevel: string) {
  const limits = this.experimentFile.limits as Record<string, number>;
  for (const { name, section } of conditionsOf(this)) {
    const part = under(section, "### Model and limits");
    const where = `condition "${name}"`;
    assert.equal(itemOf(part, "Models"), model, where);
    assert.equal(itemOf(part, "Thinking level"), thinkingLevel, where);
    assert.equal(itemOf(part, "Activations per agent"), String(limits.activations_per_agent), where);
    assert.equal(itemOf(part, "Time limit"), `${limits.time_limit_ms} ms`, where);
    assert.equal(itemOf(part, "Parallelism limit"), String(limits.parallelism_limit), where);
    assert.equal(itemOf(part, "Model turn timeout"), `${limits.model_turn_timeout_ms} ms`, where);
  }
});

Given(
  "the test scenario {string} describes the duration of {string} from {string} in its configuration",
  function (this: Context, scenario: string, tool: string, path: string) {
    const declared = this.library?.get(scenario) as Partial<Scenario<Slots>> | undefined;
    assert.ok(declared?.baseConfiguration !== undefined && declared.describeDuration !== undefined, `the library has no test scenario "${scenario}"`);
    const describeOthers = declared.describeDuration;
    // The base configuration gets the key, with a value no condition here sets, so a condition can change it.
    const base = parse(declared.baseConfiguration);
    const keys = path.split(".");
    const holder = keys.slice(0, -1).reduce((table, key) => table[key] as TomlTable, base);
    holder[keys[keys.length - 1]] = 100;
    const describeDuration = (configuration: TomlTable, name: string) => {
      if (name !== tool) return describeOthers(configuration, name);
      const value = keys.reduce<unknown>((table, key) => (table as TomlTable)[key], configuration);
      return `${String(value)} ms.`;
    };
    this.library = new Map([...this.library!, [scenario, { ...declared, baseConfiguration: stringify(base), describeDuration }]]);
  },
);

Given("the condition {string} also sets {string} to {int}", function (this: Context, condition: string, path: string, value: number) {
  const conditions = this.experimentFile.conditions as TomlTable;
  assert.ok(Object.hasOwn(conditions, condition), `the experiment file has no condition "${condition}"`);
  const keys = path.split(".");
  let table = conditions[condition] as TomlTable;
  for (const key of keys.slice(0, -1)) {
    if (!Object.hasOwn(table, key)) table[key] = {};
    table = table[key] as TomlTable;
  }
  table[keys[keys.length - 1]] = value;
});

/** Whether the inventory's section for a condition describes a tool's duration with that number of milliseconds. */
function describesDuration(context: Context, condition: string, tool: string, ms: number): boolean {
  const part = under(under(sectionOf(context, condition), "### Tools"), `#### Tool "${tool}"`);
  return new RegExp(`(^|[^0-9])${ms} ms`).test(itemOf(part, "Duration"));
}

Then(
  "the section for {string} describes the duration of {string} with {int} milliseconds",
  function (this: Context, condition: string, tool: string, ms: number) {
    assert.ok(describesDuration(this, condition, tool, ms), `the section for "${condition}" does not describe "${tool}"'s duration with ${ms} ms`);
    this.lastDurationRead = { tool, ms };
  },
);

Then("the section for {string} does not", function (this: Context, condition: string) {
  const read = this.lastDurationRead;
  assert.ok(read !== undefined, "no duration was read before");
  assert.ok(!describesDuration(this, condition, read.tool, read.ms), `the section for "${condition}" describes "${read.tool}"'s duration with ${read.ms} ms`);
});

Then("each section lists the energy model, the environment processes and each tool's effort as {string}", function (this: Context, none: string) {
  for (const { name, section, loaded } of conditionsOf(this)) {
    assert.equal(under(section, "### Energy model").trim(), none, `condition "${name}"`);
    assert.equal(under(section, "### Environment processes").trim(), none, `condition "${name}"`);
    const tools = under(section, "### Tools");
    for (const tool of loaded.scenario.tools) {
      assert.equal(itemOf(under(tools, `#### Tool "${tool.name}"`), "Effort"), none, `condition "${name}", tool "${tool.name}"`);
    }
  }
});

Then("each section says that every sensor and channel is instant", function (this: Context) {
  for (const { name, section } of conditionsOf(this)) {
    assert.equal(under(section, "### How fast information travels").trim(), "Every sensor and channel is instant.", `condition "${name}"`);
  }
});

Then(
  "each section lists, besides each tool's own outcomes, the outcomes the engine gives: {string}, with the harness's explanation, {string} and {string}",
  function (this: Context, invalidArguments: string, unknownTool: string, cutOff: string) {
    for (const { name, section, loaded } of conditionsOf(this)) {
      const where = `condition "${name}"`;
      const engine = under(section, "### Outcomes the engine gives");
      assert.match(itemOf(engine, invalidArguments), /the harness's explanation/, where);
      itemOf(engine, unknownTool);
      itemOf(engine, cutOff);
      // Each tool still lists its own outcomes besides the engine's.
      const tools = under(section, "### Tools");
      for (const tool of loaded.scenario.tools) {
        const part = under(tools, `#### Tool "${tool.name}"`);
        const own = tool.kind === "effector" ? Object.keys(tool.texts ?? {}) : ["success"];
        for (const outcome of own) itemOf(part, outcome);
      }
    }
  },
);
