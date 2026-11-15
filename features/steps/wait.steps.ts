import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { parse } from "smol-toml";
import type { ToolCall } from "../../src/engine/adapter.ts";
import type { ComponentAction } from "../../src/engine/components.ts";
import type { Context } from "../support/context.ts";
import { itemOf, under } from "./inventory.steps.ts";
import { linesOf } from "./record.steps.ts";

/** The worker, the workplace's one agent. */
const WORKER = "worker";

/**
 * How long after the moment that ends it a call may end: the engine takes a moment to notice it and to record the call,
 * and Node's timers a moment more.
 */
const NOTICED_WITHIN_MS = 20;

/** How late a timer may deliver a stimulus the scenario places at a moment, on a busy machine. */
const DELIVERED_LATE_BY_MS = 100;

/** The worker's only call of a tool, as the run recorded it, which "it" names in the steps that follow. */
function onlyCall(context: Context, tool: string): ToolCall {
  assert.ok(context.toolCalls !== undefined, "the worker did not run");
  // In the workshop, the only call of that tool any worker made (FR-WORKSHOP-02).
  const anyWorker = context.libraryScenario?.name === "workshop";
  const calls = context.toolCalls.filter((call) => (anyWorker || call.agent === WORKER) && call.tool === tool);
  assert.equal(calls.length, 1, `the worker made ${calls.length} "${tool}" calls`);
  context.lastToolCall = calls[0];
  return calls[0];
}

/** The call the scenario checked last. */
function theCall(context: Context): ToolCall {
  assert.ok(context.lastToolCall !== undefined, "no call was checked before");
  return context.lastToolCall;
}

/** A moment of the run, in milliseconds since it started, rounded for a message. */
function intoRun(context: Context, atMs: number): string {
  assert.ok(context.runStartedAtMs !== undefined, "the run gave no start");
  return `${Math.round(atMs - context.runStartedAtMs)} ms into the run`;
}

Then("the {string} call succeeded with the text {string}", function (this: Context, tool: string, text: string) {
  const call = onlyCall(this, tool);
  assert.deepEqual({ outcome: call.outcome, text: call.text }, { outcome: "success", text });
});

Then("it ended at least {int} milliseconds after it started", function (this: Context, durationMs: number) {
  const call = theCall(this);
  const took = call.endedAtMs - call.startedAtMs;
  assert.ok(took >= durationMs, `the call took ${took} ms`);
});

Then("the world's version did not change during it", function (this: Context) {
  const call = theCall(this);
  // The arbiter's every applied effect is watched, with when it was applied; the version counts them.
  const during = this.applied.filter(({ atMs }) => atMs >= call.startedAtMs && atMs <= call.endedAtMs);
  assert.equal(during.length, 0, `the arbiter applied ${during.length} effects during the call, the first at ${intoRun(this, during[0]?.atMs ?? 0)}`);
});

Then(
  "the {string} call ended with the outcome {string} and the text {string}",
  function (this: Context, tool: string, outcome: string, text: string) {
    const call = onlyCall(this, tool);
    assert.deepEqual({ outcome: call.outcome, text: call.text }, { outcome, text });
  },
);

Then("the {string} call ended with the outcome {string}", function (this: Context, tool: string, outcome: string) {
  assert.equal(onlyCall(this, tool).outcome, outcome);
});

Then("it ended within {int} milliseconds after {string} appeared in {string}", function (this: Context, withinMs: number, id: string, place: string) {
  const call = theCall(this);
  // The visitor appears as their action of appearing is applied, at its end; appearing takes no time.
  const appearing = linesOf(this, `${this.runId}.jsonl`)
    .map((line) => JSON.parse(line) as { type: string } & ComponentAction)
    .find((line) => line.type === "component_action" && line.component === id && line.action.startsWith(`appear in "${place}"`));
  assert.ok(appearing !== undefined, `"${id}" did not appear in "${place}"`);
  const after = call.endedAtMs - appearing.endedAtMs;
  assert.ok(after >= 0 && after <= withinMs, `"${id}" appeared ${intoRun(this, appearing.endedAtMs)}, and the call ended ${intoRun(this, call.endedAtMs)}`);
});

Given("a stimulus on the channel {string} reaches the worker {int} milliseconds into the run", function (this: Context, channel: string, afterMs: number) {
  // The run's time starts right after its stimuli are handed over.
  this.atRunStart.push((stimuli) => {
    setTimeout(() => {
      this.stimulusDeliveredAtMs = performance.now();
      stimuli.deliver(WORKER, channel);
    }, afterMs);
  });
});

Then(
  "the {string} call ended with the outcome {string} about {int} milliseconds into the run",
  function (this: Context, tool: string, outcome: string, atMs: number) {
    const call = onlyCall(this, tool);
    assert.equal(call.outcome, outcome);
    assert.ok(this.runStartedAtMs !== undefined, "the run gave no start");
    assert.ok(this.stimulusDeliveredAtMs !== undefined, "the stimulus was never delivered");
    const deliveredAtMs = this.stimulusDeliveredAtMs;
    // "About": a timer may fire up to 1 ms before the run's clock reads it (the run starts just after the timer is set),
    // and may be late by up to 100 ms, still well short of the wait's 300 ms.
    const deliveredInto = deliveredAtMs - this.runStartedAtMs;
    assert.ok(
      deliveredInto >= atMs - 1 && deliveredInto <= atMs + DELIVERED_LATE_BY_MS,
      `the stimulus was delivered ${intoRun(this, deliveredAtMs)}, not about ${atMs} ms`,
    );
    const noticed = call.endedAtMs - deliveredAtMs;
    assert.ok(
      noticed >= 0 && noticed <= NOTICED_WITHIN_MS,
      `the stimulus was delivered ${intoRun(this, deliveredAtMs)}, and the call ended ${intoRun(this, call.endedAtMs)}`,
    );
  },
);

Then("it lists the tool {string} with its duration in depot minutes, up to {int}", function (this: Context, tool: string, maxMinutes: number) {
  const describe = this.libraryScenario.describeDuration;
  assert.ok(describe !== undefined, "the scenario describes no durations");
  const tools = under(under(this.labOutput ?? "", '## Condition "base"'), "### Tools");
  const duration = itemOf(under(tools, `#### Tool "${tool}"`), "Duration");
  assert.equal(duration, describe(parse(this.libraryScenario.baseConfiguration ?? ""), tool));
  assert.match(duration, /depot minute/, `the duration of "${tool}" gives no depot minutes: ${duration}`);
  assert.match(duration, new RegExp(`\\bup to ${maxMinutes}\\b`), `the duration of "${tool}" gives no limit of ${maxMinutes}: ${duration}`);
});
