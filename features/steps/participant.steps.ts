import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { getCurrentTools } from "@earendil-works/pi-ai";
import { type TomlTable, stringify } from "smol-toml";
import { type WorldTime, readCalendar, worldTimeAt } from "../../src/engine/calendar.ts";
import { inventoryMarkdown } from "../../src/engine/inventory.ts";
import type { Mail } from "../../src/engine/mail.ts";
import { type LoadedScenario, type Scenario, loadScenario } from "../../src/engine/scenario.ts";
import type { Stimulus } from "../../src/engine/stimuli.ts";
import { rhythmChannel } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { madeInventory, toTheMinute } from "./calendar.steps.ts";
import { listed } from "./mail.steps.ts";
import { linesOf } from "./record.steps.ts";
import { asRead } from "./stimulus.steps.ts";
import { modelOf, runScenario, script } from "./tool.steps.ts";

/** The test scenario's world: the mail the engine keeps in it, and nothing else. */
interface Post {
  mail: Mail;
}

/** What a rule set perceives at each step: the stimuli that reached its participant since its last step, and its last call's result. */
interface Perceived {
  stimuli: readonly Stimulus[];
  result?: { tool: string; outcome: string; text: string };
}

/** A rule set's next step, as these scenarios use them: a call of one of its participant's tools, or the end. */
type RuleStep = { kind: "call"; tool: string; arguments: Record<string, unknown> } | { kind: "end" };

/** How the scenario changes "echo" from what the Background says it does. */
interface EchoChanges {
  /** The tool it calls when woken, in place of what it does otherwise. */
  callsWhenWoken?: string;
  /** Whether its outcome gives the number of messages it answered; otherwise it gives none. */
  givesAnswered?: boolean;
}

/** What the participant scenarios set up: the agents, the [mail] and [participants] of the configuration, "echo" and what it was given. */
interface ParticipantSetup {
  agents: string[];
  mail: TomlTable;
  participants: Record<string, TomlTable>;
  echo: EchoChanges;
  /** Every input "echo" was given, in order: what its rule set was started with, then what it perceived at each step. */
  inputs: unknown[];
  loaded?: LoadedScenario<Post>;
}

const setups = new WeakMap<Context, ParticipantSetup>();

function setupOf(context: Context): ParticipantSetup {
  const setup = setups.get(context);
  assert.ok(setup !== undefined, "the scenario set up no participant test scenario");
  return setup;
}

/** The ids a "check_mail" result lists, oldest first. */
function idsOf(text: string): string[] {
  return listed(text).map(({ id }) => id);
}

/**
 * "echo", as the Background says: woken by a mail notice, it calls "check_mail" for its unread messages, then
 * "read_mail" for each, then answers each with "send_mail" back to its sender, with the act "answer", then waits for the
 * next stimulus; a notice that comes while it answers makes it check again before it waits. It keeps every input it is
 * given.
 */
function echo(setup: ParticipantSetup) {
  return {
    start: (params: unknown) => {
      setup.inputs.push(params);
      let unread: string[] = [];
      let again = false;
      let answered = 0;
      const call = (tool: string, args: Record<string, unknown> = {}): RuleStep => ({ kind: "call", tool, arguments: args });
      const readNext = (): RuleStep => {
        const id = unread.shift();
        if (id !== undefined) return call("read_mail", { id });
        if (!again) return { kind: "end" };
        again = false;
        return call("check_mail", { unread_only: true });
      };
      return {
        next: (perceived: Perceived): RuleStep => {
          setup.inputs.push(perceived);
          const { stimuli, result } = perceived;
          if (result === undefined) return setup.echo.callsWhenWoken === undefined ? call("check_mail", { unread_only: true }) : call(setup.echo.callsWhenWoken);
          if (stimuli.length > 0) again = true;
          if (result.tool === "check_mail") {
            unread = idsOf(result.text);
            return readNext();
          }
          if (result.tool === "read_mail") {
            const from = /^From: (.+?)\. Act:/.exec(result.text)?.[1];
            assert.ok(from !== undefined, `"echo" cannot read the sender of ${result.text}`);
            return call("send_mail", { to: from, act: "answer" });
          }
          answered += 1;
          return readNext();
        },
        outcome: () => (setup.echo.givesAnswered === true ? { answered } : {}),
      };
    },
  };
}

/**
 * The test scenario as its steps set it up: its agents wake at once and are told nothing of the world; it provides the
 * rule set "echo"; its base configuration holds the [calendar], the [mail] and the [participants] the steps declare,
 * which the engine reads as it loads the scenario.
 */
function participantScenario(context: Context): Scenario<Post> {
  const setup = setupOf(context);
  return {
    name: "participants",
    agents: () => setup.agents,
    // The engine puts the mail in the world as it loads the scenario; the scenario starts it with none.
    initialState: () => ({ mail: { mailboxes: {}, inTransit: [] } }),
    tools: [],
    channels: () => [rhythmChannel],
    metrics: {},
    systemPrompt: (_configuration, agent) => `You are "${agent}".`,
    rhythm: () => () => 0,
    describeDuration: () => "As the mail gives it.",
    describeRhythm: () => "No wait before any activation.",
    mail: { of: (state) => state.mail, with: (state, mail) => ({ ...state, mail }) },
    ruleSets: { echo: echo(setup) },
    baseConfiguration: stringify({
      agents: setup.agents,
      ...(context.calendar === undefined ? {} : { calendar: context.calendar }),
      mail: setup.mail,
      participants: setup.participants,
    }),
  } as Scenario<Post>;
}

Given("a test scenario with the agent {string} and the participant {string}, both with a mailbox", function (this: Context, agent: string, participant: string) {
  const setup: ParticipantSetup = { agents: [agent], mail: { mailboxes: [agent, participant] }, participants: { [participant]: {} }, echo: {}, inputs: [] };
  setups.set(this, setup);
  // The agent ends its only activation at once unless the scenario scripts its turns.
  script(this, agent, [{ text: "Nothing to do.", delayMs: 0 }]);
  this.inventoryScenario = () => participantScenario(this);
  // A run that stops on an error, or is refused, leaves its error for the steps that check it; the others check there is none.
  this.runInstead = async () => {
    try {
      setup.loaded = loadScenario(participantScenario(this), this.seed);
      await runScenario(this, setup.loaded);
    } catch (error) {
      this.runError = error as Error;
    }
  };
});

Given(
  /^the mail's "delivery_minutes" is \[(\d+), (\d+)\], its "send_minutes" (\d+), its "check_minutes" (\d+) and its "read_minutes" (\d+), with a notice from "([^"]+)"$/,
  function (this: Context, from: string, to: string, send: string, check: string, read: string, source: string) {
    Object.assign(setupOf(this).mail, {
      delivery_minutes: [Number(from), Number(to)],
      send_minutes: Number(send),
      check_minutes: Number(check),
      read_minutes: Number(read),
      notice_source: source,
      notice: "New mail from {from}: {subject}",
    });
  },
);

Given(
  "{string} decides by the rule set {string}, has the tools {string}, {string} and {string}, the channel {string}, and {string} [{int}, {int}]",
  function (this: Context, participant: string, rules: string, first: string, second: string, third: string, channel: string, key: string, fewest: number, most: number) {
    assert.equal(key, "reply_minutes");
    setupOf(this).participants[participant] = { decides: "rules", rules, tools: [first, second, third], channels: [channel], [key]: [fewest, most] };
  },
);

Given(
  '"echo", woken by a mail notice, calls "check_mail", then "read_mail" for each unread message, then answers each with "send_mail" back to its sender, with the act "answer", then waits for the next stimulus',
  function (this: Context) {
    // As echo() does.
  },
);

/** The lines of the log the scenario's last run wrote, parsed; a run that stopped or was refused has none to check. */
function ranLines(context: Context): Record<string, unknown>[] {
  assert.equal(context.runError, undefined, `the run stopped: ${context.runError?.message}`);
  return stoppedLines(context);
}

/** The lines of the log the scenario's last run wrote, parsed, whether or not it stopped. */
function stoppedLines(context: Context): Record<string, unknown>[] {
  assert.ok(context.runId !== undefined, "no run gave its id");
  return linesOf(context, `${context.runId}.jsonl`).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The world's time at a moment of the last run, by performance.now(), by the configuration's calendar. */
function worldTimeOf(context: Context, atMs: unknown): WorldTime {
  assert.ok(context.calendar !== undefined && context.runStartedAtMs !== undefined, "the run had no calendar or did not start");
  return worldTimeAt(readCalendar(context.calendar), (atMs as number) - context.runStartedAtMs);
}

/** The "stimulus" lines of a participant's, on a channel, in the order written. */
function stimulusLines(lines: readonly Record<string, unknown>[], participant: string, channel: string) {
  return lines.filter((line) => line.type === "stimulus" && line.agent === participant && line.channel === channel);
}

/** The one "message_delivered" line of the message sent to a recipient. */
function landedFor(lines: readonly Record<string, unknown>[], recipient: string) {
  const sent = lines.filter((line) => line.type === "message_sent" && line.to === recipient);
  assert.equal(sent.length, 1, `${sent.length} messages were sent to "${recipient}"`);
  const landed = lines.find((line) => line.type === "message_delivered" && line.id === sent[0].id);
  assert.ok(landed !== undefined, `the message to "${recipient}" did not land`);
  return landed;
}

/** A participant's only notice: the one "stimulus" line on the mail notice's channel. */
function noticeOf(lines: readonly Record<string, unknown>[], participant: string) {
  const notices = stimulusLines(lines, participant, "mail_notice");
  assert.equal(notices.length, 1, `"${participant}" received ${notices.length} mail notices`);
  return notices[0];
}

Then(
  /^"(\w+)"'s notice reached it at "([^"]+)", ten world minutes after the message landed at (\d\d:\d\d)$/,
  function (this: Context, participant: string, time: string, landedAt: string) {
    const lines = ranLines(this);
    assert.equal(toTheMinute(landedFor(lines, participant).worldTime as WorldTime).slice(-5), landedAt);
    assert.equal(toTheMinute(worldTimeOf(this, noticeOf(lines, participant).deliveredAtMs)), time);
  },
);

/** The run milliseconds one world minute takes in the Background's calendar. */
const MINUTE_MS = 100;

/** A participant's "tool_call" lines, in the order written. */
function callLines(lines: readonly Record<string, unknown>[], participant: string) {
  return lines.filter((line) => line.type === "tool_call" && line.agent === participant);
}

Then(
  "the run's log has {string}'s {string}, {string} and {string} calls as tool calls under its name, each with its duration and outcome",
  function (this: Context, participant: string, first: string, second: string, third: string) {
    const calls = callLines(ranLines(this), participant);
    assert.deepEqual(
      calls.map((call) => call.tool),
      [first, second, third],
    );
    const { mail } = setupOf(this);
    const minutes = [mail.check_minutes, mail.read_minutes, mail.send_minutes] as number[];
    for (const [index, call] of calls.entries()) {
      assert.equal(call.outcome, "success", `the "${call.tool}" call failed with ${call.outcome}`);
      const tookMs = (call.endedAtMs as number) - (call.startedAtMs as number);
      assert.ok(Math.abs(tookMs - minutes[index] * MINUTE_MS) <= 20, `the "${call.tool}" call took ${Math.round(tookMs)} ms of the run, not ${minutes[index]} world minutes`);
    }
  },
);

Then("{string} made no model turn", function (this: Context, participant: string) {
  assert.deepEqual(
    ranLines(this).filter((line) => line.type === "model_turn" && line.agent === participant),
    [],
  );
});

Then(
  "{string}'s {string} result lists one message, from {string}, with the subject {string}, received at {string}",
  function (this: Context, agent: string, tool: string, from: string, subject: string, received: string) {
    const calls = callLines(ranLines(this), agent).filter((call) => call.tool === tool);
    assert.equal(calls.length, 1, `"${agent}" made ${calls.length} "${tool}" calls`);
    const messages = listed(calls[0].result as string);
    assert.equal(messages.length, 1, `the result lists ${messages.length} messages: ${String(calls[0].result)}`);
    assert.deepEqual({ from: messages[0].from, subject: messages[0].subject, received: messages[0].received }, { from, subject, received });
  },
);

Then(
  "every input {string} was given was either the stimulus {string} or the result of one of {string}'s own calls",
  function (this: Context, rules: string, stimulus: string, participant: string) {
    const calls = callLines(ranLines(this), participant);
    const { inputs } = setupOf(this);
    // The first input is what its rule set was started with: the participant's parameters, none here.
    const [params, ...perceived] = inputs;
    assert.deepEqual(params, {}, `"${rules}" was started with ${JSON.stringify(params)}`);
    assert.ok(perceived.length > 0, `"${rules}" was given nothing`);
    let results = 0;
    for (const input of perceived as Perceived[]) {
      assert.deepEqual(Object.keys(input).sort(), input.result === undefined ? ["stimuli"] : ["result", "stimuli"], `"${rules}" was given ${JSON.stringify(input)}`);
      for (const each of input.stimuli) assert.equal(asRead(each.source, each.content), stimulus);
      if (input.result === undefined) continue;
      const call = calls[results];
      results += 1;
      assert.ok(call !== undefined, `"${rules}" was given the result of a call "${participant}" did not make`);
      assert.deepEqual(input.result, { tool: call.tool, outcome: call.outcome, text: call.result ?? call.text });
    }
    assert.equal(results, calls.length, `"${rules}" was given ${results} results of "${participant}"'s ${calls.length} calls`);
  },
);

Then("{string} was never given the world's state", function (this: Context, rules: string) {
  // The world keeps nothing but the mail: an input that holds a mailbox or a message in transit holds the world's state.
  for (const input of setupOf(this).inputs) {
    const text = JSON.stringify(input);
    assert.ok(!text.includes("mailboxes") && !text.includes("inTransit"), `"${rules}" was given ${text}`);
  }
});

Given(
  "the configuration's calendar starts at {string} with one segment of scale {int}, so one world hour is {int} milliseconds of the run",
  function (this: Context, start: string, scale: number, hourMs: number) {
    assert.equal((3600 * 1000) / scale, hourMs, `at the scale ${scale}, a world hour is not ${hourMs} ms`);
    this.calendar = { start, segments: [{ scale }] };
  },
);

Given(
  "the calendar declares the hours {string} on Monday to Friday from {string} to {string}, and {string} keeps the hours {string}",
  function (this: Context, name: string, from: string, to: string, participant: string, kept: string) {
    assert.ok(this.calendar !== undefined, "the configuration declares no calendar");
    this.calendar.hours = { [name]: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], from, to } };
    setupOf(this).participants[participant].hours = kept;
  },
);

Then(/^"(\w+)"'s message landed on "([^"]+)", before (\d\d:\d\d)$/, function (this: Context, agent: string, day: string, before: string) {
  const lines = ranLines(this);
  const sent = lines.filter((line) => line.type === "message_sent" && line.from === agent);
  assert.equal(sent.length, 1, `"${agent}" sent ${sent.length} messages`);
  const landed = toTheMinute(landedFor(lines, sent[0].to as string).worldTime as WorldTime);
  assert.ok(landed.startsWith(`${day} `) && landed.slice(-5) < before, `it landed at ${landed}`);
});

Then("{string}'s notice reached it on {string} between {string} and {string}", function (this: Context, participant: string, day: string, from: string, to: string) {
  const reached = toTheMinute(worldTimeOf(this, noticeOf(ranLines(this), participant).deliveredAtMs));
  assert.ok(reached.startsWith(`${day} `) && reached.slice(-5) >= from && reached.slice(-5) <= to, `it reached it at ${reached}`);
});

/** A world time "day <n> <weekday> HH:MM" as the minutes since day 1's midnight, which orders world times. */
function minutesOf(time: string): number {
  const [, day, hours, minutes] = /^day (\d+) \w+ (\d\d):(\d\d)$/.exec(time) ?? [];
  assert.ok(day !== undefined, `"${time}" is no world time`);
  return (Number(day) - 1) * 24 * 60 + Number(hours) * 60 + Number(minutes);
}

Then("{string} made no call before {string}", function (this: Context, participant: string, time: string) {
  const calls = callLines(ranLines(this), participant);
  assert.ok(calls.length > 0, `"${participant}" made no call`);
  for (const call of calls) {
    const started = toTheMinute(worldTimeOf(this, call.startedAtMs));
    assert.ok(minutesOf(started) >= minutesOf(time), `"${participant}"'s "${call.tool}" call started at ${started}`);
  }
});

Given("{string}'s {string} is [{int}, {int}]", function (this: Context, participant: string, key: string, fewest: number, most: number) {
  setupOf(this).participants[participant][key] = [fewest, most];
});

/** The run milliseconds from the message to a participant landing to its notice reaching it, in each replica the scenario ran. */
const replyDelays = new WeakMap<Context, number[]>();

/** The run milliseconds from the message to a participant landing to its notice reaching it, in the last run. */
function replyDelayMs(context: Context, participant: string): number {
  const lines = ranLines(context);
  return (noticeOf(lines, participant).deliveredAtMs as number) - (landedFor(lines, participant).atMs as number);
}

When(
  "two replicas run with the seed {int}, the second with another participant {string} that decides by {string}",
  async function (this: Context, seed: number, other: string, rules: string) {
    const setup = setupOf(this);
    this.seed = seed;
    assert.ok(this.runInstead !== undefined);
    await this.runInstead();
    const delays = [replyDelayMs(this, "desk")];
    setup.participants[other] = { ...setup.participants.desk, rules };
    // Each replica's scripted models start again from their first answer.
    for (const [agent, answers] of this.scripts) script(this, agent, answers);
    await this.runInstead();
    delays.push(replyDelayMs(this, "desk"));
    replyDelays.set(this, delays);
  },
);

Then("{string}'s reply delay was the same in both, between {int} and {int} world minutes", function (this: Context, participant: string, fewest: number, most: number) {
  const [first, second] = replyDelays.get(this) ?? [];
  assert.ok(first !== undefined && second !== undefined, `"${participant}" was not reached in both replicas`);
  // Within the few milliseconds the engine's own work adds to a delivery.
  assert.ok(Math.abs(first - second) <= 10, `the delays were ${Math.round(first)} and ${Math.round(second)} ms of the run`);
  assert.ok(first >= fewest * MINUTE_MS && first <= most * MINUTE_MS + 10, `the delay was ${Math.round(first)} ms of the run, not between ${fewest} and ${most} world minutes`);
});

Given(
  "{string} decides by a scripted model instead, with the system prompt {string}, and its scripted turns call {string}, then end",
  function (this: Context, participant: string, systemPrompt: string, tool: string) {
    const setup = setupOf(this);
    const { rules: _rules, ...rest } = setup.participants[participant];
    setup.participants[participant] = { ...rest, decides: "model", model: `scripted/${participant}`, system_prompt: systemPrompt };
    script(this, participant, [
      { toolCalls: [{ name: tool, arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
  },
);

Then("{string}'s session was offered exactly the tools {string}, {string} and {string}", function (this: Context, participant: string, first: string, second: string, third: string) {
  ranLines(this);
  for (const [turn, messages] of modelOf(this, participant).received.entries()) {
    const offered = getCurrentTools(messages).map((tool) => tool.name);
    assert.deepEqual([...offered].sort(), [first, second, third].sort(), `turn ${turn + 1} was offered ${offered.join(", ")}`);
  }
});

Then("{string} received {string} through the channel {string} at {string}", function (this: Context, participant: string, text: string, channel: string, time: string) {
  const stimuli = stimulusLines(ranLines(this), participant, channel);
  assert.deepEqual(
    stimuli.map((line) => asRead(line.source as string, line.content as string)),
    [text],
  );
  assert.equal(toTheMinute(worldTimeOf(this, stimuli[0].deliveredAtMs)), time);
});

Then("{string}'s {string} call is in the run's log under its name, after a model turn", function (this: Context, participant: string, tool: string) {
  const lines = ranLines(this);
  const calls = callLines(lines, participant).filter((call) => call.tool === tool);
  assert.equal(calls.length, 1, `"${participant}" made ${calls.length} "${tool}" calls`);
  const turns = lines.filter((line) => line.type === "model_turn" && line.agent === participant && (line.endedAtMs as number) <= (calls[0].startedAtMs as number));
  assert.ok(turns.length > 0, `no model turn of "${participant}"'s ended before its "${tool}" call`);
});

Given('"echo" is changed to call {string} when woken', function (this: Context, tool: string) {
  setupOf(this).echo.callsWhenWoken = tool;
});

Then("the run stopped with an error that names {string} and {string}", function (this: Context, participant: string, tool: string) {
  assert.ok(this.runError !== undefined, "the run did not stop");
  for (const name of [participant, tool]) assert.ok(this.runError.message.includes(`"${name}"`), `the error does not name "${name}": ${this.runError.message}`);
});

Then("the run's log ends with a line that says it stopped and gives the error", function (this: Context) {
  const last = stoppedLines(this).at(-1);
  assert.equal(last?.type, "run_stopped", `the log's last line does not say the run stopped: ${JSON.stringify(last)}`);
  assert.equal(last.error, this.runError?.message);
});

Then(
  "{string}'s {string} call, started at {int} milliseconds, is recorded {string} and applied nothing",
  function (this: Context, participant: string, tool: string, startedMs: number, outcome: string) {
    const calls = callLines(ranLines(this), participant).filter((call) => call.tool === tool);
    assert.equal(calls.length, 1, `"${participant}" made ${calls.length} "${tool}" calls`);
    const [call] = calls;
    const intoRunMs = (call.startedAtMs as number) - (this.runStartedAtMs ?? 0);
    assert.ok(Math.abs(intoRunMs - startedMs) <= 30, `the call started ${Math.round(intoRunMs)} ms into the run, not ${startedMs}`);
    assert.equal(call.outcome, outcome);
    // A sensor applies nothing; a call cut off reads nothing either, so its record holds no result.
    assert.equal(call.result, undefined, `the call read ${String(call.result)}`);
  },
);

Given('"echo" gives as its outcome the number of messages it answered', function (this: Context) {
  setupOf(this).echo.givesAnswered = true;
});

Then("the run's log has a {string} line for {string} with answered {int}", function (this: Context, type: string, participant: string, answered: number) {
  const lines = ranLines(this).filter((line) => line.type === type && line.participant === participant);
  assert.equal(lines.length, 1, `the log has ${lines.length} "${type}" lines for "${participant}"`);
  assert.deepEqual(lines[0].outcome, { answered });
});

Then(
  "it gives {string}: decided by the rules {string}, its tools {string}, {string} and {string}, the channel {string}, no hours, and {string} [{int}, {int}]",
  function (this: Context, participant: string, rules: string, first: string, second: string, third: string, channel: string, key: string, fewest: number, most: number) {
    assert.equal(key, "reply_minutes");
    const [condition] = madeInventory(this).conditions;
    assert.deepEqual((condition as { participants?: unknown }).participants, [
      { name: participant, decides: "rules", rules, params: {}, tools: [first, second, third], channels: [channel], replyMinutes: [fewest, most] },
    ]);
    // "lab inventory" prints what the inventory gives.
    const printed = inventoryMarkdown(madeInventory(this));
    for (const text of ["### Participants", `"${participant}"`, `rule set "${rules}"`, `${first}, ${second}, ${third}`, channel, "Hours: none", `${fewest} to ${most} world minutes`]) {
      assert.ok(printed.includes(text), `the printed inventory does not give ${text}`);
    }
  },
);

/** Each change the contract makes to "desk"'s configuration, by how it writes it. */
const participantChanges: [RegExp, (desk: TomlTable, setup: ParticipantSetup) => void][] = [
  [/^it declares the tool "fly"$/, (desk) => (desk.tools = [...(desk.tools as string[]), "fly"])],
  [/^it declares the channel "radio"$/, (desk) => (desk.channels = [...(desk.channels as string[]), "radio"])],
  [/^it keeps the hours "night", which the calendar lacks$/, (desk) => (desk.hours = "night")],
  [/^its "reply_minutes" is \[30, 10\]$/, (desk) => (desk.reply_minutes = [30, 10])],
  [/^it decides by "dice"$/, (desk) => (desk.decides = "dice")],
  [/^it decides by the rule set "mirror", not provided$/, (desk) => (desk.rules = "mirror")],
  [
    /^it decides by a model and gives no model$/,
    (desk) => {
      delete desk.rules;
      Object.assign(desk, { decides: "model", system_prompt: "You run the front desk." });
    },
  ],
  [
    /^its name is "ana", an agent's$/,
    (desk, { participants }) => {
      delete participants.desk;
      participants.ana = desk;
    },
  ],
];

Given('"desk"\'s configuration is changed so that {}', function (this: Context, change: string) {
  const known = participantChanges.find(([written]) => written.test(change));
  assert.ok(known !== undefined, `the steps do not read the change "${change}"`);
  const setup = setupOf(this);
  known[1](setup.participants.desk, setup);
});
