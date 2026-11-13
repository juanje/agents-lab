import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
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
import { logLines } from "./record.steps.ts";
import { asRead } from "./stimulus.steps.ts";
import { script } from "./tool.steps.ts";

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
