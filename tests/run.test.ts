import { describe, expect, it } from "vitest";
import { run } from "../src/engine/run.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { World } from "../src/engine/world.ts";
import { declaredActions, emptySlots } from "./fixtures/slots.ts";

/** A rhythm with no waiting: the agent decides again as soon as its previous decision ends. */
const noWait = () => 0;

/** A replica's seed, for a run whose rhythms draw nothing from it. */
const seed = 1;

describe("run", () => {
  it("gives each decision the next answer of the agent's scripted model, and applies the action it names", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([
      { text: "take 2", delayMs: 0 },
      { text: "wait", delayMs: 0 },
    ]);

    const decisions = await run(world, declaredActions, [{ name: "a", model, decisions: 2, rhythm: noWait }], seed);

    expect(decisions.get("a")?.map(({ answer, outcome }) => ({ answer, outcome }))).toEqual([
      { answer: "take 2", outcome: "success" },
      { answer: "wait", outcome: "success" },
    ]);
    expect(world.state).toEqual([null, "a", null]);
  });

  it("records each decision's model latency, from the call's start to the answer the script delays", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([{ text: "wait", delayMs: 50 }]);

    const decisions = await run(world, declaredActions, [{ name: "a", model, decisions: 1, rhythm: noWait }], seed);

    expect(decisions.get("a")?.[0]?.latencyMs).toBeGreaterThanOrEqual(50);
  });

  it("records when each decision's action went to the arbiter, after the model answered", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([{ text: "wait", delayMs: 50 }]);
    const start = performance.now();

    const decisions = await run(world, declaredActions, [{ name: "a", model, decisions: 1, rhythm: noWait }], seed);

    const actedAtMs = decisions.get("a")?.[0]?.actedAtMs;
    expect(actedAtMs).toBeGreaterThanOrEqual(start + 50);
    expect(actedAtMs).toBeLessThanOrEqual(performance.now());
  });

  it("records when each decision observed, before its model call", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([{ text: "wait", delayMs: 50 }]);
    const start = performance.now();

    const decisions = await run(world, declaredActions, [{ name: "a", model, decisions: 1, rhythm: noWait }], seed);

    const [decision] = decisions.get("a") ?? [];
    expect(decision?.observedAtMs).toBeGreaterThanOrEqual(start);
    expect((decision?.actedAtMs ?? -Infinity) - (decision?.observedAtMs ?? Infinity)).toBeGreaterThanOrEqual(50);
  });

  it("waits an interval drawn from the agent's rhythm before each observation", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([
      { text: "wait", delayMs: 0 },
      { text: "wait", delayMs: 0 },
    ]);
    const intervals = [30, 80];
    const start = performance.now();

    const decisions = await run(world, declaredActions, [
      { name: "a", model, decisions: 2, rhythm: () => intervals.shift() ?? 0 },
    ], seed);

    const [first, second] = decisions.get("a") ?? [];
    expect(first?.observedAtMs).toBeGreaterThanOrEqual(start + 30);
    expect((second?.observedAtMs ?? -Infinity) - (first?.actedAtMs ?? Infinity)).toBeGreaterThanOrEqual(80);
  });

  it("gives each agent's rhythm the same draws for the same seed, however long the other agents' models take", async () => {
    /** Runs agents "a" and "b" with seed 42, "b" answering after its delay, and gives the draws of "a"'s rhythm. */
    async function drawsOfA(bDelayMs: number): Promise<number[]> {
      const draws: number[] = [];
      const answers = (delayMs: number) => new ScriptedModel(Array.from({ length: 4 }, () => ({ text: "wait", delayMs })));
      await run(
        new World(emptySlots(3)),
        declaredActions,
        [
          { name: "a", model: answers(0), decisions: 4, rhythm: (source) => (draws.push(source.next()), 5) },
          { name: "b", model: answers(bDelayMs), decisions: 4, rhythm: (source) => source.next() * 5 },
        ],
        42,
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
        declaredActions,
        names.map((name) => ({
          name,
          model: new ScriptedModel(Array.from({ length: 3 }, () => ({ text: "wait", delayMs: 0 }))),
          decisions: 3,
          rhythm: (source) => (name === "b" ? (draws.push(source.next()), 0) : source.next()),
        })),
        42,
      );
      return draws;
    }

    const draws = await drawsOfB(["a", "b"]);

    expect(draws).toHaveLength(3);
    expect(await drawsOfB(["b", "a"])).toEqual(draws);
    expect(await drawsOfB(["c", "d", "b"])).toEqual(draws);
  });

  it("runs each agent's decisions in its own loop, so a slow agent does not hold back a fast one", async () => {
    const world = new World(emptySlots(3));
    const slow = new ScriptedModel([{ text: "wait", delayMs: 200 }]);
    const fast = new ScriptedModel(Array.from({ length: 3 }, () => ({ text: "wait", delayMs: 20 })));

    const decisions = await run(world, declaredActions, [
      { name: "slow", model: slow, decisions: 1, rhythm: noWait },
      { name: "fast", model: fast, decisions: 3, rhythm: noWait },
    ], seed);

    const slowActedAtMs = decisions.get("slow")?.[0]?.actedAtMs ?? -Infinity;
    const fastActedAtMs = decisions.get("fast")?.map((decision) => decision.actedAtMs ?? Infinity);
    expect(fastActedAtMs).toHaveLength(3);
    for (const actedAtMs of fastActedAtMs ?? []) expect(actedAtMs).toBeLessThan(slowActedAtMs);
  });

  it("gives a decision after the script runs out the outcome script_exhausted, with no answer, and applies nothing", async () => {
    const world = new World(emptySlots(3));
    const model = new ScriptedModel([{ text: "take 1", delayMs: 0 }]);

    const decisions = await run(world, declaredActions, [{ name: "a", model, decisions: 2, rhythm: noWait }], seed);

    expect(decisions.get("a")?.[1]).toEqual({ outcome: "script_exhausted" });
    expect(world.state).toEqual(["a", null, null]);
    expect(world.version).toBe(1);
  });
});
