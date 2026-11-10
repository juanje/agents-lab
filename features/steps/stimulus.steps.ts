import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import type { Context } from "../support/context.ts";
import { modelOf, script } from "./tool.steps.ts";

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

Then("its first model turn did not", function (this: Context) {
  assert.ok(this.lastAgent !== undefined && this.lastStimulusRead !== undefined, "no stimulus was checked before");
  const [first] = modelOf(this, this.lastAgent).received;
  assert.ok(!userTexts(first).includes(this.lastStimulusRead), `agent "${this.lastAgent}"'s first turn received it`);
});
