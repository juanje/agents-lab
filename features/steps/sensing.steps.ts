import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { SLOT_TAKEN, type Seen } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { callOf, fixtureTool, returned, script } from "./tool.steps.ts";

Given(
  "the sensor {string} takes {int} milliseconds and returns which slots are empty and which are held",
  function (this: Context, name: string, durationMs: number) {
    const sensor = fixtureTool("sensor", name);
    this.tools = this.tools.map((tool) => (tool.name === name ? { ...sensor, durationMs } : tool));
  },
);

Given(
  "the effector {string} takes no time and puts the agent in a slot, only if that slot is empty, and otherwise fails with {string}",
  function (this: Context, name: string, reason: string) {
    // Effectors have no duration yet (FR-TOOL-04): the test world's applies its effect as soon as it is called.
    fixtureTool("effector", name);
    assert.equal(reason, SLOT_TAKEN);
  },
);

Then(
  "agent {string}'s {string} call ended at least {int} milliseconds after it started",
  function (this: Context, agent: string, tool: string, durationMs: number) {
    const { startedAtMs, endedAtMs } = callOf(this, agent, tool);
    assert.ok(endedAtMs - startedAtMs >= durationMs, `the call took ${endedAtMs - startedAtMs} ms`);
  },
);

Given(
  "agent {string} runs on a scripted model that calls {string} with slot {int} while agent {string}'s {string} call is under way",
  function (this: Context, agent: string, tool: string, slot: number, _other: string, sensor: string) {
    const declared = this.tools.find((candidate) => candidate.name === sensor);
    assert.ok(declared?.kind === "sensor" && declared.durationMs > 0, `"${sensor}" takes no time for a call to land in`);
    // Both agents wake at once, and the other agent's call starts as its first turn ends at once: this call lands halfway
    // through it. The step that checks the result checks that it did.
    script(this, agent, [
      { toolCalls: [{ name: tool, arguments: { slot } }], delayMs: declared.durationMs / 2 },
      { text: "Done.", delayMs: 0 },
    ]);
  },
);

Then(
  "agent {string}'s {string} call returned slot {int} held",
  function (this: Context, agent: string, tool: string, slot: number) {
    const sensed = callOf(this, agent, tool);
    // The slot was empty when the call started: only a "take" that landed while it was under way can have filled it.
    const landed = this.toolCalls?.filter((call) => call.tool === "take" && call.outcome === "success") ?? [];
    assert.ok(
      landed.some((call) => sensed.startedAtMs < call.endedAtMs && call.endedAtMs < sensed.endedAtMs),
      `no "take" landed while agent "${agent}"'s "${tool}" was under way`,
    );
    assert.equal((JSON.parse(returned(this, agent, tool)) as Seen[])[slot - 1], "held");
  },
);

Then(
  "the engine's last sensing for agent {string} is the result of its {string} call, at the moment that call ended",
  function (this: Context, agent: string, tool: string) {
    assert.ok(this.sensings !== undefined, "the run gave no sensings");
    assert.deepEqual(this.sensings.last(agent), { tool, result: returned(this, agent, tool), atMs: callOf(this, agent, tool).endedAtMs });
  },
);
