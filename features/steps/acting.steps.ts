import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import type { Action } from "../../src/engine/world.ts";
import { SLOT_TAKEN, type Seen, type Slots, holder } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { turnsOf } from "./adapter.steps.ts";
import { callOf, callThenEnd, fixtureTool, script, takeTime } from "./tool.steps.ts";

Given(
  "the sensor {string} takes no time and returns which slots are empty and which are held",
  function (this: Context, name: string) {
    const sensor = fixtureTool("sensor", name);
    // It takes no time for any call, in any state: the test world's "look" gives its duration from neither.
    assert.ok(sensor.kind === "sensor" && sensor.durationMs([null], { agent: "a", arguments: {} }) === 0, `the test world's "${name}" takes time`);
  },
);

Given(
  "the effector {string} takes {int} milliseconds, puts the agent in a slot when it lands, and fails with {string} when the slot is held when it lands",
  function (this: Context, name: string, durationMs: number, reason: string) {
    assert.equal(reason, SLOT_TAKEN);
    takeTime(this, "effector", name, durationMs);
  },
);

Given(
  "the target of {string}, in the agent's last sensing, is the slot it names",
  function (this: Context, name: string) {
    const effector = fixtureTool("effector", name);
    assert.ok(effector.kind === "effector" && typeof effector.readTarget === "function", `"${name}" declares no way to read its target`);
    // Each slot in turn is the only one held: the call that names it reads "held", any other reads "free".
    for (let held = 1; held <= 3; held += 1) {
      const seen: Seen[] = [1, 2, 3].map((slot) => (slot === held ? "held" : "empty"));
      const sensing = { tool: "look", result: JSON.stringify(seen), atMs: 0 };
      for (let slot = 1; slot <= 3; slot += 1) {
        const read: string = effector.readTarget(sensing, { agent: "a", arguments: { slot } });
        assert.equal(read, slot === held ? "held" : "free", `"${name}" of slot ${slot} reads "${read}" when slot ${held} is held`);
      }
    }
  },
);

Then(
  "agent {string}'s second model turn began after its {string} call ended",
  function (this: Context, agent: string, tool: string) {
    const second = turnsOf(this, agent)[1];
    assert.ok(second !== undefined, `agent "${agent}" made no second model turn`);
    const { endedAtMs } = callOf(this, agent, tool);
    assert.ok(second.startedAtMs >= endedAtMs, `the second turn began ${endedAtMs - second.startedAtMs} ms before the call ended`);
  },
);

Given(
  "agent {string}'s {string} of slot {int} lands while agent {string}'s {string} is under way",
  function (this: Context, agent: string, tool: string, slot: number, other: string, otherTool: string) {
    const declared = this.tools.find((candidate) => candidate.name === tool);
    assert.ok(declared?.kind === "effector", `the test world declares no effector "${tool}"`);
    const durationMs = declared.durationMs(this.world.state, { agent, arguments: { slot } });
    assert.ok(durationMs > 0, `"${tool}" takes no time for a call to land in`);
    script(this, agent, callThenEnd(tool, slot, 0));
    // The other agent wakes halfway through this call, so its own call, which takes as long, starts before this one
    // lands and ends after. The check below makes sure it did.
    this.rhythms.set(other, () => durationMs / 2);
    this.setupChecks.push(() => {
      const landed = callOf(this, agent, tool);
      const underWay = callOf(this, other, otherTool);
      assert.equal(landed.outcome, "success", `agent "${agent}"'s "${tool}" did not land`);
      assert.ok(
        underWay.startedAtMs < landed.endedAtMs && landed.endedAtMs < underWay.endedAtMs,
        `agent "${agent}"'s "${tool}" did not land while agent "${other}"'s was under way`,
      );
    });
  },
);

Given(
  "agent {string} runs on a scripted model that calls {string}, then calls {string} with slot {int}, then ends without a tool call",
  function (this: Context, agent: string, sensor: string, effector: string, slot: number) {
    script(this, agent, [
      { toolCalls: [{ name: sensor, arguments: {} }], delayMs: 0 },
      { toolCalls: [{ name: effector, arguments: { slot } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
  },
);

Given(
  "agent {string} runs on a scripted model that calls {string} with slot {int} without looking, then ends without a tool call",
  function (this: Context, agent: string, effector: string, slot: number) {
    script(this, agent, callThenEnd(effector, slot, 0));
  },
);

Then("agent {string}'s {string} call failed with {string}", function (this: Context, agent: string, tool: string, reason: string) {
  assert.equal(callOf(this, agent, tool).outcome, reason);
});

Then(
  "agent {string}'s {string} call recorded its target as sensed: {string}",
  function (this: Context, agent: string, tool: string, sensed: string) {
    assert.equal(callOf(this, agent, tool).targetAsSensed, sensed);
  },
);

/**
 * The world's state at a moment of the run: its state as the run started, with every effect applied before then. The
 * caller names the state the scenario's world holds.
 */
export function stateAt<State>(context: Context, atMs: number): State {
  return context.applied
    .filter((applied) => applied.atMs <= atMs)
    .reduce((state, { action, args }) => (action as Action<State, never>).effect(state, args as never), context.stateBefore as State);
}

Then(
  "slot {int} was still empty {int} milliseconds after agent {string}'s {string} call started",
  function (this: Context, slot: number, afterMs: number, agent: string, tool: string) {
    const { startedAtMs } = callOf(this, agent, tool);
    assert.equal(holder(stateAt<Slots>(this, startedAtMs + afterMs), slot), null);
  },
);
