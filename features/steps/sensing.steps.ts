import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { SLOT_TAKEN, slotTools } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";

Given(
  "the sensor {string} takes {int} milliseconds and returns which slots are empty and which are held",
  function (this: Context, name: string, durationMs: number) {
    const sensor = slotTools.find((declared) => declared.name === name);
    assert.ok(sensor?.kind === "sensor", `the test world declares no sensor "${name}"`);
    this.tools = this.tools.map((tool) => (tool.name === name ? { ...sensor, durationMs } : tool));
  },
);

Given(
  "the effector {string} takes no time and puts the agent in a slot, only if that slot is empty, and otherwise fails with {string}",
  function (this: Context, name: string, reason: string) {
    // Effectors have no duration yet (FR-TOOL-04): the test world's applies its effect as soon as it is called.
    const effector = this.tools.find((declared) => declared.name === name);
    assert.equal(effector?.kind, "effector", `the test world declares no effector "${name}"`);
    assert.equal(reason, SLOT_TAKEN);
  },
);

/** The agent's only call of the tool, as the run recorded it. */
function callOf(context: Context, agent: string, tool: string) {
  assert.ok(context.toolCalls !== undefined, "the run gave no tool calls");
  const calls = context.toolCalls.filter((call) => call.agent === agent && call.tool === tool);
  assert.equal(calls.length, 1, `agent "${agent}" made ${calls.length} "${tool}" calls`);
  return calls[0];
}

Then(
  "agent {string}'s {string} call ended at least {int} milliseconds after it started",
  function (this: Context, agent: string, tool: string, durationMs: number) {
    const { startedAtMs, endedAtMs } = callOf(this, agent, tool);
    assert.ok(endedAtMs - startedAtMs >= durationMs, `the call took ${endedAtMs - startedAtMs} ms`);
  },
);
