import { getCurrentTools } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ScriptedModel } from "../src/engine/scripted-model.ts";

const look = { name: "look", description: "Look.", parameters: { type: "object", properties: {} } };

describe("ScriptedModel", () => {
  it("keeps the messages each turn received, with the tools it was offered", async () => {
    const scripted = new ScriptedModel([
      { text: "first", delayMs: 0 },
      { text: "second", delayMs: 0 },
    ]);

    await scripted.models.complete(scripted.model, { messages: [], tools: [look] });
    const answer = await scripted.models.complete(scripted.model, { messages: [], tools: [] });

    expect(answer.content).toEqual([{ type: "text", text: "second" }]);
    expect(scripted.received.map((messages) => getCurrentTools(messages).map((tool) => tool.name))).toEqual([
      ["look"],
      [],
    ]);
  });
});
