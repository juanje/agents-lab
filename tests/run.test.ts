import { describe, expect, it } from "vitest";
import { run } from "../src/engine/run.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { World } from "../src/engine/world.ts";
import { declaredActions, emptySlots } from "./fixtures/slots.ts";

describe("run", () => {
  it("gives each decision the next answer of the agent's scripted model, and applies the action it names", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([
      { text: "take 2", delayMs: 0 },
      { text: "wait", delayMs: 0 },
    ]);

    const decisions = await run(world, declaredActions, [{ name: "a", model, decisions: 2 }]);

    expect(decisions.get("a")?.map(({ answer, outcome }) => ({ answer, outcome }))).toEqual([
      { answer: "take 2", outcome: "success" },
      { answer: "wait", outcome: "success" },
    ]);
    expect(world.state).toEqual([null, "a", null]);
  });

  it("records each decision's model latency, from the call's start to the answer the script delays", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([{ text: "wait", delayMs: 50 }]);

    const decisions = await run(world, declaredActions, [{ name: "a", model, decisions: 1 }]);

    expect(decisions.get("a")?.[0]?.latencyMs).toBeGreaterThanOrEqual(50);
  });

  it("gives a decision after the script runs out the outcome script_exhausted, with no answer, and applies nothing", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([{ text: "take 1", delayMs: 0 }]);

    const decisions = await run(world, declaredActions, [{ name: "a", model, decisions: 2 }]);

    expect(decisions.get("a")?.[1]).toEqual({ outcome: "script_exhausted" });
    expect(world.state).toEqual(["a", null, null]);
    expect(world.version).toBe(1);
  });
});
