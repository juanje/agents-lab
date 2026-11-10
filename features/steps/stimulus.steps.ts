import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import type { Context } from "../support/context.ts";
import { modelOf } from "./tool.steps.ts";

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
