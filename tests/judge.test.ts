import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { type Message, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { judgeRuns, readJudgeFile } from "../src/analysis/judge.ts";
import type { AgentModel } from "../src/engine/adapter.ts";
import type { Judgeable, Scenario } from "../src/engine/scenario.ts";
import { type ScriptedAnswer, ScriptedModel } from "../src/engine/scripted-model.ts";

const hashOf = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

/** A directory holding a judge file of these lines, with its instructions in materials/judge.md beside it. */
function judgeDirectory(lines: readonly string[]): string {
  const directory = mkdtempSync(join(tmpdir(), "agents-lab-judge-"));
  mkdirSync(join(directory, "materials"));
  writeFileSync(join(directory, "materials", "judge.md"), "You judge.\n");
  writeFileSync(join(directory, "judge.toml"), lines.join("\n"));
  return directory;
}

const JUDGE_FILE = ['model = "scripted/judge"', 'thinking_level = "off"', 'instructions = { file = "materials/judge.md" }'];

describe("readJudgeFile", () => {
  it("gives the model, the thinking level and the instructions, read from beside the file, with their hash", () => {
    const directory = judgeDirectory(JUDGE_FILE);

    expect(readJudgeFile(join(directory, "judge.toml"))).toEqual({
      model: "scripted/judge",
      thinkingLevel: "off",
      instructions: { path: "materials/judge.md", hash: hashOf("You judge.\n"), text: "You judge.\n" },
    });
  });

  it.each([["model"], ["thinking_level"], ["instructions"]])("refuses a judge file without its %s, naming it", (field) => {
    const directory = judgeDirectory(JUDGE_FILE.filter((line) => !line.startsWith(`${field} `)));

    expect(() => readJudgeFile(join(directory, "judge.toml"))).toThrow(`"${field}"`);
  });

  it("refuses a thinking level Pi does not know, and instructions whose file does not exist, naming them", () => {
    const level = judgeDirectory(['model = "scripted/judge"', 'thinking_level = "some"', 'instructions = { file = "materials/judge.md" }']);
    const missing = judgeDirectory(['model = "scripted/judge"', 'thinking_level = "off"', 'instructions = { file = "materials/none.md" }']);

    expect(() => readJudgeFile(join(level, "judge.toml"))).toThrow(/"thinking_level"/);
    expect(() => readJudgeFile(join(missing, "judge.toml"))).toThrow(/"materials\/none.md"/);
  });
});

/** The keys a test run's setup line names, as its held-out material. */
const KEYS = 'said = "the box arrived open"\n';
const KEYS_PATH = "materials/keys.toml";

/** A test scenario that judges its "keys" text as one statement, on the texts of the calls of "note". */
const judging: Partial<Scenario<unknown>> = {
  name: "judging",
  judged: (configuration, toolCalls): Judgeable[] => [
    {
      situation: "box",
      key: "said",
      statement: String(configuration.keys).split('"')[1],
      asks: "says",
      texts: toolCalls.filter((call) => call.tool === "note").map((call) => ({ text: (call.arguments as { text: string }).text, atMs: call.endedAtMs })),
    },
    { situation: "jar", key: "said", statement: "a jar was found", asks: "says", texts: [] },
  ],
};

/** A run of the test scenario: its index line and its log, with a held-out keys material and the notes it sent. */
interface TestRun {
  runId: string;
  status: "completed" | "stopped";
  notes: string[];
  scenario?: string;
}

/** A runs directory under the judge file's directory, with these runs, and the keys file beside the judge file. */
function runsDirectoryOf(directory: string, runs: readonly TestRun[]): string {
  writeFileSync(join(directory, KEYS_PATH), KEYS);
  const runsDirectory = join(directory, "runs", "e-test");
  mkdirSync(runsDirectory, { recursive: true });
  const index = runs.map(({ runId, status }, at) => JSON.stringify({ runId, condition: "rules-why", model: "scripted/worker", replica: at + 1, seed: at, status }));
  writeFileSync(join(runsDirectory, "index.jsonl"), `${index.join("\n")}\n`);
  for (const { runId, notes, scenario = "judging" } of runs) {
    const setup = {
      type: "run_setup",
      runId,
      experiment: "e-test",
      scenario,
      condition: "rules-why",
      configuration: { keys: { file: KEYS_PATH, held_out: true } },
      replica: 1,
      seed: 0,
      model: "scripted/worker",
      materials: [{ path: KEYS_PATH, key: "keys", hash: hashOf(KEYS), heldOut: true }],
    };
    const calls = notes.map((text, at) => ({ type: "tool_call", agent: "worker", tool: "note", arguments: { text }, outcome: "success", startedAtMs: at, endedAtMs: at + 1 }));
    writeFileSync(join(runsDirectory, `${runId}.jsonl`), [setup, ...calls].map((line) => `${JSON.stringify(line)}\n`).join(""));
  }
  return runsDirectory;
}

/** A scripted judge whose answers each call "verdict" with these arguments. */
function judgeModel(verdicts: readonly object[]): ScriptedModel {
  const answers: ScriptedAnswer[] = verdicts.map((args) => ({ toolCalls: [{ name: "verdict", arguments: args as never }], delayMs: 0 }));
  return new ScriptedModel(answers);
}

/** The lines of the judgements files under the runs directory, file by file. */
function judgementFiles(runsDirectory: string): Record<string, unknown>[][] {
  const directory = join(runsDirectory, "judgements");
  if (!existsSync(directory)) return [];
  return readdirSync(directory).map((file) =>
    readFileSync(join(directory, file), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  );
}

/** The text of every message but the system prompt a call received. */
const questionOf = (messages: readonly Message[]) => JSON.stringify(messages.filter((message) => message.role !== "system"));

describe("judgeRuns", () => {
  const scenarios = new Map([["judging", judging]]);
  const resolving = (model: AgentModel) => async (name: string) => {
    expect(name).toBe("scripted/judge");
    return model;
  };

  it("asks one question for each statement with texts, and writes each verdict, with the judge's settings and the call's tokens and cost", async () => {
    const directory = judgeDirectory(JUDGE_FILE);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: ["The box came in open."] }]);
    const model = judgeModel([{ verdict: "yes", quoted: "came in open", reason: "It says so." }]);

    await judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(model));

    const [lines] = judgementFiles(runsDirectory);
    const settings = { model: "scripted/judge", thinkingLevel: "off", instructionsHash: hashOf("You judge.\n") };
    expect(lines).toEqual([
      { runId: "run-1", situation: "box", key: "said", verdict: "yes", quoted: "came in open", reason: "It says so.", ...settings, tokens: expect.objectContaining({ totalTokens: expect.any(Number) }), cost: expect.objectContaining({ total: expect.any(Number) }) },
      { runId: "run-1", situation: "jar", key: "said", verdict: "no", quoted: null, reason: "no text on the channel", ...settings, tokens: null, cost: null },
    ]);
    expect(model.received).toHaveLength(1);
  });

  it("gives the judge its instructions as the system prompt, and the statement and the texts only as the question", async () => {
    const directory = judgeDirectory(JUDGE_FILE);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: ["The box came in open.", "All done."] }]);
    const model = judgeModel([{ verdict: "no", quoted: "", reason: "No." }]);

    await judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(model));

    const [received] = model.received;
    expect(getCurrentSystemPrompt(received)).toBe("You judge.\n");
    const question = questionOf(received);
    for (const held of ["the box arrived open", "The box came in open.", "All done."]) expect(question).toContain(held);
    for (const hidden of ["rules-why", "scripted/worker", 'box"', "replica", "run-1"]) expect(question).not.toContain(hidden);
  });

  it("judges only the runs that completed", async () => {
    const directory = judgeDirectory(JUDGE_FILE);
    const runsDirectory = runsDirectoryOf(directory, [
      { runId: "run-1", status: "stopped", notes: ["Stopped."] },
      { runId: "run-2", status: "completed", notes: ["The box came in open."] },
    ]);

    await judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(judgeModel([{ verdict: "no", quoted: "", reason: "No." }])));

    expect(new Set(judgementFiles(runsDirectory)[0].map((line) => line.runId))).toEqual(new Set(["run-2"]));
  });

  it("writes each judge run into a new file", async () => {
    const directory = judgeDirectory(JUDGE_FILE);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: [] }]);

    await judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(judgeModel([])));
    await judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(judgeModel([])));

    expect(judgementFiles(runsDirectory)).toHaveLength(2);
  });

  it("refuses a held-out material changed since the run, or missing, naming its path, before any model call", async () => {
    const changed = judgeDirectory(JUDGE_FILE);
    const changedRuns = runsDirectoryOf(changed, [{ runId: "run-1", status: "completed", notes: ["The box came in open."] }]);
    appendFileSync(join(changed, KEYS_PATH), "# changed\n");
    const model = judgeModel([{ verdict: "no", quoted: "", reason: "No." }]);

    await expect(judgeRuns(changedRuns, join(changed, "judge.toml"), scenarios, resolving(model))).rejects.toThrow(`"${KEYS_PATH}"`);
    expect(model.received).toHaveLength(0);
    expect(judgementFiles(changedRuns)).toEqual([]);

    const moved = judgeDirectory(JUDGE_FILE);
    const movedRuns = runsDirectoryOf(moved, [{ runId: "run-1", status: "completed", notes: [] }]);
    writeFileSync(join(moved, "judge.toml"), JUDGE_FILE.join("\n"));
    const elsewhere = join(moved, "elsewhere");
    mkdirSync(join(elsewhere, "materials"), { recursive: true });
    writeFileSync(join(elsewhere, "materials", "judge.md"), "You judge.\n");
    writeFileSync(join(elsewhere, "judge.toml"), JUDGE_FILE.join("\n"));

    await expect(judgeRuns(movedRuns, join(elsewhere, "judge.toml"), scenarios, resolving(model))).rejects.toThrow(`"${KEYS_PATH}"`);
  });

  it("refuses a run whose scenario the library does not have, or that declares nothing to judge, naming it", async () => {
    const directory = judgeDirectory(JUDGE_FILE);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: [], scenario: "other" }]);
    const silent = new Map([["other", { name: "other" }]]);

    await expect(judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(judgeModel([])))).rejects.toThrow(/"other"/);
    await expect(judgeRuns(runsDirectory, join(directory, "judge.toml"), silent, resolving(judgeModel([])))).rejects.toThrow(/"other"/);
  });

  it.each([
    ["no verdict call", []],
    ["a verdict that is neither yes nor no", [{ verdict: "maybe", quoted: "", reason: "Unsure." }]],
    ["a verdict without its reason", [{ verdict: "yes", quoted: "came in open" }]],
  ])("refuses an answer with %s, naming the run, the situation and the key", async (_case, verdicts) => {
    const directory = judgeDirectory(JUDGE_FILE);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: ["The box came in open."] }]);
    const model = verdicts.length === 0 ? new ScriptedModel([{ text: "Yes.", delayMs: 0 }]) : judgeModel(verdicts);

    await expect(judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(model))).rejects.toThrow(/"run-1".*"box".*"said"/);
  });
});
