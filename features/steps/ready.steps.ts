import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, stringify } from "smol-toml";
import { type Inventory, inventory } from "../../src/engine/inventory.ts";
import { readExperiment } from "../../src/engine/experiment.ts";
import { MONEY_TOOLS } from "../../src/engine/money.ts";
import type { Perceived, RuleSet, RuleStep } from "../../src/engine/participants.ts";
import type { Context } from "../support/context.ts";
import { change, configurationOf, hourMsOf, setUpCongress } from "./congress.steps.ts";
import { changePools, minutesOf, ranLines } from "./congress-parties.steps.ts";
import { modelOf, script, scriptActivations } from "./tool.steps.ts";

/** The congress's one agent. */
const ORGANISER = "organiser";

/** Every day of the week, all day. */
const ALWAYS = { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" };

/** The Background's city: an office and the venue "mill-house". */
const CITY = {
  places: [{ id: "office" }],
  venues: [{ id: "mill-house", entrance: "mill-house-entrance", hours: "always", rooms: [{ id: "mill-hall", seats: 90 }] }],
  passages: [
    { between: ["office", "mill-house-entrance"], length: 20, step_free: true },
    { between: ["mill-house-entrance", "mill-hall"], length: 1, step_free: true },
  ],
};

/** The venue "mill-house", which fills the role "false_claim". */
const MILL_HOUSE: TomlTable = {
  id: "mill-house",
  roles: ["false_claim"],
  rooms: [{ id: "mill-hall", seats: 90, equipment: [] }],
  access_claim: "step-free access throughout",
  catering: "outside_free",
  opening: "doors open one hour before",
  price: 1500,
  extras: {},
  hold_days: 2,
  deposit_share: 0.25,
  deposit_due_days: 3,
  cancellation: [{ share: 0.5 }],
  indicative: false,
  enquiries_per_day: 0,
  pick_up: 1,
};

/** The sponsor "nordtech", which fills the role "slot". */
const NORDTECH: TomlTable = { id: "nordtech", roles: ["slot"], amount: 800, conditions: ["logo"], insists: [], pay_days: [2, 2], pick_up: 1 };

/** The attendees material an experiment sets. */
const ATTENDEES = {
  pool_factor: 1,
  base_per_day: 2,
  unannounced: 0,
  promotion_factor: 1,
  payment_fee_share: 0,
  cancel_share: 0,
  consent_share: 1,
  pay_share: 1,
  no_show_share: 0,
  diets: { none: 1 },
  access: { none: 1 },
  fixed: [],
};

/** A part the organiser has not reached by the run's end: the event's day booked for the attendance. */
const PART = { id: "p1", predicate: "P01", evaluate_at: "end" };

Given(
  "the congress scenario of FR-CONGRESS-07 with its base configuration, whose calendar starts at {string} with one segment of scale {int}, so one world hour is {int} milliseconds of the run",
  function (this: Context, start: string, scale: number, hourMs: number) {
    assert.equal((3600 * 1000) / scale, hourMs);
    setUpCongress(this, { start, segments: [{ scale }], hours: { always: ALWAYS } });
    change(this, (configuration) => (configuration.city = stringify(CITY)));
    // The run ends 5 world hours in, unless a scenario says when.
    this.timeLimitMs = 5 * hourMs;
  },
);

Given(
  'the variant draws the topic "rural development", the target attendance 67, the board "chair" with funds 1200, the venue "mill-house" in the role "false_claim" and the sponsor "nordtech" in the role "slot"',
  function (this: Context) {
    changePools(this, (pool) => {
      pool.topics = ["rural development"] as never;
      pool.venue = [structuredClone(MILL_HOUSE)];
      pool.board = [{ id: "chair", funds: 1200, reserve: 200 }];
      pool.sponsor = [structuredClone(NORDTECH)];
    });
    change(this, (configuration) => (configuration.draw = stringify({ attendance: [67, 67], board: 1, venue: { roles: { false_claim: 1 } }, sponsor: { roles: { slot: 1 } } })));
  },
);

/** The experiment a scenario writes, in a directory of its own with its materials, and the inventory made of it. */
const experiments = new WeakMap<Context, { toml: string; directory: string; inventory?: Inventory }>();

/** Writes an experiment over the congress, with these parts of it, and these materials in its directory. */
function writeExperiment(context: Context, parts: { common?: TomlTable; conditions?: Record<string, TomlTable>; baseline?: boolean }, materials: Record<string, string> = {}): void {
  const directory = mkdtempSync(join(tmpdir(), "congress-ready-"));
  mkdirSync(join(directory, "materials"));
  for (const [path, text] of Object.entries(materials)) writeFileSync(join(directory, path), text);
  const head = [
    'id = "e"',
    'scenario = "congress"',
    'models = ["scripted/one"]',
    'thinking_level = "off"',
    "replicas = 1",
    "seed = 1",
    ...(parts.baseline === true ? ["baseline = true"] : []),
    "[limits]",
    "time_limit_ms = 1000",
    "activations_per_agent = 1",
    "parallelism_limit = 1",
    "model_turn_timeout_ms = 500",
    "[compaction]",
    "enabled = false",
    "",
  ].join("\n");
  const body = stringify({ ...(parts.common === undefined ? {} : { common: parts.common }), conditions: parts.conditions ?? { base: {} } });
  experiments.set(context, { toml: `${head}${body}\n`, directory });
}

/** The experiment the scenario wrote. */
function experimentOf(context: Context) {
  const written = experiments.get(context);
  assert.ok(written !== undefined, "the scenario wrote no experiment");
  return written;
}

Given(
  'an experiment whose common part sets "attendees" and "parts" to materials, "[mail] send_words_per_minute" to 40 and "[durations] ledger" to 3',
  function (this: Context) {
    writeExperiment(
      this,
      {
        common: {
          attendees: { file: "materials/attendees.toml" },
          parts: { file: "materials/parts.toml", held_out: true },
          mail: { send_words_per_minute: 40 },
          durations: { ledger: 3 },
        },
      },
      { "materials/attendees.toml": stringify(ATTENDEES), "materials/parts.toml": stringify({ parts: [PART] }) },
    );
  },
);

Given(
  'an experiment whose common part adds "[calendar.hours.office]" and "[perturbations.change]", and a condition that adds "[perturbations.late_cancel]"',
  function (this: Context) {
    writeExperiment(this, {
      baseline: true,
      common: {
        calendar: { hours: { office: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], from: "09:00", to: "17:00" } } },
        perturbations: { change: { between: ["day 6 09:00", "day 6 10:00"], kind: "room_lost" } },
      },
      conditions: { cancelling: { perturbations: { late_cancel: { at: "day 24 10:00" } } } },
    });
  },
);

Given('a condition that sets "[mail] colour" to "blue"', function (this: Context) {
  writeExperiment(this, { conditions: { coloured: { mail: { colour: "blue" } } } });
});

When("the experiment's inventory is made", function (this: Context) {
  // The Background's congress, or an experiment of one condition over it when the scenario wrote none.
  if (!experiments.has(this)) writeExperiment(this, {});
  const written = experimentOf(this);
  const scenario = this.inventoryScenario?.();
  assert.ok(scenario !== undefined, "the scenario set up no congress");
  try {
    written.inventory = inventory(readExperiment(written.toml, written.directory), scenario);
  } catch (error) {
    this.runError = error as Error;
  }
});

/** Whether the scenario made the inventory of an experiment it wrote: the older steps of the same text check another. */
export function madeReadyInventory(context: Context): boolean {
  return experiments.get(context)?.inventory !== undefined || (experiments.has(context) && context.runError !== undefined);
}

/** The inventory of the experiment the scenario wrote, which must not have been refused. */
function readyInventory(context: Context): Inventory {
  assert.equal(context.runError, undefined, `the inventory was refused: ${context.runError?.message}`);
  const made = experimentOf(context).inventory;
  assert.ok(made !== undefined, "no inventory was made");
  return made;
}

/** "it is not refused, and the inventory gives those values", for FR-CONGRESS-08's experiment. */
export function assertReadyValues(context: Context): void {
  const [condition] = readyInventory(context).conditions;
  assert.equal(condition.mail?.durations.sendWordsPerMinute, 40);
  const world = condition.world as { durations: Record<string, number> };
  assert.equal(world.durations.ledger, 3);
  assert.deepEqual(
    condition.materials.map(({ path }) => path),
    ["materials/attendees.toml", "materials/parts.toml"],
  );
}

Then("it is not refused, and the inventory gives the hours and the three perturbations", function (this: Context) {
  const { conditions } = readyInventory(this);
  for (const condition of conditions) assert.deepEqual(condition.calendar?.hours.office?.days, ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], `${condition.condition} gives no hours "office"`);
  const perturbations = conditions.map((condition) => Object.keys((condition.world as { perturbations: Record<string, unknown> }).perturbations).sort());
  assert.deepEqual(perturbations, [["change"], ["change", "late_cancel"]]);
});

Then("it is refused, with an error that names {string}", function (this: Context, key: string) {
  assert.ok(this.runError !== undefined, "it was not refused");
  assert.ok(this.runError.message.includes(key), `the error does not name ${key}: ${this.runError.message}`);
});

/** The feature's text with its "\n" as a line break. */
const written = (text: string) => text.replaceAll("\\n", "\n");

Given('the {string} text is {string}', function (this: Context, key: string, text: string) {
  change(this, (configuration) => (configuration[key] = written(text)));
});

Then("the organiser's first message from the person reads {string}", function (this: Context, text: string) {
  const person = ranLines(this).filter((line) => line.type === "stimulus" && line.agent === ORGANISER && line.channel === "person");
  assert.deepEqual(
    person.map((line) => line.content),
    [text],
  );
});

Then(
  'the organiser\'s system prompt has one line per drawn party, among them "mill-house", a venue, with a mailbox and a line, taking "ask_quote \\(date, attendance)", "book \\(date, rooms, hours)" and its other acts',
  function (this: Context) {
    ranLines(this);
    const [messages] = modelOf(this, ORGANISER).received;
    const system = String(messages?.find((message) => message.role === "system")?.content ?? "");
    const lines = system.split("\n");
    for (const party of ["chair", "mill-house", "nordtech"]) assert.equal(lines.filter((line) => line.includes(party)).length, 1, `the system prompt has no one line for "${party}":\n${system}`);
    const line = lines.find((each) => each.includes("mill-house")) as string;
    for (const text of ["venue", "mailbox", "line", "ask_quote (date, attendance)", "book (date, rooms, hours)", "hold (date)", "accept_contract (contract)", "cancel_booking"]) {
      assert.ok(line.includes(text), `the line of "mill-house" does not give "${text}": ${line}`);
    }
    assert.ok(!line.includes("{"), `the line has braces: ${line}`);
  },
);

Then("it is refused before any model call, with an error that names {string} and {string}", function (this: Context, one: string, other: string) {
  assert.ok(this.runError !== undefined, "the run was not refused");
  for (const name of [one, other]) assert.ok(this.runError.message.includes(name), `the error does not name ${name}: ${this.runError.message}`);
  for (const [name, model] of this.models) assert.equal(model.received.length, 0, `the model "${name}" was called`);
});

/** Gives the configuration the parts material's text, with these actors for "p1". */
function partWithActors(context: Context, actors: string[]): void {
  change(context, (configuration) => (configuration.parts = stringify({ parts: [{ ...PART, actors }] })));
}

Given('the part {string} has the actors {string} and {string}', function (this: Context, part: string, one: string, other: string) {
  assert.equal(part, "p1");
  partWithActors(this, [one, other]);
  // The organiser writes to each of the Background's parties: two calls name the part's actors, one does not.
  const mail = (to: string, act: string, fields: Record<string, unknown> = {}) => ({ toolCalls: [{ name: "send_mail", arguments: { to, act, fields } }] as never, delayMs: 0 });
  script(this, ORGANISER, [
    mail("mill-house", "ask_quote", { date: "day 26", attendance: 67 }),
    mail("chair", "report"),
    mail("nordtech", "ask_conditions"),
    { text: "Done.", delayMs: 0 },
  ]);
});

Given('the part {string} has the actor {string}', function (this: Context, part: string, actor: string) {
  assert.equal(part, "p1");
  partWithActors(this, [actor]);
});

Then('{string}\'s effort counts the organiser\'s calls naming {string} or {string}', function (this: Context, part: string, one: string, other: string) {
  const lines = ranLines(this);
  const naming = (value: unknown): boolean => (typeof value === "string" ? [one, other].includes(value) : typeof value === "object" && value !== null && Object.values(value).some(naming));
  const calls = lines.filter((line) => line.type === "tool_call" && line.agent === ORGANISER);
  const expected = calls.filter((line) => naming(line.arguments)).length;
  assert.equal(expected, 2, "the organiser's calls named the actors other than twice");
  const line = lines.find((each) => each.type === "part" && each.part === part);
  assert.ok(line !== undefined, `the log has no part line for "${part}"`);
  assert.deepEqual((line.effort as { calls: number }).calls, expected);
});

/**
 * "ringer", the rule set "nordtech" follows here: it calls the organiser 120 world minutes after the run starts, then
 * mails it an hour after the call was placed.
 */
const ringer: RuleSet = {
  start: () => {
    let step = 0;
    return {
      atStart: (): RuleStep => ({ kind: "wait", minutes: 120 }),
      next: (_perceived: Perceived): RuleStep => {
        step += 1;
        if (step === 1) return { kind: "call", tool: "call", arguments: { to: ORGANISER, act: "ask" } };
        // The ring lasts 5 world minutes.
        if (step === 2) return { kind: "wait", minutes: 55 };
        if (step === 3) return { kind: "call", tool: "send_mail", arguments: { to: ORGANISER, act: "ask" } };
        return { kind: "end" };
      },
      outcome: () => ({}),
    };
  },
};

Given("the organiser's rhythm wakes it every 10 world hours and its scripted turns, each activation, call {string}, then end", function (this: Context, tool: string) {
  const intervalMs = 10 * hourMsOf(this);
  change(this, (configuration) => (configuration.rhythm = { ...(configuration.rhythm as TomlTable), min_ms: intervalMs, max_ms: intervalMs }));
  scriptActivations(this, ORGANISER, 3, () => [
    { toolCalls: [{ name: tool, arguments: {} }] as never, delayMs: 0 },
    { text: "Done.", delayMs: 0 },
  ]);
});

Given('{string} calls the organiser at {string} and mails it at {string}', function (this: Context, party: string, calls: string, mails: string) {
  const start = minutesOf((configurationOf(this).calendar as TomlTable).start as string);
  assert.deepEqual([party, minutesOf(calls) - start, minutesOf(mails) - minutesOf(calls)], ["nordtech", 120, 60]);
  change(this, (configuration) => (((configuration.kinds as TomlTable).sponsor as TomlTable).rules = "ringer"));
  this.libraryScenario = { ...this.libraryScenario, ruleSets: { ...this.libraryScenario.ruleSets, ringer } };
});

/** The world minutes since day 1's midnight at a time of the run, by performance.now(). */
function worldMinutesAt(context: Context, atMs: number): number {
  const start = minutesOf((configurationOf(context).calendar as TomlTable).start as string);
  return start + ((atMs - (context.runStartedAtMs as number)) / hourMsOf(context)) * 60;
}

/** The organiser's activations, each with the world minutes it started at. */
function activationsOf(context: Context): { at: number; wokeAtMs: number; endedAtMs: number }[] {
  return ranLines(context)
    .filter((line) => line.type === "activation" && line.agent === ORGANISER)
    .map((line) => ({ at: worldMinutesAt(context, line.wokeAtMs as number), wokeAtMs: line.wokeAtMs as number, endedAtMs: line.endedAtMs as number }));
}

Then('the organiser started an activation at {string}, within one world hour, with the ring among its stimuli', function (this: Context, time: string) {
  const at = minutesOf(time);
  const activation = activationsOf(this).find((each) => each.at >= at && each.at <= at + 60);
  assert.ok(activation !== undefined, `no activation started within an hour of ${time}: ${JSON.stringify(activationsOf(this).map(({ at: started }) => started))}`);
  const ring = ranLines(this).find((line) => line.type === "stimulus" && line.agent === ORGANISER && line.channel === "phone");
  assert.ok(ring !== undefined, "no ring reached the organiser");
  assert.ok((ring.deliveredAtMs as number) <= activation.wokeAtMs + 1, "the ring reached the organiser after the activation started");
  // The activation's first turn has the ring in its context.
  const [first] = modelOf(this, ORGANISER).received;
  assert.ok(JSON.stringify(first).includes(String(ring.content)), "the activation's first turn does not have the ring");
});

Then('no activation started between {string} and {string}', function (this: Context, from: string, to: string) {
  const started = activationsOf(this).filter(({ at }) => at > minutesOf(from) && at < minutesOf(to));
  assert.deepEqual(started, [], `activations started at ${started.map(({ at }) => at).join(", ")}`);
});

Then("the organiser's tools in the inventory are exactly those its session is offered, and do not include {string}, {string}, {string} or {string}", function (this: Context, one: string, two: string, three: string, four: string) {
  const excluded = [one, two, three, four];
  const [condition] = readyInventory(this).conditions;
  const listed = condition.tools.map(({ name }) => name).sort();
  // The organiser's account gives it ledger, pay and issue_invoice of the money's tools (the base's [money]).
  const offered = ["check_time", "look", "go", "write_note", "read_notes", "wait", "travel_options", "book_travel", "similar_events", "edit_ticket_page", "ticket_page", "publish_programme", "announce", "read_programme", "send_mail", "check_mail", "read_mail", "call", "answer_call", "ledger", "pay", "issue_invoice"].sort();
  assert.deepEqual(listed, offered);
  for (const tool of excluded) assert.ok((MONEY_TOOLS as readonly string[]).includes(tool) && !listed.includes(tool), `the inventory lists "${tool}"`);
});
