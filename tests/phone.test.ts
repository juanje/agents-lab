import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "@earendil-works/pi-ai";
import { stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { readCalendar } from "../src/engine/calendar.ts";
import type { Perceived, RuleSet } from "../src/engine/participants.ts";
import { type PhoneSettings, readPhone } from "../src/engine/phone.ts";
import { type RunSettings, run } from "../src/engine/run.ts";
import { loadScenario } from "../src/engine/scenario.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { switchboardScenario } from "./fixtures/switchboard.ts";

/** A calendar where one world minute is 100 ms of the run. */
const calendar = readCalendar({ start: "day 1 Friday 17:00", segments: [{ scale: 600 }] });

/** FR-PHONE-01's Background phone, with any of its keys replaced. */
function phone(changes: Record<string, unknown> = {}) {
  return { lines: ["ana", "ben", "desk"], ring_minutes: 5, call_minutes: 4, ring: "{from} calls ({call}): {act}. {fields}{text}", ...changes };
}

/** The names a phone's lines are checked against: the agents' and the participants'. */
const names = ["ana", "ben", "desk"];

describe("readPhone (FR-PHONE-01)", () => {
  it("reads the lines, ring_minutes, call_minutes, the time per word when given, and the ring's text", () => {
    const read: PhoneSettings = readPhone(phone({ call_words_per_minute: 10 }) as never, calendar, names);

    expect(read).toEqual({ lines: ["ana", "ben", "desk"], ringMinutes: 5, callMinutes: 4, callWordsPerMinute: 10, ring: "{from} calls ({call}): {act}. {fields}{text}" });
    expect(readPhone(phone() as never, calendar, names)).not.toHaveProperty("callWordsPerMinute");
  });

  it("refuses, naming the key, a phone without a calendar, a line for a name that is no agent or participant, and durations and a ring it cannot follow", () => {
    const refusing = (changes: Record<string, unknown>) => () => readPhone(phone(changes) as never, calendar, names);
    const withoutCalendar = () => readPhone(phone() as never, undefined, names);

    expect(withoutCalendar).toThrow(/phone.*\[calendar\]/);
    expect(refusing({ lines: ["ana", "zoe"] })).toThrow(/phone\.lines.*"zoe"/);
    for (const minutes of [0, -1, "five"]) expect(refusing({ ring_minutes: minutes })).toThrow(/phone\.ring_minutes/);
    for (const minutes of [0, -1, undefined]) expect(refusing({ call_minutes: minutes })).toThrow(/phone\.call_minutes/);
    expect(refusing({ call_words_per_minute: -1 })).toThrow(/phone\.call_words_per_minute/);
    expect(refusing({ ring: "{from} offers {price}" })).toThrow(/phone\.ring.*\{price\}/);
  });
});

/** A participant "desk" decided by the rule set "operator", with a line that takes calls, and any of its keys replaced. */
function desk(changes: Record<string, unknown> = {}): string {
  return `${stringify({ participants: { desk: { decides: "rules", rules: "operator", tools: ["answer_call", "call"], channels: ["phone"], ...changes } } })}`;
}

/** What "operator" does when a ring reaches it: answers it at once with the act "answer" and the field free "yes", or nothing. */
function operator(answers: boolean, rings: Perceived[] = []): RuleSet {
  return {
    start: () => ({
      next: (perceived) => {
        rings.push(perceived);
        const call = /\((c-\d+)\)/.exec(perceived.stimuli[0]?.content ?? "")?.[1];
        if (!answers || perceived.result !== undefined || call === undefined) return { kind: "end" };
        return { kind: "call", tool: "answer_call", arguments: { call, act: "answer", fields: { free: "yes" } } };
      },
      outcome: () => ({}),
    }),
  };
}

const settings: Omit<RunSettings, "logDirectory"> = { modelTurnTimeoutMs: 10_000, thinkingLevel: "off", compaction: { enabled: false }, parallelismLimit: 4, timeLimitMs: 10_000 };

/** An agent's scripted turns: each call after its delay, in milliseconds of the run, then the end. */
function calls(...made: { name: string; arguments: Record<string, unknown>; delayMs?: number }[]): ScriptedModel {
  return new ScriptedModel([...made.map(({ name, arguments: args, delayMs = 0 }) => ({ toolCalls: [{ name, arguments: args as JsonObject }], delayMs })), { text: "Done.", delayMs: 0 }]);
}

/** Runs the switchboard with "desk" and the rule set given, and the agents' scripted turns; gives the run's log and when it started. */
async function runSwitchboard(ruleSet: RuleSet, agents: Record<string, ScriptedModel>, deskChanges: Record<string, unknown> = {}, more: Partial<RunSettings> = {}) {
  const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));
  const scenario = { ...switchboardScenario(desk(deskChanges)), ruleSets: { operator: ruleSet } };
  const named = { ana: new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]), ben: new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }]), ...agents };
  const runId = "switchboard";
  const ran = await run(loadScenario(scenario, 1), Object.entries(named).map(([name, model]) => ({ name, model, activations: 1 })), 1, { ...settings, logDirectory, runId, ...more });
  const lines = readFileSync(join(logDirectory, `${runId}.jsonl`), "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
  const callsOf = (party: string, tool: string) => lines.filter((line) => line.type === "tool_call" && line.agent === party && line.tool === tool);
  const into = (atMs: unknown) => (atMs as number) - ran.startedAtMs;
  return { lines, callsOf, into };
}

describe("run, with a phone (FR-PHONE-01)", () => {
  it("rings a callee free and in its hours at once, with the caller as the ring's source; answered, the call connects for call_minutes and the caller gets the answer", async () => {
    const rings: Perceived[] = [];
    const { lines, callsOf, into } = await runSwitchboard(operator(true, rings), { ana: calls({ name: "call", arguments: { to: "desk", act: "ask" } }) }, { reply_minutes: [10, 10] });

    // Not held for desk's reply delay.
    const [ring] = lines.filter((line) => line.type === "stimulus" && line.agent === "desk");
    expect(ring).toMatchObject({ channel: "phone", source: "ana", content: "ana calls (c-1): ask. " });
    expect(into(ring.deliveredAtMs)).toBeLessThan(30);
    const [call] = callsOf("ana", "call");
    expect(call).toMatchObject({ outcome: "success", text: "Answer from desk. Act: answer. free: yes." });
    expect(into(call.endedAtMs)).toBeGreaterThanOrEqual(400);
    expect(into(call.endedAtMs)).toBeLessThan(430);
    const [answer] = callsOf("desk", "answer_call");
    expect(answer.outcome).toBe("success");
    expect(Math.abs((answer.endedAtMs as number) - (call.endedAtMs as number))).toBeLessThan(10);
  });

  it("gives the callee's rule set the world's record of the call beside the ring's text: its caller, id, act, fields and text (FR-CONGRESS-09)", async () => {
    const rings: Perceived[] = [];
    await runSwitchboard(operator(true, rings), { ana: calls({ name: "call", arguments: { to: "desk", act: "ask", fields: { date: "day 5" }, text: "Free? Notes: date: none." } }) });

    expect(rings[0].stimuli[0]).toMatchObject({ channel: "phone", record: { from: "ana", call: "c-1", act: "ask", fields: { date: "day 5" }, text: "Free? Notes: date: none." } });
  });

  it("writes a call line as the call ends: its id, parties, act, answer, outcome, and when it rang, was answered and ended", async () => {
    const { lines, into } = await runSwitchboard(operator(true), { ana: calls({ name: "call", arguments: { to: "desk", act: "ask", text: "Free?" } }) });

    const [line] = lines.filter(({ type }) => type === "call");
    expect(line).toMatchObject({ id: "c-1", from: "ana", to: "desk", act: "ask", fields: {}, text: "Free?", answer: { act: "answer", fields: { free: "yes" } }, outcome: "answered" });
    expect(line.rang).toMatchObject({ worldTime: { day: 1, weekday: "Friday" } });
    expect(into((line.answered as { atMs: number }).atMs)).toBeLessThan(30);
    expect(into((line.ended as { atMs: number }).atMs)).toBeGreaterThanOrEqual(400);
    expect((line.ended as { worldTime: { seconds: number } }).worldTime.seconds).toBeGreaterThanOrEqual(17 * 3600 + 4 * 60);
  });

  it("ends a call nobody answers as no_answer when ring_minutes end", async () => {
    const { lines, callsOf, into } = await runSwitchboard(operator(false), { ana: calls({ name: "call", arguments: { to: "desk", act: "ask" } }) });

    const [call] = callsOf("ana", "call");
    expect(call.outcome).toBe("no_answer");
    expect(into(call.endedAtMs)).toBeGreaterThanOrEqual(500);
    expect(into(call.endedAtMs)).toBeLessThan(530);
    expect(lines.filter(({ type }) => type === "call")).toMatchObject([{ id: "c-1", outcome: "no_answer" }]);
  });

  it("gives a callee already on a call no ring, and fails the call as busy after 1 world minute (FR-CONGRESS-07)", async () => {
    const { lines, callsOf, into } = await runSwitchboard(operator(true), {
      ben: calls({ name: "call", arguments: { to: "desk", act: "ask" } }),
      ana: calls({ name: "call", arguments: { to: "desk", act: "ask" }, delayMs: 100 }),
    });

    const [call] = callsOf("ana", "call");
    expect(call.outcome).toBe("busy");
    // One world minute is 100 milliseconds of the run; ring_minutes would be 500.
    expect((call.endedAtMs as number) - (call.startedAtMs as number)).toBeGreaterThanOrEqual(100);
    expect((call.endedAtMs as number) - (call.startedAtMs as number)).toBeLessThan(300);
    expect(into(call.endedAtMs)).toBeLessThan(400);
    expect(lines.filter((line) => line.type === "stimulus" && line.agent === "desk")).toHaveLength(1);
  });

  it("gives a callee outside its hours no ring, and fails the call as no_answer", async () => {
    const { lines, callsOf } = await runSwitchboard(operator(true), { ana: calls({ name: "call", arguments: { to: "desk", act: "ask" } }) }, { hours: "night" });

    expect(callsOf("ana", "call")[0].outcome).toBe("no_answer");
    expect(lines.filter((line) => line.type === "stimulus" && line.agent === "desk")).toEqual([]);
  });

  it("refuses a call its callee cannot take as it starts, taking no time and ringing nothing", async () => {
    const { lines, callsOf } = await runSwitchboard(operator(true), {
      ana: calls({ name: "call", arguments: { to: "zoe", act: "ask" } }, { name: "call", arguments: { to: "desk", act: "order" } }, { name: "call", arguments: { to: "desk", act: "book", fields: { date: "day 26" } } }),
    });

    const made = callsOf("ana", "call");
    expect(made.map(({ outcome }) => outcome)).toEqual(["unknown_recipient", "act_not_taken", "missing_field"]);
    for (const call of made) expect((call.endedAtMs as number) - (call.startedAtMs as number)).toBeLessThan(10);
    expect(lines.filter((line) => line.channel === "phone")).toEqual([]);
  });

  it("lets an agent answer a ring; an answer once the ring has ended fails as no_such_call, taking no time", async () => {
    const answered = await runSwitchboard(operator(true), {
      ben: calls({ name: "call", arguments: { to: "ana", act: "ask" } }),
      ana: calls({ name: "answer_call", arguments: { call: "c-1", act: "yes" }, delayMs: 50 }),
    });
    expect(answered.callsOf("ben", "call")[0]).toMatchObject({ outcome: "success", text: "Answer from ana. Act: yes." });

    const late = await runSwitchboard(operator(true), {
      ben: calls({ name: "call", arguments: { to: "ana", act: "ask" } }),
      ana: calls({ name: "answer_call", arguments: { call: "c-1", act: "yes" }, delayMs: 700 }),
    });
    expect(late.callsOf("ben", "call")[0].outcome).toBe("no_answer");
    const [answer] = late.callsOf("ana", "answer_call");
    expect(answer.outcome).toBe("no_such_call");
    expect((answer.endedAtMs as number) - (answer.startedAtMs as number)).toBeLessThan(10);
  });

  it("lengthens a connected call by one minute per call_words_per_minute words of both texts", async () => {
    const scenario = switchboardScenario(desk());
    const words = Array.from({ length: 20 }, () => "word").join(" ");
    const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));
    const withWords = { ...scenario, ruleSets: { operator: operator(true) }, baseConfiguration: scenario.baseConfiguration.replace("call_minutes = 4", "call_minutes = 4\ncall_words_per_minute = 10") };

    const { toolCalls, startedAtMs } = await run(loadScenario(withWords, 1), [{ name: "ana", model: calls({ name: "call", arguments: { to: "desk", act: "ask", text: words } }), activations: 1 }, { name: "ben", model: new ScriptedModel([{ text: "No.", delayMs: 0 }]), activations: 1 }], 1, { ...settings, logDirectory });

    const call = toolCalls.find(({ agent, tool }) => agent === "ana" && tool === "call");
    expect((call?.endedAtMs ?? 0) - startedAtMs).toBeGreaterThanOrEqual(600);
    expect((call?.endedAtMs ?? 0) - startedAtMs).toBeLessThan(630);
  });

  it("records a call the run's time limit cuts off as cut_off on both sides and in its line, connecting nothing", async () => {
    const { lines, callsOf } = await runSwitchboard(operator(true), { ana: calls({ name: "call", arguments: { to: "desk", act: "ask" } }) }, {}, { timeLimitMs: 200 });

    expect(callsOf("ana", "call")[0].outcome).toBe("cut_off");
    expect(callsOf("desk", "answer_call")[0].outcome).toBe("cut_off");
    expect(lines.filter(({ type }) => type === "call")).toMatchObject([{ id: "c-1", outcome: "cut_off" }]);
  });
});

describe("loadScenario, with a phone (FR-PHONE-01)", () => {
  it("refuses a participant whose line takes calls without the tool answer_call, naming its tools", () => {
    const scenario = { ...switchboardScenario(desk({ tools: ["call"] })), ruleSets: { operator: operator(true) } };

    expect(() => loadScenario(scenario, 1)).toThrow(/participants\.desk\.tools.*answer_call/);
  });
});
