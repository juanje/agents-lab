import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentTools } from "@earendil-works/pi-ai";
import { stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { readCalendar } from "../src/engine/calendar.ts";
import { type Declared, type Perceived, type RuleSet, readParticipants } from "../src/engine/participants.ts";
import { type RunSettings, run } from "../src/engine/run.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import type { Tool } from "../src/engine/tools.ts";
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

describe("run, with a participant that declares no channel (FR-PARTICIPANT-01)", () => {
  it("lands its mail but never gives it the notice, nor wakes its rule set", async () => {
    const perceived: Perceived[] = [];
    const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));

    const { runId } = await run(loadScenario(withDesk(checking(perceived), { channels: [] }), 1), [{ name: "ana", model: anaAsks(), activations: 1 }], 1, { ...settings, logDirectory });

    const lines = logOf(logDirectory, runId);
    expect(lines.filter((line) => line.type === "message_delivered")).toHaveLength(1);
    expect(lines.filter((line) => line.type === "stimulus" && line.agent === "desk")).toEqual([]);
    expect(perceived).toEqual([]);
  });
});

describe("run, with a rule set that calls a tool its participant does not declare (FR-PARTICIPANT-01)", () => {
  it("stops, with an error that names the participant and the tool, as the log's last line", async () => {
    const looking: RuleSet = { start: () => ({ next: () => ({ kind: "call", tool: "look", arguments: {} }), outcome: () => ({}) }) };
    const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));
    const runId = "looking";

    const running = run(loadScenario(withDesk(looking), 1), [{ name: "ana", model: anaAsks(), activations: 1 }], 1, { ...settings, logDirectory, runId });

    await expect(running).rejects.toThrow(/"desk".*"look"/);
    expect(logOf(logDirectory, runId).at(-1)).toMatchObject({ type: "run_stopped", error: expect.stringMatching(/"desk".*"look"/) });
  });
});

describe("run, with a tool that throws during a participant's call (FR-PARTICIPANT-01)", () => {
  it("stops, with an error that names the participant, not an agent, and gives the tool's error", async () => {
    const failing: RuleSet = { start: () => ({ next: (input) => (input.result === undefined ? { kind: "call", tool: "jam", arguments: {} } : { kind: "end" }), outcome: () => ({}) }) };
    const jam: Tool<Post> = { kind: "sensor", name: "jam", description: "Fails.", parameters: { type: "object", properties: {} }, durationMs: () => 0, sense: () => { throw new Error("disk full"); } };
    const scenario = withDesk(failing, { tools: ["check_mail", "jam"] });
    const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));

    const running = run(loadScenario({ ...scenario, tools: [jam] }, 1), [{ name: "ana", model: anaAsks(), activations: 1 }], 1, { ...settings, logDirectory, runId: "jammed" });

    await expect(running).rejects.toThrow(/^participant "desk"'s "jam" call failed: disk full$/);
  });
});

/**
 * A rule set that, woken by a stimulus, checks its mail, then waits the world minutes given; woken with nothing new, its
 * wait ended, it ends. It keeps what it perceives and when, by performance.now().
 */
function waiting(minutes: number, perceived: { input: Perceived; atMs: number }[]): RuleSet {
  return {
    start: () => ({
      next: (input) => {
        perceived.push({ input, atMs: performance.now() });
        if (input.result !== undefined) return { kind: "wait", minutes };
        return input.stimuli.length === 0 ? { kind: "end" } : { kind: "call", tool: "check_mail", arguments: {} };
      },
      outcome: () => ({}),
    }),
  };
}

describe("run, with a rule set that waits (FR-PARTICIPANT-01)", () => {
  it("wakes it at the end of its wait, given nothing new, and the wait keeps the run going", async () => {
    const perceived: { input: Perceived; atMs: number }[] = [];
    const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));

    const { runId } = await run(loadScenario(withDesk(waiting(5, perceived)), 1), [{ name: "ana", model: anaAsks(), activations: 1 }], 1, { ...settings, logDirectory });

    const [checked] = logOf(logDirectory, runId).filter((line) => line.type === "tool_call" && line.agent === "desk");
    expect(perceived.map(({ input }) => input.stimuli.length)).toEqual([1, 0, 0]);
    expect(perceived[2].input).toEqual({ stimuli: [] });
    // Five world minutes after its check ended, at 100 ms each.
    const waitedMs = perceived[2].atMs - (checked.endedAtMs as number);
    expect(waitedMs).toBeGreaterThanOrEqual(500);
    expect(waitedMs).toBeLessThan(540);
  });

  it("wakes it early at a stimulus that reaches it during its wait, given that stimulus", async () => {
    const perceived: { input: Perceived; atMs: number }[] = [];
    const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));
    const anaAsksTwice = new ScriptedModel([
      { toolCalls: [{ name: "send_mail", arguments: { to: "desk", act: "ask" } }], delayMs: 0 },
      { toolCalls: [{ name: "send_mail", arguments: { to: "desk", act: "ask" } }], delayMs: 1000 },
      { text: "Done.", delayMs: 0 },
    ]);

    const { runId, startedAtMs } = await run(loadScenario(withDesk(waiting(20, perceived), { reply_minutes: [0, 0] }), 1), [{ name: "ana", model: anaAsksTwice, activations: 1 }], 1, { ...settings, logDirectory });

    const notices = logOf(logDirectory, runId).filter((line) => line.type === "stimulus" && line.agent === "desk");
    expect(notices).toHaveLength(2);
    // Woken by the first notice, given its check's result, then woken by the second notice, before its 20 world minutes ended.
    expect(perceived.map(({ input }) => input.stimuli.length)).toEqual([1, 0, 1, 0, 0]);
    expect(perceived[2].atMs - (notices[1].deliveredAtMs as number)).toBeLessThan(30);
    expect(perceived[2].atMs - startedAtMs).toBeLessThan(2000);
  });
});

describe("run, recording each participant's outcome (FR-PARTICIPANT-01)", () => {
  it("writes a participant_outcome line for each participant decided by rules, with its rule set's outcome record, when the run ends", async () => {
    const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));

    const { runId } = await run(loadScenario(withDesk(checking([])), 1), [{ name: "ana", model: anaAsks(), activations: 1 }], 1, { ...settings, logDirectory });

    const lines = logOf(logDirectory, runId);
    expect(lines.filter(({ type }) => type === "participant_outcome")).toEqual([{ type: "participant_outcome", participant: "desk", outcome: { checked: 1 } }]);
    // Written once the participant's work is done, before the run's last metric sample.
    expect(lines.findIndex(({ type }) => type === "participant_outcome")).toBe(lines.length - 2);
  });
});

describe("readParticipants, a participant decided by a model (FR-PARTICIPANT-01)", () => {
  it("reads its model and system prompt in place of a rule set", () => {
    const written = desk({ decides: "model", rules: undefined, model: "openai/gpt-6-luna", system_prompt: "You run the front desk." });
    expect(readParticipants({ desk: written } as never, declared)).toEqual([
      { name: "desk", decides: "model", model: "openai/gpt-6-luna", systemPrompt: "You run the front desk.", tools: ["check_mail", "read_mail", "send_mail"], channels: ["mail_notice"], replyMinutes: [10, 10] },
    ]);
  });
});

describe("readParticipants, refusing what cannot be followed (FR-PARTICIPANT-01)", () => {
  const refusing = (written: Record<string, unknown>, given: Declared = declared) => () => readParticipants(written as never, given);

  it("refuses a tool or a channel the scenario does not declare, naming the key", () => {
    expect(refusing({ desk: desk({ tools: ["check_mail", "fly"] }) })).toThrow(/participants\.desk\.tools.*"fly"/);
    expect(refusing({ desk: desk({ channels: ["radio"] }) })).toThrow(/participants\.desk\.channels.*"radio"/);
  });

  it("refuses hours the calendar does not declare, and hours without a calendar", () => {
    expect(refusing({ desk: desk({ hours: "night" }) })).toThrow(/participants\.desk\.hours.*"night"/);
    const { calendar: _calendar, ...withoutCalendar } = declared;
    expect(refusing({ desk: desk({ hours: "office" }) }, withoutCalendar)).toThrow(/participants\.desk\.hours/);
  });

  it("refuses reply_minutes without a calendar, whose world minutes they are", () => {
    const { calendar: _calendar, ...withoutCalendar } = declared;
    expect(refusing({ desk: desk({ reply_minutes: [1, 2] }) }, withoutCalendar)).toThrow(/participants\.desk\.reply_minutes.*\[calendar\]/);
  });

  it("refuses reply_minutes that are not two numbers, the first at least 0 and not above the second", () => {
    for (const replyMinutes of [[30, 10], [-1, 10], [10], ["ten", 20]]) {
      expect(refusing({ desk: desk({ reply_minutes: replyMinutes }) })).toThrow(/participants\.desk\.reply_minutes/);
    }
  });

  it("refuses decides that is neither rules nor model, and a rule set the scenario does not provide", () => {
    expect(refusing({ desk: desk({ decides: "dice" }) })).toThrow(/participants\.desk\.decides.*"dice"/);
    expect(refusing({ desk: desk({ rules: "mirror" }) })).toThrow(/participants\.desk\.rules.*"mirror"/);
  });

  it("refuses a participant decided by a model without a model or a system prompt", () => {
    const byModel = { decides: "model", rules: undefined, model: "openai/gpt-6-luna", system_prompt: "You run the front desk." };
    expect(refusing({ desk: desk({ ...byModel, model: undefined }) })).toThrow(/participants\.desk\.model/);
    expect(refusing({ desk: desk({ ...byModel, system_prompt: undefined }) })).toThrow(/participants\.desk\.system_prompt/);
  });

  it("refuses a participant whose name an agent or a component already has", () => {
    expect(refusing({ ana: desk() })).toThrow(/participants\.ana/);
  });
});

describe("run, with a participant decided by a model (FR-PARTICIPANT-01)", () => {
  const byModel = { decides: "model", rules: undefined, model: "scripted/desk", system_prompt: "You run the front desk.", tools: ["check_mail"] };

  it("loads it as an agent of the run, with its system prompt and the scenario's rhythm", () => {
    const loaded = loadScenario(withDesk(checking([]), byModel), 1);

    expect([...loaded.systemPrompts]).toEqual([
      ["ana", 'You are "ana".'],
      ["desk", "You run the front desk."],
    ]);
    expect([...loaded.rhythms.keys()]).toEqual(["ana", "desk"]);
  });

  it("offers its session only its own tools, and holds its stimuli by its reply delay", async () => {
    const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));
    const deskModel = new ScriptedModel([{ text: "Nothing yet.", delayMs: 0 }]);

    const { runId, startedAtMs } = await run(
      loadScenario(withDesk(checking([]), byModel), 1),
      [
        { name: "ana", model: anaAsks(), activations: 1 },
        { name: "desk", model: deskModel, activations: 1 },
      ],
      1,
      { ...settings, logDirectory },
    );

    expect(getCurrentTools(deskModel.received[0]).map(({ name }) => name)).toEqual(["check_mail"]);
    const notice = logOf(logDirectory, runId).find((line) => line.type === "stimulus" && line.agent === "desk" && line.channel === "mail_notice");
    expect((notice?.deliveredAtMs as number) - startedAtMs).toBeGreaterThanOrEqual(1400);
  });
});
