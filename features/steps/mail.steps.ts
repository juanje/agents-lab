import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import type { JsonObject } from "@earendil-works/pi-ai";
import { type TomlTable, stringify } from "smol-toml";
import type { WorldTime } from "../../src/engine/calendar.ts";
import type { Component } from "../../src/engine/components.ts";
import type { Mail } from "../../src/engine/mail.ts";
import { type LoadedScenario, type Scenario, loadScenario } from "../../src/engine/scenario.ts";
import type { ScriptedAnswer } from "../../src/engine/scripted-model.ts";
import { rhythmChannel } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { toTheMinute } from "./calendar.steps.ts";
import { linesOf, logLines } from "./record.steps.ts";
import { asRead } from "./stimulus.steps.ts";
import { returned, runTheScenario, script } from "./tool.steps.ts";

/** The test scenario's world: the mail the engine keeps in it, and nothing else. */
interface Post {
  mail: Mail;
}

/** What the mail scenarios set up: the agents and components, the configuration's [mail], and the world the run acted on. */
interface MailSetup {
  agents: string[];
  components: Map<string, Component<Post>["cycle"]>;
  mail: TomlTable;
  loaded?: LoadedScenario<Post>;
}

const setups = new WeakMap<Context, MailSetup>();

function setupOf(context: Context): MailSetup {
  const setup = setups.get(context);
  assert.ok(setup !== undefined, "the scenario set up no mail test scenario");
  return setup;
}

/** A component whose cycle ends at once, for a component the scenario gives no cycle. */
const idle: Component<Post>["cycle"] = () => ({ next: () => ({ kind: "end" }) });

/**
 * The test scenario as its steps set it up: its agents wake at once and are told nothing of the world; its components
 * follow the cycles the steps give them; its base configuration holds the [calendar] and the [mail] the steps declare,
 * which the engine reads as it loads the scenario.
 */
function mailScenario(context: Context, agents: readonly string[]): Scenario<Post> {
  const setup = setupOf(context);
  return {
    name: "mail",
    agents: () => agents,
    // The engine puts the mail in the world as it loads the scenario; the scenario starts it with none.
    initialState: () => ({ mail: { mailboxes: {}, inTransit: [] } }),
    tools: [],
    channels: () => [rhythmChannel],
    metrics: {},
    systemPrompt: (_configuration, agent) => `You are "${agent}".`,
    rhythm: () => () => 0,
    describeDuration: () => "As the mail gives it.",
    describeRhythm: () => "No wait before any activation.",
    components: () => [...setup.components].map(([name, cycle]) => ({ name, kind: "world", description: `The test component "${name}".`, cycle })),
    mail: { of: (state) => state.mail, with: (state, mail) => ({ ...state, mail }) },
    baseConfiguration: stringify({ agents: [...agents], ...(context.calendar === undefined ? {} : { calendar: context.calendar }), mail: setup.mail }),
  };
}

Given(
  "a test scenario with the agents {string} and {string} and the component {string}, each with a mailbox",
  function (this: Context, first: string, second: string, component: string) {
    const setup: MailSetup = { agents: [first, second], components: new Map([[component, idle]]), mail: { mailboxes: [first, second, component] } };
    setups.set(this, setup);
    // Each agent ends its only activation at once unless the scenario scripts its turns.
    for (const agent of setup.agents) script(this, agent, [{ text: "Nothing to do.", delayMs: 0 }]);
    this.assembleRun = (agents) => {
      setup.loaded = loadScenario(mailScenario(this, agents), this.seed);
      return setup.loaded as LoadedScenario<unknown>;
    };
  },
);

Given(
  "the configuration's calendar starts at {string} with one segment of scale {int}, so one world minute is {int} milliseconds of the run",
  function (this: Context, start: string, scale: number, minuteMs: number) {
    assert.equal((60 * 1000) / scale, minuteMs, `at the scale ${scale}, a world minute is not ${minuteMs} ms`);
    this.calendar = { start, segments: [{ scale }] };
  },
);

Given(
  /^the mail's "delivery_minutes" is \[(\d+), (\d+)\], its "send_minutes" (\d+), its "check_minutes" (\d+) and its "read_minutes" (\d+), with no time per field or word$/,
  function (this: Context, from: string, to: string, send: string, check: string, read: string) {
    Object.assign(setupOf(this).mail, {
      delivery_minutes: [Number(from), Number(to)],
      send_minutes: Number(send),
      check_minutes: Number(check),
      read_minutes: Number(read),
    });
  },
);

Given(/^the mail's notice source is "([^"]+)" and its notice is "([^"]+)"$/, function (this: Context, source: string, notice: string) {
  Object.assign(setupOf(this).mail, { notice_source: source, notice });
});

Given(
  "{string} takes the acts {string}, which requires the fields {string} and {string}, and {string}, which requires none",
  function (this: Context, recipient: string, first: string, field: string, other: string, second: string) {
    setupOf(this).mail.acts = { [recipient]: { [first]: [field, other], [second]: [] } };
  },
);

/** The id the engine gives the first message of a run: messages are numbered from 1, in the order they are sent. */
const FIRST_MESSAGE_ID = "m-1";

/** The fields a call's description gives, as `name "text"` or `name number`, joined by "and". */
function fieldsOf(written: string): JsonObject {
  const fields: JsonObject = {};
  for (const [, name, text, number] of written.matchAll(/(\w+) (?:"([^"]*)"|(\d+(?:\.\d+)?))/g)) fields[name] = text ?? Number(number);
  return fields;
}

/** The arguments of a "send_mail" call as the contract writes them: its recipient, act, fields, subject and text. */
function sendArguments(written: string): JsonObject {
  const args: JsonObject = {};
  const quoted = (pattern: RegExp) => pattern.exec(written)?.[1];
  const to = quoted(/to "([^"]+)"/);
  const act = quoted(/the act "([^"]+)"/);
  const subject = quoted(/the subject "([^"]+)"/);
  const text = quoted(/the text "([^"]+)"/);
  const fields = quoted(/the fields? (.+?)(?:, and a text|$)/);
  const words = quoted(/a text of (\d+) words/);
  if (to !== undefined) args.to = to;
  if (act !== undefined) args.act = act;
  if (fields !== undefined) args.fields = fieldsOf(fields);
  if (subject !== undefined) args.subject = subject;
  if (text !== undefined) args.text = text;
  if (words !== undefined) args.text = Array.from({ length: Number(words) }, () => "word").join(" ");
  return args;
}

/** The arguments of a call of a tool, from what follows its name in the contract's words. */
function argumentsOf(tool: string, written: string): JsonObject {
  if (tool === "send_mail") return sendArguments(written);
  if (written === "") return {};
  if (written === 'with "unread_only"') return { unread_only: true };
  if (written === "with the first message's id") return { id: FIRST_MESSAGE_ID };
  const id = /^with the id "([^"]+)"$/.exec(written)?.[1];
  assert.ok(id !== undefined, `the steps do not read the arguments "${written}" of "${tool}"`);
  return { id };
}

/**
 * An agent's turns as the contract writes them: parts joined by ", then ", each a wait before the next call, a call
 * (`call "<tool>" …`, or `"<tool>" …` after the first), or the end; each call is a turn of its own.
 */
function turnsOf(written: string): ScriptedAnswer[] {
  const answers: ScriptedAnswer[] = [];
  let delayMs = 0;
  for (const part of written.split(", then ")) {
    const wait = /^wait (\d+) milliseconds$/.exec(part);
    if (wait !== null) {
      delayMs += Number(wait[1]);
      continue;
    }
    if (part === "end") {
      answers.push({ text: "Done.", delayMs });
      return answers;
    }
    const call = /^(?:call )?"(\w+)"\s*(.*)$/.exec(part);
    assert.ok(call !== null, `the steps do not read the part "${part}" of an agent's turns`);
    const [, tool, rest] = call;
    answers.push({ toolCalls: [{ name: tool, arguments: argumentsOf(tool, rest) }], delayMs });
    delayMs = 0;
  }
  assert.fail(`the agent's turns "${written}" do not end`);
}

Given(/^"(\w+)"'s scripted turns (.+)$/, function (this: Context, agent: string, written: string) {
  script(this, agent, turnsOf(written));
});

/** A line of the run's log, as JSON gives it back. */
type Line = ReturnType<typeof logLines>[number];

/** The run's only "message_sent" line, which "the message" and "it" name. */
function sentLine(context: Context): Line {
  const lines = logLines(context).filter((line) => line.type === "message_sent");
  assert.equal(lines.length, 1, `the log has ${lines.length} "message_sent" lines`);
  return lines[0];
}

/** The log's "message_delivered" line of a message's id. */
function deliveredLine(context: Context, id: unknown): Line {
  const lines = logLines(context).filter((line) => line.type === "message_delivered" && line.id === id);
  assert.equal(lines.length, 1, `the log has ${lines.length} "message_delivered" lines for ${String(id)}`);
  return lines[0];
}

/** Checks a moment of the run, in milliseconds by performance.now(), against the one the contract gives into the run. */
function assertAtMs(context: Context, what: string, atMs: unknown, expectedMs: number, withinMs: number): void {
  const intoRunMs = (atMs as number) - (context.runStartedAtMs ?? 0);
  assert.ok(Math.abs(intoRunMs - expectedMs) <= withinMs, `${what} ${Math.round(intoRunMs)} ms into the run, not ${expectedMs} within ${withinMs}`);
}

Then(
  "the message was sent {int} milliseconds into the run, within {int}, at the world time {string}",
  function (this: Context, expectedMs: number, withinMs: number, time: string) {
    const line = sentLine(this);
    assertAtMs(this, "the message was sent", line.atMs, expectedMs, withinMs);
    assert.equal(toTheMinute(line.worldTime as WorldTime), time);
  },
);

Then("the {string} action was given the world's time {string}", function (this: Context, tool: string, time: string) {
  // The send's landing is the one effect applied for an agent's call: its arguments name the agent.
  const landings = this.applied.map(({ args }) => args as { agent?: string; world?: WorldTime }).filter((args) => args.agent !== undefined);
  assert.equal(landings.length, 1, `${landings.length} effects were applied for an agent's call, not the one "${tool}"`);
  const [{ world }] = landings;
  assert.ok(world !== undefined, `the "${tool}" action was given no world time`);
  assert.equal(toTheMinute(world), time);
});

Then(
  "it landed in {string}'s mailbox {int} milliseconds into the run, within {int}, at {string}",
  function (this: Context, recipient: string, expectedMs: number, withinMs: number, time: string) {
    const { id } = sentLine(this);
    const line = deliveredLine(this, id);
    assertAtMs(this, "it landed", line.atMs, expectedMs, withinMs);
    assert.equal(toTheMinute(line.worldTime as WorldTime), time);
    const mailbox = setupOf(this).loaded?.world.state.mail.mailboxes[recipient] ?? [];
    assert.ok(
      mailbox.some((message) => message.id === id),
      `"${recipient}"'s mailbox does not hold ${String(id)}`,
    );
  },
);

Then("{string} received {string} through the channel {string}", function (this: Context, agent: string, text: string, channel: string) {
  const stimuli = logLines(this).filter((line) => line.type === "stimulus" && line.agent === agent && line.channel === channel);
  assert.deepEqual(
    stimuli.map((line) => asRead(line.source as string, line.content as string)),
    [text],
  );
});

Given("the mail's {string} is [{int}, {int}]", function (this: Context, key: string, from: number, to: number) {
  setupOf(this).mail[key] = [from, to];
});

Given("the mail's {string} is {float} and its {string} is {int}", function (this: Context, key: string, value: number, other: string, otherValue: number) {
  Object.assign(setupOf(this).mail, { [key]: value, [other]: otherValue });
});

Given("the mail declares no notice", function (this: Context) {
  delete setupOf(this).mail.notice;
  delete setupOf(this).mail.notice_source;
});

/** The lines of the log the scenario's last run wrote, by its run id, parsed. */
function lastRunLines(context: Context): Line[] {
  assert.ok(context.runId !== undefined, "no run gave its id");
  return linesOf(context, `${context.runId}.jsonl`).map((line) => JSON.parse(line) as Line);
}

/** The milliseconds of the run from each message's "message_sent" line to its "message_delivered" line, in the log's order. */
function delaysMs(lines: readonly Line[]): number[] {
  return lines
    .filter((line) => line.type === "message_sent")
    .map((sent) => {
      const landed = lines.find((line) => line.type === "message_delivered" && line.id === sent.id);
      assert.ok(landed !== undefined, `${String(sent.id)} did not land`);
      return (landed.atMs as number) - (sent.atMs as number);
    });
}

/** The delays of the message each replica's run sent, in run milliseconds, for the step that compares them. */
const replicaDelays = new WeakMap<Context, number[][]>();

When(
  "two replicas run with the seed {int}, the second with another agent {string} who has a mailbox",
  async function (this: Context, seed: number, other: string) {
    const setup = setupOf(this);
    this.seed = seed;
    const delays: number[][] = [];
    await runTheScenario(this);
    delays.push(delaysMs(lastRunLines(this)));
    (setup.mail.mailboxes as string[]).push(other);
    script(this, other, [{ text: "Nothing to do.", delayMs: 0 }]);
    // Each replica's scripted models start again from their first answer.
    for (const [agent, answers] of this.scripts) script(this, agent, answers);
    await runTheScenario(this);
    delays.push(delaysMs(lastRunLines(this)));
    replicaDelays.set(this, delays);
  },
);

/** The run milliseconds one world minute takes in the Background's calendar. */
const MINUTE_MS = 100;

Then("the message's delay was the same in both, between {int} and {int} world minutes", function (this: Context, fewest: number, most: number) {
  const [[first], [second]] = replicaDelays.get(this) ?? [[], []];
  assert.ok(first !== undefined && second !== undefined, "a replica sent no message");
  // Within the few milliseconds the engine's own work adds to a delivery.
  assert.ok(Math.abs(first - second) <= 10, `the delays were ${Math.round(first)} and ${Math.round(second)} ms of the run`);
  assert.ok(first >= fewest * MINUTE_MS && first <= most * MINUTE_MS + 10, `the delay was ${Math.round(first)} ms of the run, not between ${fewest} and ${most} world minutes`);
});

Then("the run's log has the message's {string} line and no {string} line for it", function (this: Context, sent: string, delivered: string) {
  const { id } = sentLine(this);
  assert.equal(sent, "message_sent");
  assert.deepEqual(
    logLines(this).filter((line) => line.type === delivered && line.id === id),
    [],
  );
});

Then("{string} received no stimulus through the channel {string}", function (this: Context, agent: string, channel: string) {
  assert.deepEqual(
    logLines(this).filter((line) => line.type === "stimulus" && line.agent === agent && line.channel === channel),
    [],
  );
});

Then("the message landed in {string}'s mailbox", function (this: Context, recipient: string) {
  const { id } = sentLine(this);
  deliveredLine(this, id);
  assert.ok((setupOf(this).loaded?.world.state.mail.mailboxes[recipient] ?? []).some((message) => message.id === id), `"${recipient}"'s mailbox does not hold ${String(id)}`);
});

Then("no channel {string} is declared, and {string} received no stimulus from the mail", function (this: Context, channel: string, agent: string) {
  assert.deepEqual(
    setupOf(this).loaded?.channels.filter(({ name }) => name === channel),
    [],
  );
  // The rhythm's stimulus wakes every agent; nothing else reaches one in these scenarios but the mail's.
  assert.deepEqual(
    logLines(this).filter((line) => line.type === "stimulus" && line.agent === agent && line.channel !== rhythmChannel.name),
    [],
  );
});

Then(
  "the {string} call took {int} world minutes: {int}, plus {float} for each of {int} fields, plus {int} for {int} words, which is {int} milliseconds of the run, within {int}",
  function (this: Context, tool: string, minutes: number, base: number, perField: number, fields: number, forWords: number, words: number, runMs: number, withinMs: number) {
    const { mail } = setupOf(this);
    assert.equal(base + perField * fields + forWords, minutes, "the contract's sum");
    assert.deepEqual([mail.send_minutes, mail.send_minutes_per_field, words / (mail.send_words_per_minute as number)], [base, perField, forWords], "the configuration's durations");
    assert.equal(minutes * MINUTE_MS, runMs, "a world minute's run time");
    const calls = (this.toolCalls ?? []).filter((call) => call.tool === tool);
    assert.equal(calls.length, 1, `${calls.length} "${tool}" calls were made`);
    const tookMs = calls[0].endedAtMs - calls[0].startedAtMs;
    assert.ok(Math.abs(tookMs - runMs) <= withinMs, `the call took ${Math.round(tookMs)} ms of the run, not ${runMs} within ${withinMs}`);
  },
);

Then(
  "the run's log has a {string} line with the message's id, {string}, {string}, {string}, its fields, {string}, {string}, and the run time and world time it was sent",
  function (this: Context, type: string, from: string, to: string, act: string, subject: string, text: string) {
    const line = sentLine(this);
    assert.equal(type, line.type);
    assert.match(String(line.id), /^m-\d+$/);
    assert.deepEqual(
      { from: line.from, to: line.to, act: line.act, fields: line.fields, subject: line.subject, text: line.text },
      { from, to, act, fields: {}, subject, text },
    );
    assert.equal(typeof line.atMs, "number");
    assert.deepEqual(Object.keys(line.worldTime as WorldTime).sort(), ["day", "seconds", "weekday"]);
  },
);

Then("a {string} line with the same id and the run time and world time it landed", function (this: Context, type: string) {
  const { id, atMs, worldTime } = sentLine(this);
  assert.equal(type, "message_delivered");
  const line = deliveredLine(this, id);
  assert.ok((line.atMs as number) > (atMs as number), "it landed before it was sent");
  assert.ok((line.worldTime as WorldTime).seconds > (worldTime as WorldTime).seconds, "it landed at a world time before it was sent");
});

/** The run's only call of a tool, which "its" names from here on. */
function onlyCall(context: Context, tool: string) {
  const calls = (context.toolCalls ?? []).filter((call) => call.tool === tool);
  assert.equal(calls.length, 1, `${calls.length} "${tool}" calls were made`);
  context.lastToolCall = calls[0];
  return calls[0];
}

/** The text the agent received for the call "its" names. */
function itsResult(context: Context): string {
  const call = context.lastToolCall;
  assert.ok(call !== undefined, "no call was checked");
  return returned(context, call.agent, call.tool);
}

Then("the {string} call failed with the outcome {string} and took no time", function (this: Context, tool: string, outcome: string) {
  const call = onlyCall(this, tool);
  assert.equal(call.outcome, outcome);
  assert.ok(call.endedAtMs - call.startedAtMs < 5, `the call took ${Math.round(call.endedAtMs - call.startedAtMs)} ms of the run`);
});

Then("the {string} call failed with the outcome {string}", function (this: Context, tool: string, outcome: string) {
  assert.equal(onlyCall(this, tool).outcome, outcome);
});

Then("its result lists the acts {string}", function (this: Context, acts: string) {
  assert.ok(itsResult(this).includes(acts), `the result does not list ${acts}: ${itsResult(this)}`);
});

Then("its result names the field {string}", function (this: Context, field: string) {
  assert.ok(itsResult(this).includes(`"${field}"`), `the result does not name the field "${field}": ${itsResult(this)}`);
});

Then("its result names {string}", function (this: Context, name: string) {
  assert.ok(itsResult(this).includes(`"${name}"`), `the result does not name "${name}": ${itsResult(this)}`);
});

Then("no message was sent", function (this: Context) {
  assert.deepEqual(
    logLines(this).filter((line) => line.type === "message_sent"),
    [],
  );
  assert.deepEqual(setupOf(this).loaded?.world.state.mail.inTransit, []);
});
