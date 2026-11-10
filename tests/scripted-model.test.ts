import { type Context, type ModelsApiStreamOptions, createModels, getCurrentTools } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ScriptedModel } from "../src/engine/scripted-model.ts";

const look = { name: "look", description: "Look.", parameters: { type: "object", properties: {} } };

/** Asks a scripted model for its next answer, through Pi's models with only its provider, as a session's call does. */
function complete(scripted: ScriptedModel, context: Context, options?: ModelsApiStreamOptions<string>) {
  const models = createModels();
  models.setProvider(scripted.provider);
  return models.complete(scripted.model, context, options);
}

describe("ScriptedModel", () => {
  it("answers a turn with its scripted text and tool calls, in that order", async () => {
    const scripted = new ScriptedModel([
      { text: "Looking.", toolCalls: [{ name: "look", arguments: { far: true } }], delayMs: 0 },
    ]);

    const answer = await complete(scripted, { messages: [], tools: [look] });

    expect(answer.content).toEqual([
      { type: "text", text: "Looking." },
      { type: "toolCall", id: expect.any(String), name: "look", arguments: { far: true } },
    ]);
  });

  it("keeps the messages each turn received, with the tools it was offered", async () => {
    const scripted = new ScriptedModel([
      { text: "first", delayMs: 0 },
      { text: "second", delayMs: 0 },
    ]);

    await complete(scripted, { messages: [], tools: [look] });
    const answer = await complete(scripted, { messages: [], tools: [] });

    expect(answer.content).toEqual([{ type: "text", text: "second" }]);
    expect(scripted.received.map((messages) => getCurrentTools(messages).map((tool) => tool.name))).toEqual([
      ["look"],
      [],
    ]);
  });

  it("keeps the Pi session each turn came from", async () => {
    const scripted = new ScriptedModel([
      { text: "first", delayMs: 0 },
      { text: "second", delayMs: 0 },
    ]);

    await complete(scripted, { messages: [] }, { sessionId: "session 1" });
    await complete(scripted, { messages: [] });

    expect(scripted.sessions).toEqual(["session 1", undefined]);
  });

  it("answers as a model with the id it is given", async () => {
    const scripted = new ScriptedModel([{ text: "first", delayMs: 0 }], "scripted-model-x");

    const answer = await complete(scripted, { messages: [] });

    expect(scripted.model.id).toBe("scripted-model-x");
    expect(answer.model).toBe("scripted-model-x");
  });

  it("answers a turn with a provider error when the script says so", async () => {
    const scripted = new ScriptedModel([{ error: "overloaded", delayMs: 0 }]);

    const answer = await complete(scripted, { messages: [] });

    expect(answer).toMatchObject({ stopReason: "error", errorMessage: "overloaded", content: [] });
  });

  it("stops waiting for its delay when its call is aborted, and answers as aborted", async () => {
    const scripted = new ScriptedModel([{ text: "late", delayMs: 2_000 }]);
    const started = performance.now();

    const answer = await complete(scripted, { messages: [] }, { signal: AbortSignal.timeout(50) });

    expect(performance.now() - started).toBeLessThan(500);
    expect(answer).toMatchObject({ stopReason: "aborted", content: [] });
  });
});
