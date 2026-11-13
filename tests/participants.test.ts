import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { readCalendar } from "../src/engine/calendar.ts";
import { type Perceived, type RuleSet, readParticipants } from "../src/engine/participants.ts";
import { type RunSettings, run } from "../src/engine/run.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { type Post, postScenario } from "./fixtures/post.ts";

/** A calendar where one world minute is 100 ms of the run, with office hours. */
const calendar = readCalendar({
  start: "day 1 Friday 17:00",
  segments: [{ scale: 600 }],
  hours: { office: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], from: "09:00", to: "18:00" } },
});

/** What a configuration's participants are checked against: the scenario's tools and channels, its calendar, rule sets and names taken. */
const declared = { tools: ["check_mail", "read_mail", "send_mail"], channels: ["rhythm", "mail_notice"], calendar, ruleSets: ["echo"], taken: ["ana"] };

/** A participant decided by the rule set "echo", with any of its keys replaced. */
function desk(changes: Record<string, unknown> = {}) {
  return { decides: "rules", rules: "echo", tools: ["check_mail", "read_mail", "send_mail"], channels: ["mail_notice"], reply_minutes: [10, 10], ...changes };
}

describe("readParticipants", () => {
  it("reads a participant decided by rules: its rule set and parameters, tools, channels, hours and reply delay", () => {
    expect(readParticipants({ desk: desk({ hours: "office", params: { answer: "yes" } }) } as never, declared)).toEqual([
      { name: "desk", decides: "rules", rules: "echo", params: { answer: "yes" }, tools: ["check_mail", "read_mail", "send_mail"], channels: ["mail_notice"], hours: "office", replyMinutes: [10, 10] },
    ]);
  });

  it("gives no parameters, hours or reply delay when the configuration gives none, and no participants when it declares none", () => {
    expect(readParticipants({ desk: desk({ reply_minutes: undefined }) } as never, declared)).toEqual([
      { name: "desk", decides: "rules", rules: "echo", params: {}, tools: ["check_mail", "read_mail", "send_mail"], channels: ["mail_notice"] },
    ]);
    expect(readParticipants(undefined, declared)).toEqual([]);
  });
});

/** The [participants] of a configuration with "desk", decided by "echo", as the post scenario's base configuration takes them. */
const deskConfiguration = (changes: Record<string, unknown> = {}) => `\n${stringify({ participants: { desk: desk(changes) } })}\n`;

/** A rule set that, woken, checks its mail once and ends; it keeps what it perceives. */
function checking(perceived: Perceived[]): RuleSet {
  return {
    start: () => ({
      next: (input) => {
        perceived.push(input);
        return input.result === undefined ? { kind: "call", tool: "check_mail", arguments: {} } : { kind: "end" };
      },
      outcome: () => ({ checked: perceived.filter(({ result }) => result !== undefined).length }),
    }),
  };
}

/** The post scenario, Friday at 17:00, with "desk" decided by a rule set, and the agent "ana" alone. */
function withDesk(ruleSet: RuleSet, changes: Record<string, unknown> = {}): Scenario<Post> {
  const base = postScenario.baseConfiguration.replace('agents = ["ana", "ben"]', 'agents = ["ana"]').replace("day 1 Monday 09:00", "day 1 Friday 17:00");
  return { ...postScenario, ruleSets: { echo: ruleSet }, baseConfiguration: `${base}${deskConfiguration(changes)}` };
}

const settings: Omit<RunSettings, "logDirectory"> = {
  modelTurnTimeoutMs: 10_000,
  thinkingLevel: "off",
  compaction: { enabled: false },
  parallelismLimit: 4,
  timeLimitMs: 10_000,
};

/** The lines of a run's log, parsed. */
function logOf(directory: string, runId: string): Record<string, unknown>[] {
  return readFileSync(join(directory, `${runId}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

/** "ana", who sends "desk" a message as she starts, then ends. */
const anaAsks = () =>
  new ScriptedModel([
    { toolCalls: [{ name: "send_mail", arguments: { to: "desk", act: "ask" } }], delayMs: 0 },
    { text: "Done.", delayMs: 0 },
  ]);

describe("run, with a participant decided by rules (FR-PARTICIPANT-01)", () => {
  it("holds its notice for its reply delay, wakes its rule set with it, and runs its calls through the tools under its name, with no model turn", async () => {
    const perceived: Perceived[] = [];
    const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));

    const { runId, startedAtMs, toolCalls } = await run(loadScenario(withDesk(checking(perceived)), 1), [{ name: "ana", model: anaAsks(), activations: 1 }], 1, { ...settings, logDirectory });

    const lines = logOf(logDirectory, runId);
    const notice = lines.find((line) => line.type === "stimulus" && line.agent === "desk");
    // Sent in three world minutes, landed one later, and reached "desk" ten after that: 1400 ms of the run.
    expect(notice).toMatchObject({ channel: "mail_notice", source: "mail client", content: "New mail from ana: ask" });
    expect((notice!.deliveredAtMs as number) - startedAtMs).toBeGreaterThanOrEqual(1400);
    expect((notice!.deliveredAtMs as number) - startedAtMs).toBeLessThan(1450);
    expect(perceived[0]).toEqual({ stimuli: [{ channel: "mail_notice", source: "mail client", content: "New mail from ana: ask" }] });
    const checked = lines.filter((line) => line.type === "tool_call" && line.agent === "desk");
    expect(checked).toMatchObject([{ tool: "check_mail", outcome: "success", arguments: {} }]);
    expect(toolCalls.filter(({ agent }) => agent === "desk")).toHaveLength(1);
    expect(perceived[1]).toEqual({ stimuli: [], result: { tool: "check_mail", outcome: "success", text: checked[0].result } });
    expect(lines.filter((line) => line.type === "model_turn" && line.agent === "desk")).toEqual([]);
    // The run waits for the held notice and the call it wakes.
    expect((checked[0].endedAtMs as number) - startedAtMs).toBeGreaterThanOrEqual(1600);
  });
});
