import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/engine/run.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import type { Tool } from "../src/engine/tools.ts";
import { type Post, postScenario } from "./fixtures/post.ts";

/** The post scenario with a variant: a recipient drawn from the replica's sequence, given a mailbox. */
const varied: Scenario<Post> = {
  ...postScenario,
  variant: (configuration, random) => {
    const recipient = ["carla", "dora", "eva"][Math.floor(random.next() * 3)];
    const mail = configuration.mail as Record<string, unknown>;
    return { configuration: { ...configuration, mail: { ...mail, mailboxes: [...(mail.mailboxes as string[]), recipient] } }, drawn: { recipient } };
  },
};

describe("loadScenario, with a scenario that draws a variant (FR-CONGRESS-01)", () => {
  it("draws it from the seed and `variant` alone, the same under every condition, and loads the configuration it gives", () => {
    const first = loadScenario(varied, 42);
    const again = loadScenario(varied, 42, { name: "other", change: 'agents = ["ana"]' });

    expect(again.variant).toEqual(first.variant);
    const { recipient } = first.variant as { recipient: string };
    expect((first.configuration.mail as { mailboxes: string[] }).mailboxes).toContain(recipient);
    expect(loadScenario(postScenario, 42).variant).toBeUndefined();
  });
});

describe("run, with a variant (FR-CONGRESS-01)", () => {
  it("writes a variant line with what was drawn before any agent acts", async () => {
    const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));
    const loaded = loadScenario(varied, 42);
    const agents = ["ana", "ben"].map((name) => ({ name, model: new ScriptedModel([{ text: "No.", delayMs: 0 }]), activations: 1 }));

    const { runId } = await run(loaded, agents, 42, { logDirectory, modelTurnTimeoutMs: 10_000, thinkingLevel: "off", compaction: { enabled: false }, parallelismLimit: 2, timeLimitMs: 5_000 });

    const lines = readFileSync(join(logDirectory, `${runId}.jsonl`), "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line));
    expect(lines.filter(({ type }) => type === "variant")).toEqual([{ type: "variant", ...(loaded.variant as object) }]);
    expect(lines.findIndex(({ type }) => type === "variant")).toBeLessThan(lines.findIndex(({ type }) => type === "model_turn"));
  });
});

/** Runs the post scenario as changed, "ana" making the calls given; gives her tool calls and when the run started. */
async function runPost(scenario: Scenario<Post>, calls: { name: string; arguments: Record<string, unknown> }[]) {
  const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));
  const ana = new ScriptedModel([...calls.map((call) => ({ toolCalls: [call as never], delayMs: 0 })), { text: "Done.", delayMs: 0 }]);
  const agents = [
    { name: "ana", model: ana, activations: 1 },
    { name: "ben", model: new ScriptedModel([{ text: "No.", delayMs: 0 }]), activations: 1 },
  ];
  const { toolCalls, startedAtMs } = await run(loadScenario(scenario, 1), agents, 1, { logDirectory, modelTurnTimeoutMs: 10_000, thinkingLevel: "off", compaction: { enabled: false }, parallelismLimit: 2, timeLimitMs: 5_000 });
  return { calls: toolCalls.filter(({ agent }) => agent === "ana"), startedAtMs };
}

describe("run, an effector that refuses by the world's time (FR-CONGRESS-01)", () => {
  it("is given the world's time as the call starts", async () => {
    const given: unknown[] = [];
    const knock: Tool<Post> = {
      kind: "effector",
      name: "knock",
      description: "Knock.",
      parameters: { type: "object", properties: {} },
      durationMs: () => 0,
      refuses: (_state, _call, world) => {
        given.push(world);
        return { outcome: "closed", reason: "it is closed" };
      },
      readTarget: () => "not_sensed",
    };

    const { calls } = await runPost({ ...postScenario, tools: [knock] }, [{ name: "knock", arguments: {} }]);

    expect(calls.map(({ outcome }) => outcome)).toEqual(["closed"]);
    // The run's start, within the moment the engine takes to start the call.
    // The run's start, within the 10 ms of the run (6 world seconds) the engine takes to start the call.
    expect(given).toHaveLength(1);
    expect(given[0]).toMatchObject({ day: 1, weekday: "Monday" });
    expect((given[0] as { seconds: number }).seconds - 9 * 3600).toBeLessThanOrEqual(6);
  });
});

describe("run, a scenario that slows the engine's own tools (FR-CONGRESS-01)", () => {
  it("makes a mail tool take its duration times the factor the scenario gives for the caller and the state", async () => {
    const slowed = { ...postScenario, slowedBy: (_state: Post, agent: string, tool: string) => (agent === "ana" && tool === "check_mail" ? 2 : 1) };

    const { calls } = await runPost(slowed, [{ name: "check_mail", arguments: {} }]);

    // check_minutes 2, twice, at 100 ms a world minute.
    const tookMs = calls[0].endedAtMs - calls[0].startedAtMs;
    expect(tookMs).toBeGreaterThanOrEqual(400);
    expect(tookMs).toBeLessThan(430);
  });
});
