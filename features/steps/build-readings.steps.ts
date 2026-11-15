import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, stringify } from "smol-toml";
import type { Context } from "../support/context.ts";
import { change, configurationOf, hourMsOf, organiserTurns } from "./congress.steps.ts";
import { before, changePools, minutesOf, ranLines, untilTime } from "./congress-parties.steps.ts";
import { V1 } from "./run-corrections.steps.ts";
import { runTheScenario, script } from "./tool.steps.ts";

// FR-CONGRESS-18: the readings from FR-CONGRESS-17's build, on FR-CONGRESS-09's congress with the venue "v1", the
// speaker "s1", the partner "p1" (session 3) and two hotels of 10 rooms near "v1".

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The literal text of a step, as a regular expression that matches it alone. */
const literal = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** The speaker and the partner the variant draws. */
const S1: TomlTable = { id: "s1", title: "Soil life", draw: 1, fee: 0, home: "local", available: true, acceptance: 1, pick_up: 1 };
const P1: TomlTable = { id: "p1", title: "Partner's soil", session: 3, fee: 0, home: "north", available: true, pick_up: 1 };

/** The run's milliseconds from the calendar's start, "day 1 09:00", to a world time. */
const msUntil = (context: Context, time: string) => ((minutesOf(time) - minutesOf("day 1 09:00")) / 60) * hourMsOf(context);

Given(literal('the travel has the hotels "h1" (near "v1", 10 rooms) and "h2" (near "v1", 10 rooms), and the event is on "day 26"'), function (this: Context) {
  changePools(this, (pool) => {
    pool.venue = [structuredClone(V1)];
    pool.speaker = [structuredClone(S1)];
    pool.partner = [structuredClone(P1)];
  });
  change(this, (configuration) => {
    assert.equal(configuration.event_day, 26);
    configuration.draw = stringify({ attendance: [50, 50], venue: 1, speaker: 1, partner: 1 });
    configuration.travel = stringify({
      stations: ["north"],
      trains: [{ id: "t1", from: "north", arrives: "08:30", price: 0 }],
      hotels: [
        { id: "h1", near: "v1", rooms: 10, price: 90 },
        { id: "h2", near: "v1", rooms: 10, price: 90 },
      ],
      sold_out_probability: 0,
    });
  });
});

// A hotel keeps a room up to its own night.
When(/^the organiser calls "travel_options" for "day 26" on "(day \d+)"$/, { timeout: 120_000 }, async function (this: Context, today: string) {
  untilTime(this, `${today} 09:00`);
  before(this, organiserTurns('call "travel_options" "north" "day 26"', hourMsOf(this)));
  this.timeLimitMs = msUntil(this, `${today} 12:00`);
  await runTheScenario(this);
});

Then(/^"(h\d)" has (\d+) rooms left for the night of "(day \d+)"$/, function (this: Context, hotel: string, left: string, night: string) {
  const calls = ranLines(this).filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === "travel_options");
  assert.equal(calls.length, 1, `the organiser called "travel_options" ${calls.length} times`);
  assert.equal(calls[0].outcome, "success");
  const { hotels } = JSON.parse(String(calls[0].result)) as { hotels: { option: string; rooms_left: number }[] };
  const option = hotels.find((each) => each.option === `${hotel} ${night}`);
  assert.ok(option !== undefined, `"travel_options" gave no "${hotel} ${night}": ${JSON.stringify(hotels)}`);
  assert.equal(option.rooms_left, Number(left));
});

// A speaker whose room was cancelled the night before can get another.
/** The organiser's rest between activations: 17 world days, so it first wakes on "day 18" and then only when a call rings. */
const REST_DAYS = 17;

Given(
  'the organiser booked "h1" for "s1" for the night of "day 25", and the hotel overbooks on "day 25" at 21:00',
  function (this: Context) {
    change(this, (configuration) => {
      configuration.rhythm = { ...(configuration.rhythm as TomlTable), min_ms: REST_DAYS * 24 * hourMsOf(this), max_ms: REST_DAYS * 24 * hourMsOf(this) };
      (configuration.perturbations as TomlTable).hotel_overbooks = { at: "day 25 21:00" };
    });
    // Its first activation, on "day 18", books the room.
    script(this, ORGANISER, [...organiserTurns('call "book_travel" "h1 day 25" for "s1"', hourMsOf(this)), { text: "Done.", delayMs: 0 }]);
  },
);

Given('the organiser\'s scripted turns, woken by the call, call "book_travel" for "s1" with the option "h2 day 25", then end', function (this: Context) {
  // Its second activation, which only the speaker's call can start before the run ends: a ring wakes a resting organiser.
  assert.equal((configurationOf(this).phone as TomlTable).wakes, true);
  const first = this.scripts.get(ORGANISER) ?? [];
  script(this, ORGANISER, [...first, ...organiserTurns('call "book_travel" "h2 day 25" for "s1"', hourMsOf(this)), { text: "Done.", delayMs: 0 }]);
  this.activations.set(ORGANISER, 2);
});

When('{string} is evaluated on {string} at {int}:{int}', { timeout: 120_000 }, async function (this: Context, part: string, day: string, hours: number, minutes: number) {
  const at = `${day} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  change(this, (configuration) => (configuration.parts = stringify({ parts: [{ id: part, predicate: part, evaluate_at: at }] })));
  this.timeLimitMs = msUntil(this, at) + hourMsOf(this);
  await runTheScenario(this);
});

Then('{string} has a booking of {string} and {string} holds', function (this: Context, traveller: string, option: string, part: string) {
  const lines = ranLines(this);
  const calls = lines.filter((line) => line.type === "call" && line.from === traveller && line.to === ORGANISER).map((line) => line.act);
  assert.deepEqual(calls, ["no_room"], `"${traveller}" phoned the organiser with ${JSON.stringify(calls)}`);
  const booked = lines.filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === "book_travel").map((line) => [(line.arguments as { option: string }).option, line.outcome]);
  assert.deepEqual(booked, [
    ["h1 day 25", "success"],
    [option, "success"],
  ]);
  const line = lines.find((each) => each.type === "part" && each.part === part);
  assert.ok(line !== undefined, `the log has no part line for "${part}"`);
  assert.equal(line.held, true, JSON.stringify(line));
});

// A refused invitation is no misapplication.
Given(
  'the organiser\'s scripted turns call "send_mail" to "s1" with the act "invite" and the session 3 but no time, which fails as "missing_field", then end',
  function (this: Context) {
    script(this, ORGANISER, [{ toolCalls: [{ name: "send_mail", arguments: { to: "s1", act: "invite", fields: { session: 3 } } }], delayMs: 0 }, { text: "Done.", delayMs: 0 }]);
  },
);

Then('{string} records no misapplication', function (this: Context, part: string) {
  const sends = ranLines(this).filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === "send_mail");
  assert.deepEqual(
    sends.map((line) => line.outcome),
    ["missing_field"],
  );
  const line = ranLines(this).find((each) => each.type === "part" && each.part === part) as { misapplications?: unknown[] } | undefined;
  assert.ok(line?.misapplications !== undefined, `the log has no evaluated part line for "${part}": ${JSON.stringify(line)}`);
  assert.deepEqual(line.misapplications, []);
});
