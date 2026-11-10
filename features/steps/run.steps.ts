import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type Decision, run } from "../../src/engine/run.ts";
import { ScriptedModel } from "../../src/engine/scripted-model.ts";
import type { Context } from "../support/context.ts";

Given(
  "agent {string} runs on a scripted model that answers {string}, then {string}",
  function (this: Context, agent: string, first: string, second: string) {
    this.models.set(agent, new ScriptedModel([first, second].map((text) => ({ text, delayMs: 0 }))));
  },
);

Given(
  "agent {string} runs on a scripted model that answers {string} after {int} milliseconds",
  function (this: Context, agent: string, text: string, delayMs: number) {
    this.models.set(agent, new ScriptedModel([{ text, delayMs }]));
  },
);

Given(
  "agent {string} runs on a scripted model that answers {string}",
  function (this: Context, agent: string, text: string) {
    this.models.set(agent, new ScriptedModel([{ text, delayMs: 0 }]));
  },
);

Given("agent {string} makes {int} decision(s)", function (this: Context, agent: string, decisions: number) {
  this.budgets.set(agent, decisions);
});

/** Gives an agent a script with one answer per decision, each after the same delay. */
function scriptEachDecision(context: Context, agent: string, text: string, delayMs: number, decisions: number): void {
  context.models.set(agent, new ScriptedModel(Array.from({ length: decisions }, () => ({ text, delayMs }))));
  context.budgets.set(agent, decisions);
}

Given(
  "agent {string} runs on a scripted model that answers {string} after {int} milliseconds, and makes {int} decision(s)",
  function (this: Context, agent: string, text: string, delayMs: number, decisions: number) {
    scriptEachDecision(this, agent, text, delayMs, decisions);
  },
);

Given(
  "agent {string} runs on a scripted model that answers {string} after {int} milliseconds each time, and makes {int} decision(s)",
  function (this: Context, agent: string, text: string, delayMs: number, decisions: number) {
    scriptEachDecision(this, agent, text, delayMs, decisions);
  },
);

Given(
  "agent {string} runs on a scripted model that answers {string} with no delay, and makes {int} decision(s)",
  function (this: Context, agent: string, text: string, decisions: number) {
    scriptEachDecision(this, agent, text, 0, decisions);
  },
);

Given("agent {string} waits {int} milliseconds between decisions", function (this: Context, agent: string, intervalMs: number) {
  this.intervals.set(agent, intervalMs);
});

Then(
  "each of agent {string}'s decisions was observed at least {int} milliseconds after the previous one was applied",
  function (this: Context, agent: string, intervalMs: number) {
    const decisions = this.decisions.get(agent) ?? [];
    assert.ok(decisions.length > 1, `expected several decisions of "${agent}", got ${decisions.length}`);
    for (const [index, decision] of decisions.slice(1).entries()) {
      const previous = decisions[index];
      const gapMs = (decision.observedAtMs ?? -Infinity) - (previous.actedAtMs ?? Infinity);
      assert.ok(
        gapMs >= intervalMs,
        `expected decision ${index + 2} observed at least ${intervalMs} ms after decision ${index + 1} was applied, got ${gapMs} ms`,
      );
    }
  },
);

Given("both agents wait {int} milliseconds between decisions", function (this: Context, intervalMs: number) {
  assert.equal(this.models.size, 2, "the scenario names two agents before their interval");
  for (const agent of this.models.keys()) this.intervals.set(agent, intervalMs);
});

Then(
  "all {int} of agent {string}'s decisions were applied before agent {string}'s decision was applied",
  function (this: Context, count: number, fast: string, slow: string) {
    const fastDecisions = this.decisions.get(fast) ?? [];
    const [slowDecision] = this.decisions.get(slow) ?? [];
    assert.equal(fastDecisions.length, count);
    assert.deepEqual(
      fastDecisions.map((decision) => decision.outcome),
      Array.from({ length: count }, () => "success"),
    );
    assert.equal(slowDecision?.outcome, "success");
    const fastActed = fastDecisions.map((decision) => decision.actedAtMs);
    assert.ok(
      fastActed.every((actedAtMs) => actedAtMs !== undefined && actedAtMs < (slowDecision?.actedAtMs ?? -Infinity)),
      `expected every decision of "${fast}" (applied at ${fastActed.join(", ")} ms) before "${slow}"'s (applied at ${slowDecision?.actedAtMs} ms)`,
    );
  },
);

When("the run ends", async function (this: Context) {
  // An agent the scenario gives no interval decides again as soon as its previous decision ends.
  const agents = [...this.models].map(([name, model]) => ({
    name,
    model,
    decisions: this.budgets.get(name) ?? 0,
    rhythm: () => this.intervals.get(name) ?? 0,
  }));
  // Any seed: these rhythms draw nothing from it.
  this.decisions = await run(this.world, this.actions, agents, 1);
});

Then(
  "agent {string}'s decisions had the answers {string} and {string}, in that order",
  function (this: Context, agent: string, first: string, second: string) {
    assert.deepEqual(
      this.decisions.get(agent)?.map((decision) => decision.answer),
      [first, second],
    );
  },
);

Then(
  "agent {string}'s decision had a model latency of at least {int} milliseconds",
  function (this: Context, agent: string, latencyMs: number) {
    const [decision] = this.decisions.get(agent) ?? [];
    assert.ok(
      decision?.latencyMs !== undefined && decision.latencyMs >= latencyMs,
      `expected a latency of at least ${latencyMs} ms, got ${decision?.latencyMs}`,
    );
  },
);

/** The single decision an agent made in the run. */
function onlyDecision(context: Context, agent: string): Decision {
  const decisions = context.decisions.get(agent) ?? [];
  assert.equal(decisions.length, 1, `expected one decision of "${agent}", got ${decisions.length}`);
  return decisions[0];
}

Then("agent {string}'s decision succeeded", function (this: Context, agent: string) {
  assert.equal(onlyDecision(this, agent).outcome, "success");
});

Then("agent {string}'s decision failed with {string}", function (this: Context, agent: string, reason: string) {
  assert.equal(onlyDecision(this, agent).outcome, reason);
});

Then("agent {string}'s second decision has the outcome {string}", function (this: Context, agent: string, outcome: string) {
  assert.equal(this.decisions.get(agent)?.[1]?.outcome, outcome);
});
