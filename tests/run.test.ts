import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { type RunSettings, run } from "../src/engine/run.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { Stimuli } from "../src/engine/stimuli.ts";
import { World } from "../src/engine/world.ts";
import { type Slots, emptySlots, rhythmChannel, slotTools } from "./fixtures/slots.ts";

/** A rhythm with no waiting: the agent wakes again as soon as its previous activation ends. */
const noWait = () => 0;

/** A replica's seed, for a run whose rhythms draw nothing from it. */
const seed = 1;

/** The stimuli of a run whose only channel is the test world's rhythm. */
const rhythmOnly = () => new Stimuli([rhythmChannel]);

/** Settings for a run whose test looks at none of them. */
const settings: RunSettings = { systemPrompt: "", modelTurnTimeoutMs: 10_000, parallelismLimit: 10 };

describe("run", () => {
  it("starts an activation with the rhythm channel's stimulus, which the model reads with its source", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(new World(emptySlots(3)), slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    const [first] = model.received[0]?.filter((message) => message.role !== "system") ?? [];
    expect(first).toMatchObject({ role: "user", content: [{ type: "text", text: "rhythm: You wake up." }] });
  });

  it("gives what each agent's session held at the end: its stimuli, keeping their channel and source, and its model turns", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    const { messages } = await run(new World(emptySlots(3)), slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(messages.get("a")?.filter((message) => message.role !== "system")).toMatchObject([
      {
        role: "custom",
        customType: "stimulus",
        content: "rhythm: You wake up.",
        details: { channel: "rhythm", source: "rhythm", content: "You wake up." },
      },
      { role: "assistant", content: [{ type: "text", text: "Nothing to do." }] },
    ]);
  });

  it("delivers a stimulus that arrives while the agent rests when it wakes, after the rhythm's", async () => {
    const stimuli = new Stimuli([rhythmChannel, { name: "bell", source: "town bell", stimulus: "The bell rings." }]);
    const model = new ScriptedModel([
      { text: "Nothing to do.", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);
    let rests = 0;
    // The agent wakes at once, then rests 100 ms, and the bell rings halfway through that rest.
    const restsOnceWithBell = () => (rests++ === 0 ? 0 : (setTimeout(() => stimuli.deliver("a", "bell"), 50), 100));

    await run(new World(emptySlots(3)), slotTools, stimuli, [{ name: "a", model, activations: 2, rhythm: restsOnceWithBell }], seed, settings);

    const text = (value: string) => ({ role: "user", content: [{ type: "text", text: value }] });
    expect(model.received[1]?.slice(-2)).toMatchObject([text("rhythm: You wake up."), text("town bell: The bell rings.")]);
  });

  it("delivers a stimulus that arrives during a model turn at the agent's next model turn", async () => {
    const stimuli = new Stimuli([rhythmChannel, { name: "bell", source: "town bell", stimulus: "The bell rings." }]);
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 100 },
      { text: "Done.", delayMs: 0 },
    ]);
    // The rhythm is called as the agent starts to wait, and with no wait the agent wakes as it returns.
    const ringsAfter50 = () => (setTimeout(() => stimuli.deliver("a", "bell"), 50), 0);

    await run(new World(emptySlots(3)), slotTools, stimuli, [{ name: "a", model, activations: 1, rhythm: ringsAfter50 }], seed, settings);

    const [first, second] = model.received;
    const rings = { role: "user", content: [{ type: "text", text: "town bell: The bell rings." }] };
    expect(first).not.toContainEqual(expect.objectContaining(rings));
    expect(second?.at(-1)).toMatchObject(rings);
  });

  it("offers the agent's model exactly the scenario's tools, with their descriptions and arguments", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(new World(emptySlots(3)), slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

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

    await run(world, slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

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

    await run(world, slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(world.state).toEqual(["a", null, null]);
    expect(world.version).toBe(1);
  });

  it("runs all of an agent's model turns in one Pi session, across its activations", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);

    await run(new World(emptySlots(3)), slotTools, rhythmOnly(), [{ name: "a", model, activations: 2, rhythm: noWait }], seed, settings);

    expect(model.sessions).toEqual([expect.any(String), model.sessions[0], model.sessions[0]]);
  });

  it("gives the agent's model the scenario's system prompt and nothing else", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(new World(emptySlots(3)), slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, {
      ...settings,
      systemPrompt: "You live in a row of slots.",
    });

    expect(model.received.map(getCurrentSystemPrompt)).toEqual(["You live in a row of slots."]);
  });

  it("opens its sessions in the lab's Pi directory, and leaves the person's as it was", async () => {
    const persons = join(homedir(), ".pi", "agent");
    mkdirSync(persons, { recursive: true });
    writeFileSync(join(persons, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-6-luna" }));
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(new World(emptySlots(3)), slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(readdirSync(persons, { recursive: true })).toEqual(["settings.json"]);
    expect(existsSync(join(homedir(), ".agents-lab", "pi"))).toBe(true);
    expect(model.received).toHaveLength(1);
  });

  it("records a turn the provider answered with an error as model_error, with its message, and ends the activation there", async () => {
    const model = new ScriptedModel([
      { error: "overloaded", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);

    const { turns } = await run(new World(emptySlots(3)), slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(turns).toEqual([expect.objectContaining({ agent: "a", outcome: "model_error", message: "overloaded" })]);
    expect(model.received).toHaveLength(1);
  });

  it("aborts a model turn longer than the timeout, records it as timeout, and runs none of its tool calls", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 300 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { turns } = await run(world, slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, {
      ...settings,
      modelTurnTimeoutMs: 50,
    });

    expect(turns).toEqual([expect.objectContaining({ agent: "a", outcome: "timeout" })]);
    expect(world.state).toEqual(emptySlots(3));
    expect(model.received).toHaveLength(1);
  });

  it("records when each model turn started and ended, by the run's clock", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 50 }]);
    const before = performance.now();

    const { turns } = await run(new World(emptySlots(3)), slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);
    const [turn] = turns;

    expect(turn?.startedAtMs).toBeGreaterThanOrEqual(before);
    expect((turn?.endedAtMs ?? 0) - (turn?.startedAtMs ?? 0)).toBeGreaterThanOrEqual(50);
    expect(turn?.endedAtMs).toBeLessThanOrEqual(performance.now());
  });

  it("makes a model turn wait for a free slot when the parallelism limit is reached, and records the wait", async () => {
    const answersAfter50 = () => new ScriptedModel([{ text: "Nothing to do.", delayMs: 50 }]);

    const { turns } = await run(
      new World(emptySlots(3)),
      slotTools,
      rhythmOnly(),
      ["a", "b", "c"].map((name) => ({ name, model: answersAfter50(), activations: 1, rhythm: noWait })),
      seed,
      { ...settings, parallelismLimit: 2 },
    );

    const waits = turns.map((turn) => turn.slotWaitMs).sort((one, other) => one - other);
    expect(waits[0]).toBeLessThan(50);
    expect(waits[1]).toBeLessThan(50);
    expect(waits[2]).toBeGreaterThanOrEqual(50);
    const [first, second, third] = [...turns].sort((one, other) => one.startedAtMs - other.startedAtMs);
    expect(third?.startedAtMs).toBeGreaterThanOrEqual(Math.min(first?.endedAtMs ?? Infinity, second?.endedAtMs ?? Infinity));
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
      rhythmOnly(),
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
        rhythmOnly(),
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
        rhythmOnly(),
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
  it("records the text of each model turn as the agent's reflection, and the text acts on nothing", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([
      { text: "I take slot 1.", toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Slot 2 is mine.", delayMs: 0 },
    ]);

    const { turns } = await run(world, slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(turns.map((turn) => turn.text)).toEqual(["I take slot 1.", "Slot 2 is mine."]);
    expect(world.version).toBe(0);
  });
  it.each([[{ slot: "seven" }], [{}], [{ slot: 1, x: 2 }]])(
    "records a call with arguments %j, which the tool does not take, as invalid_arguments, and applies nothing",
    async (args) => {
      const world = new World(emptySlots(3));
      const model = new ScriptedModel([
        { toolCalls: [{ name: "take", arguments: args }], delayMs: 0 },
        { text: "Done.", delayMs: 0 },
      ]);

      const { toolCalls } = await run(world, slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

      expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: args, outcome: "invalid_arguments" }]);
      expect(world.version).toBe(0);
    },
  );

  it("records a call with the arguments as the model made them, before Pi coerces them", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: "2" } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(world, slotTools, rhythmOnly(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: { slot: "2" }, outcome: "success" }]);
    expect(world.state).toEqual([null, "a", null]);
  });
});
