import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import type { Scenario } from "../../src/engine/scenario.ts";
import type { Effector } from "../../src/engine/tools.ts";
import { type Slots, slotsScenario, take } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { logLines } from "./record.steps.ts";
import { asRead, userTexts } from "./stimulus.steps.ts";
import { callOf, callThenEnd, callWithThenEnd, modelOf, runTheScenario, script, scriptActivations } from "./tool.steps.ts";

/** The scenario's effector of a name, which must be declared. */
function effectorOf(context: Context, name: string): Effector<Slots> {
  const tool = context.tools.find((declared) => declared.name === name);
  assert.ok(tool?.kind === "effector", `the scenario declares no effector "${name}"`);
  return tool;
}

/** Replaces the scenario's effector of a name with what the change makes of it. */
function changeEffector(context: Context, name: string, change: (effector: Effector<Slots>) => Effector<Slots>): void {
  const changed = change(effectorOf(context, name));
  context.tools = context.tools.map((tool) => (tool.name === name ? changed : tool));
}

/**
 * Lists the scenario, as its steps set it up, for "lab inventory": the slots test scenario with the tools and the
 * channels the steps declare, read when it is listed.
 */
function listedAsSetUp(context: Context): void {
  const scenario: Partial<Scenario<Slots>> = {
    ...slotsScenario,
    channels: (configuration) => [...slotsScenario.channels(configuration), ...context.channels.filter(({ name }) => name !== "rhythm")],
  };
  Object.defineProperty(scenario, "tools", { get: () => context.tools, enumerable: true });
  context.libraryScenario = scenario as never;
}

Given("agents {string}, {string} and {string}", function (this: Context, first: string, second: string, third: string) {
  // Each ends its turns without a tool call, unless the scenario scripts it otherwise.
  for (const agent of [first, second, third]) script(this, agent, [{ text: "Nothing to do.", delayMs: 0 }]);
});

Given(
  "when the effect of {string} is applied, it delivers on the channel {string}, to every other agent, the stimulus with the claimed slot, from the claiming agent as its source",
  function (this: Context, name: string, channel: string) {
    changeEffector(this, name, (effector) => ({
      ...effector,
      delivers: {
        channel,
        deliveries: (_state, call) =>
          [...this.models.keys()].filter((agent) => agent !== call.agent).map((agent) => ({ agent, source: call.agent, values: { slot: String(call.arguments.slot) } })),
      },
    }));
    listedAsSetUp(this);
  },
);

Given(
  "the effector {string} takes {int} milliseconds, changes nothing, and ends early with the outcome {string} when a stimulus reaches its agent",
  function (this: Context, name: string, durationMs: number, outcome: string) {
    const nap: Effector<Slots> = {
      kind: "effector",
      name,
      description: "Rest a while.",
      parameters: { type: "object", properties: {} },
      durationMs: () => durationMs,
      endsEarly: { outcome, byChange: () => false, byStimulus: () => true },
      readTarget: () => "not_sensed",
    };
    this.tools = [...this.tools.filter((tool) => tool.name !== name), nap];
  },
);

/** Gives each agent named a script whose turns each end without a tool call, one activation for each. */
function turnsWithoutCalls(context: Context, agents: readonly string[], turns: readonly { text: string; delayMs: number }[]): void {
  for (const agent of agents) scriptActivations(context, agent, turns.length, (index) => [turns[index]]);
}

Given(
  "agents {string} and {string} run on scripted models whose turns are: the text {string} with no tool call, after {int} milliseconds; the text {string} with no tool call",
  function (this: Context, first: string, second: string, text: string, delayMs: number, then: string) {
    // A turn without a tool call ends its activation, so each turn is one activation.
    turnsWithoutCalls(this, [first, second], [
      { text, delayMs },
      { text: then, delayMs: 0 },
    ]);
  },
);

Given("agents {string} and {string} run on scripted models that end every turn without a tool call", function (this: Context, first: string, second: string) {
  for (const agent of [first, second]) script(this, agent, [{ text: "Nothing to do.", delayMs: 0 }]);
});

Given("slot {int} is held by {string}", function (this: Context, slot: number, thing: string) {
  // The arbiter is the only writer, so the setup goes through it too.
  assert.deepEqual(this.world.apply(take, { agent: thing, slot }), { applied: true });
});

Given(
  "agent {string} waits {int} milliseconds before each activation and ends its first turn without a tool call",
  function (this: Context, agent: string, waitMs: number) {
    this.rhythms.set(agent, () => waitMs);
    script(this, agent, [{ text: "Nothing to do.", delayMs: 0 }]);
  },
);

Given("the channel {string} wakes", function (this: Context, name: string) {
  const index = this.channels.findIndex((channel) => channel.name === name);
  assert.ok(index !== -1, `the scenario declares no channel "${name}"`);
  this.channels[index] = { ...this.channels[index], wakes: true };
});

Given(
  "agent {string} runs on a scripted model that calls {string} with slot {int} after {int} milliseconds, then ends without a tool call",
  function (this: Context, agent: string, tool: string, slot: number, delayMs: number) {
    script(this, agent, callThenEnd(tool, slot, delayMs));
  },
);

Given("agent {string} runs on a scripted model that calls {string} at once, then ends without a tool call", function (this: Context, agent: string, tool: string) {
  script(this, agent, callWithThenEnd(tool, {}, 0));
});

Given(
  'the effect of {string} delivers on the channel {string} instead, which the scenario does not declare',
  function (this: Context, name: string, channel: string) {
    assert.ok(!this.channels.some((declared) => declared.name === channel), `the scenario declares the channel "${channel}"`);
    changeEffector(this, name, (effector) => ({ ...effector, delivers: { ...(effector.delivers as NonNullable<Effector<Slots>["delivers"]>), channel } }));
  },
);

Given(/^the effect of "([^"]*)" delivers to (?:its own caller, )?"([^"]*)"(?:, which is no agent)? instead$/, function (this: Context, name: string, recipient: string) {
  changeEffector(this, name, (effector) => ({
    ...effector,
    delivers: { ...(effector.delivers as NonNullable<Effector<Slots>["delivers"]>), deliveries: (_state, call) => [{ agent: recipient, source: call.agent, values: { slot: String(call.arguments.slot) } }] },
  }));
  // A run that stops leaves its error for the steps that check it.
  this.runInstead = async () => {
    this.runInstead = undefined;
    try {
      await runTheScenario(this);
    } catch (error) {
      this.runError = error as Error;
    }
  };
});

/** The stimulus lines of the run's log on a channel. */
function stimulusLinesOn(context: Context, channel: string) {
  return logLines(context).filter((line) => line.type === "stimulus" && line.channel === channel);
}

Then("agent {string} received no stimulus on the channel {string}", function (this: Context, agent: string, channel: string) {
  const lines = stimulusLinesOn(this, channel).filter((line) => line.agent === agent);
  assert.deepEqual(lines, [], `agent "${agent}" received stimuli on the channel "${channel}"`);
  const declared = this.channels.find((each) => each.name === channel);
  assert.ok(declared !== undefined, `the scenario declares no channel "${channel}"`);
  // Nor did its model read one: no message it received comes from the channel.
  const read = modelOf(this, agent).received.flatMap((messages) => messages.filter((message) => message.role === "custom" || message.role === "user"));
  const fromChannel = read.filter((message) => JSON.stringify(message).includes(declared.stimulus.split("{")[0]));
  assert.deepEqual(fromChannel, [], `agent "${agent}"'s model read a stimulus on the channel "${channel}"`);
});

Then(
  "the log has a stimulus line for agent {string} and one for agent {string}, each with the channel {string}, the source {string} and the content {string}",
  function (this: Context, first: string, second: string, channel: string, source: string, content: string) {
    for (const agent of [first, second]) {
      const lines = stimulusLinesOn(this, channel).filter((line) => line.agent === agent);
      assert.equal(lines.length, 1, `the log has ${lines.length} stimulus lines for agent "${agent}" on the channel "${channel}"`);
      assert.deepEqual({ source: lines[0].source, content: lines[0].content }, { source, content });
      assert.equal(typeof lines[0].deliveredAtMs, "number", `the stimulus line gives no time: ${JSON.stringify(lines[0])}`);
    }
  },
);

Then(
  "each was delivered no earlier than the end of agent {string}'s {string} call, and within {int} milliseconds of it",
  function (this: Context, agent: string, tool: string, withinMs: number) {
    const { endedAtMs } = callOf(this, agent, tool);
    const lines = stimulusLinesOn(this, "news");
    assert.ok(lines.length > 0, "the log has no stimulus line on the channel \"news\"");
    for (const line of lines) {
      const afterMs = (line.deliveredAtMs as number) - endedAtMs;
      assert.ok(afterMs >= 0 && afterMs <= withinMs, `agent "${line.agent}"'s stimulus was delivered ${afterMs} ms after the call ended`);
    }
  },
);

Then("the log has no stimulus line on the channel {string}", function (this: Context, channel: string) {
  assert.deepEqual(stimulusLinesOn(this, channel), []);
});

/** The activation lines of an agent in the run's log, in order. */
function activationsOf(context: Context, agent: string) {
  return logLines(context).filter((line) => line.type === "activation" && line.agent === agent) as unknown as { wokeAtMs: number; endedAtMs: number }[];
}

Then("agent {string}'s first activation began no earlier than {int} milliseconds into the run", function (this: Context, agent: string, ms: number) {
  assert.ok(this.runStartedAtMs !== undefined, "the run gave no start");
  const [first] = activationsOf(this, agent);
  assert.ok(first !== undefined, `agent "${agent}" made no activation`);
  const after = first.wokeAtMs - this.runStartedAtMs;
  assert.ok(after >= ms, `agent "${agent}"'s first activation began ${after} ms into the run`);
});

/** Checks that an agent's model read a stimulus, by its content and source, in the first turn of its activations. */
function readAtWake(context: Context, agent: string, content: string, source: string): void {
  const [first] = modelOf(context, agent).received;
  const text = asRead(source, content);
  assert.ok(userTexts(first).includes(text), `agent "${agent}"'s first activation woke to ${JSON.stringify(userTexts(first))}`);
}

Then("agent {string}'s first activation received {string} from {string} when it woke", function (this: Context, agent: string, content: string, source: string) {
  readAtWake(this, agent, content, source);
});

Then(
  "agent {string} started an activation within {int} milliseconds after agent {string}'s {string} call ended, with {string} from {string} among its stimuli",
  function (this: Context, agent: string, withinMs: number, caller: string, tool: string, content: string, source: string) {
    const { endedAtMs } = callOf(this, caller, tool);
    const [first] = activationsOf(this, agent);
    assert.ok(first !== undefined, `agent "${agent}" made no activation`);
    const afterMs = first.wokeAtMs - endedAtMs;
    assert.ok(afterMs >= 0 && afterMs <= withinMs, `agent "${agent}"'s activation began ${afterMs} ms after the call ended`);
    readAtWake(this, agent, content, source);
  },
);

Then(
  "agent {string}'s {string} call ended with the outcome {string} within {int} milliseconds after agent {string}'s {string} call ended",
  function (this: Context, agent: string, tool: string, outcome: string, withinMs: number, other: string, otherTool: string) {
    const call = callOf(this, agent, tool);
    assert.equal(call.outcome, outcome);
    const afterMs = call.endedAtMs - callOf(this, other, otherTool).endedAtMs;
    assert.ok(afterMs >= 0 && afterMs <= withinMs, `agent "${agent}"'s "${tool}" call ended ${afterMs} ms after agent "${other}"'s "${otherTool}" call`);
  },
);

Then("it lists the tool {string} with the channel {string} it delivers through", function (this: Context, tool: string, channel: string) {
  const printed = this.labOutput ?? "";
  const start = printed.indexOf(`#### Tool "${tool}"`);
  assert.ok(start !== -1, `the inventory lists no tool "${tool}":\n${printed}`);
  const section = printed.slice(start, printed.indexOf("####", start + 1));
  assert.ok(section.includes(`- Delivers through: ${channel}`), `the tool "${tool}" is listed without the channel it delivers through:\n${section}`);
});

Then("it lists the channel {string} with the source {string} and the text {string}", function (this: Context, channel: string, source: string, text: string) {
  const printed = this.labOutput ?? "";
  const listed = `#### Channel "${channel}"\n\n- Source: ${source}\n\nDelivers:\n\n\`\`\`text\n${text}\n\`\`\``;
  assert.ok(printed.includes(listed), `the inventory does not list:\n${listed}\nIt printed:\n${printed}`);
});

Then("the log's last line says the run stopped, with that error", function (this: Context) {
  assert.ok(this.runError !== undefined, "the run did not stop");
  const last = logLines(this).at(-1);
  assert.equal(last?.type, "run_stopped", `the log's last line does not say the run stopped: ${JSON.stringify(last)}`);
  assert.equal(last.error, this.runError.message);
});
