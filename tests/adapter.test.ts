import { describe, expect, it } from "vitest";
import { type JsonObject, validateToolArguments } from "@earendil-works/pi-ai";
import { labModel, unrunOutcome } from "../src/engine/adapter.ts";
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
