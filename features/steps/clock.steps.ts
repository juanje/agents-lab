import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import type { ScriptedAnswer } from "../../src/engine/scripted-model.ts";
import type { EffectorCall } from "../../src/engine/tools.ts";
import { slotTools } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { turnsOf } from "./adapter.steps.ts";
import { modelOf, scriptActivations } from "./tool.steps.ts";

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
    scriptActivations(this, agent, activations, () => callThenEnd(tool, slot, delayMs));
  },
);

Given(
  "agent {string} makes {int} activation(s), whose model calls {string} with a free slot after {int} milliseconds, then ends",
  function (this: Context, agent: string, activations: number, tool: string, delayMs: number) {
    const named = namedSlots(this);
    const free = this.world.state.flatMap((holder, index) => (holder === null && !named.has(index + 1) ? [index + 1] : []));
    assert.ok(free.length >= activations, `the test world has ${free.length} free slots for ${activations} activations`);
    scriptActivations(this, agent, activations, (index) => callThenEnd(tool, free[index], delayMs));
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

Given(
  "agent {string} makes {int} activation(s), whose turns are: a call to {string}; a call to {string}; the text {string} with no tool call",
  function (this: Context, agent: string, activations: number, first: string, second: string, text: string) {
    scriptActivations(this, agent, activations, () => [
      { toolCalls: [{ name: first, arguments: {} }], delayMs: 0 },
      { toolCalls: [{ name: second, arguments: {} }], delayMs: 0 },
      { text, delayMs: 0 },
    ]);
  },
);

Then("agent {string}'s activation ended after its third model turn", function (this: Context, agent: string) {
  // The script holds three answers: a fourth turn would have been recorded as script_exhausted.
  assert.deepEqual(turnsOf(this, agent).map((turn) => turn.outcome), ["success", "success", "success"]);
  const [, , third] = this.scripts.get(agent) ?? [];
  assert.deepEqual(third?.toolCalls ?? [], [], `agent "${agent}"'s third model turn made a tool call`);
});

Given(
  "agent {string} makes {int} activations, each ending its first turn without a tool call",
  function (this: Context, agent: string, activations: number) {
    scriptActivations(this, agent, activations, () => [{ text: "Nothing to do.", delayMs: 0 }]);
  },
);

Given("agent {string} waits {int} milliseconds between activations", function (this: Context, agent: string, waitMs: number) {
  const rests: number[] = [];
  this.restedAtMs.set(agent, rests);
  // The agent's loop calls its rhythm once the previous activation has ended, as the agent starts to rest.
  this.rhythms.set(agent, () => (rests.push(performance.now()), waitMs));
});

Then(
  "each of agent {string}'s activations began at least {int} milliseconds after the previous one ended",
  function (this: Context, agent: string, waitMs: number) {
    const rests = this.restedAtMs.get(agent) ?? [];
    const wakes = this.wokeAtMs.get(agent) ?? [];
    const activations = this.activations.get(agent);
    assert.equal(wakes.length, activations, `agent "${agent}" woke ${wakes.length} times, not ${activations}`);
    assert.equal(rests.length, activations, `agent "${agent}" rested ${rests.length} times, not ${activations}`);
    // A rest starts no sooner than the previous activation ended, so the time from it to the next wake is never longer
    // than the time between the two activations.
    for (let index = 1; index < wakes.length; index += 1) {
      const gap = wakes[index] - rests[index];
      assert.ok(gap >= waitMs, `activation ${index + 1} of agent "${agent}" began ${gap} ms after activation ${index} ended`);
    }
  },
);

Given(
  "agents {string} and {string} each make {int} activation(s), ending its first turn without a tool call",
  function (this: Context, first: string, second: string, activations: number) {
    for (const agent of [first, second]) scriptActivations(this, agent, activations, () => [{ text: "Nothing to do.", delayMs: 0 }]);
  },
);

Given(
  "each agent waits a random interval between {int} and {int} milliseconds before each activation",
  function (this: Context, minMs: number, maxMs: number) {
    for (const agent of this.models.keys()) {
      const rests: number[] = [];
      const drawn: number[] = [];
      this.restedAtMs.set(agent, rests);
      this.drawnMs.set(agent, drawn);
      this.rhythms.set(agent, (random) => {
        rests.push(performance.now());
        drawn.push(minMs + random.next() * (maxMs - minMs));
        return drawn[drawn.length - 1];
      });
    }
  },
);

Given("the run's seed is {int}", function (this: Context, seed: number) {
  this.seed = seed;
});

Then(
  "each agent's first activation began at least the first interval of its rhythm after the run started",
  function (this: Context) {
    for (const agent of this.models.keys()) {
      const [rested] = this.restedAtMs.get(agent) ?? [];
      const [intervalMs] = this.drawnMs.get(agent) ?? [];
      const [woke] = this.wokeAtMs.get(agent) ?? [];
      assert.ok(rested !== undefined && intervalMs !== undefined, `agent "${agent}"'s rhythm drew no interval before its first activation`);
      assert.ok(woke !== undefined, `agent "${agent}" never woke`);
      // The first rest starts no sooner than the run did, so the time from it to the first wake is never longer than
      // the time from the run's start.
      assert.ok(woke - rested >= intervalMs, `agent "${agent}" woke ${woke - rested} ms into a first rest of ${intervalMs} ms`);
    }
  },
);

Then(
  "agent {string}'s and agent {string}'s first activations began at different moments",
  function (this: Context, first: string, second: string) {
    const [one] = this.wokeAtMs.get(first) ?? [];
    const [other] = this.wokeAtMs.get(second) ?? [];
    assert.ok(one !== undefined && other !== undefined, `agents "${first}" and "${second}" did not both wake`);
    assert.notEqual(one, other, `agents "${first}" and "${second}" woke at the same moment, ${one} ms`);
  },
);

Then(
  "the model turn of agent {string}'s second activation received the {string} result of its first activation",
  function (this: Context, agent: string, tool: string) {
    // The first activation is two turns, a call and its end; the second activation's model turn is the third.
    const [, end, second] = modelOf(this, agent).received;
    assert.ok(second !== undefined, `agent "${agent}"'s second activation made no model turn`);
    const result = end?.find((message) => message.role === "toolResult" && message.toolName === tool);
    assert.ok(result !== undefined, `agent "${agent}"'s first activation got no "${tool}" result`);
    assert.ok(
      second.some((message) => JSON.stringify(message) === JSON.stringify(result)),
      `the model turn of agent "${agent}"'s second activation did not receive the "${tool}" result of its first`,
    );
  },
);
