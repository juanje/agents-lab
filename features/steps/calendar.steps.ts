import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, stringify } from "smol-toml";
import { readExperiment } from "../../src/engine/experiment.ts";
import { type Inventory, inventory, inventoryMarkdown } from "../../src/engine/inventory.ts";
import * as calendars from "../../src/engine/calendar.ts";
import type { Weekday, WorldDuration, WorldTime } from "../../src/engine/calendar.ts";
import type { Component } from "../../src/engine/components.ts";
import type { Sensor } from "../../src/engine/tools.ts";
import { World } from "../../src/engine/world.ts";
import { type Slots, slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { editWorld, setClock, workplaceDay } from "./day.steps.ts";
import { scriptWorker } from "./measures.steps.ts";
import { withBase } from "./neighbourhood.steps.ts";
import { callWithThenEnd, runTheScenario, script } from "./tool.steps.ts";

/** The test scenario's one agent. */
const AGENT = "agent";

/** Two digits, as a clock writes hours and minutes. */
const two = (value: number) => String(value).padStart(2, "0");

/** A world time to the minute, as the test scenario's sensors give it: "day <n> <weekday> HH:MM". */
function toTheMinute({ day, weekday, seconds }: WorldTime): string {
  return `day ${day} ${weekday} ${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}`;
}

/**
 * A sensor of the test scenario that gives the world's time when it reads the world, to the minute, and takes this
 * duration; without the world's time it says so, which no scenario expects.
 */
function clockSensor(name: string, duration: number | WorldDuration): Sensor<Slots> {
  return {
    kind: "sensor",
    name,
    description: "Gives the world's time.",
    parameters: { type: "object", properties: {} },
    durationMs: () => duration,
    sense: (_state, _agent, _args, _sinceStartMs, world) => (world === undefined ? "no world time was given" : toTheMinute(world)),
  };
}

/** Declares a clock sensor in the test scenario, in place of one of the same name. */
function declareClockSensor(context: Context, name: string, duration: number | WorldDuration): void {
  context.tools = [...context.tools.filter((tool) => tool.name !== name), clockSensor(name, duration)];
}

/** The configuration's [calendar], which the steps fill in. */
function calendarOf(context: Context): TomlTable {
  context.calendar ??= { segments: [] };
  return context.calendar;
}

/** The configuration's calendar segments, in order. */
function segmentsOf(context: Context): TomlTable[] {
  return calendarOf(context).segments as TomlTable[];
}

/** The seconds since midnight of "HH:MM" at the end of a world time as the contract writes it. */
function secondsOf(time: string): number {
  const [, hours, minutes] = /(\d{2}):(\d{2})$/.exec(time) ?? [];
  assert.ok(hours !== undefined, `the steps do not read the time of "${time}"`);
  return Number(hours) * 3600 + Number(minutes) * 60;
}

/** The run milliseconds one world minute takes at a scale, in world seconds per second of the run. */
const minuteMsAt = (scale: number) => (60 * 1000) / scale;

Given(
  'a test scenario with one agent and a sensor {string} that gives the world\'s time to the minute, as "day <n> <weekday> HH:MM"',
  function (this: Context, name: string) {
    this.world = new World<Slots>([]);
    this.tools = [];
    declareClockSensor(this, name, 0);
    // The agent ends its only activation at once unless the scenario scripts its turns.
    script(this, AGENT, [{ text: "Nothing to do.", delayMs: 0 }]);
  },
);

Given("the configuration's calendar starts at {string}", function (this: Context, start: string) {
  calendarOf(this).start = start;
});

Given("the configuration's calendar starts at {string} with one segment of scale {int}", function (this: Context, start: string, scale: number) {
  this.calendar = { start, segments: [{ scale }] };
});

Given(
  "its first segment has the scale {int} until {string}, so one world minute is {int} milliseconds of the run and the segment takes {int}",
  function (this: Context, scale: number, until: string, minuteMs: number, takesMs: number) {
    assert.equal(minuteMsAt(scale), minuteMs, `at the scale ${scale}, a world minute is not ${minuteMs} ms`);
    const spanMs = ((secondsOf(until) - secondsOf(calendarOf(this).start as string)) / scale) * 1000;
    assert.equal(spanMs, takesMs, `the first segment takes ${spanMs} ms, not ${takesMs}`);
    segmentsOf(this).push({ scale, until });
  },
);

Given("its second segment has the scale {int}, so one world minute is {int} milliseconds of the run", function (this: Context, scale: number, minuteMs: number) {
  assert.equal(minuteMsAt(scale), minuteMs, `at the scale ${scale}, a world minute is not ${minuteMs} ms`);
  segmentsOf(this).push({ scale });
});

Given(
  "the agent's scripted turns wait {int} milliseconds, then call {string} with a run-time duration of {int}, then end",
  function (this: Context, waitMs: number, tool: string, durationMs: number) {
    declareClockSensor(this, tool, durationMs);
    script(this, AGENT, callWithThenEnd(tool, {}, waitMs));
  },
);

Given("a sensor {string} whose duration is {int} world minutes and that gives the world's time when it ends", function (this: Context, name: string, minutes: number) {
  declareClockSensor(this, name, { worldSeconds: minutes * 60 });
});

Given(
  "a sensor {string} whose duration is {int} milliseconds of the run and that gives the world's time when it ends",
  function (this: Context, name: string, durationMs: number) {
    declareClockSensor(this, name, durationMs);
  },
);

Given("the agent's scripted turns wait {int} milliseconds, then call {string}, then end", function (this: Context, waitMs: number, tool: string) {
  script(this, AGENT, callWithThenEnd(tool, {}, waitMs));
});

Given("the agent's scripted turns call {string}, then end", function (this: Context, tool: string) {
  script(this, AGENT, callWithThenEnd(tool, {}, 0));
});

/** The agent's one call of a tool, which "its" names from here on, and when it started and ended, in milliseconds into the run. */
function checkedCall(context: Context, tool: string) {
  const calls = (context.toolCalls ?? []).filter((call) => call.tool === tool);
  assert.equal(calls.length, 1, `the agent made ${calls.length} "${tool}" calls`);
  const [call] = calls;
  context.lastToolCall = call;
  const runStartedAtMs = context.runStartedAtMs ?? 0;
  return { startedMs: call.startedAtMs - runStartedAtMs, endedMs: call.endedAtMs - runStartedAtMs };
}

/** Checks a span of the run's milliseconds against the one the contract gives, within its slack. */
function assertTook(what: string, tookMs: number, expectedMs: number, withinMs: number): void {
  assert.ok(Math.abs(tookMs - expectedMs) <= withinMs, `${what} took ${Math.round(tookMs)} ms of the run, not ${expectedMs} within ${withinMs}`);
}

Then("the {string} call took {int} milliseconds of the run, within {int}", function (this: Context, tool: string, durationMs: number, withinMs: number) {
  const { startedMs, endedMs } = checkedCall(this, tool);
  assertTook(`the "${tool}" call`, endedMs - startedMs, durationMs, withinMs);
});

Then(
  "the {string} call took {int} milliseconds of the run, within {int}: {int} in the first segment and {int} in the second",
  function (this: Context, tool: string, durationMs: number, withinMs: number, firstMs: number, secondMs: number) {
    const { startedMs, endedMs } = checkedCall(this, tool);
    assertTook(`the "${tool}" call`, endedMs - startedMs, durationMs, withinMs);
    const [first] = segmentsOf(this);
    const firstEndsMs = ((secondsOf(first.until as string) - secondsOf(calendarOf(this).start as string)) / (first.scale as number)) * 1000;
    // The time the call started is what its duration counts from: the agent's wait and the engine's own moment before it.
    assertTook(`in the first segment, the "${tool}" call`, firstEndsMs - startedMs, firstMs, withinMs);
    assertTook(`in the second segment, the "${tool}" call`, endedMs - firstEndsMs, secondMs, withinMs);
  },
);

/** A world time to the second as the contract writes it, "day <n> <weekday> HH:MM:SS", read or written. */
function worldTimeOf(text: string): WorldTime {
  const [, day, weekday, hours, minutes, seconds] = /^day (\d+) (\w+) (\d{2}):(\d{2}):(\d{2})$/.exec(text.trim()) ?? [];
  assert.ok(day !== undefined, `the steps do not read the world time "${text}"`);
  return { day: Number(day), weekday: weekday as Weekday, seconds: Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) };
}

function toTheSecond(time: WorldTime): string {
  return `${toTheMinute(time)}:${two(time.seconds % 60)}`;
}

/** What the engine answered about a set of hours at a world time, for the step that checks it. */
const answers = new WeakMap<Context, { within: boolean; next: WorldTime }>();

Given(
  "the calendar declares the hours {string} on Monday, Tuesday, Wednesday, Thursday and Friday from {string} to {string}, with the calendar starting at {string}",
  function (this: Context, name: string, from: string, to: string, start: string) {
    assert.equal(calendarOf(this).start, start, "the calendar starts elsewhere");
    calendarOf(this).hours = { [name]: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], from, to } };
  },
);

When("the engine is asked about {string} at {string}", function (this: Context, name: string, time: string) {
  // Through the module, so a missing answer fails this step rather than every step's import.
  answers.set(this, calendars.hoursAt(calendars.readCalendar(calendarOf(this)), name, worldTimeOf(time)));
});

Then("it answers within: {word}, next beginning at {string}", function (this: Context, within: string, next: string) {
  const answer = answers.get(this);
  assert.ok(answer !== undefined, "the engine was not asked");
  assert.deepEqual({ within: answer.within, next: toTheSecond(answer.next) }, { within: within === "yes", next: toTheSecond(worldTimeOf(next)) });
});

/** What each component of the test scenario recorded of the world's time, by the component's name. */
const recorded = new WeakMap<Context, Map<string, string[]>>();

Given(
  "a component {string} whose cycle records the world's time it is given, acting every {int} world minutes, {int} times",
  function (this: Context, name: string, minutes: number, times: number) {
    const records = recorded.get(this) ?? new Map<string, string[]>();
    recorded.set(this, records);
    const times_: string[] = [];
    records.set(name, times_);
    // Its action changes nothing and lasts its world minutes, so it chooses again that many world minutes later.
    const rest = { precondition: () => ({ holds: true as const }), effect: (state: Slots) => state };
    const bell: Component<Slots> = {
      name,
      kind: "world",
      description: `Records the world's time every ${minutes} world minutes, ${times} times.`,
      cycle: () => ({
        next: (_state, _outcome, _sinceStartMs, world) => {
          if (times_.length === times) return { kind: "end" };
          times_.push(world === undefined ? "no world time was given" : toTheMinute(world));
          return { kind: "action", name: "act", durationMs: { worldSeconds: minutes * 60 }, action: rest };
        },
      }),
    };
    this.components = [...this.components, bell];
  },
);

Then("{string} recorded, to the minute, {string}, {string} and {string}", function (this: Context, name: string, first: string, second: string, third: string) {
  assert.deepEqual(recorded.get(this)?.get(name), [first, second, third]);
});

Given(
  "the workplace scenario of FR-WORKPLACE-05's first scenario, with {string} {string} and {string} {int}",
  function (this: Context, startKey: string, start: string, scaleKey: string, scale: number) {
    // FR-WORKPLACE-05's background, then its first scenario's own setup, with the clock this scenario gives.
    workplaceDay(this, "ms_per_length", 20);
    setClock(this, startKey, start, scaleKey, scale);
    editWorld(this, (world) => {
      world.porter = { id: "piet", name: "Piet, the porter", description: "The porter, bringing the day's deliveries.", enters: "yard", drops_in: "store", rounds: ["09:10"] };
      world.things = [...((world.things ?? []) as TomlTable[]), { id: "crate", name: "a wooden crate", arrives: "09:10" }];
    });
    this.libraryScenario = withBase(this.libraryScenario, { durations: { check_time_ms: 10 } });
    scriptWorker(this, 'call "look", then wait 130 milliseconds, then call "check_time"');
  },
);

/** The inventory the scenario made, of an experiment over the slots test scenario with the configuration's [calendar]. */
const inventories = new WeakMap<Context, Inventory>();

When("the inventory is made", function (this: Context) {
  const experiment = readExperiment(
    [
      'id = "calendar"',
      'scenario = "slots"',
      'models = ["scripted/one"]',
      'thinking_level = "off"',
      "replicas = 1",
      "seed = 1",
      "[limits]",
      "time_limit_ms = 1000",
      "activations_per_agent = 1",
      "parallelism_limit = 1",
      "model_turn_timeout_ms = 500",
      "[compaction]",
      "enabled = false",
      "[conditions.base]",
      "",
    ].join("\n"),
  );
  const scenario = { ...slotsScenario, baseConfiguration: `${slotsScenario.baseConfiguration}\n${stringify({ calendar: calendarOf(this) })}\n` };
  inventories.set(this, inventory(experiment, scenario));
});

Then(
  "it gives the start {string}, the first segment with scale {int} until {string} taking {int} milliseconds of the run, and the second with scale {int} {string}",
  function (this: Context, start: string, firstScale: number, until: string, takesMs: number, secondScale: number, lasts: string) {
    const made = inventories.get(this);
    assert.ok(made !== undefined, "no inventory was made");
    const [condition] = made.conditions;
    assert.deepEqual(condition.calendar, {
      start,
      segments: [
        { scale: firstScale, until, runTime: `${takesMs} ms` },
        { scale: secondScale, runTime: lasts },
      ],
      hours: {},
    });
    // "lab inventory" prints what the inventory gives.
    const printed = inventoryMarkdown(made);
    for (const text of [start, `${firstScale}`, until, `${takesMs} ms`, `${secondScale}`, lasts]) assert.ok(printed.includes(text), `the printed inventory does not give ${text}`);
  },
);

When("the run is attempted", async function (this: Context) {
  try {
    await runTheScenario(this);
  } catch (error) {
    this.runError = error as Error;
  }
});
