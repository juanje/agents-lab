import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { type RunSettings, run } from "../src/engine/run.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { World } from "../src/engine/world.ts";
import { type Slots, emptySlots, slotTools } from "./fixtures/slots.ts";

/** A rhythm with no waiting: the agent wakes again as soon as its previous activation ends. */
const noWait = () => 0;

/** A replica's seed, for a run whose rhythms draw nothing from it. */
const seed = 1;

/** Settings for a run whose test looks at none of them. */
const settings: RunSettings = { systemPrompt: "", modelTurnTimeoutMs: 10_000 };

describe("run", () => {
  it("offers the agent's model exactly the scenario's tools, with their descriptions and arguments", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(new World(emptySlots(3)), slotTools, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(model.received.map(getCurrentTools)).toEqual([
      slotTools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    ]);
  });

  it("returns what a sensor the model called gave, at the model's next turn, and changes nothing", async () => {
    const world = new World<Slots>([null, "b", null]);
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    await run(world, slotTools, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    const [, next] = model.received;
    const call = next?.find((message) => message.role === "assistant")?.content[0];
    expect(next?.at(-1)).toMatchObject({
      role: "toolResult",
      toolCallId: call?.type === "toolCall" ? call.id : "no call",
      toolName: "look",
      content: [{ type: "text", text: '["empty","held","empty"]' }],
    });
    expect(world.state).toEqual([null, "b", null]);
    expect(world.version).toBe(0);
  });

  it("applies an effector the model calls through the arbiter, with the agent and the call's arguments", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    await run(world, slotTools, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(world.state).toEqual(["a", null, null]);
    expect(world.version).toBe(1);
  });

  it("runs all of an agent's model turns in one Pi session, across its activations", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);

    await run(new World(emptySlots(3)), slotTools, [{ name: "a", model, activations: 2, rhythm: noWait }], seed, settings);

    expect(model.sessions).toEqual([expect.any(String), model.sessions[0], model.sessions[0]]);
  });

  it("gives the agent's model the scenario's system prompt and nothing else", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(new World(emptySlots(3)), slotTools, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, {
      systemPrompt: "You live in a row of slots.",
    });

    expect(model.received.map(getCurrentSystemPrompt)).toEqual(["You live in a row of slots."]);
  });

  it("opens its sessions in the lab's Pi directory, and leaves the person's as it was", async () => {
    const persons = join(homedir(), ".pi", "agent");
    mkdirSync(persons, { recursive: true });
    writeFileSync(join(persons, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-6-luna" }));
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(new World(emptySlots(3)), slotTools, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(readdirSync(persons, { recursive: true })).toEqual(["settings.json"]);
    expect(existsSync(join(homedir(), ".agents-lab", "pi"))).toBe(true);
    expect(model.received).toHaveLength(1);
  });

  it("records a turn the provider answered with an error as model_error, with its message, and ends the activation there", async () => {
    const model = new ScriptedModel([
      { error: "overloaded", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);

    const turns = await run(new World(emptySlots(3)), slotTools, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(turns).toEqual([expect.objectContaining({ agent: "a", outcome: "model_error", message: "overloaded" })]);
    expect(model.received).toHaveLength(1);
  });

  it("aborts a model turn longer than the timeout, records it as timeout, and runs none of its tool calls", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 300 },
      { text: "Done.", delayMs: 0 },
    ]);

    const turns = await run(world, slotTools, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, {
      ...settings,
      modelTurnTimeoutMs: 50,
    });

    expect(turns).toEqual([expect.objectContaining({ agent: "a", outcome: "timeout" })]);
    expect(world.state).toEqual(emptySlots(3));
    expect(model.received).toHaveLength(1);
  });

  it("gives each agent's model turns to that agent's own model", async () => {
    const world = new World(emptySlots(3));
    const takes = (slot: number) =>
      new ScriptedModel([
        { toolCalls: [{ name: "take", arguments: { slot } }], delayMs: 0 },
        { text: "Done.", delayMs: 0 },
      ]);

    await run(
      world,
      slotTools,
      [
        { name: "a", model: takes(1), activations: 1, rhythm: noWait },
        { name: "b", model: takes(2), activations: 1, rhythm: noWait },
      ],
      seed,
      settings,
    );

    expect(world.state).toEqual(["a", "b", null]);
  });

  it("gives each agent's rhythm the same draws for the same seed, however long the other agents' models take", async () => {
    /** Runs agents "a" and "b" with seed 42, "b" answering after its delay, and gives the draws of "a"'s rhythm. */
    async function drawsOfA(bDelayMs: number): Promise<number[]> {
      const draws: number[] = [];
      const answers = (delayMs: number) => new ScriptedModel(Array.from({ length: 4 }, () => ({ text: "resting", delayMs })));
      await run(
        new World(emptySlots(3)),
        [],
        [
          { name: "a", model: answers(0), activations: 4, rhythm: (source) => (draws.push(source.next()), 5) },
          { name: "b", model: answers(bDelayMs), activations: 4, rhythm: (source) => source.next() * 5 },
        ],
        42,
        settings,
      );
      return draws;
    }

    const draws = await drawsOfA(0);

    expect(draws).toHaveLength(4);
    expect(await drawsOfA(30)).toEqual(draws);
  });

  it("gives an agent's rhythm the same draws for the same seed, whichever agents run with it and in whatever order", async () => {
    /** Runs the named agents with seed 42, in that order, and gives the draws of "b"'s rhythm. */
    async function drawsOfB(names: readonly string[]): Promise<number[]> {
      const draws: number[] = [];
      await run(
        new World(emptySlots(3)),
        [],
        names.map((name) => ({
          name,
          model: new ScriptedModel(Array.from({ length: 3 }, () => ({ text: "resting", delayMs: 0 }))),
          activations: 3,
          rhythm: (source) => (name === "b" ? (draws.push(source.next()), 0) : source.next()),
        })),
        42,
        settings,
      );
      return draws;
    }

    const draws = await drawsOfB(["a", "b"]);

    expect(draws).toHaveLength(3);
    expect(await drawsOfB(["b", "a"])).toEqual(draws);
    expect(await drawsOfB(["c", "d", "b"])).toEqual(draws);
  });
});
