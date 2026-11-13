import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import type { TomlTable } from "smol-toml";
import { type WorldTime, sinceDayOne } from "../../src/engine/calendar.ts";
import { inventoryMarkdown } from "../../src/engine/inventory.ts";
import type { Stimulus } from "../../src/engine/stimuli.ts";
import type { Context } from "../support/context.ts";
import { madeInventory, toTheMinute } from "./calendar.steps.ts";
import { MINUTE_MS, callLines, ranLines, setUpParticipants, setupOf, stimulusLines, stoppedLines, worldTimeOf } from "./participant.steps.ts";

/** What a rule set perceives at each step: the stimuli that reached its participant since its last step, and its last call's result. */
interface Perceived {
  stimuli: readonly Stimulus[];
  result?: { tool: string; outcome: string; text: string };
}

/** A rule set's next step, as these scenarios use them. */
type RuleStep = { kind: "call"; tool: string; arguments: Record<string, unknown> } | { kind: "end" };

/** How a scenario changes "operator" from what the Background says it does. */
interface OperatorChanges {
  answersNothing?: boolean;
  /** The call it makes at the run's start, in place of waiting for a ring. */
  callsAtStart?: Record<string, unknown>;
}

const operators = new WeakMap<Context, OperatorChanges>();

function operatorOf(context: Context): OperatorChanges {
  const operator = operators.get(context);
  assert.ok(operator !== undefined, "the scenario set up no phone test scenario");
  return operator;
}

/**
 * "operator", as the Background says: woken by a ring for the act "ask", it answers it at once with "answer_call", the
 * act "answer" and the field free "yes"; it reads the call's id and act from the ring's text only. Changed, it answers
 * nothing, or calls once at the run's start. After its call, it ends.
 */
function operator(changes: OperatorChanges) {
  return {
    start: () => ({
      ...(changes.callsAtStart === undefined ? {} : { atStart: (): RuleStep => ({ kind: "call", tool: "call", arguments: changes.callsAtStart as Record<string, unknown> }) }),
      next: ({ stimuli, result }: Perceived): RuleStep => {
        if (result !== undefined || changes.answersNothing === true) return { kind: "end" };
        for (const { channel, content } of stimuli) {
          // The Background's ring: "{from} calls ({call}): {act}. {fields}{text}".
          const ring = /\((c-\d+)\): (\w+)\./.exec(content);
          if (channel === "phone" && ring !== null && ring[2] === "ask") return { kind: "call", tool: "answer_call", arguments: { call: ring[1], act: "answer", fields: { free: "yes" } } };
        }
        return { kind: "end" };
      },
      outcome: () => ({}),
    }),
  };
}

Given(
  "a test scenario with the agents {string} and {string} and the participant {string}, each with a mailbox and a line",
  function (this: Context, first: string, second: string, participant: string) {
    const changes: OperatorChanges = {};
    operators.set(this, changes);
    setUpParticipants(this, {
      agents: [first, second],
      mail: { mailboxes: [first, second, participant], delivery_minutes: [1, 1], send_minutes: 1, check_minutes: 1, read_minutes: 1 },
      phone: { lines: [first, second, participant] },
      participants: { [participant]: {} },
      ruleSets: { operator: operator(changes) },
      echo: {},
      inputs: [],
      givenAtMs: [],
    });
  },
);

/** The test scenario's [phone]. */
function phoneOf(context: Context): TomlTable {
  const { phone } = setupOf(context);
  assert.ok(phone !== undefined, "the configuration declares no phone");
  return phone;
}

Given(
  /^the phone's "(\w+)" is (\d+) and its "(\w+)" (\d+), with no time per word, and its ring is "([^"]+)"$/,
  function (this: Context, key: string, value: string, other: string, otherValue: string, ring: string) {
    Object.assign(phoneOf(this), { [key]: Number(value), [other]: Number(otherValue), ring });
  },
);

Given(/^the phone's "(\w+)" is (\d+)$/, function (this: Context, key: string, value: string) {
  phoneOf(this)[key] = Number(value);
});

Given(
  "{string} decides by the rule set {string}, has the tools {string} and {string}, and the channel {string}",
  function (this: Context, participant: string, rules: string, first: string, second: string, channel: string) {
    setupOf(this).participants[participant] = { decides: "rules", rules, tools: [first, second], channels: [channel] };
  },
);

Given(
  '"operator", woken by a ring for the act "ask", answers it at once with "answer_call", the act "answer" and the field free "yes"',
  function (this: Context) {
    // As operator() does.
  },
);

Given('"operator" is changed to answer nothing', function (this: Context) {
  operatorOf(this).answersNothing = true;
});

Given(
  /^"operator" is changed to call "(\w+)" at the run's start with the act "(\w+)"(?: and the text "([^"]+)")?$/,
  function (this: Context, callee: string, act: string, text: string | undefined) {
    operatorOf(this).callsAtStart = { to: callee, act, ...(text === undefined ? {} : { text }) };
  },
);

/** The "phone" stimuli a party received, in order. */
function ringsOf(context: Context, party: string): Record<string, unknown>[] {
  return stimulusLines(ranLines(context), party, "phone");
}

/** A party's only call of a tool. */
function onlyCall(context: Context, party: string, tool: string): Record<string, unknown> {
  const calls = callLines(stoppedLines(context), party).filter((call) => call.tool === tool);
  assert.equal(calls.length, 1, `"${party}" made ${calls.length} "${tool}" calls`);
  return calls[0];
}

/** Checks that a moment of the last run, by performance.now(), was a number of milliseconds into it, within a margin. */
function assertIntoRun(context: Context, what: string, atMs: unknown, expectedMs: number, withinMs: number): void {
  const intoMs = (atMs as number) - (context.runStartedAtMs ?? 0);
  assert.ok(Math.abs(intoMs - expectedMs) <= withinMs, `${what} ${Math.round(intoMs)} ms into the run, not ${expectedMs} within ${withinMs}`);
}

Then(
  "{string} received the ring {string} through the channel {string}, whose source is {string}, at the run's start, within {int} milliseconds",
  function (this: Context, party: string, ring: string, channel: string, source: string, withinMs: number) {
    assert.equal(channel, "phone");
    const rings = ringsOf(this, party);
    assert.equal(rings.length, 1, `"${party}" received ${rings.length} rings`);
    assert.deepEqual({ content: rings[0].content, source: rings[0].source }, { content: ring, source });
    assertIntoRun(this, "the ring came", rings[0].deliveredAtMs, 0, withinMs);
  },
);

Then(
  /^"(\w+)"'s "(\w+)" succeeded (\d+) milliseconds into the run, within (\d+), with the result "([^"]+)"$/,
  function (this: Context, party: string, tool: string, expectedMs: string, withinMs: string, result: string) {
    ranLines(this);
    const call = onlyCall(this, party, tool);
    assert.equal(call.outcome, "success", `"${party}"'s "${tool}" ended ${String(call.outcome)}`);
    assertIntoRun(this, `"${party}"'s "${tool}" ended`, call.endedAtMs, Number(expectedMs), Number(withinMs));
    assert.equal(call.text, result);
  },
);

Then("{string}'s {string} succeeded at the same moment", function (this: Context, party: string, tool: string) {
  ranLines(this);
  const call = onlyCall(this, party, tool);
  assert.equal(call.outcome, "success", `"${party}"'s "${tool}" ended ${String(call.outcome)}`);
  const caller = callLines(ranLines(this), "ana").find((each) => each.tool === "call");
  assert.ok(caller !== undefined, '"ana" made no call');
  // The moment the callee's call lands ends the caller's: within the few milliseconds the engine takes to tell it.
  assert.ok(Math.abs((call.endedAtMs as number) - (caller.endedAtMs as number)) <= 10, `the calls ended ${Math.round((call.endedAtMs as number) - (caller.endedAtMs as number))} ms apart`);
});

Then(
  /^"(\w+)"'s "(\w+)" failed with the outcome "(\w+)" (\d+) milliseconds into the run, within (\d+)$/,
  function (this: Context, party: string, tool: string, outcome: string, expectedMs: string, withinMs: string) {
    ranLines(this);
    const call = onlyCall(this, party, tool);
    assert.equal(call.outcome, outcome);
    assertIntoRun(this, `"${party}"'s "${tool}" ended`, call.endedAtMs, Number(expectedMs), Number(withinMs));
  },
);

Then(/^"(\w+)"'s "(\w+)" failed with the outcome "(\w+)"$/, function (this: Context, party: string, tool: string, outcome: string) {
  ranLines(this);
  assert.equal(onlyCall(this, party, tool).outcome, outcome);
});

/** Checks that a call took no time: it ended as it started, within the engine's own work. */
function assertNoTime(call: Record<string, unknown>): void {
  const tookMs = (call.endedAtMs as number) - (call.startedAtMs as number);
  assert.ok(tookMs <= 10, `the "${String(call.tool)}" call took ${Math.round(tookMs)} ms`);
}

Then(/^"(\w+)"'s "(\w+)" failed with the outcome "(\w+)" and took no time$/, function (this: Context, party: string, tool: string, outcome: string) {
  ranLines(this);
  const call = onlyCall(this, party, tool);
  assert.equal(call.outcome, outcome);
  assertNoTime(call);
});

Then("{string} received one ring only", function (this: Context, party: string) {
  assert.equal(ringsOf(this, party).length, 1);
});

Then("{string} received no ring", function (this: Context, party: string) {
  assert.deepEqual(ringsOf(this, party), []);
});

Then("{string} received the ring {string} through the channel {string}", function (this: Context, party: string, ring: string, channel: string) {
  assert.equal(channel, "phone");
  assert.deepEqual(
    ringsOf(this, party).map((line) => line.content),
    [ring],
  );
});

Then("{string}'s {string} succeeded with the result {string}", function (this: Context, party: string, tool: string, result: string) {
  ranLines(this);
  const call = onlyCall(this, party, tool);
  assert.deepEqual({ outcome: call.outcome, text: call.text }, { outcome: "success", text: result });
});

Then("the {string} failed with the outcome {string} and took no time, and no phone rang", function (this: Context, tool: string, outcome: string) {
  const lines = ranLines(this);
  const calls = lines.filter((line) => line.type === "tool_call" && line.tool === tool);
  assert.equal(calls.length, 1, `${calls.length} "${tool}" calls were made`);
  assert.equal(calls[0].outcome, outcome);
  assertNoTime(calls[0]);
  assert.deepEqual(
    lines.filter((line) => line.type === "stimulus" && line.channel === "phone"),
    [],
  );
});

Then(
  /^"(\w+)"'s "(\w+)" succeeded (\d+) milliseconds into the run, within (\d+): (\d+) world minutes, plus (\d+) for (\d+) words$/,
  function (this: Context, party: string, tool: string, expectedMs: string, withinMs: string, minutes: string, more: string, _words: string) {
    assert.equal(Number(expectedMs), (Number(minutes) + Number(more)) * MINUTE_MS);
    ranLines(this);
    const call = onlyCall(this, party, tool);
    assert.equal(call.outcome, "success", `"${party}"'s "${tool}" ended ${String(call.outcome)}`);
    assertIntoRun(this, `"${party}"'s "${tool}" ended`, call.endedAtMs, Number(expectedMs), Number(withinMs));
  },
);

/** The run's "call" lines, in the order written. */
function callRecords(context: Context): Record<string, unknown>[] {
  return ranLines(context).filter((line) => line.type === "call");
}

Then(
  "the call's line has the outcome {string}, and both {string}'s {string} and {string}'s {string} are recorded {string}",
  function (this: Context, outcome: string, caller: string, tool: string, callee: string, other: string, recorded: string) {
    const records = callRecords(this);
    assert.equal(records.length, 1, `the log has ${records.length} "call" lines`);
    assert.equal(records[0].outcome, outcome);
    assert.equal(onlyCall(this, caller, tool).outcome, recorded);
    assert.equal(onlyCall(this, callee, other).outcome, recorded);
  },
);

/** Checks a moment a call's line gives: its run time and the world's time then, which agree. */
function assertMoment(context: Context, what: string, moment: unknown, expectedMs: number): void {
  const { atMs, worldTime } = (moment ?? {}) as { atMs?: number; worldTime?: WorldTime };
  assert.ok(atMs !== undefined && worldTime !== undefined, `the call's line gives no run time and world time it ${what}`);
  assertIntoRun(context, `it ${what}`, atMs, expectedMs, 30);
  assert.ok(Math.abs(sinceDayOne(worldTime) - sinceDayOne(worldTimeOf(context, atMs))) <= 1, `it ${what} at ${toTheMinute(worldTime)}, which is not the world's time then`);
}

Then(
  "the run's log has a {string} line with the id {string}, {string}, {string}, {string}, the answer's act {string} and field free {string}, the outcome {string}, and the run time and world time it rang, was answered and ended",
  function (this: Context, type: string, id: string, caller: string, callee: string, act: string, answer: string, free: string, outcome: string) {
    const records = ranLines(this).filter((line) => line.type === type);
    assert.equal(records.length, 1, `the log has ${records.length} "${type}" lines`);
    const [line] = records;
    assert.deepEqual(
      { id: line.id, from: line.from, to: line.to, act: line.act, answer: line.answer, outcome: line.outcome },
      { id, from: caller, to: callee, act, answer: { act: answer, fields: { free } }, outcome },
    );
    // Rung and answered as the run starts, and ended once "call_minutes" had passed.
    assertMoment(this, "rang", line.rang, 0);
    assertMoment(this, "was answered", line.answered, 0);
    assertMoment(this, "ended", line.ended, (phoneOf(this).call_minutes as number) * MINUTE_MS);
  },
);

Then(
  /^it gives the lines of "(\w+)", "(\w+)" and "(\w+)", "ring_minutes" (\d+), "call_minutes" (\d+), no time per word, and the ring's text$/,
  function (this: Context, first: string, second: string, third: string, ring: string, call: string) {
    const [condition] = madeInventory(this).conditions;
    const text = phoneOf(this).ring as string;
    assert.deepEqual((condition as { phone?: unknown }).phone, { lines: [first, second, third], ringMinutes: Number(ring), callMinutes: Number(call), ring: text });
    // "lab inventory" prints what the inventory gives.
    const printed = inventoryMarkdown(madeInventory(this));
    for (const expected of ["### Phone", `${first}, ${second}, ${third}`, `ring_minutes ${ring}`, `call_minutes ${call}`, "call_words_per_minute: none", text]) {
      assert.ok(printed.includes(expected), `the printed inventory does not give ${expected}`);
    }
  },
);

/** Each change the contract makes to the configuration's phone, by how it writes it. */
const phoneChanges: [RegExp, (context: Context, ...values: string[]) => void][] = [
  [/^the configuration has no calendar$/, (context) => (context.calendar = undefined)],
  [/^it gives a line to "(\w+)", who is no agent or participant$/, (context, name) => phoneOf(context).lines = [...(phoneOf(context).lines as string[]), name]],
  [/^its "(\w+)" is (-?\d+)$/, (context, key, value) => (phoneOf(context)[key] = Number(value))],
  [/^its ring names "([^"]+)"$/, (context, placeholder) => (phoneOf(context).ring = `${phoneOf(context).ring as string} ${placeholder}`)],
  [
    /^"(\w+)" keeps the channel "phone" without the tool "answer_call"$/,
    (context, participant) => {
      const kept = setupOf(context).participants[participant];
      kept.tools = (kept.tools as string[]).filter((tool) => tool !== "answer_call");
    },
  ],
];

Given("the configuration's phone is changed so that {}", function (this: Context, change: string) {
  const known = phoneChanges.find(([written]) => written.test(change));
  assert.ok(known !== undefined, `the steps do not read the change "${change}"`);
  const [written, apply] = known;
  apply(this, ...(written.exec(change)?.slice(1) ?? []));
});
