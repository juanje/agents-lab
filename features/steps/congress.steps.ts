import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { inventoryMarkdown } from "../../src/engine/inventory.ts";
import type { Perceived, RuleSet, RuleStep } from "../../src/engine/participants.ts";
import { type Condition, type LoadedScenario, loadScenario } from "../../src/engine/scenario.ts";
import { scenarioLibrary } from "../../src/scenarios/library.ts";
import type { Context } from "../support/context.ts";
import { madeInventory } from "./calendar.steps.ts";
import { linesOf, logLines } from "./record.steps.ts";
import { modelOf, runScenario, script } from "./tool.steps.ts";

/** The congress's one agent. */
const ORGANISER = "organiser";

/** One world minute in the Background's calendar, in milliseconds of the run. */
const MINUTE_MS = 10;

/** FR-CONGRESS-01's Background "city". */
const CITY = `
[[places]]
id = "office"
[[places]]
id = "station"

[[venues]]
id = "v1"
entrance = "v1-entrance"
hours = "office"
[[venues.rooms]]
id = "foyer"
[[venues.rooms]]
id = "main-hall"
seats = 120
equipment = ["projector"]

[[venues]]
id = "v2"
entrance = "v2-entrance"
hours = "office"

[[venues]]
id = "v3"
entrance = "v3-entrance"
hours = "office"

[[passages]]
between = ["office", "v1-entrance"]
length = 40
step_free = true
[[passages]]
between = ["office", "v2-entrance"]
length = 60
step_free = true
[[passages]]
between = ["office", "v3-entrance"]
length = 75
step_free = true
[[passages]]
between = ["v1-entrance", "foyer"]
length = 1
step_free = true
[[passages]]
between = ["foyer", "main-hall"]
length = 1
step_free = "3 steps"
`;

/** What a congress scenario sets up besides its configuration, which the library scenario of the context keeps: the conditions it runs under. */
interface CongressSetup {
  context: Context;
  conditions: Condition[];
  /** Each run's log lines, by condition, for the scenarios that run more than one. */
  runs: Record<string, unknown>[][];
  loaded?: LoadedScenario<unknown>;
}

const setups = new WeakMap<Context, CongressSetup>();

function setupOf(context: Context): CongressSetup {
  const setup = setups.get(context);
  assert.ok(setup !== undefined, "the scenario set up no congress");
  return setup;
}

/** The congress's configuration as the steps set it up: the library scenario's base configuration, which a step changes through \`change\`. */
function configurationOf(context: Context): TomlTable {
  return parse(context.libraryScenario.baseConfiguration ?? "");
}

/** Changes the congress's configuration. */
function change(context: Context, changing: (configuration: TomlTable) => void): void {
  const configuration = configurationOf(context);
  changing(configuration);
  context.libraryScenario = { ...context.libraryScenario, baseConfiguration: stringify(configuration) };
}

/** A TOML text of the configuration, such as "city", parsed, so a step can change it. */
function textOf(setup: CongressSetup, key: string): TomlTable {
  return parse(configurationOf(setup.context)[key] as string);
}

/** A TOML text of the configuration, as a step changed it. */
function setText(setup: CongressSetup, key: string, table: TomlTable): void {
  change(setup.context, (configuration) => (configuration[key] = stringify(table)));
}

/**
 * "silent", the rule set of the Background's kinds: it does nothing, unless its template's parameters say it sends the
 * organiser a mail some world minutes after the run starts.
 */
const silent: RuleSet = {
  start: (params) => ({
    atStart: (): RuleStep | undefined => (typeof params.sends_after_minutes === "number" ? { kind: "wait", minutes: params.sends_after_minutes } : undefined),
    next: ({ result }: Perceived): RuleStep =>
      typeof params.sends_after_minutes === "number" && result === undefined ? { kind: "call", tool: "send_mail", arguments: { to: ORGANISER, act: "ask" } } : { kind: "end" },
    outcome: () => ({}),
  }),
};

/** The congress scenario of the library, with the configuration the steps set up and the rule set "silent". */
function congressOf(setup: CongressSetup) {
  const scenario = setup.context.libraryScenario;
  return { ...scenario, ruleSets: { ...scenario.ruleSets, silent } };
}

/** Loads and runs the congress under a condition, if one is given, keeping its log's lines; a refusal is kept as the run's error. */
async function runCongress(context: Context, condition?: Condition): Promise<void> {
  const setup = setupOf(context);
  try {
    setup.loaded = loadScenario(congressOf(setup), context.seed, condition);
    await runScenario(context, setup.loaded);
  } catch (error) {
    context.runError = error as Error;
  }
}

Given(
  'the congress scenario, whose calendar starts at {string} with one segment of scale {int}, so one world minute is {int} milliseconds of the run, and declares the hours "office" on Monday to Friday from {string} to {string}',
  function (this: Context, start: string, scale: number, minuteMs: number, from: string, to: string) {
    assert.equal((60 * 1000) / scale, minuteMs);
    const scenario = scenarioLibrary.get("congress");
    assert.ok(scenario !== undefined, "the library has no congress scenario");
    this.libraryScenario = scenario;
    const setup: CongressSetup = { context: this, conditions: [], runs: [] };
    setups.set(this, setup);
    change(this, (configuration) => {
      configuration.calendar = { start, segments: [{ scale }], hours: { office: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], from, to } } };
      // The organiser wakes at once.
      configuration.rhythm = { ...(configuration.rhythm as TomlTable), min_ms: 0, max_ms: 0 };
    });
    this.seed = 1;
    script(this, ORGANISER, [{ text: "Nothing to do.", delayMs: 0 }]);
    this.inventoryScenario = () => congressOf(setup);
    this.runInstead = () => runCongress(this);
  },
);

Given(
  'its "city" has the places "office", "station", and the venues "v1", "v2" and "v3" with their entrances "v1-entrance", "v2-entrance" and "v3-entrance", joined to "office" by passages of 40, 60 and 75 world minutes, all step-free',
  function (this: Context) {
    change(this, (configuration) => (configuration.city = CITY));
  },
);

Given(
  '"v1"\'s interior is "foyer" and "main-hall", open in the hours "office"; "v1-entrance" to "foyer" is a step-free passage of 1 minute, and "foyer" to "main-hall" a passage of 1 minute whose "step_free" is "3 steps"; "main-hall" has 120 seats and the equipment "projector"',
  function (this: Context) {
    // In CITY.
  },
);

Given(
  'its "pools" have the venues "v1", "v2" and "v3", the speakers "s1", "s2", "s3" and "s4", and the topics "soil", "rivers" and "bees"',
  function (this: Context) {
    const pools = stringify({ topics: ["soil", "rivers", "bees"], venue: ["v1", "v2", "v3"].map((id) => ({ id })), speaker: ["s1", "s2", "s3", "s4"].map((id) => ({ id })) });
    change(this, (configuration) => (configuration.pools = pools));
  },
);

Given('its "draw" chooses {int} venues and {int} speakers, and a target attendance between {int} and {int}', function (this: Context, venues: number, speakers: number, fewest: number, most: number) {
  change(this, (configuration) => (configuration.draw = stringify({ attendance: [fewest, most], venue: venues, speaker: speakers })));
});

Given(
  'its "[kinds.venue]" and "[kinds.speaker]" give each party the rule set {string}, the tool {string} and the channel {string}',
  function (this: Context, rules: string, tool: string, channel: string) {
    const kind = { rules, tools: [tool], channels: [channel] };
    change(this, (configuration) => (configuration.kinds = { venue: kind, speaker: kind }));
  },
);

Given(
  'the mail and the phone of FR-MESSAGE-01 and FR-PHONE-01 exist, with "check_minutes" {int}, and the configuration\'s "away_factor" is {float}',
  function (this: Context, checkMinutes: number, awayFactor: number) {
    change(this, (configuration) => {
    configuration.mail = {
      mailboxes: [ORGANISER],
      delivery_minutes: [1, 1],
      send_minutes: 3,
      check_minutes: checkMinutes,
      read_minutes: 1,
      notice_source: "mail client",
      notice: "New mail from {from}: {subject}",
    };
    configuration.phone = { lines: [ORGANISER], ring_minutes: 5, call_minutes: 4, ring: "{from} calls ({call}): {act}. {fields}{text}" };
    configuration.away_factor = awayFactor;
    });
  },
);

/** A call of the organiser's as the contract writes it: `"tool"`, then its arguments. */
function callOf(written: string): { name: string; arguments: Record<string, unknown> } {
  const [, tool, rest = ""] = /^(?:call )?"(\w+)"\s*(.*)$/.exec(written) ?? [];
  assert.ok(tool !== undefined, `the steps do not read the call "${written}"`);
  const quoted = [...rest.matchAll(/"([^"]*)"/g)].map(([, text]) => text);
  if (tool === "go") return { name: tool, arguments: { place: /^to "([^"]+)"$/.exec(rest)?.[1] } };
  if (tool === "write_note") return { name: tool, arguments: { title: quoted[0], text: quoted[1] } };
  if (tool === "read_notes") return { name: tool, arguments: quoted.length === 0 ? {} : { title: quoted[0] } };
  if (tool === "wait") return { name: tool, arguments: { minutes: Number(rest) } };
  assert.equal(rest, "", `the steps do not read the arguments "${rest}" of "${tool}"`);
  return { name: tool, arguments: {} };
}

Given(/^the organiser's scripted turns (call .+), then end$/, function (this: Context, written: string) {
  script(this, ORGANISER, [
    ...written.split(", then ").map((part) => ({ toolCalls: [callOf(part)] as never, delayMs: 0 })),
    { text: "Done.", delayMs: 0 },
  ]);
});

Given("the organiser's scripted turns end at once", function (this: Context) {
  script(this, ORGANISER, [{ text: "Nothing to do.", delayMs: 0 }]);
});

/** The organiser's place and, when given, the calendar's start, as a scenario changes them. */
function startsAt(context: Context, place: string, time?: string): void {
  change(context, (configuration) => {
    configuration.organiser_place = place;
    if (time !== undefined) (configuration.calendar as TomlTable).start = time;
  });
}

Given("the organiser starts in {string} on {string}", function (this: Context, place: string, time: string) {
  startsAt(this, place, time);
});

Given("the calendar starts at {string} and the organiser starts in {string}", function (this: Context, time: string, place: string) {
  startsAt(this, place, time);
});

Given("the calendar starts at {string}, within the venue's hours", function (this: Context, time: string) {
  change(this, (configuration) => ((configuration.calendar as TomlTable).start = time));
});

Given("the organiser starts in {string}", function (this: Context, place: string) {
  startsAt(this, place);
});

/** The log's lines of the last run, which must not have stopped. */
function ranLines(context: Context): Record<string, unknown>[] {
  assert.equal(context.runError, undefined, `the run stopped: ${context.runError?.message}`);
  return logLines(context);
}

/** The organiser's calls of a tool, in order. */
function callsOf(context: Context, tool: string): Record<string, unknown>[] {
  return ranLines(context).filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === tool);
}

/** The organiser's only call of a tool. */
function onlyCall(context: Context, tool: string): Record<string, unknown> {
  const calls = callsOf(context, tool);
  assert.equal(calls.length, 1, `the organiser made ${calls.length} "${tool}" calls`);
  return calls[0];
}

/** What a "look" shows, as JSON. */
interface Looked {
  place: string;
  closed?: boolean;
  exits: { place: string; length: number; step_free: true | string }[];
  seats?: number;
  equipment?: string[];
}

/** The nth "look" result, as JSON. */
function looked(context: Context, index = 0): Looked {
  const call = callsOf(context, "look")[index];
  assert.ok(call !== undefined, `the organiser made no look number ${index + 1}`);
  return JSON.parse(call.result as string) as Looked;
}

Then(
  'the "look" result gives the place {string} and the exits "v1-entrance" \\(40, step-free), "v2-entrance" \\(60, step-free) and "v3-entrance" \\(75, step-free)',
  function (this: Context, place: string) {
    const seen = looked(this);
    assert.equal(seen.place, place);
    assert.deepEqual(seen.exits, [
      { place: "v1-entrance", length: 40, step_free: true },
      { place: "v2-entrance", length: 60, step_free: true },
      { place: "v3-entrance", length: 75, step_free: true },
    ]);
  },
);

/** Checks how long a call took, in milliseconds of the run, within a margin. */
function assertTook(call: Record<string, unknown>, expectedMs: number, withinMs: number): void {
  const tookMs = (call.endedAtMs as number) - (call.startedAtMs as number);
  assert.ok(Math.abs(tookMs - expectedMs) <= withinMs, `the "${String(call.tool)}" call took ${Math.round(tookMs)} ms, not ${expectedMs} within ${withinMs}`);
}

Then('the "look" result gives the exits {string} and {string}', function (this: Context, first: string, second: string) {
  assert.deepEqual(
    looked(this).exits.map(({ place }) => place),
    [first, second],
  );
});

Then('the "look" result gives the exits {string} and {string} only', function (this: Context, first: string, second: string) {
  assert.deepEqual(
    looked(this).exits.map(({ place }) => place),
    [first, second],
  );
});

Then('the first "look" result gives the exit {string} with the length {int} and "step_free" {string}', function (this: Context, place: string, length: number, stepFree: string) {
  const exit = looked(this, 0).exits.find((each) => each.place === place);
  assert.deepEqual(exit, { place, length, step_free: stepFree });
});

Then("the second gives {string} with {int} seats and the equipment {string}", function (this: Context, place: string, seats: number, equipment: string) {
  const seen = looked(this, 1);
  assert.deepEqual({ place: seen.place, seats: seen.seats, equipment: seen.equipment }, { place, seats, equipment: [equipment] });
});

Then('the "look" result says the interior is closed and lists no exit into it', function (this: Context) {
  const seen = looked(this);
  assert.equal(seen.closed, true, `the look does not say the interior is closed: ${JSON.stringify(seen)}`);
  assert.deepEqual(
    seen.exits.map(({ place }) => place),
    ["office"],
  );
});

Then('the "go" call failed with the outcome {string}, took no time and changed nothing', function (this: Context, outcome: string) {
  const call = onlyCall(this, "go");
  assert.equal(call.outcome, outcome);
  assertTook(call, 0, 10);
  assert.equal(this.applied.length, 0, `${this.applied.length} effects were applied`);
});

/** The text a call gives the organiser: a sensor's result, an effector's text. */
function textOfCall(call: Record<string, unknown>): string {
  return (call.result ?? call.text) as string;
}

Then('the first "read_notes" result lists one title, {string}', function (this: Context, title: string) {
  const [first] = callsOf(this, "read_notes");
  assert.equal(first.outcome, "success");
  assert.equal(textOfCall(first), title);
});

Then("the second is {string}", function (this: Context, text: string) {
  const second = callsOf(this, "read_notes")[1];
  assert.equal(second.outcome, "success");
  assert.equal(textOfCall(second), text);
});

Then("the third failed with the outcome {string}", function (this: Context, outcome: string) {
  assert.equal(callsOf(this, "read_notes")[2].outcome, outcome);
});

/** The draw a seed gives the congress as the steps set it up, from the variant line of a load. */
function drawnWith(context: Context, seed: number): Record<string, unknown> {
  return loadScenario(congressOf(setupOf(context)), seed).variant as Record<string, unknown>;
}

/** Chooses, for the scenario's runs, the first seed whose draw chooses these templates of a kind. */
function seedDrawing(context: Context, kind: string, ids: readonly string[], exactly = false): void {
  for (let seed = 1; seed < 1000; seed += 1) {
    const chosen = (drawnWith(context, seed).chosen as Record<string, string[]>)[kind];
    if (exactly ? [...chosen].sort().join() === [...ids].sort().join() : ids.every((id) => chosen.includes(id))) {
      context.seed = seed;
      return;
    }
  }
  assert.fail(`no seed below 1000 draws ${ids.join(", ")} among the ${kind}s`);
}

Given("a participant {string} sends the organiser a mail at {string}", function (this: Context, speaker: string, time: string) {
  const setup = setupOf(this);
  const configuration = configurationOf(this);
  const start = (configuration.calendar as TomlTable).start as string;
  const minutesOf = (written: string) => {
    const [, hours, minutes] = /(\d\d):(\d\d)$/.exec(written) ?? [];
    return Number(hours) * 60 + Number(minutes);
  };
  const pools = textOf(setup, "pools");
  // Its mail takes send_minutes to send: it starts sending so that it is sent at that time.
  const sendMinutes = (configuration.mail as TomlTable).send_minutes as number;
  pools.speaker = (pools.speaker as TomlTable[]).map((template) => (template.id === speaker ? { ...template, sends_after_minutes: minutesOf(time) - minutesOf(start) - sendMinutes } : template));
  setText(setup, "pools", pools);
  seedDrawing(this, "speaker", [speaker]);
});

Then('the first "wait" failed with the outcome {string} and took no time', function (this: Context, outcome: string) {
  const [first] = callsOf(this, "wait");
  assert.equal(first.outcome, outcome);
  assertTook(first, 0, 10);
});

Then('the second ended with the outcome {string} when the mail\'s notice arrived', function (this: Context, outcome: string) {
  const second = callsOf(this, "wait")[1];
  assert.equal(second.outcome, outcome);
  const notice = ranLines(this).find((line) => line.type === "stimulus" && line.agent === ORGANISER && line.channel === "mail_notice");
  assert.ok(notice !== undefined, "no mail notice reached the organiser");
  assert.ok(Math.abs((second.endedAtMs as number) - (notice.deliveredAtMs as number)) <= 10, "the wait did not end when the notice arrived");
});

Then('the "check_mail" call took {int} world minutes, {int} milliseconds of the run, within {int}', function (this: Context, minutes: number, expectedMs: number, withinMs: number) {
  assert.equal(minutes * MINUTE_MS, expectedMs);
  assertTook(onlyCall(this, "check_mail"), expectedMs, withinMs);
});

Given('the experiment has two conditions that differ only in their {string}', function (this: Context, key: string) {
  setupOf(this).conditions = ["instructions", "character"].map((name) => ({ name, change: stringify({ [key]: `Act by your ${name}.` }) }));
});

When("one replica of each runs with the seed {int}", { timeout: 20_000 }, async function (this: Context, seed: number) {
  const setup = setupOf(this);
  this.seed = seed;
  for (const condition of setup.conditions) {
    script(this, ORGANISER, [{ text: "Nothing to do.", delayMs: 0 }]);
    await runCongress(this, condition);
    assert.equal(this.runError, undefined, `the run stopped: ${this.runError?.message}`);
    // Each run writes its own log in the scenario's log directory.
    setup.runs.push(linesOf(this, `${this.runId}.jsonl`).map((line) => JSON.parse(line) as Record<string, unknown>));
  }
});

/** The variant line of each run. */
function variantLines(context: Context): Record<string, unknown>[] {
  return setupOf(context).runs.map((lines) => {
    const variants = lines.filter((line) => line.type === "variant");
    assert.equal(variants.length, 1, `a run's log has ${variants.length} "variant" lines`);
    return variants[0];
  });
}

Then("both runs' {string} lines give the same topic, target attendance, venues and speakers", function (this: Context, type: string) {
  assert.equal(type, "variant");
  const [first, second] = variantLines(this);
  assert.ok(first !== undefined && second !== undefined, "two runs did not run");
  const { type: _first, ...drawn } = first;
  const { type: _second, ...again } = second;
  assert.deepEqual(again, drawn);
  assert.ok(["soil", "rivers", "bees"].includes(drawn.topic as string), `the topic is ${String(drawn.topic)}`);
  assert.equal((drawn.chosen as Record<string, string[]>).venue.length, 3);
});

Then(
  'the speakers are 3 of "s1", "s2", "s3" and "s4", and the target attendance is between {int} and {int}',
  function (this: Context, fewest: number, most: number) {
    const [drawn] = variantLines(this);
    const speakers = (drawn.chosen as Record<string, string[]>).speaker;
    assert.equal(new Set(speakers).size, 3);
    for (const speaker of speakers) assert.ok(["s1", "s2", "s3", "s4"].includes(speaker));
    assert.ok(Number.isInteger(drawn.attendance) && (drawn.attendance as number) >= fewest && (drawn.attendance as number) <= most, `the target attendance is ${String(drawn.attendance)}`);
  },
);

/** The participants the last load gave, by name. */
function participantsOf(context: Context) {
  ranLines(context);
  return new Map((setupOf(context).loaded?.participants ?? []).map((participant) => [participant.name, participant]));
}

Then(
  'each chosen venue and speaker is a participant named by its id, with a mailbox and a line, deciding by {string}, with the tool {string} and the channel {string}',
  function (this: Context, rules: string, tool: string, channel: string) {
    const loaded = setupOf(this).loaded as LoadedScenario<unknown>;
    const [variant] = ranLines(this).filter((line) => line.type === "variant");
    const chosen = variant.chosen as Record<string, string[]>;
    const participants = participantsOf(this);
    for (const id of [...chosen.venue, ...chosen.speaker]) {
      const participant = participants.get(id);
      assert.ok(participant !== undefined, `"${id}" is no participant`);
      assert.deepEqual({ decides: participant.decides, rules: participant.decides === "rules" ? participant.rules : undefined, tools: participant.tools, channels: participant.channels }, { decides: "rules", rules, tools: [tool], channels: [channel] });
      assert.ok(loaded.mail?.settings.mailboxes.includes(id), `"${id}" has no mailbox`);
      assert.ok(loaded.phone?.settings.lines.includes(id), `"${id}" has no line`);
    }
    assert.equal(participants.size, chosen.venue.length + chosen.speaker.length);
  },
);

Then("the speaker not chosen is no participant", function (this: Context) {
  const [variant] = ranLines(this).filter((line) => line.type === "variant");
  const chosen = (variant.chosen as Record<string, string[]>).speaker;
  const left = ["s1", "s2", "s3", "s4"].filter((id) => !chosen.includes(id));
  assert.equal(left.length, 1);
  assert.ok(!participantsOf(this).has(left[0]), `"${left[0]}" is a participant`);
  assert.ok(!(setupOf(this).loaded?.mail?.settings.mailboxes.includes(left[0]) ?? false), `"${left[0]}" has a mailbox`);
});

Given('the "draw" chooses {int} venues, and the seed draws {string} and {string}', function (this: Context, venues: number, first: string, second: string) {
  const setup = setupOf(this);
  setText(setup, "draw", { ...textOf(setup, "draw"), venue: venues });
  seedDrawing(this, "venue", [first, second], true);
});

Given(
  'the configuration\'s "task" is {string}, "limits" {string}, "restrictions" {string}, "knowledge" {string} and "guidance" {string}',
  function (this: Context, task: string, limits: string, restrictions: string, knowledge: string, guidance: string) {
    change(this, (configuration) => Object.assign(configuration, { task, limits, restrictions, knowledge, guidance }));
  },
);

Given('"[placement]" puts "task" in the person\'s first message and the others in the system prompt', function (this: Context) {
  change(this, (configuration) => (configuration.placement = { task: "person", limits: "system", restrictions: "system", knowledge: "system", guidance: "system" }));
});

Then("the organiser's system prompt is {string}", function (this: Context, prompt: string) {
  ranLines(this);
  const expected = prompt.replaceAll("\\n", "\n");
  for (const [turn, messages] of modelOf(this, ORGANISER).received.entries()) {
    const system = messages.find((message) => message.role === "system");
    assert.equal(system?.content, expected, `turn ${turn + 1} received another system prompt`);
  }
});

Then("its first message from the person is {string}", function (this: Context, text: string) {
  const person = ranLines(this).filter((line) => line.type === "stimulus" && line.agent === ORGANISER && line.channel === "person");
  assert.deepEqual(
    person.map((line) => line.content),
    [text],
  );
});

Then(
  'it gives the places and passages with their lengths and "step_free", "v1"\'s rooms, seats and hours, the draw\'s ranges, each kind\'s settings, the tools\' durations, the "away_factor", and the prompt\'s texts and placement',
  function (this: Context) {
    const made = madeInventory(this);
    const [condition] = made.conditions;
    const world = (condition as { world?: Record<string, unknown> }).world;
    assert.ok(world !== undefined, "the inventory gives no world");
    const printed = inventoryMarkdown(made);
    for (const expected of ['"v1-entrance"', '"3 steps"', '"main-hall"', '"seats": 120', '"projector"', '"hours": "office"', '"attendance"', '"speaker": 3', '"silent"', '"away_factor": 1.5', '"guidance"', '"placement"']) {
      assert.ok(printed.includes(expected), `the printed inventory does not give ${expected}`);
    }
    const tools = condition.tools.map(({ name }) => name);
    for (const tool of ["check_time", "look", "go", "write_note", "read_notes", "wait", "send_mail", "check_mail", "read_mail", "call", "answer_call"]) {
      assert.ok(tools.includes(tool), `the inventory lists no tool "${tool}"`);
    }
    for (const { name, duration } of condition.tools) assert.ok(duration.trim() !== "", `the tool "${name}" has no duration`);
  },
);

/** Each change the contract makes to the congress's configuration, by how it writes it. */
const congressChanges: [RegExp, (setup: CongressSetup) => void][] = [
  [/^"city" is not valid TOML$/, (setup) => change(setup.context, (configuration) => (configuration.city = "[[places]\nid = "))],
  [
    /^a passage joins "office" to "moon"$/,
    (setup) => {
      const city = textOf(setup, "city");
      setText(setup, "city", { ...city, passages: [...(city.passages as TomlTable[]), { between: ["office", "moon"], length: 5, step_free: true }] });
    },
  ],
  [
    /^a passage's "step_free" is 3$/,
    (setup) => {
      const city = textOf(setup, "city");
      const [first, ...rest] = city.passages as TomlTable[];
      setText(setup, "city", { ...city, passages: [{ ...first, step_free: 3 }, ...rest] });
    },
  ],
  [
    /^"v1"'s hours are "night", which the calendar lacks$/,
    (setup) => {
      const city = textOf(setup, "city");
      setText(setup, "city", { ...city, venues: (city.venues as TomlTable[]).map((venue) => (venue.id === "v1" ? { ...venue, hours: "night" } : venue)) });
    },
  ],
  [/^the "draw" chooses 5 speakers from a pool of 4$/, (setup) => setText(setup, "draw", { ...textOf(setup, "draw"), speaker: 5 })],
  [/^the "draw" chooses 1 caterer and "pools" has no caterers$/, (setup) => setText(setup, "draw", { ...textOf(setup, "draw"), caterer: 1 })],
  [/^the target attendance is between 80 and 50$/, (setup) => setText(setup, "draw", { ...textOf(setup, "draw"), attendance: [80, 50] })],
  [/^"\[kinds\.sponsor\]" is given and "pools" has no sponsors$/, (setup) => change(setup.context, (configuration) => ((configuration.kinds as TomlTable).sponsor = { rules: "silent", tools: [], channels: [] }))],
  [/^"wait_max_minutes" is 2000$/, (setup) => change(setup.context, (configuration) => (configuration.wait_max_minutes = 2000))],
  [/^"away_factor" is 0\.5$/, (setup) => change(setup.context, (configuration) => (configuration.away_factor = 0.5))],
  [
    /^two speakers in the pool have the id "s1"$/,
    (setup) => {
      const pools = textOf(setup, "pools");
      setText(setup, "pools", { ...pools, speaker: [...(pools.speaker as TomlTable[]), { id: "s1" }] });
    },
  ],
];

Given("the configuration is changed so that {}", function (this: Context, change: string) {
  const known = congressChanges.find(([written]) => written.test(change));
  assert.ok(known !== undefined, `the steps do not read the change "${change}"`);
  known[1](setupOf(this));
});
