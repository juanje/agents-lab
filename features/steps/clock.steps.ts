import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import type { ScriptedAnswer } from "../../src/engine/scripted-model.ts";
import type { EffectorCall } from "../../src/engine/tools.ts";
import { slotTools } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { script } from "./tool.steps.ts";

/** An activation whose model calls a tool with a slot after a delay, then ends its next turn without a tool call. */
function callThenEnd(tool: string, slot: number, delayMs: number): ScriptedAnswer[] {
  return [
    { toolCalls: [{ name: tool, arguments: { slot } }], delayMs },
    { text: "Done.", delayMs: 0 },
  ];
}

/** Every slot some agent's script already names, so a "free slot" is one no other call can take first. */
function namedSlots(context: Context): Set<number> {
  const answers = [...context.scripts.values()].flat();
  return new Set(answers.flatMap((answer) => (answer.toolCalls ?? []).map((call) => call.arguments.slot as number)));
}

Given(
  "agent {string} makes {int} activation(s), whose model calls {string} with slot {int} after {int} milliseconds, then ends",
  function (this: Context, agent: string, activations: number, tool: string, slot: number, delayMs: number) {
    this.activations.set(agent, activations);
    script(this, agent, Array.from({ length: activations }, () => callThenEnd(tool, slot, delayMs)).flat());
  },
);

Given(
  "agent {string} makes {int} activation(s), whose model calls {string} with a free slot after {int} milliseconds, then ends",
  function (this: Context, agent: string, activations: number, tool: string, delayMs: number) {
    const named = namedSlots(this);
    const free = this.world.state.flatMap((holder, index) => (holder === null && !named.has(index + 1) ? [index + 1] : []));
    assert.ok(free.length >= activations, `the test world has ${free.length} free slots for ${activations} activations`);
    this.activations.set(agent, activations);
    script(this, agent, free.slice(0, activations).flatMap((slot) => callThenEnd(tool, slot, delayMs)));
  },
);

Given("both agents wait {int} milliseconds between activations", function (this: Context, waitMs: number) {
  assert.equal(this.models.size, 2, `the scenario has ${this.models.size} agents, not 2`);
  for (const agent of this.models.keys()) this.rhythms.set(agent, () => waitMs);
});

/** The agents whose calls of an effector the arbiter applied, in the order it applied them. */
function appliedCallsOf(context: Context, tool: string): string[] {
  const effector = slotTools.find((declared) => declared.name === tool);
  assert.ok(effector?.kind === "effector", `the test world declares no effector "${tool}"`);
  return context.applied.filter(({ action }) => action === effector.action).map(({ args }) => (args as EffectorCall).agent);
}

Then(
  "all {int} of agent {string}'s {string} calls were applied before agent {string}'s",
  function (this: Context, count: number, agent: string, tool: string, other: string) {
    const order = appliedCallsOf(this, tool);
    const positions = (name: string) => order.flatMap((applied, index) => (applied === name ? [index] : []));
    const mine = positions(agent);
    const theirs = positions(other);
    assert.equal(mine.length, count, `the arbiter applied ${mine.length} of agent "${agent}"'s "${tool}" calls, in ${JSON.stringify(order)}`);
    assert.ok(theirs.length > 0, `the arbiter applied none of agent "${other}"'s "${tool}" calls`);
    assert.ok(Math.max(...mine) < Math.min(...theirs), `the arbiter applied "${tool}" calls in the order ${JSON.stringify(order)}`);
  },
);
