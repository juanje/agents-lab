import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { type RunSettings, run } from "../src/engine/run.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import type { Stimuli } from "../src/engine/stimuli.ts";
import type { EffectorCall } from "../src/engine/tools.ts";
import { type Slots, emptySlots, rhythmChannel, slotTools, slotsScenario, take } from "./fixtures/slots.ts";

/** A rhythm with no waiting: the agent wakes again as soon as its previous activation ends. */
const noWait = () => 0;

/** A replica's seed, for a run whose rhythms draw nothing from it. */
const seed = 1;

/** The slots test scenario as loaded with 3 empty slots, with any of its parts replaced. */
const slots = (parts: Partial<Scenario<Slots>> = {}) => loadScenario({ ...slotsScenario, ...parts }, seed);

/** A channel besides the rhythm, for stimuli the test delivers. */
const bell = { name: "bell", source: "town bell", stimulus: "The bell rings." };

/** When a recorded tool call started and ended, for a test that checks neither. */
const timed = { startedAtMs: expect.any(Number), endedAtMs: expect.any(Number) };

/** The test world's tools, with its sensor "look" taking this long. */
const withLookTaking = (durationMs: number) => slotTools.map((tool) => (tool.kind === "sensor" ? { ...tool, durationMs } : tool));

/** The test world's tools, with its effector "take" taking this long. */
const withTakeTaking = (durationMs: number) =>
  slotTools.map((tool) => (tool.kind === "effector" ? { ...tool, durationMs: () => durationMs } : tool));

/** Settings for a run whose test looks at none of them. */
const settings: RunSettings = { modelTurnTimeoutMs: 10_000, parallelismLimit: 10 };

describe("run", () => {
  it("starts an activation with the rhythm channel's stimulus, which the model reads with its source", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    const [first] = model.received[0]?.filter((message) => message.role !== "system") ?? [];
    expect(first).toMatchObject({ role: "user", content: [{ type: "text", text: "rhythm: You wake up." }] });
  });

  it("gives what each agent's session held at the end: its stimuli, keeping their channel and source, and its model turns", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    const { messages } = await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

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

  it("hands the run's stimuli to onStart before any agent wakes, so what it delivers reaches the first activation", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(slots({ channels: [rhythmChannel, bell] }), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, {
      ...settings,
      onStart: (stimuli) => stimuli.deliver("a", "bell"),
    });

    const text = (value: string) => ({ role: "user", content: [{ type: "text", text: value }] });
    expect(model.received[0]?.filter((message) => message.role !== "system")).toMatchObject([
      text("rhythm: You wake up."),
      text("town bell: The bell rings."),
    ]);
  });

  it("delivers a stimulus that arrives while the agent rests when it wakes, after the rhythm's", async () => {
    let stimuli: Stimuli | undefined;
    const model = new ScriptedModel([
      { text: "Nothing to do.", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);
    let rests = 0;
    // The agent wakes at once, then rests 100 ms, and the bell rings halfway through that rest.
    const restsOnceWithBell = () => (rests++ === 0 ? 0 : (setTimeout(() => stimuli?.deliver("a", "bell"), 50), 100));

    await run(slots({ channels: [rhythmChannel, bell] }), [{ name: "a", model, activations: 2, rhythm: restsOnceWithBell }], seed, {
      ...settings,
      onStart: (started) => (stimuli = started),
    });

    const text = (value: string) => ({ role: "user", content: [{ type: "text", text: value }] });
    expect(model.received[1]?.slice(-2)).toMatchObject([text("rhythm: You wake up."), text("town bell: The bell rings.")]);
  });

  it("delivers a stimulus that arrives during a model turn at the agent's next model turn", async () => {
    let stimuli: Stimuli | undefined;
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 100 },
      { text: "Done.", delayMs: 0 },
    ]);
    // The rhythm is called as the agent starts to wait, and with no wait the agent wakes as it returns.
    const ringsAfter50 = () => (setTimeout(() => stimuli?.deliver("a", "bell"), 50), 0);

    await run(slots({ channels: [rhythmChannel, bell] }), [{ name: "a", model, activations: 1, rhythm: ringsAfter50 }], seed, {
      ...settings,
      onStart: (started) => (stimuli = started),
    });

    const [first, second] = model.received;
    const rings = { role: "user", content: [{ type: "text", text: "town bell: The bell rings." }] };
    expect(first).not.toContainEqual(expect.objectContaining(rings));
    expect(second?.at(-1)).toMatchObject(rings);
  });

  it("offers the agent's model exactly the scenario's tools, with their descriptions and arguments", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(model.received.map(getCurrentTools)).toEqual([
      slotTools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    ]);
  });

  it("returns what a sensor the model called gave, at the model's next turn, and changes nothing", async () => {
    const loaded = slots();
    const { world } = loaded;
    world.apply(take, { agent: "b", slot: 2 });
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    const [, next] = model.received;
    const call = next?.find((message) => message.role === "assistant")?.content[0];
    expect(next?.at(-1)).toMatchObject({
      role: "toolResult",
      toolCallId: call?.type === "toolCall" ? call.id : "no call",
      toolName: "look",
      content: [{ type: "text", text: '["empty","held","empty"]' }],
    });
    expect(world.state).toEqual([null, "b", null]);
    expect(world.version).toBe(1);
  });

  it("applies an effector the model calls through the arbiter, with the agent and the call's arguments", async () => {
    const loaded = slots();
    const { world } = loaded;
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(world.state).toEqual(["a", null, null]);
    expect(world.version).toBe(1);
  });

  it("runs all of an agent's model turns in one Pi session, across its activations", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);

    await run(slots(), [{ name: "a", model, activations: 2, rhythm: noWait }], seed, settings);

    expect(model.sessions).toEqual([expect.any(String), model.sessions[0], model.sessions[0]]);
  });

  it("gives the agent's model the scenario's system prompt and nothing else", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(slots({ systemPrompt: "You live in a row of slots." }), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(model.received.map(getCurrentSystemPrompt)).toEqual(["You live in a row of slots."]);
  });

  it("opens its sessions in the lab's Pi directory, and leaves the person's as it was", async () => {
    const persons = join(homedir(), ".pi", "agent");
    mkdirSync(persons, { recursive: true });
    writeFileSync(join(persons, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-6-luna" }));
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(readdirSync(persons, { recursive: true })).toEqual(["settings.json"]);
    expect(existsSync(join(homedir(), ".agents-lab", "pi"))).toBe(true);
    expect(model.received).toHaveLength(1);
  });

  it("records a turn the provider answered with an error as model_error, with its message, and ends the activation there", async () => {
    const model = new ScriptedModel([
      { error: "overloaded", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);

    const { turns } = await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(turns).toEqual([expect.objectContaining({ agent: "a", outcome: "model_error", message: "overloaded" })]);
    expect(model.received).toHaveLength(1);
  });

  it("records the turn past the end of the script as script_exhausted, and ends the activation there", async () => {
    const model = new ScriptedModel([{ toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 }]);

    const { turns, messages } = await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(turns.map(({ outcome, message }) => ({ outcome, message }))).toEqual([
      { outcome: "success", message: undefined },
      { outcome: "script_exhausted", message: undefined },
    ]);
    expect(messages.get("a")?.filter((message) => message.role === "assistant")).toHaveLength(2);
  });

  it("aborts a model turn longer than the timeout, records it as timeout, and runs none of its tool calls", async () => {
    const loaded = slots();
    const { world } = loaded;
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 300 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { turns } = await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, {
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

    const { turns } = await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);
    const [turn] = turns;

    expect(turn?.startedAtMs).toBeGreaterThanOrEqual(before);
    expect((turn?.endedAtMs ?? 0) - (turn?.startedAtMs ?? 0)).toBeGreaterThanOrEqual(50);
    expect(turn?.endedAtMs).toBeLessThanOrEqual(performance.now());
  });

  it("makes a model turn wait for a free slot when the parallelism limit is reached, and records the wait", async () => {
    const answersAfter50 = () => new ScriptedModel([{ text: "Nothing to do.", delayMs: 50 }]);

    const { turns } = await run(
      slots(),
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
    const loaded = slots();
    const { world } = loaded;
    const takes = (slot: number) =>
      new ScriptedModel([
        { toolCalls: [{ name: "take", arguments: { slot } }], delayMs: 0 },
        { text: "Done.", delayMs: 0 },
      ]);

    await run(
      loaded,
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
        slots({ tools: [] }),
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
        slots({ tools: [] }),
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
    const loaded = slots();
    const { world } = loaded;
    const model = new ScriptedModel([
      { text: "I take slot 1.", toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Slot 2 is mine.", delayMs: 0 },
    ]);

    const { turns } = await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(turns.map((turn) => turn.text)).toEqual(["I take slot 1.", "Slot 2 is mine."]);
    expect(world.version).toBe(0);
  });
  it.each([[{ slot: "seven" }], [{}], [{ slot: 1, x: 2 }]])(
    "records a call with arguments %j, which the tool does not take, as invalid_arguments, and applies nothing",
    async (args) => {
      const loaded = slots();
      const { world } = loaded;
      const model = new ScriptedModel([
        { toolCalls: [{ name: "take", arguments: args }], delayMs: 0 },
        { text: "Done.", delayMs: 0 },
      ]);

      const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

      expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: args, outcome: "invalid_arguments", ...timed }]);
      expect(world.version).toBe(0);
    },
  );

  it("records a call with the arguments as the model made them, before Pi coerces them", async () => {
    const loaded = slots();
    const { world } = loaded;
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: "2" } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: { slot: "2" }, outcome: "success", targetAsSensed: "not_sensed", ...timed }]);
    expect(world.state).toEqual([null, "a", null]);
  });
  it("records a call to a tool the session does not offer as unknown_tool, applies nothing, and goes on", async () => {
    const loaded = slots();
    const { world } = loaded;
    const model = new ScriptedModel([
      { toolCalls: [{ name: "fly", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(toolCalls).toEqual([{ agent: "a", tool: "fly", arguments: { slot: 1 }, outcome: "unknown_tool", ...timed }]);
    expect(world.version).toBe(0);
    expect(model.received).toHaveLength(2);
  });
  it("applies an effector as the agent that called it, even when it declares an argument that names another agent", async () => {
    const takeNamingAgent = slotTools.map((tool) =>
      tool.name === "take"
        ? { ...tool, parameters: { type: "object", properties: { slot: { type: "integer" }, agent: { type: "string" } }, required: ["slot"] } }
        : tool,
    );
    const loaded = slots({ tools: takeNamingAgent });
    const { world } = loaded;
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1, agent: "b" } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(world.state).toEqual(["a", null, null]);
  });
  it("tells the agent a failed call failed: its result is marked as an error and gives the outcome", async () => {
    const loaded = slots();
    const { world } = loaded;
    world.apply(take, { agent: "b", slot: 1 });
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: { slot: 1 }, outcome: "slot_taken", targetAsSensed: "not_sensed", ...timed }]);
    expect(model.received[1]?.at(-1)).toMatchObject({ role: "toolResult", isError: true, content: [{ type: "text", text: "slot_taken" }] });
  });

  it("marks the result of a call that succeeded as no error", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(model.received[1]?.at(-1)).toMatchObject({ role: "toolResult", isError: false, content: [{ type: "text", text: "success" }] });
  });
  it("rejects an argument the tool does not declare, though its schema allows it, telling the agent which", async () => {
    const loaded = slots();
    const { world } = loaded;
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1, x: 2 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: { slot: 1, x: 2 }, outcome: "invalid_arguments", ...timed }]);
    expect(world.version).toBe(0);
    expect(model.received[1]?.at(-1)).toMatchObject({
      role: "toolResult",
      isError: true,
      content: [{ type: "text", text: 'invalid_arguments: "take" takes no argument "x"' }],
    });
  });
  it("rejects an argument a sensor does not declare, as it does for an effector", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(toolCalls).toEqual([{ agent: "a", tool: "look", arguments: { slot: 1 }, outcome: "invalid_arguments", ...timed }]);
    expect(model.received[1]?.at(-1)).toMatchObject({ role: "toolResult", isError: true });
  });

  it("records when each tool call started and ended, and a sensor's call takes its declared duration", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(slots({ tools: withLookTaking(50) }), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    const [{ startedAtMs, endedAtMs }] = toolCalls;
    expect(endedAtMs - startedAtMs).toBeGreaterThanOrEqual(50);
  });

  it("reads the world for a sensor's call when its duration ends, with what changed while it was under way", async () => {
    const looking = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const taking = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 50 },
      { text: "Done.", delayMs: 0 },
    ]);
    const agents = [
      { name: "a", model: looking, activations: 1, rhythm: noWait },
      { name: "b", model: taking, activations: 1, rhythm: noWait },
    ];

    const { toolCalls } = await run(slots({ tools: withLookTaking(100) }), agents, seed, settings);

    const look = toolCalls.find((call) => call.tool === "look");
    const take = toolCalls.find((call) => call.tool === "take");
    expect(take?.endedAtMs).toBeGreaterThan(look?.startedAtMs ?? Infinity);
    expect(take?.endedAtMs).toBeLessThan(look?.endedAtMs ?? -Infinity);
    expect(looking.received[1]?.at(-1)).toMatchObject({ role: "toolResult", content: [{ type: "text", text: '["held","empty","empty"]' }] });
  });

  it("keeps what each agent's sensor call returned, at the moment the call ended", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls, sensings } = await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(sensings?.last("a")).toEqual({ tool: "look", result: '["empty","empty","empty"]', atMs: toolCalls[0]?.endedAtMs });
  });

  it("keeps no sensing of an effector's call, nor of a sensor's call it rejected", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { toolCalls: [{ name: "look", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { sensings } = await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(sensings.last("a")).toBeUndefined();
  });

  it("applies an effector's effect when its declared duration ends, and the call ends then", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const loaded = slots({ tools: withTakeTaking(50) });
    const appliedAtMs: number[] = [];
    const apply = loaded.world.apply.bind(loaded.world);
    loaded.world.apply = (action, args) => {
      appliedAtMs.push(performance.now());
      return apply(action, args);
    };

    const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    const [{ outcome, startedAtMs, endedAtMs }] = toolCalls;
    expect(outcome).toBe("success");
    expect(appliedAtMs).toHaveLength(1);
    expect(appliedAtMs[0] - startedAtMs).toBeGreaterThanOrEqual(50);
    expect(endedAtMs).toBeGreaterThanOrEqual(appliedAtMs[0]);
  });

  it("takes the duration the effector gives for the call's arguments, the calling agent and the state as the call starts", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 2 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const asked: unknown[] = [];
    const tools = slotTools.map((tool) =>
      tool.kind === "effector"
        ? {
            ...tool,
            durationMs: (state: Slots, call: EffectorCall) => {
              asked.push({ state, call });
              return 40;
            },
          }
        : tool,
    );

    const { toolCalls } = await run(slots({ tools }), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(asked).toEqual([{ state: emptySlots(3), call: { agent: "a", arguments: { slot: 2 } } }]);
    const [{ outcome, startedAtMs, endedAtMs }] = toolCalls;
    expect(outcome).toBe("success");
    expect(endedAtMs - startedAtMs).toBeGreaterThanOrEqual(40);
  });

  it("records beside an effector call's outcome what the agent last sensed of its target, which never decides it", async () => {
    const looking = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const taking = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    // "a" wakes halfway through "b"'s take: it sees slot 1 free, and "b" takes it while "a"'s take is under way.
    const agents = [
      { name: "a", model: looking, activations: 1, rhythm: () => 50 },
      { name: "b", model: taking, activations: 1, rhythm: noWait },
    ];

    const { toolCalls } = await run(slots({ tools: withTakeTaking(100) }), agents, seed, settings);

    const take = toolCalls.find((call) => call.agent === "a" && call.tool === "take");
    expect(take).toMatchObject({ outcome: "slot_taken", targetAsSensed: "free" });
  });

  it("records an effector call by an agent that has sensed nothing as not_sensed", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: { slot: 1 }, outcome: "success", targetAsSensed: "not_sensed", ...timed }]);
  });
});
