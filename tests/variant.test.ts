import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/engine/run.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
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
