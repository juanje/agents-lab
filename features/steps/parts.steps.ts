import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Given, Then } from "@cucumber/cucumber";
import { type TomlTable, stringify } from "smol-toml";
import type { WorldTime } from "../../src/engine/calendar.ts";
import { Materials, hidingHeldOut } from "../../src/engine/materials.ts";
import type { Perceived, RuleSet, RuleStep } from "../../src/engine/participants.ts";
import { type Condition, type LoadedScenario, type Scenario, loadScenario } from "../../src/engine/scenario.ts";
import type { Effector } from "../../src/engine/tools.ts";
import type { Context } from "../support/context.ts";
import { minutesOf } from "./congress-parties.steps.ts";
import { linesOf } from "./record.steps.ts";
import { runScenario, script } from "./tool.steps.ts";

/** The test scenario's world: its flags, each raise of a flag with its world time, and the engine's mail. */
interface Flags {
  flags: Record<string, boolean>;
  raised: { flag: string; at: WorldTime }[];
  mail: unknown;
}

/** An effector that sets or clears a flag, taking these world minutes; setting it records a raise. */
function flagging(name: string, value: boolean, minutes: number): Effector<Flags> {
  return {
    kind: "effector",
    name,
    description: `${value ? "Set" : "Clear"} a flag.`,
    parameters: { type: "object", properties: { flag: { type: "string" } }, required: ["flag"] },
    durationMs: () => ({ worldSeconds: minutes * 60 }),
    action: {
      precondition: () => ({ holds: true }),
      effect: (state, { arguments: { flag }, world }) => ({
        ...state,
        flags: { ...state.flags, [String(flag)]: value },
        raised: value ? [...state.raised, { flag: String(flag), at: world as WorldTime }] : state.raised,
      }),
    },
    texts: { success: "Done." },
    readTarget: () => "not_sensed",
  };
}

/** "raiser", the rule set of a participant that raises the flag its params name after the minutes they give, or does nothing. */
const raiser: RuleSet = {
  start: (params) => ({
    atStart: (): RuleStep | undefined => (typeof params.after_minutes === "number" ? { kind: "wait", minutes: params.after_minutes } : undefined),
    next: ({ result }: Perceived): RuleStep => (result === undefined && typeof params.after_minutes === "number" ? { kind: "call", tool: "raise_flag", arguments: { flag: params.flag as string } } : { kind: "end" }),
    outcome: () => ({}),
  }),
};

/** A part as the steps write it into the material. */
type Part = TomlTable;

/** What the scenario sets up: its calendar, its parts, the run's level of the kind factor, and the shop's raise. */
interface PartsSetup {
  calendar: TomlTable;
  parts: Part[];
  kindFactor: { name: string; levels?: string[] };
  level: string;
  shop: TomlTable;
  loaded?: LoadedScenario<Flags>;
}

const setups = new WeakMap<Context, PartsSetup>();

function setupOf(context: Context): PartsSetup {
  const setup = setups.get(context);
  assert.ok(setup !== undefined, "the scenario set up no parts test scenario");
  return setup;
}

/** The test scenario of FR-PARTS-01: "ana", with set_flag, clear_flag and the mail, and "shop", who may raise a flag. */
function partsScenario(setup: PartsSetup): Scenario<Flags> {
  return {
    name: "flags",
    agents: () => ["ana"],
    initialState: () => ({ flags: {}, raised: [], mail: { mailboxes: {}, inTransit: [] } }),
    tools: [flagging("set_flag", true, 60), flagging("clear_flag", false, 60), flagging("raise_flag", true, 0)],
    channels: () => [{ name: "rhythm", source: "rhythm", stimulus: "You wake up." }],
    metrics: {},
    systemPrompt: () => 'You are "ana". You keep flags.',
    rhythm: () => () => 0,
    describeDuration: () => "60 world minutes.",
    describeRhythm: () => "No wait before any activation.",
    mail: { of: (state) => state.mail as never, with: (state, mail) => ({ ...state, mail }) },
    ruleSets: { raiser },
    parts: {
      predicates: { flag_set: (state, params) => state.flags[String(params.flag)] === true },
      events: { flag_raised: (state, params) => state.raised.find(({ flag }) => flag === params.flag)?.at },
      misapplications: { act_named: (act, params) => act.tool === params.tool },
    },
    baseConfiguration: stringify({
      calendar: setup.calendar,
      mail: { mailboxes: ["ana", "shop"], delivery_minutes: [1, 1], send_minutes: 0, check_minutes: 0, read_minutes: 0 },
      participants: { shop: { decides: "rules", rules: "raiser", tools: ["raise_flag"], channels: [], params: setup.shop } },
      parts: "",
    }),
  } as Scenario<Flags>;
}

/** The condition the run is loaded under: its level of the kind factor, and the parts as a held-out material. */
function conditionOf(setup: PartsSetup): Condition {
  const directory = mkdtempSync(join(tmpdir(), "agents-lab-parts-"));
  writeFileSync(join(directory, "parts.toml"), stringify({ parts: setup.parts }));
  return {
    name: `${setup.kindFactor.name}=${setup.level}`,
    change: stringify({ parts: { file: "parts.toml", held_out: true } }),
    levels: { [setup.kindFactor.name]: setup.level },
    kindFactor: setup.kindFactor,
    materials: new Materials(directory),
  };
}

Given(
  "a test scenario with the agent {string} and the participant {string}, whose calendar starts at {string} with one segment of scale {int}, so one world hour is {int} milliseconds of the run",
  function (this: Context, agent: string, participant: string, start: string, scale: number, hourMs: number) {
    assert.deepEqual([agent, participant], ["ana", "shop"]);
    assert.equal((3600 * 1000) / scale, hourMs);
    const setup: PartsSetup = { calendar: { start, segments: [{ scale }] }, parts: [], kindFactor: { name: "guidance", levels: ["none", "rules"] }, level: "none", shop: {} };
    setups.set(this, setup);
    // The congress's steps read the calendar from the library scenario: the time limit, a world hour.
    this.libraryScenario = partsScenario(setup) as never;
    this.seed = 1;
    script(this, "ana", [{ text: "Nothing to do.", delayMs: 0 }]);
    // The inventory loads the scenario under the condition, which reads and checks the parts.
    this.inventoryInstead = () => {
      try {
        loadScenario(partsScenario(setup), this.seed, conditionOf(setup));
      } catch (error) {
        this.runError = error as Error;
      }
    };
    this.runInstead = async () => {
      try {
        setup.loaded = loadScenario(partsScenario(setup), this.seed, conditionOf(setup));
        const loaded = setup.loaded;
        // A setup line as the runner writes one, with the condition's materials and its configuration as a log holds it.
        const runSetup = { experiment: "e", scenario: "flags", condition: conditionOf(setup).name, configuration: hidingHeldOut(loaded.configuration, loaded.materials), replica: 1, seed: this.seed, model: "scripted/one", materials: loaded.materials };
        await runScenario(this, loaded, undefined, { setup: runSetup as never });
      } catch (error) {
        this.runError = error as Error;
      }
    };
  },
);

Given(
  /^the scenario provides the predicate "flag_set" \(holds while the world's flag named by its params is set\), the event "flag_raised", and the misapplication pattern "act_named" \(a call of the tool its params name\)$/,
  function (this: Context) {
    // In partsScenario.
  },
);

Given(/^"ana" has the effectors "set_flag" and "clear_flag" \(each 60 world minutes\) and the tool "send_mail"$/, function (this: Context) {
  // In partsScenario.
});

Given('the experiment has the factor {string} with the levels {string} and {string}, and the "kind_factor" {string}', function (this: Context, factor: string, first: string, second: string, kindFactor: string) {
  assert.equal(factor, kindFactor);
  setupOf(this).kindFactor = { name: kindFactor, levels: [first, second] };
});

/** A part as the contract writes it. */
function partOf(written: string): Part {
  const [, id, predicate, flag, event, eventFlag, evaluate, firstLevel, firstKind, secondLevel, secondKind, actor] =
    /^"(\w+)": predicate "(\w+)" with flag "(\w+)", activation (?:"always"|the event "(\w+)" with flag "(\w+)"), evaluated at "([^"]+)", (?:kinds "(\w+)" (\w+) and "(\w+)" (\w+)|no kinds)(?:, actors "(\w+)")?$/.exec(written) ?? [];
  assert.ok(id !== undefined, `the steps do not read the part ${written}`);
  return {
    id,
    predicate,
    params: { flag },
    activation: event === undefined ? "always" : { event, params: { flag: eventFlag } },
    evaluate_at: evaluate,
    ...(firstLevel === undefined ? {} : { kinds: { [firstLevel]: firstKind, [secondLevel]: secondKind } }),
    actors: actor === undefined ? [] : [actor],
  };
}

Given(/^the held-out material "parts" has the part (.+)$/, function (this: Context, written: string) {
  setupOf(this).parts.push(partOf(written));
});

Given(/^the part ("\w+": .+)$/, function (this: Context, written: string) {
  setupOf(this).parts.push(partOf(written));
});

Given('the condition\'s {string} is {string}', function (this: Context, factor: string, level: string) {
  assert.equal(factor, setupOf(this).kindFactor.name);
  setupOf(this).level = level;
});

Given('{string} has the misapplication "act_named" with tool {string}, before the event "flag_raised" with flag {string}', function (this: Context, id: string, tool: string, flag: string) {
  const part = setupOf(this).parts.find((each) => each.id === id) as Part;
  part.misapplications = [{ pattern: "act_named", params: { tool }, before: { event: "flag_raised", params: { flag } } }];
});

Given('the participant "shop" raises the flag {string} at {string}', function (this: Context, flag: string, at: string) {
  const start = minutesOf(setupOf(this).calendar.start as string);
  setupOf(this).shop = { flag, after_minutes: minutesOf(at) - start };
});

/** The run's log lines. */
function lines(context: Context): Record<string, unknown>[] {
  assert.equal(context.runError, undefined, `the run stopped: ${context.runError?.message}`);
  return linesOf(context, `${context.runId}.jsonl`).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The one part line of a part. */
function partLine(context: Context, id: string): Record<string, unknown> {
  const found = lines(context).filter((line) => line.type === "part" && line.part === id);
  assert.equal(found.length, 1, `the log has ${found.length} part lines for "${id}"`);
  return found[0];
}

/** Checks that a world time, written "day <n> HH:MM", is within so many world minutes of another. */
function assertNear(actual: unknown, expected: string, minutes: number): void {
  assert.ok(typeof actual === "string", `no time: ${String(actual)}`);
  assert.ok(Math.abs(minutesOf(actual) - minutesOf(expected)) <= minutes, `${actual} is not ${expected} within ${minutes} world minutes`);
}

Then(
  'the run\'s log has a "part" line for "p1": active, held at {string}, reached at {string} within 30 world minutes, kind {string}',
  function (this: Context, evaluated: string, reached: string, kind: string) {
    const line = partLine(this, "p1");
    assert.deepEqual({ active: line.active, held: line.held, evaluated_at: line.evaluated_at, kind: line.kind }, { active: true, held: true, evaluated_at: evaluated, kind });
    assertNear(line.reached_at, reached, 30);
  },
);

Then('the "part" line for "p1" says it did not hold at {string} and has no "reached_at"', function (this: Context, evaluated: string) {
  const line = partLine(this, "p1");
  assert.deepEqual({ active: line.active, held: line.held, evaluated_at: line.evaluated_at }, { active: true, held: false, evaluated_at: evaluated });
  assert.ok(!Object.hasOwn(line, "reached_at"), `it gives "reached_at" ${String(line.reached_at)}`);
});

Then('the "part" line for "p1" gives "reached_at" {string}, within 30 world minutes', function (this: Context, reached: string) {
  assertNear(partLine(this, "p1").reached_at, reached, 30);
});

Then('the "part" line for "p1" gives the kind {string}', function (this: Context, kind: string) {
  assert.equal(partLine(this, "p1").kind, kind);
});

Then('the "part" line for "p2" says it was not active', function (this: Context) {
  const line = partLine(this, "p2");
  assert.equal(line.active, false);
  assert.ok(!Object.hasOwn(line, "held"), "a part not active has a result");
});

Then('the "part" line for "p1" gives the effort {int} calls and {int} money', function (this: Context, calls: number, money: number) {
  assert.deepEqual(partLine(this, "p1").effort, { calls, money });
});

Then('the "part" line for "p1" lists one misapplication: the first "clear_flag", with its time', function (this: Context) {
  const { misapplications } = partLine(this, "p1") as { misapplications: { tool: string; arguments: unknown; at: string }[] };
  assert.equal(misapplications.length, 1, JSON.stringify(misapplications));
  assert.deepEqual({ tool: misapplications[0].tool, arguments: misapplications[0].arguments }, { tool: "clear_flag", arguments: { flag: "door" } });
  // The first lands an hour into the run; the second, after an eight-hour wait, after the alarm.
  assertNear(misapplications[0].at, "day 1 10:00", 30);
});

Then('the "part" line for "w1" has no kind', function (this: Context) {
  const line = partLine(this, "w1");
  assert.equal(line.held, true);
  assert.ok(!Object.hasOwn(line, "kind"), `it gives the kind ${String(line.kind)}`);
});

Then('the run\'s log lists "p3" as "not_evaluated"', function (this: Context) {
  const all = lines(this);
  const listed = all.filter((line) => line.type === "parts_not_evaluated");
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].parts, ["p3"]);
  assert.ok(!all.some((line) => line.type === "part" && line.part === "p3"), '"p3" was evaluated');
});

Then('no text "ana" received contains "p1", "flag_set" or "covered"', function (this: Context) {
  const received = [
    setupOf(this).loaded?.systemPrompts.get("ana") ?? "",
    ...lines(this)
      .filter((line) => (line.type === "stimulus" || line.type === "tool_call") && line.agent === "ana")
      .map((line) => JSON.stringify(line)),
  ];
  for (const text of received) for (const word of ["p1", "flag_set", "covered"]) assert.ok(!text.includes(word), `"ana" received ${word}: ${text}`);
});

Then('the setup line gives the "parts" material\'s hash', function (this: Context) {
  const [setup] = lines(this).filter((line) => line.type === "run_setup");
  assert.ok(setup !== undefined, "the log has no setup line");
  const [material] = (setup.materials as { path: string; key: string; hash: string; heldOut: boolean }[]).filter(({ key }) => key === "parts");
  assert.deepEqual({ path: material?.path, heldOut: material?.heldOut }, { path: "parts.toml", heldOut: true });
  assert.match(material.hash, /^sha256:[0-9a-f]{64}$/);
  // The configuration it gives holds the material's reference, not its text.
  assert.deepEqual((setup.configuration as TomlTable).parts, { file: "parts.toml", held_out: true });
});

/** Each change the contract makes to the parts material or the experiment, by how it writes it. */
const changes: [RegExp, (setup: PartsSetup) => void][] = [
  [/^"p1"'s predicate is "moon_full"$/, (setup) => (setup.parts[0].predicate = "moon_full")],
  [/^"p1"'s kind for "rules" is "easy"$/, (setup) => ((setup.parts[0].kinds as TomlTable).rules = "easy")],
  [/^"p1"'s kinds lack "none"$/, (setup) => delete (setup.parts[0].kinds as TomlTable).none],
  [/^"p1"'s kinds name the level "chaos"$/, (setup) => ((setup.parts[0].kinds as TomlTable).chaos = "new")],
  [/^the experiment's "kind_factor" is "colour"$/, (setup) => (setup.kindFactor = { name: "colour" })],
  [/^"p1" is evaluated at "Monday"$/, (setup) => (setup.parts[0].evaluate_at = "Monday")],
  [/^"p1"'s actors name "zoe"$/, (setup) => (setup.parts[0].actors = ["zoe"])],
  [/^two parts have the id "p1"$/, (setup) => setup.parts.push(structuredClone(setup.parts[0]))],
];

Given("the parts material is changed so that {}", function (this: Context, written: string) {
  const known = changes.find(([pattern]) => pattern.test(written));
  assert.ok(known !== undefined, `the steps do not read the change "${written}"`);
  known[1](setupOf(this));
});

// The approved addition: a group beside the kind.

/** A part of the setup, by its id. */
const partNamed = (context: Context, id: string) => setupOf(context).parts.find((part) => part.id === id) as Part;

Given('the part "p1" also has the group "covered", and its kinds give "none" new and "rules" covered', function (this: Context) {
  Object.assign(partNamed(this, "p1"), { group: "covered", kinds: { none: "new", rules: "covered" } });
});

Then(/^the "part" line for "p1" gives the group "(\w+)" and the kind "(\w+)"$/, function (this: Context, group: string, kind: string) {
  const line = partLine(this, "p1");
  assert.deepEqual({ group: line.group, kind: line.kind }, { group, kind });
});

Given('the part "p2" has the group "variant", activation the event "flag_raised" with flag "alarm", evaluated at "end"', function (this: Context) {
  setupOf(this).parts.push({ id: "p2", predicate: "flag_set", params: { flag: "gate" }, activation: { event: "flag_raised", params: { flag: "alarm" } }, evaluate_at: "end", group: "variant", actors: [] } as Part);
});

Then('the "part" line for "p2" says it was not active and gives the group "variant"', function (this: Context) {
  const line = partLine(this, "p2");
  assert.deepEqual({ active: line.active, group: line.group }, { active: false, group: "variant" });
});

Given('"p1"\'s kinds also give the level "character" covered, which the experiment does not run', function (this: Context) {
  (partNamed(this, "p1").kinds as Record<string, string>).character = "covered";
});

Then("it is not refused", function (this: Context) {
  assert.equal(this.runError, undefined, `it was refused: ${this.runError?.message}`);
});

Given('"p1" has the group "changed" and kinds only for "rules"', function (this: Context) {
  Object.assign(partNamed(this, "p1"), { group: "changed", kinds: { rules: "covered" } });
});
