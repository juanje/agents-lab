import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { SLOT_TAKEN, type Seen, type Slots, holder } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { callOf, fixtureTool } from "./tool.steps.ts";

Given(
  "the sensor {string} takes no time and returns which slots are empty and which are held",
  function (this: Context, name: string) {
    const sensor = fixtureTool("sensor", name);
    assert.ok(sensor.kind === "sensor" && sensor.durationMs === 0, `the test world's "${name}" takes time`);
  },
);

Given(
  "the effector {string} takes {int} milliseconds, puts the agent in a slot when it lands, and fails with {string} when the slot is held when it lands",
  function (this: Context, name: string, durationMs: number, reason: string) {
    const effector = fixtureTool("effector", name);
    assert.equal(reason, SLOT_TAKEN);
    this.tools = this.tools.map((tool) => (tool.name === name ? { ...effector, durationMs } : tool));
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

/** The world's state at a moment of the run: its state as the run started, with every effect applied before then. */
function stateAt(context: Context, atMs: number): Slots {
  return context.applied
    .filter((applied) => applied.atMs <= atMs)
    .reduce((state, { action, args }) => action.effect(state, args as never), context.stateBefore);
}

Then(
  "slot {int} was still empty {int} milliseconds after agent {string}'s {string} call started",
  function (this: Context, slot: number, afterMs: number, agent: string, tool: string) {
    const { startedAtMs } = callOf(this, agent, tool);
    assert.equal(holder(stateAt(this, startedAtMs + afterMs), slot), null);
  },
);
