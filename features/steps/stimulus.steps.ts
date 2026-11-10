import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { slotTools } from "../../tests/fixtures/slots.ts";
import type { Context } from "../support/context.ts";
import { modelOf, script, scriptActivations } from "./tool.steps.ts";

Given(
  "the channel {string} delivers the stimulus {string} from the source {string}",
  function (this: Context, name: string, stimulus: string, source: string) {
    this.channels.push({ name, source, stimulus });
  },
);

/** The text the agent reads for a stimulus: its source, then what it says (agreed with the person). */
function asRead(source: string, content: string): string {
  return `${source}: ${content}`;
}

/** The text of a message the model received, when it is a user message. */
function userText(message: { role: string; content: unknown }): string | undefined {
  if (message.role !== "user") return undefined;
  if (typeof message.content === "string") return message.content;
  return (message.content as { type: string; text?: string }[]).flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

Then(
  "the first message of agent {string}'s activation is a stimulus from the channel {string}",
  function (this: Context, agent: string, name: string) {
    const channel = this.channels.find((declared) => declared.name === name);
    assert.ok(channel !== undefined, `the scenario declares no channel "${name}"`);
    const [first] = modelOf(this, agent).received[0].filter((message) => message.role !== "system");
    assert.ok(first !== undefined, `agent "${agent}"'s first model turn received no message`);
    assert.equal(userText(first), asRead(channel.source, channel.stimulus));
  },
);

Given(
  "agent {string} runs on a scripted model whose turns are: a call to {string} after {int} milliseconds; the text {string} with no tool call",
  function (this: Context, agent: string, tool: string, delayMs: number, text: string) {
    script(this, agent, [
      { toolCalls: [{ name: tool, arguments: {} }], delayMs },
      { text, delayMs: 0 },
    ]);
  },
);

Given("the bell rings {int} milliseconds after agent {string} wakes", function (this: Context, afterMs: number, agent: string) {
  // The rhythm is called as the agent starts to wait; with no wait, the agent wakes as the rhythm returns.
  this.rhythms.set(agent, () => {
    setTimeout(() => this.stimuli.deliver(agent, "bell"), afterMs);
    return 0;
  });
});

/** The texts of the user messages a model turn received. */
function userTexts(messages: readonly { role: string; content: unknown }[]): string[] {
  return messages.flatMap((message) => userText(message) ?? []);
}

/** The text a declared channel's stimulus is read as, for a stimulus the scenario names by its words and source. */
function declaredStimulus(context: Context, content: string, source: string): string {
  const channel = context.channels.find((declared) => declared.stimulus === content && declared.source === source);
  assert.ok(channel !== undefined, `the scenario declares no channel delivering "${content}" from "${source}"`);
  return asRead(source, content);
}

Then(
  "agent {string}'s second model turn received {string} from {string}",
  function (this: Context, agent: string, content: string, source: string) {
    const text = declaredStimulus(this, content, source);
    this.lastAgent = agent;
    this.lastStimulusRead = text;
    const second = modelOf(this, agent).received[1];
    assert.ok(second !== undefined, `agent "${agent}"'s model made no second turn`);
    assert.ok(userTexts(second).includes(text), `agent "${agent}"'s second turn received ${JSON.stringify(userTexts(second))}`);
  },
);

Given(
  "agent {string} makes {int} activations, each ending its first turn without a tool call, and waits {int} milliseconds between them",
  function (this: Context, agent: string, activations: number, waitMs: number) {
    scriptActivations(this, agent, activations, () => [{ text: "Nothing to do.", delayMs: 0 }]);
    let rests = 0;
    // The rhythm is called before each activation; the agent wakes at once the first time.
    this.rhythms.set(agent, () => (rests++ === 0 ? 0 : waitMs));
  },
);

Given("the bell rings while agent {string} rests", function (this: Context, agent: string) {
  const rhythm = this.rhythms.get(agent);
  assert.ok(rhythm !== undefined, `agent "${agent}" has no rhythm of its own to rest by`);
  // Halfway through each rest the agent takes.
  this.rhythms.set(agent, () => {
    const restMs = rhythm();
    if (restMs > 0) setTimeout(() => this.stimuli.deliver(agent, "bell"), restMs / 2);
    return restMs;
  });
});

/** The messages a model turn received after the model's last answer: what reached the agent since it last answered. */
function sinceLastAnswer(messages: readonly { role: string; content: unknown }[]) {
  const answered = messages.map((message) => message.role).lastIndexOf("assistant");
  return messages.slice(answered + 1);
}

Then(
  "agent {string}'s second activation received {string} from {string} when it woke",
  function (this: Context, agent: string, content: string, source: string) {
    const text = declaredStimulus(this, content, source);
    const rhythm = this.channels.find((declared) => declared.name === "rhythm");
    assert.ok(rhythm !== undefined, "the scenario declares no rhythm channel");
    // An activation's first model turn is the one that received the rhythm's stimulus since the model last answered.
    const wakings = modelOf(this, agent)
      .received.map(sinceLastAnswer)
      .filter((received) => userTexts(received).includes(asRead(rhythm.source, rhythm.stimulus)));
    const second = wakings[1];
    assert.ok(second !== undefined, `agent "${agent}" woke ${wakings.length} times, not twice`);
    assert.ok(userTexts(second).includes(text), `agent "${agent}"'s second activation woke to ${JSON.stringify(userTexts(second))}`);
  },
);

Then(
  "agent {string}'s session holds only its system prompt, its stimuli, its model turns and its tool results",
  function (this: Context, agent: string) {
    const held = this.sessionMessages?.get(agent);
    assert.ok(held !== undefined && held.length > 0, `the run gave nothing agent "${agent}"'s session holds`);
    for (const [index, message] of held.entries()) {
      const what = `message ${index + 1} of agent "${agent}"'s session`;
      if (message.role === "assistant" || message.role === "toolResult") continue;
      if (message.role === "system") {
        // Pi keeps the tools it offers on a system message with no text of its own, and sends the system prompt with it.
        const text = typeof message.content === "string" ? message.content : message.content.map((block) => block.text).join("");
        assert.ok([this.systemPrompt, ""].includes(text), `${what} is a system message with other text: ${text}`);
        const tools = (message.toolsAdded ?? []).map((tool) => tool.name);
        assert.deepEqual(tools.filter((name) => !slotTools.some((tool) => tool.name === name)), [], `${what} adds tools of its own`);
        continue;
      }
      assert.equal(message.role, "custom", `${what} is a ${message.role} message`);
      assert.equal(message.customType, "stimulus", `${what} is a custom message of type "${message.customType}"`);
      const stimulus = message.details as { channel: string; source: string; content: string };
      const channel = this.channels.find((declared) => declared.name === stimulus.channel);
      assert.ok(channel !== undefined, `${what} comes from the undeclared channel "${stimulus.channel}"`);
      assert.deepEqual(stimulus, { channel: channel.name, source: channel.source, content: channel.stimulus });
      assert.equal(message.content, asRead(channel.source, channel.stimulus), `${what} reads otherwise than its stimulus`);
    }
  },
);

Then("its first model turn did not", function (this: Context) {
  assert.ok(this.lastAgent !== undefined && this.lastStimulusRead !== undefined, "no stimulus was checked before");
  const [first] = modelOf(this, this.lastAgent).received;
  assert.ok(!userTexts(first).includes(this.lastStimulusRead), `agent "${this.lastAgent}"'s first turn received it`);
});
