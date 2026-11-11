import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { type RunSettings, run } from "../src/engine/run.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import type { Stimuli } from "../src/engine/stimuli.ts";
import type { AgentCall } from "../src/engine/tools.ts";
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
const withLookTaking = (durationMs: number) =>
  slotTools.map((tool) => (tool.kind === "sensor" ? { ...tool, durationMs: () => durationMs } : tool));

/** The test world's tools, with its effector "take" taking this long. */
const withTakeTaking = (durationMs: number) =>
  slotTools.map((tool) => (tool.kind === "effector" ? { ...tool, durationMs: () => durationMs } : tool));

/** A new, empty directory for a run's log. */
const newLogDirectory = () => mkdtempSync(join(tmpdir(), "agents-lab-logs-"));

/** Settings for a run whose test looks at none of them. */
const settings: RunSettings = { logDirectory: newLogDirectory(), modelTurnTimeoutMs: 10_000, parallelismLimit: 10, timeLimitMs: 60_000 };

/** The lines of the only log in a directory, which must be the run's, parsed. */
function logOf(directory: string, runId: string): unknown[] {
  expect(readdirSync(directory)).toEqual([`${runId}.jsonl`]);
  return readFileSync(join(directory, `${runId}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

describe("run", () => {
  it("records each activation in a new log named with its run id: the agent, when it woke and when it ended", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }, { text: "Nothing to do.", delayMs: 0 }]);
    const logDirectory = newLogDirectory();

    const { runId } = await run(slots(), [{ name: "a", model, activations: 2, rhythm: noWait }], seed, { ...settings, logDirectory });

    const activations = logOf(logDirectory, runId).filter((line) => (line as { type: string }).type === "activation");
    expect(activations).toEqual([
      { type: "activation", agent: "a", wokeAtMs: expect.any(Number), endedAtMs: expect.any(Number) },
      { type: "activation", agent: "a", wokeAtMs: expect.any(Number), endedAtMs: expect.any(Number) },
    ]);
    const [first, second] = activations as { wokeAtMs: number; endedAtMs: number }[];
    expect(first.wokeAtMs).toBeLessThanOrEqual(first.endedAtMs);
    expect(first.endedAtMs).toBeLessThanOrEqual(second.wokeAtMs);
  });

  it("records each stimulus delivered to an agent: its channel, source and content, and when it was delivered", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const logDirectory = newLogDirectory();

    const { runId } = await run(slots({ channels: [rhythmChannel, bell] }), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, {
      ...settings,
      logDirectory,
      onStart: (stimuli) => stimuli.deliver("a", "bell"),
    });

    const lines = logOf(logDirectory, runId);
    const stimuli = lines.filter((line) => (line as { type: string }).type === "stimulus");
    expect(stimuli).toEqual([
      { type: "stimulus", agent: "a", channel: "bell", source: "town bell", content: "The bell rings.", deliveredAtMs: expect.any(Number) },
      { type: "stimulus", agent: "a", channel: "rhythm", source: "rhythm", content: "You wake up.", deliveredAtMs: expect.any(Number) },
    ]);
    const [bellRang, woke] = stimuli as { deliveredAtMs: number }[];
    const [activation] = lines.filter((line) => (line as { type: string }).type === "activation") as { wokeAtMs: number }[];
    expect(bellRang.deliveredAtMs).toBeLessThanOrEqual(woke.deliveredAtMs);
    expect(activation.wokeAtMs).toBeLessThanOrEqual(woke.deliveredAtMs);
  });

  it("records each model turn: its text, the model that answered, its wait for a slot, its latency, and the tokens and cost Pi reported", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 20 }]);
    const logDirectory = newLogDirectory();

    const { runId, messages } = await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, { ...settings, logDirectory });

    const answer = messages.get("a")?.find((message) => message.role === "assistant");
    if (answer?.role !== "assistant") throw new Error("the session kept no answer");
    const { cost, ...tokens } = answer.usage;
    const turns = logOf(logDirectory, runId).filter((line) => (line as { type: string }).type === "model_turn");
    expect(turns).toEqual([
      {
        type: "model_turn",
        agent: "a",
        outcome: "success",
        text: "Nothing to do.",
        model: `${model.model.provider}/${model.model.id}`,
        slotWaitMs: expect.any(Number),
        latencyMs: expect.any(Number),
        startedAtMs: expect.any(Number),
        endedAtMs: expect.any(Number),
        tokens,
        cost,
      },
    ]);
    const [turn] = turns as { latencyMs: number; startedAtMs: number; endedAtMs: number }[];
    expect(turn.latencyMs).toBe(turn.endedAtMs - turn.startedAtMs);
    expect(turn.latencyMs).toBeGreaterThanOrEqual(20);
  });

  it("records each tool call as the model made it, with when it started and ended, its outcome and, for a sensor, its result", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { toolCalls: [{ name: "fly", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const logDirectory = newLogDirectory();

    const { runId } = await run(slots(), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, { ...settings, logDirectory });

    expect(logOf(logDirectory, runId).filter((line) => (line as { type: string }).type === "tool_call")).toEqual([
      { type: "tool_call", agent: "a", tool: "look", arguments: {}, outcome: "success", result: '["empty","empty","empty"]', ...timed },
      { type: "tool_call", agent: "a", tool: "fly", arguments: { slot: 1 }, outcome: "unknown_tool", ...timed },
    ]);
  });

  it("records with an effector call the changes other agents applied since its agent last sensed, when it has sensed", async () => {
    // "b" takes slot 2 at once, and its effect lands at 100 ms, while "a", which wakes at 50 ms and looks, takes slot 1.
    const a = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const b = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 2 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(
      slots({ tools: withTakeTaking(100) }),
      [
        { name: "a", model: a, activations: 1, rhythm: () => 50 },
        { name: "b", model: b, activations: 1, rhythm: noWait },
      ],
      seed,
      settings,
    );

    const takes = toolCalls.filter((call) => call.tool === "take");
    expect(takes.find((call) => call.agent === "a")).toMatchObject({ outcome: "success", changesSinceSensing: 1 });
    expect(takes.find((call) => call.agent === "b")).toMatchObject({ targetAsSensed: "not_sensed", changesSinceSensing: null });
  });

  it("stops on an error a tool throws: it ends its log saying so, stops every agent, and fails with the error", async () => {
    const broken = () => {
      throw new Error("the jam broke");
    };
    const jam = {
      kind: "effector" as const,
      name: "jam",
      description: "Jam the slots.",
      parameters: { type: "object", properties: {} },
      durationMs: () => 0,
      action: { precondition: broken, effect: broken },
      readTarget: () => "not_sensed" as const,
    };
    const a = new ScriptedModel([
      { toolCalls: [{ name: "jam", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    // "b" rests long before it wakes: a run that did not stop it would wait for it.
    const b = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const logDirectory = newLogDirectory();
    const startedAtMs = performance.now();

    const running = run(
      slots({ tools: [...slotTools, jam] }),
      [
        { name: "a", model: a, activations: 1, rhythm: noWait },
        { name: "b", model: b, activations: 1, rhythm: () => 3_000 },
      ],
      seed,
      { ...settings, logDirectory },
    );

    await expect(running).rejects.toThrow('agent "a"\'s "jam" call failed: the jam broke');
    expect(performance.now() - startedAtMs).toBeLessThan(2_000);
    const [file] = readdirSync(logDirectory);
    const lines = readFileSync(join(logDirectory, file), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
    expect(lines.at(-1)).toEqual({ type: "run_stopped", error: 'agent "a"\'s "jam" call failed: the jam broke' });
    expect(b.received).toEqual([]);
  });

  it("stops when a session fails to open: it says so in its log, closes the sessions already open, and fails naming the agent", async () => {
    const a = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const unopenable = {
      get model(): never {
        throw new Error("no model to give");
      },
    };
    // Each session's closing is watched, by its model's provider, and still closes it.
    const closed: (string | undefined)[] = [];
    const close = AgentSession.prototype.dispose;
    const watch = vi.spyOn(AgentSession.prototype, "dispose").mockImplementation(function (this: AgentSession) {
      closed.push(this.model?.provider);
      close.call(this);
    });
    const logDirectory = newLogDirectory();

    try {
      const running = run(
        slots(),
        [
          { name: "a", model: a, activations: 1, rhythm: noWait },
          { name: "b", model: unopenable, activations: 1, rhythm: noWait },
        ],
        seed,
        { ...settings, logDirectory },
      );

      await expect(running).rejects.toThrow('the session of agent "b" failed to open: no model to give');
    } finally {
      watch.mockRestore();
    }
    const [file] = readdirSync(logDirectory);
    const lines = readFileSync(join(logDirectory, file), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
    expect(lines.at(-1)).toEqual({ type: "run_stopped", error: 'the session of agent "b" failed to open: no model to give' });
    expect(closed).toEqual([a.model.provider]);
    expect(a.received).toEqual([]);
  });

  it("runs a turn's calls one after another, and records a call the time limit leaves unrun as cut_off, with no target read", async () => {
    const model = new ScriptedModel([
      {
        toolCalls: [
          { name: "look", arguments: {} },
          { name: "take", arguments: { slot: 1 } },
        ],
        delayMs: 0,
      },
      { text: "Done.", delayMs: 0 },
    ]);
    const loaded = slots({ tools: withLookTaking(300) });

    const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, { ...settings, timeLimitMs: 100 });

    const [look, take] = toolCalls;
    expect(look).toMatchObject({ tool: "look", outcome: "cut_off" });
    expect(take).toEqual({ agent: "a", tool: "take", arguments: { slot: 1 }, outcome: "cut_off", ...timed });
    expect(take.startedAtMs).toBeGreaterThanOrEqual(look.endedAtMs);
    expect(loaded.world.version).toBe(0);
  });

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

  it("gives each agent's model that agent's own system prompt", async () => {
    const a = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const b = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const loaded = slots({ agents: () => ["a", "b"], systemPrompt: (_configuration, agent) => `You are "${agent}".` });

    await run(loaded, [{ name: "a", model: a, activations: 1, rhythm: noWait }, { name: "b", model: b, activations: 1, rhythm: noWait }], seed, settings);

    expect([a.received.map(getCurrentSystemPrompt), b.received.map(getCurrentSystemPrompt)]).toEqual([['You are "a".'], ['You are "b".']]);
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

    expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: { slot: "2" }, outcome: "success", targetAsSensed: "not_sensed", changesSinceSensing: null, ...timed }]);
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

    expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: { slot: 1 }, outcome: "slot_taken", targetAsSensed: "not_sensed", changesSinceSensing: null, ...timed }]);
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

  it("takes the duration the sensor gives for the call's arguments, the calling agent and the state as the call starts", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const asked: unknown[] = [];
    const tools = slotTools.map((tool) =>
      tool.kind === "sensor"
        ? {
            ...tool,
            durationMs: (state: Slots, call: AgentCall): number => {
              asked.push({ state, call });
              return 40;
            },
          }
        : tool,
    );

    const { toolCalls } = await run(slots({ tools }), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, settings);

    expect(asked).toEqual([{ state: emptySlots(3), call: { agent: "a", arguments: {} } }]);
    const [{ outcome, startedAtMs, endedAtMs }] = toolCalls;
    expect(outcome).toBe("success");
    expect(endedAtMs - startedAtMs).toBeGreaterThanOrEqual(40);
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
            durationMs: (state: Slots, call: AgentCall): number => {
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

    expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: { slot: 1 }, outcome: "success", targetAsSensed: "not_sensed", changesSinceSensing: null, ...timed }]);
  });
});

describe("run's time limit", () => {
  it("counts from when the agents can start, once every session is open, and gives that moment as the run's start", async () => {
    const loaded = slots();
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    let setUpEndedAtMs = 0;

    const { toolCalls, startedAtMs } = await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, {
      ...settings,
      timeLimitMs: 100,
      // Setting the run up, made slower than the time limit here, comes before the agents can start and uses none of it.
      onStart: () => {
        const untilMs = performance.now() + 150;
        while (performance.now() < untilMs) {
          // Busy: a timer of the run's could not fire during this set-up, only once it ends.
        }
        setUpEndedAtMs = performance.now();
      },
    });

    expect(toolCalls).toEqual([expect.objectContaining({ outcome: "success" })]);
    expect(loaded.world.state).toEqual(["a", null, null]);
    expect(startedAtMs).toBeGreaterThanOrEqual(setUpEndedAtMs);
  });

  it("aborts a model turn still running at the time limit, records it as cut_off, and runs none of its tool calls", async () => {
    const loaded = slots();
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 1000 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { turns, toolCalls, startedAtMs } = await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, {
      ...settings,
      timeLimitMs: 100,
    });

    expect(turns).toEqual([expect.objectContaining({ agent: "a", outcome: "cut_off" })]);
    expect(turns[0].endedAtMs - startedAtMs).toBeLessThan(500);
    expect(toolCalls).toEqual([]);
    expect(loaded.world.state).toEqual(emptySlots(3));
  });

  it("starts no model turn once the time limit has passed, even in an activation whose last turn called a tool", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { turns } = await run(slots({ tools: withTakeTaking(1000) }), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, {
      ...settings,
      timeLimitMs: 100,
    });

    expect(turns).toHaveLength(1);
    expect(model.received).toHaveLength(1);
  });

  it("starts no activation once the time limit has passed: an agent resting then does not wake again, nor holds the run", async () => {
    const model = new ScriptedModel(Array.from({ length: 3 }, () => ({ text: "Nothing to do.", delayMs: 0 })));
    const wokeAtMs: number[] = [];

    const { startedAtMs } = await run(slots(), [{ name: "a", model, activations: 3, rhythm: () => 80 }], seed, {
      ...settings,
      timeLimitMs: 100,
      onStart: (stimuli) => {
        const wake = stimuli.wake.bind(stimuli);
        stimuli.wake = (agent) => (wokeAtMs.push(performance.now()), wake(agent));
      },
    });

    // It wakes once, at 80 ms; its next rest would end at 160 ms, past the time limit, and the run ends at the limit.
    const endedAtMs = performance.now();
    expect(wokeAtMs).toHaveLength(1);
    expect(wokeAtMs[0] - startedAtMs).toBeLessThan(100);
    expect(endedAtMs - startedAtMs).toBeLessThan(150);
  });

  it("cuts off an effector call still running at the time limit: it applies nothing, ends then, and the agent is told so", async () => {
    const loaded = slots({ tools: withTakeTaking(1000) });
    const { world } = loaded;
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const runStartedAtMs = performance.now();
    const { toolCalls, messages } = await run(loaded, [{ name: "a", model, activations: 1, rhythm: noWait }], seed, {
      ...settings,
      timeLimitMs: 100,
    });

    const [{ outcome, endedAtMs }] = toolCalls;
    expect(outcome).toBe("cut_off");
    expect(world.state).toEqual(emptySlots(3));
    expect(world.version).toBe(0);
    // Its call ends at the time limit, not when its 1000 ms would have.
    expect(endedAtMs - runStartedAtMs).toBeLessThan(500);
    const result = messages.get("a")?.find((message) => message.role === "toolResult");
    expect(result).toMatchObject({ isError: true, content: [{ type: "text", text: "cut_off" }] });
  });

  it("cuts off a sensor call still running at the time limit: it ends then, returns nothing of the world, and is no sensing", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const runStartedAtMs = performance.now();
    const { toolCalls, messages, sensings } = await run(slots({ tools: withLookTaking(1000) }), [{ name: "a", model, activations: 1, rhythm: noWait }], seed, {
      ...settings,
      timeLimitMs: 100,
    });

    const [{ outcome, endedAtMs }] = toolCalls;
    expect(outcome).toBe("cut_off");
    expect(endedAtMs - runStartedAtMs).toBeLessThan(500);
    const result = messages.get("a")?.find((message) => message.role === "toolResult");
    expect(result).toMatchObject({ isError: true, content: [{ type: "text", text: "cut_off" }] });
    expect(sensings.last("a")).toBeUndefined();
  });
});
