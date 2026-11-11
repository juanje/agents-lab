import { describe, expect, it } from "vitest";
import { type JsonObject, getCurrentSystemMessage, getCurrentSystemPrompt, validateToolArguments } from "@earendil-works/pi-ai";
import { askOnce, labModel, unrunOutcome } from "../src/engine/adapter.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { slotTools } from "./fixtures/slots.ts";

describe("labModel", () => {
  it("gives the model a name in Pi's provider/id form names, which Pi's runtime serves with no provider of the run's", async () => {
    const { model, provider } = await labModel("openai/gpt-6-luna");

    expect({ provider: model.provider, id: model.id }).toEqual({ provider: "openai", id: "gpt-6-luna" });
    expect(provider).toBeUndefined();
  });

  it("refuses a name that is not in Pi's provider/id form, saying so", async () => {
    await expect(labModel("gpt-6-luna")).rejects.toThrow(`Model name "gpt-6-luna" is not in Pi's provider/id form`);
  });

  it("refuses a model the lab's Pi directory does not know, naming it", async () => {
    await expect(labModel("openai/no-such-model")).rejects.toThrow(`The lab's Pi directory knows no model "openai/no-such-model"`);
  });
});

describe("unrunOutcome", () => {
  const take = slotTools.find((tool) => tool.name === "take");
  /** Pi's own answer when its validation of a call of "take" fails. */
  const rejection = (args: JsonObject) => {
    try {
      validateToolArguments({ name: "take", description: "", parameters: take?.parameters as never }, { type: "toolCall", id: "1", name: "take", arguments: args });
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("Pi's validation accepted the call");
  };

  it("recognises a call to a tool the session does not offer as unknown_tool", () => {
    expect(unrunOutcome(undefined, { tool: "fly", arguments: {} }, "Tool fly not found", false)).toBe("unknown_tool");
  });

  it("recognises a call Pi rejected by its validation as invalid_arguments, from Pi's own rejection", () => {
    expect(unrunOutcome(take, { tool: "take", arguments: { slot: "one" } }, rejection({ slot: "one" }), false)).toBe("invalid_arguments");
  });

  it("records a call with valid arguments that Pi left unrun once the run had ended as cut_off", () => {
    expect(unrunOutcome(take, { tool: "take", arguments: { slot: 1 } }, "Operation aborted", true)).toBe("cut_off");
  });

  it("does not take a call left unrun for another reason for invalid arguments, and says why it cannot record it", () => {
    expect(() => unrunOutcome(take, { tool: "take", arguments: { slot: 1 } }, "Operation aborted", false)).toThrow(
      'Pi answered a call of "take" without running it, for no reason the engine recognises: Operation aborted',
    );
  });
});

describe("askOnce", () => {
  const verdict = {
    name: "verdict",
    description: "Give your verdict.",
    parameters: { type: "object", properties: { verdict: { type: "string", enum: ["yes", "no"] } }, required: ["verdict"] },
  };

  it("makes one model call, with the system prompt as it is and only the one tool, and gives the calls it made and its tokens and cost", async () => {
    const model = new ScriptedModel([
      { text: "Thinking it over.", toolCalls: [{ name: "verdict", arguments: { verdict: "yes" } }], delayMs: 0 },
      { text: "A second turn.", delayMs: 0 },
    ]);

    const answer = await askOnce(model, { systemPrompt: "You judge.", thinkingLevel: "off" }, verdict, "Is the sky blue?");

    expect(model.received).toHaveLength(1);
    const [received] = model.received;
    expect(getCurrentSystemPrompt(received)).toBe("You judge.");
    expect(getCurrentSystemMessage(received)?.toolsAdded?.map((tool) => tool.name)).toEqual(["verdict"]);
    expect(JSON.stringify(received.filter((message) => message.role !== "system"))).toContain("Is the sky blue?");
    expect(answer.calls).toEqual([{ name: "verdict", arguments: { verdict: "yes" } }]);
    expect(answer.tokens.totalTokens).toBeGreaterThan(0);
    expect(typeof answer.cost.total).toBe("number");
  });

  it("gives the calls as the model made them, even those Pi would reject", async () => {
    const model = new ScriptedModel([{ toolCalls: [{ name: "verdict", arguments: { verdict: "maybe" } }], delayMs: 0 }]);

    const answer = await askOnce(model, { systemPrompt: "You judge.", thinkingLevel: "off" }, verdict, "Is the sky blue?");

    expect(answer.calls).toEqual([{ name: "verdict", arguments: { verdict: "maybe" } }]);
  });
});
