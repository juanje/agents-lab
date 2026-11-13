import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { Random } from "../../src/engine/random.ts";
import type { Context } from "../support/context.ts";
import { change, congressChanges, hourMsOf, organiserTurns, runCongress, turnsBefore } from "./congress.steps.ts";
import {
  assertBetween,
  before,
  changePools,
  dayOf,
  fieldsOf,
  minutesOf,
  minutesOfWorld,
  moneyLines,
  outcomeOf,
  ranLines,
  sentBy,
  sentWith,
  setUpPartiesCongress,
  untilTime,
} from "./congress-parties.steps.ts";
import { script } from "./tool.steps.ts";

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The speakers of the Background, as their templates give them. */
const SPEAKERS: TomlTable[] = [
  { id: "s1", title: "Soil life", draw: 1, fee: 0, home: "local", available: true, acceptance: 1 },
  { id: "s2", title: "Soil water", draw: 1, fee: 0, home: "north-station", available: true, acceptance: 1, condition: "travel_paid" },
  { id: "s3", title: "Soil maps", draw: 2, fee: 0, home: "local", available: false, acceptance: 1 },
  { id: "s4", title: "Soil carbon", draw: 1, fee: 0, home: "local", available: true, acceptance: 1, constraint: "morning" },
  { id: "s5", title: "Soil policy", draw: 3, fee: 300, home: "local", available: true, acceptance: 1, condition: "fee" },
];

/** The partner of the Background, whose preferred session is 3. */
const PARTNER: TomlTable = { id: "p1", title: "The partner's soil survey", session: 3 };

Given(
  "the congress scenario of FR-CONGRESS-02, whose calendar starts at {string} with one segment of scale {int}, so one world hour is {int} milliseconds of the run",
  function (this: Context, start: string, scale: number, hourMs: number) {
    setUpSpeakersCongress(this, start, scale, hourMs);
  },
);

/** FR-CONGRESS-04's congress: FR-CONGRESS-02's, with the speakers "s1" to "s5" and the partner "p1". */
export function setUpSpeakersCongress(context: Context, start: string, scale: number, hourMs: number): void {
  setUpPartiesCongress(context, start, scale, hourMs);
  changePools(context, (pool) => {
    pool.speaker = structuredClone(SPEAKERS);
    pool.partner = [structuredClone(PARTNER)];
  });
  drawing(context, { speaker: 5, partner: 1 });
}

Given('the mail delivers in 1 world minute and every speaker has "reply_minutes" [60, 60], no hours and "pick_up" 1', function (this: Context) {
  change(this, (configuration) => {
    (configuration.mail as TomlTable).delivery_minutes = [1, 1];
    for (const kind of ["venue", "board", "speaker", "partner"]) delete ((configuration.kinds as TomlTable)[kind] as TomlTable | undefined)?.hours;
  });
  changePools(this, (pool) => {
    for (const template of [...pool.speaker, ...pool.partner]) Object.assign(template, { reply_minutes: [60, 60], pick_up: 1 });
  });
});

Given(
  /^the variant has the speakers "s1" \(local, available, no constraint, "acceptance" 1, no condition, "fee" 0\), "s2" \(from a station, available, "acceptance" 1, the condition "travel_paid"\), "s3" \(not available\), "s4" \(local, available, "acceptance" 1, the constraint "morning", no condition\) and "s5" \(local, available, "acceptance" 1, the condition "fee", "fee" 300\), and the partner "p1" with the preferred session 3$/,
  function (this: Context) {
    // In SPEAKERS and PARTNER; the draw chooses every speaker and the one partner of the pools.
  },
);

Given("the organiser's account opens at {int}", function (this: Context, opening: number) {
  change(this, (configuration) => ((((configuration.money as TomlTable).accounts as TomlTable)[ORGANISER] as TomlTable).opening = opening));
});

/** Changes how many templates of some kinds the draw chooses. */
export function drawing(context: Context, counts: Record<string, number>): void {
  change(context, (configuration) => (configuration.draw = stringify({ ...parse(configuration.draw as string), ...counts })));
}

/** Changes a speaker's template. */
function changeSpeaker(context: Context, id: string, changing: (template: TomlTable) => void): void {
  changePools(context, (pool) => changing(pool.speaker.find((template) => template.id === id) as TomlTable));
}

/** The organiser's turns that invite a speaker to session 2 at a time, with a fee and travel, then wait for its answer. */
function inviting(context: Context, speaker: string, { time = "10:00", fee = 0, travel = false } = {}) {
  return organiserTurns(`call "send_mail" to "${speaker}" with the act "invite", session 2, time "${time}", fee ${fee} and travel_paid ${travel}, then wait 2 world hours, then "check_time"`, hourMsOf(context));
}

/** The organiser's turns that confirm a speaker's session at a time in a room, then wait for its acknowledgement. */
function confirming(context: Context, speaker: string, { time = "10:00", room = "main-hall" } = {}) {
  return organiserTurns(`call "send_mail" to "${speaker}" with the act "confirm", time "${time}", room "${room}", length 45 and travel "none", then wait 2 world hours, then "check_time"`, hourMsOf(context));
}

/** The one message a speaker sent with an act, which may name its condition: "accept_if travel_paid". */
function answered(context: Context, speaker: string, answer: string): Record<string, unknown> {
  const [act, condition] = answer.split(" ");
  const sent = sentWith(context, speaker, act);
  if (condition !== undefined) assert.equal(fieldsOf(sent).condition, condition);
  return sent;
}

Then(/^"([sp]\d+)" answered "([^"]+)" one world hour after the invitation landed, within 30 world minutes$/, function (this: Context, speaker: string, answer: string) {
  const reply = answered(this, speaker, answer);
  const invitation = sentWith(this, ORGANISER, "invite");
  const landed = ranLines(this).find((line) => line.type === "message_delivered" && line.id === invitation.id);
  assert.ok(landed !== undefined, "the invitation did not land");
  const after = minutesOfWorld(reply.worldTime) - minutesOfWorld(landed.worldTime);
  assert.ok(Math.abs(after - 60) <= 30, `"${speaker}" answered ${after} world minutes after the invitation landed`);
});

Given('{string}\'s "acceptance" is {float}', function (this: Context, speaker: string, acceptance: number) {
  changeSpeaker(this, speaker, (template) => (template.acceptance = acceptance));
});

/** Each replica's log lines, by the scenario that ran them. */
const replicas = new WeakMap<Context, Record<string, unknown>[][]>();

When('two replicas run with the seed {int}, the second with another speaker "s6" added', { timeout: 30_000 }, async function (this: Context, seed: number) {
  this.seed = seed;
  const runs: Record<string, unknown>[][] = [];
  for (const added of [false, true]) {
    if (added) {
      changePools(this, (pool) => pool.speaker.push({ ...structuredClone(pool.speaker.find(({ id }) => id === "s1") as TomlTable), id: "s6" }));
      drawing(this, { speaker: 6 });
    }
    script(this, ORGANISER, [...inviting(this, "s1"), { text: "Done.", delayMs: 0 }]);
    await runCongress(this);
    runs.push(ranLines(this));
    if (added) assert.ok((runs[1].find((line) => line.type === "variant")?.chosen as Record<string, string[]>).speaker.includes("s6"), '"s6" was not drawn');
  }
  replicas.set(this, runs);
});

Then('"s1" gave the same answer to the same invitation in both', function (this: Context) {
  const runs = replicas.get(this) ?? [];
  assert.equal(runs.length, 2);
  const [first, second] = runs.map((lines) => {
    const invitation = lines.find((line) => line.type === "message_sent" && line.from === ORGANISER && line.act === "invite");
    const answers = lines.filter((line) => line.type === "message_sent" && line.from === "s1");
    assert.equal(answers.length, 1, `"s1" sent ${answers.length} messages`);
    return { invitation: invitation?.fields, answer: answers[0].act };
  });
  assert.deepEqual(second, first);
});

Given('"s2" answered "accept_if" with the condition "travel_paid"', function (this: Context) {
  before(this, inviting(this, "s2"));
});

Then(/^"([sp]\d+)" answered "(\w+)"$/, function (this: Context, speaker: string, act: string) {
  sentWith(this, speaker, act);
});

Given('"s2" answered "accept_if" with the condition "travel_paid" on {string}', function (this: Context, day: string) {
  untilTime(this, `${day} 09:00`);
  before(this, inviting(this, "s2"));
});

Then('"s2" mailed the organiser "withdraw" on {string}', function (this: Context, day: string) {
  assert.equal(fieldsOf(sentWith(this, "s2", "accept_if")).condition, "travel_paid");
  const withdrawn = sentWith(this, "s2", "withdraw");
  assert.equal(withdrawn.to, ORGANISER);
  assert.equal(`day ${dayOf(withdrawn)}`, day);
});

Given('"s1" has accepted', function (this: Context) {
  before(this, inviting(this, "s1"));
});

Then('"s1" answered "acknowledged" twice', function (this: Context) {
  assert.equal(sentBy(this, "s1").filter((line) => line.act === "acknowledged").length, 2);
});

/** Checks what a speaker believes about its session, as its outcome gives it. */
function assertBelieves(context: Context, speaker: string, time: string, room: string): void {
  const outcome = outcomeOf(context, speaker);
  assert.deepEqual({ time: outcome.believes_time, room: outcome.believes_room }, { time, room });
}

Then('{string} believes its session is at {string} in {string}', function (this: Context, speaker: string, time: string, room: string) {
  assertBelieves(this, speaker, time, room);
});

Given('"s5" has accepted with the fee 300', function (this: Context) {
  before(this, inviting(this, "s5", { fee: 300 }));
});

Then('"s5" committed 300 with the organiser\'s account when it acknowledged', function (this: Context) {
  const acknowledged = sentWith(this, "s5", "acknowledged");
  const commitments = moneyLines(this, "commitment").filter((line) => line.to === "s5");
  assert.equal(commitments.length, 1, `"s5" committed ${commitments.length} times`);
  assert.deepEqual({ from: commitments[0].from, amount: commitments[0].amount }, { from: ORGANISER, amount: 300 });
  // Within the moments of the run its acknowledgement and its commitment take, here a few world minutes.
  assert.ok(Math.abs(minutesOfWorld(commitments[0].worldTime) - minutesOfWorld(acknowledged.worldTime)) <= 5);
});

Then('"s5" answered "withdrawn", recorded a broken agreement and issued an invoice of 300', function (this: Context) {
  sentWith(this, "s5", "withdrawn");
  assert.equal(outcomeOf(this, "s5").broken_agreement, true);
  const invoices = moneyLines(this, "invoice").filter((line) => line.from === "s5");
  assert.deepEqual(
    invoices.map(({ to, amount }) => ({ to, amount })),
    [{ to: ORGANISER, amount: 300 }],
  );
});

Given('"s1" has accepted and been confirmed', function (this: Context) {
  before(this, [...inviting(this, "s1"), ...confirming(this, "s1")]);
});

Given('"s1" has accepted and been confirmed for {string} in {string}', function (this: Context, time: string, room: string) {
  before(this, [...inviting(this, "s1"), ...confirming(this, "s1", { time, room })]);
});

/**
 * The draws of a speaker's own sequence, from the seed and "rules of <speaker>", in order: one for each invitation it
 * does not decline at once, one for each ring it hears, and one for each request of slides or a panel.
 */
function drawsOf(context: Context, speaker: string, count: number): number[] {
  const random = Random.derive(context.seed, `rules of ${speaker}`);
  return Array.from({ length: count }, () => random.next());
}

Then(
  '"s1" either mailed "slides" before {string}, or sent nothing, as its sequence drew with probability 0.8',
  function (this: Context, by: string) {
    // Its draws: the invitation's, then the request of slides'.
    const [, slides] = drawsOf(this, "s1", 2);
    const sent = sentBy(this, "s1").filter((line) => line.act === "slides");
    if (slides < 0.8) {
      assert.equal(sent.length, 1, `"s1" drew ${slides} and sent ${sent.length} slides`);
      assert.ok(minutesOfWorld(sent[0].worldTime) < minutesOf(`${by} 00:00`), `the slides came on day ${dayOf(sent[0])}`);
    } else assert.equal(sent.length, 0, `"s1" drew ${slides} and sent slides`);
  },
);

Given('the configuration declares the perturbation {string} between {string} and {string}', function (this: Context, name: string, from: string, to: string) {
  assert.ok(name === "early_cancel");
  change(this, (configuration) => ((configuration.perturbations as TomlTable)[name] = { between: [from, to] }));
});

Given('the configuration declares the perturbation "late_cancel" at {string}', function (this: Context, at: string) {
  change(this, (configuration) => ((configuration.perturbations as TomlTable).late_cancel = { at }));
});

Given('"s1" has been confirmed on {string}', function (this: Context, day: string) {
  untilTime(this, `${day} 09:00`);
  before(this, [...inviting(this, "s1"), ...confirming(this, "s1")]);
});

Given('"s1" is confirmed on {string}', function (this: Context, time: string) {
  before(this, inviting(this, "s1"));
  untilTime(this, time);
  before(this, confirming(this, "s1"));
});

/** The one "cancel" a speaker mailed the organiser. */
function cancelOf(context: Context, speaker: string): Record<string, unknown> {
  const cancelled = sentWith(context, speaker, "cancel");
  assert.equal(cancelled.to, ORGANISER);
  return cancelled;
}

Then('"s1" mailed the organiser "cancel" on {string} between {string} and {string}', function (this: Context, day: string, from: string, to: string) {
  assertBetween(cancelOf(this, "s1"), `${day} ${from}`, `${day} ${to}`);
});

Then('"s1" mailed the organiser "cancel" on {string} at about {string}', function (this: Context, day: string, at: string) {
  const cancelled = cancelOf(this, "s1");
  // Two days after its confirmation landed, a world minute after it was sent, within the moments a chain of a component,
  // a stimulus and a mail takes under the gate's parallel load: an hour, 60 ms of the run.
  assert.ok(Math.abs(minutesOfWorld(cancelled.worldTime) - minutesOf(`${day} ${at}`)) <= 60, `"s1" cancelled at day ${dayOf(cancelled)}, ${JSON.stringify(cancelled.worldTime)}`);
});

Given('"s1" and "s4" have been confirmed', function (this: Context) {
  before(this, [...inviting(this, "s1"), ...inviting(this, "s4"), ...confirming(this, "s1"), ...confirming(this, "s4")]);
});

Given("the organiser does not answer calls", function (this: Context) {
  // Its scripted turns call no "answer_call".
  assert.ok(!(turnsBefore.get(this) ?? []).some(({ toolCalls }) => (toolCalls as { name: string }[]).some(({ name }) => name === "answer_call")));
});

/** The calls a speaker placed to the organiser with the act "cancel", as the log's call lines give them. */
function cancelCalls(context: Context): Record<string, unknown>[] {
  return ranLines(context).filter((line) => line.type === "call" && line.to === ORGANISER && line.act === "cancel");
}

Then('a confirmed speaker other than the early cancellation\'s called the organiser at {string} with the act "cancel"', function (this: Context, at: string) {
  const calls = cancelCalls(this);
  assert.equal(calls.length, 1, `the organiser was called ${calls.length} times to cancel`);
  assert.ok(["s1", "s4"].includes(calls[0].from as string), `"${String(calls[0].from)}" called`);
  const rang = calls[0].rang as { worldTime: unknown };
  assert.ok(Math.abs(minutesOfWorld(rang.worldTime) - minutesOf(at)) <= 5, `it rang at ${JSON.stringify(rang.worldTime)}`);
});

Then('the call was not answered, and it mailed "cancel" after it', function (this: Context) {
  const [call] = cancelCalls(this);
  assert.equal(call.outcome, "no_answer");
  const cancelled = cancelOf(this, call.from as string);
  assert.ok(minutesOfWorld(cancelled.worldTime) >= minutesOfWorld((call.ended as { worldTime: unknown }).worldTime), "the mail came before the call ended");
  // Only the speaker who called cancelled.
  assert.equal(ranLines(this).filter((line) => line.type === "message_sent" && line.act === "cancel").length, 1);
});

/** The organiser's calls of a tool, as the log gives them. */
function organiserCalls(context: Context, tool: string): Record<string, unknown>[] {
  return ranLines(context).filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === tool);
}

Then(
  'the "check_mail" result lists one message from "board" with the subject "partner_session", received at "day 1 Monday 09:00"',
  function (this: Context) {
    const [checked] = organiserCalls(this, "check_mail");
    assert.equal(String(checked?.result).trim(), 'm-1: from board, subject "partner_session", received day 1 Monday 09:00');
  },
);

Then('the "read_mail" result gives the speaker "p1" and the session 3', function (this: Context) {
  const [read] = organiserCalls(this, "read_mail");
  assert.equal(read?.outcome, "success");
  assert.match(String(read.text), /^From: board\. Act: partner_session\./);
  assert.match(String(read.text), / speaker: p1\./);
  assert.match(String(read.text), / session: 3\./);
});

Then('"p1" answered "acknowledged" and believes its session is at {string} in {string}', function (this: Context, time: string, room: string) {
  sentWith(this, "p1", "acknowledged");
  assertBelieves(this, "p1", time, room);
});

Then('the "call" result gives the act "accept" or "decline", as "s1"\'s sequence drew with probability 0.6', function (this: Context) {
  const [called] = organiserCalls(this, "call");
  assert.equal(called?.outcome, "success");
  // Its draws: picking up the ring, then the panel's.
  const [, panel] = drawsOf(this, "s1", 2);
  assert.match(String(called.text), new RegExp(`^Answer from s1\\. Act: ${panel < 0.6 ? "accept" : "decline"}\\.`));
});

Then(
  'the run\'s log has a "participant_outcome" line for "s1" with its invitation, its answer, what it believes about its session, and no cancellation or broken agreement',
  function (this: Context) {
    const outcome = outcomeOf(this, "s1");
    assert.match(String(outcome.invitation), /"session":2/);
    assert.deepEqual(
      { answer: outcome.answer, believes_time: outcome.believes_time, believes_room: outcome.believes_room, cancelled: outcome.cancelled, broken_agreement: outcome.broken_agreement },
      { answer: "accept", believes_time: "10:00", believes_room: "main-hall", cancelled: false, broken_agreement: false },
    );
  },
);

// The changes FR-CONGRESS-04's refusals make, beside FR-CONGRESS-01's and FR-CONGRESS-02's.
congressChanges.push(
  [/^"s1"'s "acceptance" is 1\.2$/, (setup) => changeSpeaker(setup.context, "s1", (s1) => (s1.acceptance = 1.2))],
  [/^"s1"'s "draw" is 4$/, (setup) => changeSpeaker(setup.context, "s1", (s1) => (s1.draw = 4))],
  [/^"s1"'s "fee" is -50$/, (setup) => changeSpeaker(setup.context, "s1", (s1) => (s1.fee = -50))],
  [/^"s1"'s "condition" is "lunch"$/, (setup) => changeSpeaker(setup.context, "s1", (s1) => (s1.condition = "lunch"))],
  [/^"s1"'s "constraint" is "evening"$/, (setup) => changeSpeaker(setup.context, "s1", (s1) => (s1.constraint = "evening"))],
  [/^the perturbation "late_cancel" is at "Monday"$/, (setup) => change(setup.context, (configuration) => ((configuration.perturbations as TomlTable).late_cancel = { at: "Monday" }))],
  [
    /^the draw chooses 2 partners$/,
    (setup) => {
      // The pool has two partners, so the draw could choose them: only the rule refuses it.
      changePools(setup.context, (pool) => pool.partner.push({ ...structuredClone(PARTNER), id: "p2" }));
      drawing(setup.context, { partner: 2 });
    },
  ],
);
