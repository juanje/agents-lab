import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { ToolCall } from "../src/engine/adapter.ts";
import { type RunSettings, run } from "../src/engine/run.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { type Rhythm, type Scenario, loadScenario } from "../src/engine/scenario.ts";
import type { Stimuli } from "../src/engine/stimuli.ts";
import type { AgentCall, Effector, Sensor } from "../src/engine/tools.ts";
import type { Component } from "../src/engine/components.ts";
import { type Slots, emptySlots, filler, holder, rhythmChannel, slotTools, slotsScenario, take } from "./fixtures/slots.ts";

/** A rhythm with no waiting: the agent wakes again as soon as its previous activation ends. */
const noWait = () => 0;

/** The part of the slots test scenario that gives each agent its rhythm: these, by agent, and no wait for any other. */
const rhythms = (byAgent: Readonly<Record<string, Rhythm>>): Pick<Scenario<Slots>, "rhythm"> => ({
  rhythm: (_configuration, agent) => byAgent[agent] ?? noWait,
});

/** A replica's seed, for a run whose rhythms draw nothing from it. */
const seed = 1;

/** The slots test scenario as loaded with 3 empty slots, with any of its parts replaced. */
const slots = (parts: Partial<Scenario<Slots>> = {}) => loadScenario({ ...slotsScenario, ...parts }, seed);

/** The part of the slots test scenario that names its agents, naming these; its base configuration names only "a". */
const agentsNamed = (...names: string[]) => ({ agents: () => names });

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
const settings: RunSettings = { logDirectory: newLogDirectory(), modelTurnTimeoutMs: 10_000, parallelismLimit: 10, timeLimitMs: 60_000, thinkingLevel: "off" };

/** What a run of an experiment runs, for a test that gives one and checks only where it is written. */
const setup = {
  experiment: "e-test",
  condition: "baseline",
  configuration: { agents: ["a"] },
  replica: 1,
  seed,
  model: "scripted/one",
  code: { commit: "0000000", uncommittedChanges: false },
  inventory: {} as never,
  materials: [{ path: "materials/wake.md", key: "rhythm.text", hash: "sha256:0", heldOut: false }],
};

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

    const { runId } = await run(slots(), [{ name: "a", model, activations: 2 }], seed, { ...settings, logDirectory });

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

    const { runId } = await run(slots({ channels: () => [rhythmChannel, bell] }), [{ name: "a", model, activations: 1 }], seed, {
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

    const { runId, messages } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory });

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

  it("records with a model turn the reasoning its provider returned, and no reasoning for a turn that returned none", async () => {
    const model = new ScriptedModel([
      { reasoning: "The slot may be taken; I should look first.", toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const logDirectory = newLogDirectory();

    const { runId } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory });

    const turns = logOf(logDirectory, runId).filter((line) => (line as { type: string }).type === "model_turn") as Record<string, unknown>[];
    expect(turns.map((turn) => turn.reasoning)).toEqual(["The slot may be taken; I should look first.", undefined]);
    expect(Object.hasOwn(turns[1], "reasoning")).toBe(false);
  });

  it("records each tool call as the model made it, with when it started and ended, its outcome and, for a sensor, its result", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { toolCalls: [{ name: "fly", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const logDirectory = newLogDirectory();

    const { runId } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory });

    expect(logOf(logDirectory, runId).filter((line) => (line as { type: string }).type === "tool_call")).toEqual([
      { type: "tool_call", agent: "a", tool: "look", arguments: {}, outcome: "success", result: '["empty","empty","empty"]', ...timed },
      { type: "tool_call", agent: "a", tool: "fly", arguments: { slot: 1 }, outcome: "unknown_tool", ...timed },
    ]);
  });

  it("records with an effector call the changes other agents applied since its agent last sensed, and who applied them, when it has sensed", async () => {
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
      slots({ tools: withTakeTaking(100), ...agentsNamed("a", "b"), ...rhythms({ a: () => 50 }) }),
      [
        { name: "a", model: a, activations: 1 },
        { name: "b", model: b, activations: 1 },
      ],
      seed,
      settings,
    );

    const takes = toolCalls.filter((call) => call.tool === "take");
    expect(takes.find((call) => call.agent === "a")).toMatchObject({ outcome: "success", changesSinceSensing: 1, changesSinceSensingBy: ["b"] });
    expect(takes.find((call) => call.agent === "b")).toMatchObject({ targetAsSensed: "not_sensed", changesSinceSensing: null, changesSinceSensingBy: null });
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
      slots({ tools: [...slotTools, jam], ...agentsNamed("a", "b"), ...rhythms({ b: () => 3_000 }) }),
      [
        { name: "a", model: a, activations: 1 },
        { name: "b", model: b, activations: 1 },
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

  it("gives every session the thinking level it is given, and writes the setup it is given first, once the sessions are open, with each session's thinking level and the provider's defaults for every other sampling parameter, before any stimulus onStart delivers", async () => {
    // Models that can reason, so a thinking level other than "off" is one they can use.
    const a = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }], "a", { reasoning: true });
    const b = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }], "b", { reasoning: true });
    const logDirectory = newLogDirectory();

    const { runId } = await run(
      slots({ ...agentsNamed("a", "b"), channels: () => [rhythmChannel, bell] }),
      [
        { name: "a", model: a, activations: 1 },
        { name: "b", model: b, activations: 1 },
      ],
      seed,
      { ...settings, logDirectory, setup, thinkingLevel: "low", onStart: (stimuli) => stimuli.deliver("a", "bell") },
    );

    expect([...a.reasoningLevels, ...b.reasoningLevels]).toEqual(["low", "low"]);
    const [first, second] = logOf(logDirectory, runId) as { type: string }[];
    expect(first).toEqual({
      type: "run_setup",
      runId,
      ...setup,
      sampling: { thinkingLevels: { a: "low", b: "low" }, otherParameters: "the provider's defaults" },
    });
    expect(second.type).toBe("stimulus");
  });

  it("writes the setup it is given first, with no sampling settings, when a session fails to open", async () => {
    const unopenable = {
      get model(): never {
        throw new Error("no model to give");
      },
    };
    const logDirectory = newLogDirectory();

    await expect(run(slots(), [{ name: "a", model: unopenable, activations: 1 }], seed, { ...settings, logDirectory, setup })).rejects.toThrow("no model to give");

    const [file] = readdirSync(logDirectory);
    const lines = readFileSync(join(logDirectory, file), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((line) => line.type)).toEqual(["run_setup", "run_stopped"]);
    expect(lines[0]).toEqual({ type: "run_setup", runId: file.replace(".jsonl", ""), ...setup, sampling: null });
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
        slots(agentsNamed("a", "b")),
        [
          { name: "a", model: a, activations: 1 },
          { name: "b", model: unopenable, activations: 1 },
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

  it("stops when it is interrupted: it ends its log saying it was interrupted, stops every agent, closes every session, and fails saying so", async () => {
    const models = { a: new ScriptedModel([{ text: "Nothing to do.", delayMs: 500 }]), b: new ScriptedModel([{ text: "Nothing to do.", delayMs: 500 }]) };
    const closed: (string | undefined)[] = [];
    const close = AgentSession.prototype.dispose;
    const watch = vi.spyOn(AgentSession.prototype, "dispose").mockImplementation(function (this: AgentSession) {
      closed.push(this.model?.provider);
      close.call(this);
    });
    const logDirectory = newLogDirectory();
    const interruption = new AbortController();
    const startedAtMs = performance.now();

    try {
      const running = run(
        slots(agentsNamed("a", "b")),
        [
          { name: "a", model: models.a, activations: 3 },
          { name: "b", model: models.b, activations: 3 },
        ],
        seed,
        // Interrupted while both agents' first model turns are running.
        { ...settings, logDirectory, interruption: interruption.signal, onStart: () => setTimeout(() => interruption.abort(), 100) },
      );

      await expect(running).rejects.toThrow("the run was interrupted");
    } finally {
      watch.mockRestore();
    }
    // The turns are cut short, not waited for.
    expect(performance.now() - startedAtMs).toBeLessThan(450);
    const [file] = readdirSync(logDirectory);
    const lines = readFileSync(join(logDirectory, file), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
    expect(lines.at(-1)).toEqual({ type: "run_stopped", error: "the run was interrupted" });
    expect(closed.sort()).toEqual([models.a.model.provider, models.b.model.provider].sort());
  });

  it("stops at once when it is interrupted before it starts, running no model turn", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const logDirectory = newLogDirectory();

    const running = run(slots(), [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory, interruption: AbortSignal.abort() });

    await expect(running).rejects.toThrow("the run was interrupted");
    expect(model.received).toEqual([]);
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

    const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, { ...settings, timeLimitMs: 100 });

    const [look, take] = toolCalls;
    expect(look).toMatchObject({ tool: "look", outcome: "cut_off" });
    expect(take).toEqual({ agent: "a", tool: "take", arguments: { slot: 1 }, outcome: "cut_off", ...timed });
    expect(take.startedAtMs).toBeGreaterThanOrEqual(look.endedAtMs);
    expect(loaded.world.version).toBe(0);
  });

  it("starts an activation with the rhythm channel's stimulus, which the model reads with its source", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(slots(), [{ name: "a", model, activations: 1 }], seed, settings);

    const [first] = model.received[0]?.filter((message) => message.role !== "system") ?? [];
    expect(first).toMatchObject({ role: "user", content: [{ type: "text", text: "rhythm: You wake up." }] });
  });

  it("gives what each agent's session held at the end: its stimuli, keeping their channel and source, and its model turns", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    const { messages } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, settings);

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

    await run(slots({ channels: () => [rhythmChannel, bell] }), [{ name: "a", model, activations: 1 }], seed, {
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

    await run(slots({ channels: () => [rhythmChannel, bell], ...rhythms({ a: restsOnceWithBell }) }), [{ name: "a", model, activations: 2 }], seed, {
      ...settings,
      onStart: (started) => (stimuli = started),
    });

    const text = (value: string) => ({ role: "user", content: [{ type: "text", text: value }] });
    expect(model.received[1]?.slice(-2)).toMatchObject([text("rhythm: You wake up."), text("town bell: The bell rings.")]);
  });

  it("gives each agent its first stimuli as it first wakes, after the rhythm's, and not at its next wake", async () => {
    const model = new ScriptedModel([
      { text: "Nothing to do.", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);

    await run(slots({ channels: () => [rhythmChannel, bell], firstStimuli: () => ["bell"] }), [{ name: "a", model, activations: 2 }], seed, settings);

    const text = (value: string) => ({ role: "user", content: [{ type: "text", text: value }] });
    expect(model.received[0]?.slice(-2)).toMatchObject([text("rhythm: You wake up."), text("town bell: The bell rings.")]);
    expect(model.received[1]?.slice(-2)).toMatchObject([{ role: "assistant" }, text("rhythm: You wake up.")]);
  });

  it("delivers a stimulus that arrives during a model turn at the agent's next model turn", async () => {
    let stimuli: Stimuli | undefined;
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 100 },
      { text: "Done.", delayMs: 0 },
    ]);
    // The rhythm is called as the agent starts to wait, and with no wait the agent wakes as it returns.
    const ringsAfter50 = () => (setTimeout(() => stimuli?.deliver("a", "bell"), 50), 0);

    await run(slots({ channels: () => [rhythmChannel, bell], ...rhythms({ a: ringsAfter50 }) }), [{ name: "a", model, activations: 1 }], seed, {
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

    await run(slots(), [{ name: "a", model, activations: 1 }], seed, settings);

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

    await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

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

    await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

    expect(world.state).toEqual(["a", null, null]);
    expect(world.version).toBe(1);
  });

  it("runs all of an agent's model turns in one Pi session, across its activations", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);

    await run(slots(), [{ name: "a", model, activations: 2 }], seed, settings);

    expect(model.sessions).toEqual([expect.any(String), model.sessions[0], model.sessions[0]]);
  });

  it("gives the agent's model the scenario's system prompt and nothing else", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(slots({ systemPrompt: () => "You live in a row of slots." }), [{ name: "a", model, activations: 1 }], seed, settings);

    expect(model.received.map(getCurrentSystemPrompt)).toEqual(["You live in a row of slots."]);
  });

  it("gives each agent's model that agent's own system prompt", async () => {
    const a = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const b = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const loaded = slots({ ...agentsNamed("a", "b"), systemPrompt: (_configuration, agent) => `You are "${agent}".` });

    await run(loaded, [{ name: "a", model: a, activations: 1 }, { name: "b", model: b, activations: 1 }], seed, settings);

    expect([a.received.map(getCurrentSystemPrompt), b.received.map(getCurrentSystemPrompt)]).toEqual([['You are "a".'], ['You are "b".']]);
  });

  it("wakes each agent with the rhythm channel the loaded scenario built from its configuration", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const loaded = slots({ channels: () => [{ name: "rhythm", source: "clock", stimulus: "Later." }] });

    await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

    expect(model.received[0]?.filter((message) => message.role !== "system")).toMatchObject([
      { role: "user", content: [{ type: "text", text: "clock: Later." }] },
    ]);
  });

  it.each([
    [["a", "c"], 'The run\'s agents are not those of scenario "slots": "b" is missing; "c" is not declared'],
    [["a"], 'The run\'s agents are not those of scenario "slots": "b" is missing'],
    [["a", "b", "c"], 'The run\'s agents are not those of scenario "slots": "c" is not declared'],
  ])("refuses a run of agents %j in a scenario of agents a and b before any model call, naming the difference", async (names, message) => {
    const models = names.map(() => new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]));
    const agents = names.map((name, index) => ({ name, model: models[index], activations: 1 }));

    await expect(run(slots(agentsNamed("a", "b")), agents, seed, settings)).rejects.toThrow(message);

    expect(models.map((model) => model.received)).toEqual(names.map(() => []));
  });

  it("opens its sessions in the lab's Pi directory, and leaves the person's as it was", async () => {
    const persons = join(homedir(), ".pi", "agent");
    mkdirSync(persons, { recursive: true });
    writeFileSync(join(persons, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-6-luna" }));
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);

    await run(slots(), [{ name: "a", model, activations: 1 }], seed, settings);

    expect(readdirSync(persons, { recursive: true })).toEqual(["settings.json"]);
    expect(existsSync(join(homedir(), ".agents-lab", "pi"))).toBe(true);
    expect(model.received).toHaveLength(1);
  });

  it("records a turn the provider answered with an error as model_error, with its message, and ends the activation there", async () => {
    const model = new ScriptedModel([
      { error: "overloaded", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);

    const { turns } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, settings);

    expect(turns).toEqual([expect.objectContaining({ agent: "a", outcome: "model_error", message: "overloaded" })]);
    expect(model.received).toHaveLength(1);
  });

  it("records the turn past the end of the script as script_exhausted, and ends the activation there", async () => {
    const model = new ScriptedModel([{ toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 }]);

    const { turns, messages } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, settings);

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

    const { turns } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, {
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

    const { turns } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, settings);
    const [turn] = turns;

    expect(turn?.startedAtMs).toBeGreaterThanOrEqual(before);
    expect((turn?.endedAtMs ?? 0) - (turn?.startedAtMs ?? 0)).toBeGreaterThanOrEqual(50);
    expect(turn?.endedAtMs).toBeLessThanOrEqual(performance.now());
  });

  it("makes a model turn wait for a free slot when the parallelism limit is reached, and records the wait", async () => {
    const answersAfter50 = () => new ScriptedModel([{ text: "Nothing to do.", delayMs: 50 }]);

    const { turns } = await run(
      slots(agentsNamed("a", "b", "c")),
      ["a", "b", "c"].map((name) => ({ name, model: answersAfter50(), activations: 1 })),
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
    const loaded = slots(agentsNamed("a", "b"));
    const { world } = loaded;
    const takes = (slot: number) =>
      new ScriptedModel([
        { toolCalls: [{ name: "take", arguments: { slot } }], delayMs: 0 },
        { text: "Done.", delayMs: 0 },
      ]);

    await run(
      loaded,
      [
        { name: "a", model: takes(1), activations: 1 },
        { name: "b", model: takes(2), activations: 1 },
      ],
      seed,
      settings,
    );

    expect(world.state).toEqual(["a", "b", null]);
  });

  it("names its log with the run id it is given, so its caller knows the id before the run starts or stops", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const logDirectory = newLogDirectory();

    const { runId } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory, runId: "replica-1" });

    expect(runId).toBe("replica-1");
    expect(readdirSync(logDirectory)).toEqual(["replica-1.jsonl"]);
  });

  it("hands each line of its log to onRecord as it writes it, so its caller follows the run from what it records", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const logDirectory = newLogDirectory();
    const read: unknown[] = [];

    const { runId } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory, onRecord: (line) => read.push(line) });

    expect(read).toEqual(logOf(logDirectory, runId));
  });

  it("waits before each agent's activation the interval the loaded scenario's rhythm draws for that agent", async () => {
    const a = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const b = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const logDirectory = newLogDirectory();
    const loaded = slots({ ...agentsNamed("a", "b"), rhythm: (_configuration, agent) => () => (agent === "a" ? 80 : 0) });

    const { runId, startedAtMs } = await run(
      loaded,
      [
        { name: "a", model: a, activations: 1 },
        { name: "b", model: b, activations: 1 },
      ],
      seed,
      { ...settings, logDirectory },
    );

    const woke = new Map(
      (logOf(logDirectory, runId) as { type: string; agent: string; wokeAtMs: number }[])
        .filter((line) => line.type === "activation")
        .map((line) => [line.agent, line.wokeAtMs - startedAtMs]),
    );
    expect(woke.get("a")).toBeGreaterThanOrEqual(80);
    expect(woke.get("b")).toBeLessThan(80);
  });

  it("gives each agent's rhythm the same draws for the same seed, however long the other agents' models take", async () => {
    /** Runs agents "a" and "b" with seed 42, "b" answering after its delay, and gives the draws of "a"'s rhythm. */
    async function drawsOfA(bDelayMs: number): Promise<number[]> {
      const draws: number[] = [];
      const answers = (delayMs: number) => new ScriptedModel(Array.from({ length: 4 }, () => ({ text: "resting", delayMs })));
      await run(
        slots({
          tools: [],
          ...agentsNamed("a", "b"),
          ...rhythms({ a: (source) => (draws.push(source.next()), 5), b: (source) => source.next() * 5 }),
        }),
        [
          { name: "a", model: answers(0), activations: 4 },
          { name: "b", model: answers(bDelayMs), activations: 4 },
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
        slots({
          tools: [],
          ...agentsNamed(...names),
          rhythm: (_configuration, name) => (source) => (name === "b" ? (draws.push(source.next()), 0) : source.next()),
        }),
        names.map((name) => ({
          name,
          model: new ScriptedModel(Array.from({ length: 3 }, () => ({ text: "resting", delayMs: 0 }))),
          activations: 3,
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

    const { turns } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

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

      const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

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

    const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

    expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: { slot: "2" }, outcome: "success", text: "success", targetAsSensed: "not_sensed", changesSinceSensing: null, changesSinceSensingBy: null, ...timed }]);
    expect(world.state).toEqual([null, "a", null]);
  });
  it("records a call to a tool the session does not offer as unknown_tool, applies nothing, and goes on", async () => {
    const loaded = slots();
    const { world } = loaded;
    const model = new ScriptedModel([
      { toolCalls: [{ name: "fly", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

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

    await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

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

    const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

    expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: { slot: 1 }, outcome: "slot_taken", text: "slot_taken", targetAsSensed: "not_sensed", changesSinceSensing: null, changesSinceSensingBy: null, ...timed }]);
    expect(model.received[1]?.at(-1)).toMatchObject({ role: "toolResult", isError: true, content: [{ type: "text", text: "slot_taken" }] });
  });

  it("marks the result of a call that succeeded as no error", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    await run(slots(), [{ name: "a", model, activations: 1 }], seed, settings);

    expect(model.received[1]?.at(-1)).toMatchObject({ role: "toolResult", isError: false, content: [{ type: "text", text: "success" }] });
  });
  it("gives the agent the text the effector declares for the outcome, success included, or the outcome when it declares none", async () => {
    const texts = { slot_taken: "Someone holds that slot.", success: "You took it." };
    const loaded = slots({ tools: slotTools.map((tool) => (tool.kind === "effector" ? { ...tool, texts } : tool)), baseConfiguration: slotsScenario.baseConfiguration.replace("held = 0", "held = 1") });
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { toolCalls: [{ name: "take", arguments: { slot: 2 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

    expect(model.received[1]?.at(-1)).toMatchObject({ role: "toolResult", isError: true, content: [{ type: "text", text: "Someone holds that slot." }] });
    expect(model.received[2]?.at(-1)).toMatchObject({ role: "toolResult", isError: false, content: [{ type: "text", text: "You took it." }] });
  });
  it("records the text an effector's agent received beside the call's outcome, in what the run gives and in its log", async () => {
    const logDirectory = newLogDirectory();
    const texts = { slot_taken: "Someone holds that slot." };
    const loaded = slots({ tools: slotTools.map((tool) => (tool.kind === "effector" ? { ...tool, texts } : tool)), baseConfiguration: slotsScenario.baseConfiguration.replace("held = 0", "held = 1") });
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls, runId } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory });

    expect(toolCalls).toMatchObject([{ tool: "take", outcome: "slot_taken", text: "Someone holds that slot." }]);
    expect(logOf(logDirectory, runId)).toContainEqual(expect.objectContaining({ type: "tool_call", tool: "take", outcome: "slot_taken", text: "Someone holds that slot." }));
  });
  it("gives the agent the outcome itself for an outcome the effector declares no text for", async () => {
    const loaded = slots({ tools: slotTools.map((tool) => (tool.kind === "effector" ? { ...tool, texts: { slot_taken: "Someone holds that slot." } } : tool)) });
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

    expect(model.received[1]?.at(-1)).toMatchObject({ role: "toolResult", isError: false, content: [{ type: "text", text: "success" }] });
  });
  it("rejects an argument the tool does not declare, though its schema allows it, telling the agent which", async () => {
    const loaded = slots();
    const { world } = loaded;
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1, x: 2 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

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

    const { toolCalls } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, settings);

    expect(toolCalls).toEqual([{ agent: "a", tool: "look", arguments: { slot: 1 }, outcome: "invalid_arguments", ...timed }]);
    expect(model.received[1]?.at(-1)).toMatchObject({ role: "toolResult", isError: true });
  });

  it("records when each tool call started and ended, and a sensor's call takes its declared duration", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(slots({ tools: withLookTaking(50) }), [{ name: "a", model, activations: 1 }], seed, settings);

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

    const { toolCalls } = await run(slots({ tools }), [{ name: "a", model, activations: 1 }], seed, settings);

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
      { name: "a", model: looking, activations: 1 },
      { name: "b", model: taking, activations: 1 },
    ];

    const { toolCalls } = await run(slots({ tools: withLookTaking(100), ...agentsNamed("a", "b") }), agents, seed, settings);

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

    const { toolCalls, sensings } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, settings);

    expect(sensings?.last("a")).toEqual({ tool: "look", result: '["empty","empty","empty"]', atMs: toolCalls[0]?.endedAtMs });
  });

  it("gives a sensor the call's arguments, as it gives an effector's action", async () => {
    // A sensor that reads one slot, the one the call names.
    const peek: Sensor<Slots> = {
      kind: "sensor",
      name: "peek",
      description: "See whether a slot is held.",
      parameters: { type: "object", properties: { slot: { type: "integer" } }, required: ["slot"] },
      durationMs: () => 0,
      sense: (state, agent, args) => `${agent} sees slot ${String(args.slot)} ${state[(args.slot as number) - 1] === null ? "empty" : "held"}`,
    };
    const model = new ScriptedModel([
      { toolCalls: [{ name: "peek", arguments: { slot: 2 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(slots({ tools: [peek], initialState: () => [null, "z", null] }), [{ name: "a", model, activations: 1 }], seed, settings);

    expect(toolCalls[0]).toMatchObject({ outcome: "success", result: "a sees slot 2 held" });
  });

  it("keeps where a sensor's call was taken from, when the sensor declares it, beside what it returned", async () => {
    const look: Sensor<Slots> = { ...(slotTools[0] as Sensor<Slots>), sense: () => "seen", takenFrom: (_state: Slots, agent: string) => ({ x: agent.length, y: 7 }) };
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls, sensings } = await run(slots({ tools: [look, slotTools[1]] }), [{ name: "a", model, activations: 1 }], seed, settings);

    expect(sensings.last("a")).toEqual({ tool: "look", result: "seen", takenFrom: { x: 1, y: 7 }, atMs: toolCalls[0]?.endedAtMs });
  });

  it("gives an effector's target reading the state as the call starts, beside the agent's last sensing", async () => {
    // This reading looks only at the state: two slots read as "held", whatever the look showed.
    const take: Effector<Slots> = { ...(slotTools[1] as Effector<Slots>), readTarget: (_sensing: unknown, _call: AgentCall, state: Slots) => (state.length === 2 ? "held" as const : "free" as const) };
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(
      slots({ tools: [slotTools[0], take], initialState: () => emptySlots(2) }),
      [{ name: "a", model, activations: 1 }],
      seed,
      settings,
    );

    expect(toolCalls.find((call) => call.tool === "take")).toMatchObject({ outcome: "success", targetAsSensed: "held" });
  });

  it("gives an effector's target reading the agent's last sensing by each sensor, whatever it sensed after it", async () => {
    // A second sensor, called after "look": the reading finds "look"'s sensing by its name.
    const glance: Sensor<Slots> = { ...(slotTools[0] as Sensor<Slots>), name: "glance", sense: () => "glanced" };
    const take: Effector<Slots> = {
      ...(slotTools[1] as Effector<Slots>),
      readTarget: (sensing, _call, _state, lastBy) => (sensing.tool === "glance" && lastBy("look")?.result === "seen" ? "free" : "not_sensed"),
    };
    const look: Sensor<Slots> = { ...(slotTools[0] as Sensor<Slots>), sense: () => "seen" };
    const model = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { toolCalls: [{ name: "glance", arguments: {} }], delayMs: 0 },
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(slots({ tools: [look, glance, take] }), [{ name: "a", model, activations: 1 }], seed, settings);

    expect(toolCalls.find((call) => call.tool === "take")).toMatchObject({ outcome: "success", targetAsSensed: "free" });
  });

  it("keeps no sensing of an effector's call, nor of a sensor's call it rejected", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { toolCalls: [{ name: "look", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { sensings } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, settings);

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

    const { toolCalls } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, settings);

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

    const { toolCalls } = await run(slots({ tools }), [{ name: "a", model, activations: 1 }], seed, settings);

    expect(asked).toEqual([{ state: emptySlots(3), call: { agent: "a", arguments: { slot: 2 } } }]);
    const [{ outcome, startedAtMs, endedAtMs }] = toolCalls;
    expect(outcome).toBe("success");
    expect(endedAtMs - startedAtMs).toBeGreaterThanOrEqual(40);
  });

  /**
   * An effector under way in the slots world, "cross": as its call starts, its agent takes slot 1, and when it lands,
   * the agent moves from slot 1 to slot 2. It takes this long, from the state as the call starts, kept in `asked`.
   */
  const crossing = (durationMs: number, asked: unknown[] = []): Effector<Slots> => ({
    kind: "effector",
    name: "cross",
    description: "Cross from slot 1 to slot 2.",
    parameters: { type: "object", properties: {} },
    durationMs: (state) => {
      asked.push(state);
      return durationMs;
    },
    start: {
      precondition: (state, { agent }) => take.precondition(state, { agent, slot: 1 }),
      effect: (state, { agent }) => take.effect(state, { agent, slot: 1 }),
      // What the start changes, as the effector describes it, from the state before it.
      describe: (state) => ({ took: 1, before: state[0] }),
    },
    action: {
      precondition: (state, { agent }) => take.precondition(state, { agent, slot: 2 }),
      effect: (state, { agent }) => [null, agent, ...state.slice(2)],
    },
    readTarget: () => "not_sensed",
  });

  it("applies an effector's start through the arbiter as its call starts, after taking its duration from the state before it, and its effect when it lands", async () => {
    // "a" crosses at once, over 100 ms; "b" looks 50 ms in.
    const a = new ScriptedModel([
      { toolCalls: [{ name: "cross", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const b = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const asked: unknown[] = [];
    const loaded = slots({ tools: [...slotTools, crossing(100, asked)], ...agentsNamed("a", "b"), ...rhythms({ b: () => 50 }) });

    const { toolCalls } = await run(
      loaded,
      [
        { name: "a", model: a, activations: 1 },
        { name: "b", model: b, activations: 1 },
      ],
      seed,
      settings,
    );

    expect(asked).toEqual([emptySlots(3)]);
    const cross = toolCalls.find((call) => call.tool === "cross");
    const look = toolCalls.find((call) => call.tool === "look");
    expect(look?.startedAtMs).toBeLessThan(cross?.endedAtMs ?? -Infinity);
    expect(look?.result).toBe('["held","empty","empty"]');
    expect(cross).toMatchObject({ outcome: "success" });
    expect(loaded.world.state).toEqual([null, "a", null]);
    expect(loaded.world.version).toBe(2);
  });

  it("records an effector's start in its log as it is applied, before its call's line: the agent, the tool, the moment the call started, and the change as the effector describes it", async () => {
    const a = new ScriptedModel([
      { toolCalls: [{ name: "cross", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const logDirectory = newLogDirectory();

    const { runId, toolCalls } = await run(slots({ tools: [...slotTools, crossing(50)] }), [{ name: "a", model: a, activations: 1 }], seed, { ...settings, logDirectory });

    const lines = logOf(logDirectory, runId) as { type: string }[];
    const startAt = lines.findIndex((line) => line.type === "effector_start");
    const callAt = lines.findIndex((line) => line.type === "tool_call");
    expect(lines[startAt]).toEqual({ type: "effector_start", agent: "a", tool: "cross", atMs: toolCalls[0].startedAtMs, change: { took: 1, before: null } });
    expect(startAt).toBeLessThan(callAt);
    expect(lines.filter((line) => line.type === "effector_start")).toHaveLength(1);
  });

  it("counts an effector's start among the changes since sensing of another agent's effector call", async () => {
    // "b" looks at once and takes slot 3 over 50 ms; "a" starts crossing 20 ms in, so its start lands between them.
    const a = new ScriptedModel([
      { toolCalls: [{ name: "cross", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const b = new ScriptedModel([
      { toolCalls: [{ name: "look", arguments: {} }], delayMs: 0 },
      { toolCalls: [{ name: "take", arguments: { slot: 3 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(
      slots({ tools: [...withTakeTaking(50), crossing(200)], ...agentsNamed("a", "b"), ...rhythms({ a: () => 20 }) }),
      [
        { name: "a", model: a, activations: 1 },
        { name: "b", model: b, activations: 1 },
      ],
      seed,
      settings,
    );

    const take = toolCalls.find((call) => call.tool === "take");
    const cross = toolCalls.find((call) => call.tool === "cross");
    expect(cross?.startedAtMs).toBeLessThan(take?.endedAtMs ?? -Infinity);
    expect(take).toMatchObject({ outcome: "success", changesSinceSensing: 1, changesSinceSensingBy: ["a"] });
  });

  it("applies no start for a call the effector's start does not apply to: its action alone says how it ends", async () => {
    const a = new ScriptedModel([
      { toolCalls: [{ name: "cross", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const logDirectory = newLogDirectory();
    // Slot 1 is held, so this crossing does not start, and slot 2 is held, so its action fails.
    const cross = crossing(0);
    const notStarting: Effector<Slots> = { ...cross, start: { ...(cross.start as NonNullable<Effector<Slots>["start"]>), appliesTo: (state) => state[0] === null } };
    const loaded = slots({ tools: [...slotTools, notStarting], initialState: () => ["z", "y", null] });

    const { runId, toolCalls } = await run(loaded, [{ name: "a", model: a, activations: 1 }], seed, { ...settings, logDirectory });

    expect(toolCalls[0]).toMatchObject({ tool: "cross", outcome: "slot_taken" });
    expect(loaded.world.version).toBe(0);
    expect((logOf(logDirectory, runId) as { type: string }[]).filter((line) => line.type === "effector_start")).toEqual([]);
  });

  it("gives an effector's action the moment it is checked and applied, by the run's clock", async () => {
    const a = new ScriptedModel([
      { toolCalls: [{ name: "stamp", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const moments: number[] = [];
    const stamp: Effector<Slots> = {
      kind: "effector",
      name: "stamp",
      description: "Take slot 1, noting when.",
      parameters: { type: "object", properties: {} },
      durationMs: () => 30,
      action: {
        precondition: (state, { agent, atMs }) => {
          moments.push(atMs);
          return take.precondition(state, { agent, slot: 1 });
        },
        effect: (state, { agent, atMs }) => {
          moments.push(atMs);
          return take.effect(state, { agent, slot: 1 });
        },
      },
      readTarget: () => "not_sensed",
    };

    const { toolCalls } = await run(slots({ tools: [stamp] }), [{ name: "a", model: a, activations: 1 }], seed, settings);

    const [{ startedAtMs, endedAtMs }] = toolCalls;
    expect(moments).toHaveLength(2);
    expect(moments[1]).toBe(moments[0]);
    expect(moments[0]).toBeGreaterThanOrEqual(startedAtMs + 30);
    expect(moments[0]).toBeLessThanOrEqual(endedAtMs);
  });

  it("stops on an effector's start that its check refuses, as on a tool that throws, naming the reason", async () => {
    // Slot 1 is held from the start, so the start of "cross" cannot take it.
    const a = new ScriptedModel([
      { toolCalls: [{ name: "cross", arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const loaded = slots({ tools: [...slotTools, crossing(0)], initialState: () => ["z", null, null] });

    await expect(run(loaded, [{ name: "a", model: a, activations: 1 }], seed, settings)).rejects.toThrow(
      `agent "a"'s "cross" call failed: its start was refused with "slot_taken"`,
    );
    expect(loaded.world.version).toBe(0);
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
      { name: "a", model: looking, activations: 1 },
      { name: "b", model: taking, activations: 1 },
    ];

    const { toolCalls } = await run(
      slots({ tools: withTakeTaking(100), ...agentsNamed("a", "b"), ...rhythms({ a: () => 50 }) }),
      agents,
      seed,
      settings,
    );

    const take = toolCalls.find((call) => call.agent === "a" && call.tool === "take");
    expect(take).toMatchObject({ outcome: "slot_taken", targetAsSensed: "free" });
  });

  it("records an effector call by an agent that has sensed nothing as not_sensed", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { toolCalls } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, settings);

    expect(toolCalls).toEqual([{ agent: "a", tool: "take", arguments: { slot: 1 }, outcome: "success", text: "success", targetAsSensed: "not_sensed", changesSinceSensing: null, changesSinceSensingBy: null, ...timed }]);
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

    const { toolCalls, startedAtMs } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, {
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

    const { turns, toolCalls, startedAtMs } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, {
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

    const { turns } = await run(slots({ tools: withTakeTaking(1000) }), [{ name: "a", model, activations: 1 }], seed, {
      ...settings,
      timeLimitMs: 100,
    });

    expect(turns).toHaveLength(1);
    expect(model.received).toHaveLength(1);
  });

  it("starts no activation once the time limit has passed: an agent resting then does not wake again, nor holds the run", async () => {
    const model = new ScriptedModel(Array.from({ length: 3 }, () => ({ text: "Nothing to do.", delayMs: 0 })));
    const wokeAtMs: number[] = [];

    const { startedAtMs } = await run(slots(rhythms({ a: () => 80 })), [{ name: "a", model, activations: 3 }], seed, {
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
    const { toolCalls, messages } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, {
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
    const { toolCalls, messages, sensings } = await run(slots({ tools: withLookTaking(1000) }), [{ name: "a", model, activations: 1 }], seed, {
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

describe("run's metric samples", () => {
  /** The metric sample lines of a run's log, in the order they were written. */
  const samplesOf = (logDirectory: string, runId: string) =>
    logOf(logDirectory, runId).filter((line) => (line as { type: string }).type === "metric_sample") as {
      atMs: number;
      version: number;
      metrics: Record<string, unknown>;
    }[];

  it("samples the scenario's metrics at the start and at the end, each with when and the world's version it was computed from", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 1 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const logDirectory = newLogDirectory();

    const { runId, startedAtMs } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory });

    const samples = samplesOf(logDirectory, runId);
    expect(samples).toEqual([
      { type: "metric_sample", atMs: expect.any(Number), version: 0, metrics: { held: 0 } },
      { type: "metric_sample", atMs: expect.any(Number), version: 1, metrics: { held: 1 } },
    ]);
    expect(samples[0].atMs).toBe(startedAtMs);
    const lines = logOf(logDirectory, runId) as { type: string }[];
    expect(lines.at(-1)?.type).toBe("metric_sample");
  });
});

describe("run's metric samples of a metric with no value", () => {
  it("records a metric the state gives no value as null in every sample, not leaving it out", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const logDirectory = newLogDirectory();
    const none = { metrics: { ...slotsScenario.metrics, "first holder": () => null } };

    const { runId } = await run(slots(none), [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory });

    const samples = logOf(logDirectory, runId).filter((line) => (line as { type: string }).type === "metric_sample");
    expect(samples).toHaveLength(2);
    for (const sample of samples) expect(sample).toMatchObject({ metrics: { held: 0, "first holder": null } });
  });
});

describe("run's metric samples of a metric with a value per agent", () => {
  it("records a metric with one value per agent with each agent's value, by its name", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 2 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const logDirectory = newLogDirectory();
    const slotOf = (state: Slots) => Object.fromEntries(state.flatMap((holder, index) => (holder === null ? [] : [[holder, index + 1]])));

    const { runId } = await run(slots({ metrics: { "slot of": slotOf } }), [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory });

    const samples = logOf(logDirectory, runId).filter((line) => (line as { type: string }).type === "metric_sample");
    expect(samples).toMatchObject([{ metrics: { "slot of": {} } }, { metrics: { "slot of": { a: 2 } } }]);
  });
});

describe("run's metric samples of a metric that reads the tool calls", () => {
  it("gives each metric the tool calls so far, besides the world's state", async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ name: "take", arguments: { slot: 2 } }], delayMs: 0 },
      { toolCalls: [{ name: "take", arguments: { slot: 2 } }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
    ]);
    const logDirectory = newLogDirectory();
    const calls = (_state: Slots, toolCalls: readonly ToolCall[]) => Object.fromEntries(toolCalls.map(({ agent, outcome }, index) => [`${index} ${agent}`, outcome === "success" ? 1 : 0]));

    const { runId } = await run(slots({ metrics: { calls } }), [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory });

    const samples = logOf(logDirectory, runId).filter((line) => (line as { type: string }).type === "metric_sample");
    expect(samples).toMatchObject([{ metrics: { calls: {} } }, { metrics: { calls: { "0 a": 1, "1 a": 0 } } }]);
  });
});

describe("run's metric samples at an interval", () => {
  it("samples the metrics at the interval it is given, between the start and the end, waiting at least the interval each time", async () => {
    const model = new ScriptedModel([{ text: "Waiting.", delayMs: 450 }]);
    const logDirectory = newLogDirectory();

    const { runId } = await run(slots(), [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory, metricIntervalMs: 100 });

    const samples = logOf(logDirectory, runId).filter((line) => (line as { type: string }).type === "metric_sample") as { atMs: number }[];
    expect(samples.length).toBeGreaterThanOrEqual(6);
    // The start's sample and each one at the interval; the end's comes when the run ends.
    const scheduled = samples.slice(0, -1);
    for (let index = 1; index < scheduled.length; index += 1) {
      expect(scheduled[index].atMs - scheduled[index - 1].atMs).toBeGreaterThanOrEqual(100);
    }
    expect(samples.at(-1)!.atMs).toBeGreaterThanOrEqual(scheduled.at(-1)!.atMs);
  });
});

describe("run, with components", () => {
  /** A component that keeps each draw from its random sequence, drawing once and then ending. */
  const drawing = (name: string, draws: number[]): Component<Slots> => ({
    name,
    kind: "world",
    description: "Draws once.",
    cycle: (random) => ({
      next: () => {
        draws.push(random.next());
        return { kind: "end" };
      },
    }),
  });

  it("runs the scenario's components alongside its agents, ends once they have ended too, and records each action in its log", async () => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const logDirectory = newLogDirectory();
    const porter = filler("porter", { slot: 2, thing: "crate", waitMs: () => 50, actionMs: 50 });
    const loaded = slots({ components: () => [porter] });

    const { runId } = await run(loaded, [{ name: "a", model, activations: 1 }], seed, { ...settings, logDirectory });

    expect(holder(loaded.world.state, 2)).toBe("crate");
    const actions = logOf(logDirectory, runId).filter((line) => (line as { type: string }).type === "component_action");
    expect(actions).toEqual([
      { type: "component_action", component: "porter", action: 'fill slot 2 with "crate"', startedAtMs: expect.any(Number), endedAtMs: expect.any(Number), outcome: "success" },
    ]);
  });

  it("runs components with no agent, until the time limit cuts off an action still running", async () => {
    const logDirectory = newLogDirectory();
    const porter = filler("porter", { slot: 2, thing: "crate", waitMs: () => 0, actionMs: 10_000 });
    const loaded = slots({ ...agentsNamed(), components: () => [porter] });

    const { runId } = await run(loaded, [], seed, { ...settings, logDirectory, timeLimitMs: 50 });

    expect(holder(loaded.world.state, 2)).toBeNull();
    const actions = logOf(logDirectory, runId).filter((line) => (line as { type: string }).type === "component_action");
    expect(actions).toMatchObject([{ component: "porter", outcome: "cut_off" }]);
  });

  it("gives each component a random sequence from the replica's seed and its name, whatever other components run", async () => {
    const alone: number[] = [];
    const withOther: number[] = [];
    const otherSeed: number[] = [];
    const runWith = (components: Component<Slots>[], runSeed: number) =>
      run(slots({ ...agentsNamed(), components: () => components }), [], runSeed, { ...settings, logDirectory: newLogDirectory() });

    await runWith([drawing("porter", alone)], 42);
    await runWith([drawing("visitor", []), drawing("porter", withOther)], 42);
    await runWith([drawing("porter", otherSeed)], 43);

    expect(withOther).toEqual(alone);
    expect(otherSeed).not.toEqual(alone);
  });

  it.each([
    ["an agent and a component", ["a"], ["a"]],
    ["two components", [], ["porter", "porter"]],
  ])("refuses a run that gives %s the same name before any model call, naming it", async (_case, agents, components) => {
    const model = new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]);
    const loaded = slots({ ...agentsNamed(...agents), components: () => components.map((name) => drawing(name, [])) });
    const name = agents[0] ?? components[0];

    await expect(run(loaded, agents.map((agent) => ({ name: agent, model, activations: 1 })), seed, { ...settings, logDirectory: newLogDirectory() })).rejects.toThrow(
      `"${name}"`,
    );
    expect(model.received).toEqual([]);
  });
});
