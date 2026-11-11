import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { labModel } from "../../src/engine/adapter.ts";
import { loadScenario } from "../../src/engine/scenario.ts";
import { RHYTHM_CHANNEL } from "../../src/engine/stimuli.ts";
import { summarize } from "../../src/analysis/summary.ts";
import { SLOT_TAKEN, slotsScenario } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { asRead } from "./stimulus.steps.ts";
import { turnsOf } from "./adapter.steps.ts";

/** The environment variable that names the smoke run's real model, in Pi's provider/id form. */
const SMOKE_MODEL = "AGENTS_LAB_SMOKE_MODEL";

/** What a resident of the slots world is told: who it is and what it wants, not how to get it. */
const RESIDENT_PROMPT = [
  "You are a resident of a world of numbered slots, counted from 1.",
  "You want a slot of your own. Other residents may want one too.",
  "Use your tools to find out which slots are empty and to take one.",
  "When you have nothing more to do, answer without calling a tool.",
].join("\n");

/**
 * The outcomes a tool call can have in the slots world: the engine's own, and the one failure reason the scenario's
 * effector gives. Tools do not declare their failure reasons yet (FR-TOOL-04), so the scenario's is listed here.
 */
const DECLARED_OUTCOMES = new Set(["success", "invalid_arguments", "unknown_tool", SLOT_TAKEN]);

Given(
  "the test scenario {string} with {int} slots, whose system prompt describes a resident who wants a slot of its own",
  function (this: Context, name: string, count: number) {
    assert.equal(name, slotsScenario.name);
    // Loaded once the agents are named, as the scenario declares the agents that run.
    this.scenario = { ...slotsScenario, systemPrompt: () => RESIDENT_PROMPT };
    this.condition = { name: `${count} slots`, change: `[slots]\ncount = ${count}\n` };
  },
);

Given(
  /^agents "([^"]+)" and "([^"]+)" run on the real model named by AGENTS_LAB_SMOKE_MODEL, through the lab's Pi login$/,
  async function (this: Context, first: string, second: string) {
    const name = process.env[SMOKE_MODEL];
    assert.ok(name !== undefined && name !== "", `${SMOKE_MODEL} names no model: set it to one in Pi's provider/id form`);
    // A real model answers in seconds, not milliseconds; the turn timeout only catches a call that hangs.
    this.modelTurnTimeoutMs = 120_000;
    for (const agent of [first, second]) this.realModels.set(agent, await labModel(name));
    const { condition } = this;
    assert.ok(condition !== undefined, "the scenario gives the slots world before its agents");
    const declared = { ...condition, change: `agents = ${JSON.stringify([first, second])}\n${condition.change}` };
    this.loaded = loadScenario(this.scenario, this.seed, declared);
    this.world = this.loaded.world;
  },
);

Given("each makes {int} activations, waiting {int} second(s) between them", function (this: Context, count: number, seconds: number) {
  for (const agent of this.realModels.keys()) {
    this.activations.set(agent, count);
    this.rhythms.set(agent, () => seconds * 1000);
  }
});

/** The text of a message an agent's session held, when it is a stimulus or a user message. */
function stimulusText(message: { role: string; content?: unknown }): string | undefined {
  if (message.role !== "custom" && message.role !== "user") return undefined;
  if (typeof message.content === "string") return message.content;
  return (message.content as { type: string; text?: string }[]).flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

/** Whether a message is a model turn that called no tool, which ends an activation. */
function endsActivation(message: { role: string; content?: unknown }): boolean {
  return message.role === "assistant" && !(message.content as { type: string }[]).some((block) => block.type === "toolCall");
}

Then("each agent's activations began with its rhythm stimulus", function (this: Context) {
  const rhythm = this.loaded?.channels.find((channel) => channel.name === RHYTHM_CHANNEL);
  assert.ok(rhythm !== undefined, "the loaded scenario declares no rhythm channel");
  for (const agent of this.realModels.keys()) {
    // The session's system message holds its prompt and tools; it comes before any activation.
    const messages = (this.sessionMessages?.get(agent) ?? []).filter((message) => message.role !== "system");
    // An activation begins with the session's first message, and again after each model turn that called no tool.
    const starts = messages.flatMap((message, index) => (index === 0 || endsActivation(messages[index - 1]) ? [message] : []));
    assert.equal(starts.length, this.activations.get(agent), `agent "${agent}" made another number of activations`);
    for (const [index, start] of starts.entries()) {
      assert.equal(stimulusText(start), asRead(rhythm.source, rhythm.stimulus), `agent "${agent}"'s activation ${index + 1} began with another message`);
    }
  }
});

Then("each agent made at least one model turn with the outcome {string}", function (this: Context, outcome: string) {
  for (const agent of this.realModels.keys()) {
    const outcomes = turnsOf(this, agent).map((turn) => turn.outcome);
    assert.ok(outcomes.includes(outcome as never), `agent "${agent}"'s model turns had the outcomes ${JSON.stringify(outcomes)}`);
  }
});

Then("each agent made at least one tool call, and every tool call has an outcome from the declared set", function (this: Context) {
  for (const agent of this.realModels.keys()) {
    assert.ok(this.toolCalls?.some((call) => call.agent === agent), `agent "${agent}" made no tool call`);
  }
  for (const call of this.toolCalls ?? []) {
    assert.ok(DECLARED_OUTCOMES.has(call.outcome), `agent "${call.agent}"'s "${call.tool}" call has the undeclared outcome "${call.outcome}"`);
  }
});

Then("the run printed each agent's model turns with their latencies and its tool calls with their outcomes", function (this: Context) {
  assert.ok(this.turns !== undefined && this.toolCalls !== undefined, "the run gave no result");
  const printed = summarize({ turns: this.turns, toolCalls: this.toolCalls });
  console.log(`\n${printed}`);
  for (const agent of this.realModels.keys()) {
    const section = sectionOf(printed, agent);
    for (const turn of turnsOf(this, agent)) {
      const latency = `${Math.round(turn.endedAtMs - turn.startedAtMs)} ms`;
      assert.ok(section.includes(`${turn.outcome}, ${latency}`), `agent "${agent}"'s ${turn.outcome} turn of ${latency} was not printed`);
    }
    for (const call of this.toolCalls.filter((made) => made.agent === agent)) {
      assert.ok(section.includes(`${call.tool} ${JSON.stringify(call.arguments)} → ${call.outcome}`), `agent "${agent}"'s "${call.tool}" call was not printed`);
    }
  }
});

/** The part of a printed run that speaks of one agent: from its heading to the next agent's. */
function sectionOf(printed: string, agent: string): string {
  const [, after] = printed.split(`agent "${agent}"\n`);
  assert.ok(after !== undefined, `the run printed nothing for agent "${agent}"`);
  return after.split(/^agent "/m)[0];
}
