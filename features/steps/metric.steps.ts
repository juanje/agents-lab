import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { World } from "../../src/engine/world.ts";
import { emptySlots, slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { logLines } from "./record.steps.ts";

/** A metric sample line of a run's log, as JSON gives it back. */
interface Sample {
  type: "metric_sample";
  atMs: number;
  version: number;
  metrics: Record<string, unknown>;
}

/** The metric sample lines of a log, in the order they were written, each checked to give when, from what version, and the metrics. */
export function samplesIn(lines: readonly (Record<string, unknown> & { type: string })[]): Sample[] {
  const samples = lines.filter((line) => line.type === "metric_sample");
  for (const sample of samples) {
    assert.equal(typeof sample.atMs, "number", `a metric sample gives no time: ${JSON.stringify(sample)}`);
    assert.equal(typeof sample.version, "number", `a metric sample gives no world version: ${JSON.stringify(sample)}`);
    assert.ok(typeof sample.metrics === "object" && sample.metrics !== null, `a metric sample gives no metrics: ${JSON.stringify(sample)}`);
  }
  return samples as unknown as Sample[];
}

/** The metric samples of the only log the scenario's run wrote, at least two: the start's and the end's. */
function samplesOf(context: Context): Sample[] {
  const samples = samplesIn(logLines(context));
  assert.ok(samples.length >= 2, `the log has ${samples.length} metric samples`);
  return samples;
}

Given(
  "a test world with {int} slots, all empty, whose metric {string} counts the held slots",
  function (this: Context, count: number, metric: string) {
    this.world = new World(emptySlots(count));
    // The metric lives in the fixture; this keeps the scenario's words and it in step.
    const held = slotsScenario.metrics[metric];
    assert.ok(held !== undefined, `the test world declares no metric "${metric}"`);
    assert.equal(held(["a", null, "b"]), 2);
  },
);

Then(
  /^(?:the log's|its) (first|last) metric sample gives "([^"]*)" as (\d+), computed from the world's version (\d+)$/,
  function (this: Context, which: string, metric: string, value: string, version: string) {
    const samples = samplesOf(this);
    const sample = which === "first" ? samples[0] : samples[samples.length - 1];
    assert.equal(sample.version, Number(version), `the ${which} sample was computed from version ${sample.version}`);
    assert.equal(sample.metrics[metric], Number(value), `the ${which} sample gives "${metric}" as ${JSON.stringify(sample.metrics[metric])}`);
  },
);

Given("the world's metric {string} has no value while no slot is held", function (this: Context, metric: string) {
  // Its value, once a slot is held, is the number of the first held slot.
  this.metrics = {
    ...this.metrics,
    [metric]: (slots) => {
      const first = slots.findIndex((holder) => holder !== null);
      return first === -1 ? null : first + 1;
    },
  };
});

Then("every metric sample gives {string} as null", function (this: Context, metric: string) {
  for (const [index, sample] of samplesOf(this).entries()) {
    // Written as null, not left out, so the metric is there in every sample.
    assert.ok(metric in sample.metrics, `sample ${index + 1} leaves out "${metric}": ${JSON.stringify(sample)}`);
    assert.equal(sample.metrics[metric], null, `sample ${index + 1} gives "${metric}" as ${JSON.stringify(sample.metrics[metric])}`);
  }
});

Given(
  "the world's metric {string} gives, for each agent that holds a slot, the number of its slot",
  function (this: Context, metric: string) {
    this.metrics = {
      ...this.metrics,
      [metric]: (slots) => Object.fromEntries(slots.flatMap((holder, index) => (holder === null ? [] : [[holder, index + 1]]))),
    };
  },
);

Then(
  "the log's last metric sample gives {string} as agent {string} with {int}",
  function (this: Context, metric: string, agent: string, value: number) {
    const last = samplesOf(this).at(-1);
    assert.deepEqual(last?.metrics[metric], { [agent]: value });
  },
);

Given("the metric interval is {int} milliseconds", function (this: Context, intervalMs: number) {
  this.metricIntervalMs = intervalMs;
});

/** Checks that a log has at least this many metric samples between its first and its last. */
export function checkSamplesBetween(samples: readonly Sample[], count: number): void {
  const between = samples.length - 2;
  assert.ok(between >= count, `the log has ${between} metric samples between its first and its last`);
}

Then("the log has at least {int} metric samples between its first and its last", function (this: Context, count: number) {
  checkSamplesBetween(samplesOf(this), count);
});
