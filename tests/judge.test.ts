import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { type Message, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { judgeRuns, quotedFound, readJudgeFile } from "../src/analysis/judge.ts";
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

/** The questions the judge asks when its file gives none. */
const SAYS = "Does one of the texts say what the statement states?";
const REVEALS = "Does one of the texts reveal what the statement states?";

const JUDGE_FILE = ['model = "scripted/judge"', 'thinking_level = "off"', 'instructions = { file = "materials/judge.md" }', "timeout_ms = 2000"];

describe("readJudgeFile", () => {
  it("gives the model, the thinking level and the instructions, read from beside the file, with their hash", () => {
    const directory = judgeDirectory(JUDGE_FILE);

    expect(readJudgeFile(join(directory, "judge.toml"))).toEqual({
      model: "scripted/judge",
      thinkingLevel: "off",
      instructions: { path: "materials/judge.md", hash: hashOf("You judge.\n"), text: "You judge.\n" },
      timeoutMs: 2000,
      parallelQuestions: 1,
      repeats: 1,
      retries: 0,
      retryWaitMs: 1000,
      questions: { says: { text: SAYS, hash: hashOf(SAYS) }, reveals: { text: REVEALS, hash: hashOf(REVEALS) } },
    });
  });

  it("gives the questions the file gives, each a text or a material read from beside the file, with the hash of its wording", () => {
    const directory = judgeDirectory([...JUDGE_FILE, "[questions]", 'says = "Would the keeper know it?"', 'reveals = { file = "materials/reveals.md" }']);
    writeFileSync(join(directory, "materials", "reveals.md"), "Would a reader learn it?\n");

    expect(readJudgeFile(join(directory, "judge.toml")).questions).toEqual({
      says: { text: "Would the keeper know it?", hash: hashOf("Would the keeper know it?") },
      reveals: { text: "Would a reader learn it?\n", hash: hashOf("Would a reader learn it?\n") },
    });
  });

  it("refuses a question that is neither a text nor a material, or whose file does not exist, naming it", () => {
    const number = judgeDirectory([...JUDGE_FILE, "[questions]", "says = 3"]);
    const missing = judgeDirectory([...JUDGE_FILE, "[questions]", 'reveals = { file = "materials/none.md" }']);
    const untabled = judgeDirectory([...JUDGE_FILE, 'questions = "Would the keeper know it?"']);

    expect(() => readJudgeFile(join(untabled, "judge.toml"))).toThrow(/"questions"/);
    expect(() => readJudgeFile(join(number, "judge.toml"))).toThrow(/"questions.says"/);
    expect(() => readJudgeFile(join(missing, "judge.toml"))).toThrow(/"questions.reveals".*"materials\/none.md"/);
  });

  it.each([["model"], ["thinking_level"], ["instructions"], ["timeout_ms"]])("refuses a judge file without its %s, naming it", (field) => {
    const directory = judgeDirectory(JUDGE_FILE.filter((line) => !line.startsWith(`${field} `)));

    expect(() => readJudgeFile(join(directory, "judge.toml"))).toThrow(`"${field}"`);
  });

  it("refuses a thinking level Pi does not know, and instructions whose file does not exist, naming them", () => {
    const level = judgeDirectory(['model = "scripted/judge"', 'thinking_level = "some"', 'instructions = { file = "materials/judge.md" }']);
    const missing = judgeDirectory(['model = "scripted/judge"', 'thinking_level = "off"', 'instructions = { file = "materials/none.md" }']);

    expect(() => readJudgeFile(join(level, "judge.toml"))).toThrow(/"thinking_level"/);
    expect(() => readJudgeFile(join(missing, "judge.toml"))).toThrow(/"materials\/none.md"/);
  });

  it("gives how many questions the judge asks at once, 1 when the file gives none", () => {
    const directory = judgeDirectory([...JUDGE_FILE, "parallel_questions = 3"]);

    expect(readJudgeFile(join(directory, "judge.toml")).parallelQuestions).toBe(3);
  });

  it.each([["0"], ["1.5"], ['"3"']])("refuses a parallel_questions of %s, naming it", (value) => {
    const directory = judgeDirectory([...JUDGE_FILE, `parallel_questions = ${value}`]);

    expect(() => readJudgeFile(join(directory, "judge.toml"))).toThrow(/"parallel_questions"/);
  });

  it("gives how many times each question is asked, how many times a call is retried, and the first retry's wait", () => {
    const directory = judgeDirectory([...JUDGE_FILE, "repeats = 3", "retries = 2", "retry_wait_ms = 50"]);

    expect(readJudgeFile(join(directory, "judge.toml"))).toMatchObject({ repeats: 3, retries: 2, retryWaitMs: 50 });
  });

  it.each([
    ["repeats", "0"],
    ["repeats", "-1"],
    ["repeats", "2"],
    ["repeats", "1.5"],
    ["repeats", '"3"'],
    ["retries", "-1"],
    ["retries", "1.5"],
    ["retries", '"1"'],
    ["retry_wait_ms", "0"],
    ["retry_wait_ms", "2.5"],
    ["retry_wait_ms", '"50"'],
  ])("refuses a %s of %s, naming it", (field, value) => {
    const directory = judgeDirectory([...JUDGE_FILE, `${field} = ${value}`]);

    expect(() => readJudgeFile(join(directory, "judge.toml"))).toThrow(`"${field}"`);
  });

  it("refuses a timeout that is not a whole number of milliseconds of at least 1, naming it", () => {
    const directory = judgeDirectory([...JUDGE_FILE.slice(0, 3), "timeout_ms = 0"]);

    expect(() => readJudgeFile(join(directory, "judge.toml"))).toThrow(/"timeout_ms"/);
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

/** The lines of a judgements file for these situations, in that order, whatever order the file gives them in. */
const bySituation = (lines: Record<string, unknown>[], ...situations: string[]) => situations.map((situation) => lines.find((line) => line.situation === situation) as Record<string, unknown>);

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
    const settings = { model: "scripted/judge", thinkingLevel: "off", instructionsHash: hashOf("You judge.\n"), questionHash: hashOf(SAYS) };
    expect(lines).toEqual(expect.arrayContaining([
      {
        runId: "run-1",
        situation: "box",
        key: "said",
        outcome: "success",
        verdict: "yes",
        quoted: "came in open",
        reason: "It says so.",
        quoted_found: true,
        ...settings,
        tokens: expect.objectContaining({ totalTokens: expect.any(Number) }),
        cost: expect.objectContaining({ total: expect.any(Number) }),
        repeats: 1,
        answers: [
          {
            outcome: "success",
            verdict: "yes",
            quoted: "came in open",
            reason: "It says so.",
            quoted_found: true,
            tokens: expect.objectContaining({ totalTokens: expect.any(Number) }),
            cost: expect.objectContaining({ total: expect.any(Number) }),
            retries: [],
          },
        ],
        agreement: { agreeing: 1, valid: 1 },
      },
      { runId: "run-1", situation: "jar", key: "said", outcome: "success", verdict: "no", quoted: null, reason: "no text on the channel", quoted_found: null, ...settings, tokens: null, cost: null, repeats: 1, answers: null, agreement: null },
    ]));
    expect(lines).toHaveLength(2);
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

  it("ends each question with the wording the judge file gives for what it asks, and gives that wording's hash on its line", async () => {
    const directory = judgeDirectory([...JUDGE_FILE, "[questions]", 'says = "Would the keeper know it?"']);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: ["The box came in open."] }]);
    const model = judgeModel([{ verdict: "no", quoted: "", reason: "No." }]);

    await judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(model));

    expect(questionOf(model.received[0])).toMatch(/Would the keeper know it\?"/);
    expect(questionOf(model.received[0])).not.toContain(SAYS);
    const [box, jar] = bySituation(judgementFiles(runsDirectory)[0], "box", "jar");
    expect(box.questionHash).toBe(hashOf("Would the keeper know it?"));
    expect(jar.questionHash).toBe(hashOf("Would the keeper know it?"));
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
    ["quoted words that are in a text", "came in open", true],
    ["quoted words with a word that is not in the texts", "came in shut", false],
    ["no quoted words", "", null],
  ])("says, for %s, whether they were found", async (_case, quoted, found) => {
    const directory = judgeDirectory(JUDGE_FILE);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: ["The box came in open."] }]);

    await judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(judgeModel([{ verdict: "yes", quoted, reason: "It says so." }])));

    expect(bySituation(judgementFiles(runsDirectory)[0], "box")[0].quoted_found).toBe(found);
  });

  it.each([
    ["no verdict call", [{ text: "Yes.", delayMs: 0 }], "invalid_verdict"],
    ["a verdict that is neither yes nor no", [{ toolCalls: [{ name: "verdict", arguments: { verdict: "maybe", quoted: "", reason: "Unsure." } }], delayMs: 0 }], "invalid_verdict"],
    ["a verdict without its reason", [{ toolCalls: [{ name: "verdict", arguments: { verdict: "yes", quoted: "came in open" } }], delayMs: 0 }], "invalid_verdict"],
    ["a provider error", [{ error: "overloaded", delayMs: 0 }], "model_error"],
    ["an answer past the timeout", [{ toolCalls: [{ name: "verdict", arguments: { verdict: "yes", quoted: "", reason: "Late." } }], delayMs: 5_000 }], "timeout"],
  ] as [string, ScriptedAnswer[], string][])("records a question answered with %s with its outcome and no verdict, and goes on", async (_case, answers, outcome) => {
    const directory = judgeDirectory([...JUDGE_FILE.slice(0, 3), "timeout_ms = 100"]);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: ["The box came in open."] }]);

    await judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(new ScriptedModel(answers)));

    const [box, jar] = bySituation(judgementFiles(runsDirectory)[0], "box", "jar");
    expect(box).toMatchObject({ runId: "run-1", situation: "box", key: "said", outcome, verdict: null, quoted: null, reason: null, quoted_found: null });
    expect(box.tokens).not.toBeNull();
    expect(jar).toMatchObject({ situation: "jar", outcome: "success", verdict: "no" });
  });

  it("gives a model error's message on its line", async () => {
    const directory = judgeDirectory(JUDGE_FILE);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: ["The box came in open."] }]);

    await judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(new ScriptedModel([{ error: "overloaded", delayMs: 0 }])));

    expect(bySituation(judgementFiles(runsDirectory)[0], "box")[0]).toMatchObject({ outcome: "model_error", message: "overloaded" });
  });

  it("asks up to parallel_questions questions at once, each its own call", async () => {
    const directory = judgeDirectory([...JUDGE_FILE, "parallel_questions = 2"]);
    const runs = ["run-1", "run-2", "run-3"].map((runId) => ({ runId, status: "completed" as const, notes: [`The box of ${runId} came in open.`] }));
    const runsDirectory = runsDirectoryOf(directory, runs);
    const slow = { toolCalls: [{ name: "verdict", arguments: { verdict: "no", quoted: "", reason: "No." } }], delayMs: 600 };
    const model = new ScriptedModel([slow, slow, slow]);

    const judging = judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(model));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const atOnce = model.received.length;
    await judging;

    expect(atOnce).toBe(2);
    expect(model.received).toHaveLength(3);
    // Each call holds its own question and nothing of the others.
    model.received.forEach((received) => expect(runs.filter(({ notes }) => questionOf(received).includes(notes[0]))).toHaveLength(1));
  });

  it("writes each question's line as its answer comes", async () => {
    const directory = judgeDirectory([...JUDGE_FILE, "parallel_questions = 2"]);
    const runsDirectory = runsDirectoryOf(directory, [
      { runId: "run-1", status: "completed", notes: ["The box came in open."] },
      { runId: "run-2", status: "completed", notes: ["The box came in open too."] },
    ]);
    const model = new ScriptedModel([
      { toolCalls: [{ name: "verdict", arguments: { verdict: "yes", quoted: "", reason: "Slow." } }], delayMs: 500 },
      { toolCalls: [{ name: "verdict", arguments: { verdict: "no", quoted: "", reason: "Fast." } }], delayMs: 0 },
    ]);

    await judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(model));

    const answered = judgementFiles(runsDirectory)[0].filter((line) => line.situation === "box");
    expect(answered.map((line) => line.reason)).toEqual(["Fast.", "Slow."]);
  });

  it("refuses a thinking level the judge's model cannot use, naming both, before any call", async () => {
    const directory = judgeDirectory(['model = "scripted/judge"', 'thinking_level = "high"', ...JUDGE_FILE.slice(2)]);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: ["The box came in open."] }]);
    const model = judgeModel([{ verdict: "no", quoted: "", reason: "No." }]);

    await expect(judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(model))).rejects.toThrow(/"scripted\/judge".*"high"/);
    expect(model.received).toHaveLength(0);
    expect(judgementFiles(runsDirectory)).toEqual([]);
  });
});

describe("quotedFound", () => {
  const texts = (...written: string[]) => written.map((text, at) => ({ text, atMs: at }));
  const notes = texts("The cardboard box came in with its flaps open; I didn’t close it.", "Label reads “Mr G. Ha... , 1 Church St...”, the rest is smudged.");

  it.each([
    ["typographic quotes made plain", "I didn't close it"],
    ["plain quotes made typographic", "Label reads \"Mr G. Ha... , 1 Church St...\""],
    ["another case", "THE CARDBOARD box"],
    ["runs of whitespace, a line break and a no-break space among them", "came in with  its\nflaps\u00a0open"],
    ["fragments joined by …", "The cardboard box … flaps open"],
    ["fragments joined by three or more dots", "The cardboard box .... flaps open"],
    ["dots at either end", "...came in with its flaps open..."],
    ["fragments in one text, in order", "Mr G. Ha … the rest is smudged"],
  ])("finds a quote that differs from a text only in %s", (_case, quoted) => {
    expect(quotedFound(quoted, notes)).toBe(true);
  });

  it.each([["‘"], ["’"], ["‚"], ["‛"], ["ʼ"], ["′"]])("matches %s as an apostrophe", (apostrophe) => {
    expect(quotedFound(`I didn${apostrophe}t close it`, notes)).toBe(true);
  });

  it("matches the double quotes “ ” „ ‟ ″ as one", () => {
    expect(quotedFound("\"a\" \"b\" \"c\"", texts("„a‟ ″b″ “c”"))).toBe(true);
  });

  it.each([
    ["fragments out of order", "flaps open ... The cardboard box"],
    ["fragments in different texts", "flaps open ... the rest is smudged"],
    ["a word changed", "The cardboard box came with its flaps open"],
    ["a word added", "The cardboard box came in with its flaps wide open"],
    ["a word dropped", "I did not close it"],
    ["a fragment that overlaps the one before", "cardboard box … box came"],
  ])("does not find a quote with %s", (_case, quoted) => {
    expect(quotedFound(quoted, notes)).toBe(false);
  });

  it.each([[""], ["…"], ["... … ...."]])("gives nothing for a quote %j, which leaves no fragment", (quoted) => {
    expect(quotedFound(quoted, notes)).toBeNull();
  });
});

describe("judgeRuns, with repeats", () => {
  const scenarios = new Map([["judging", judging]]);
  const resolving = (model: AgentModel) => async () => model;
  const verdict = (given: "yes" | "no", quoted: string, reason: string): ScriptedAnswer => ({ toolCalls: [{ name: "verdict", arguments: { verdict: given, quoted, reason } }], delayMs: 0 });

  /** The box's line of one judge run of a run with one note, whose said the scripted judge answers so. */
  async function boxLine(answers: ScriptedAnswer[], repeats = 3, settings: string[] = []): Promise<{ line: Record<string, unknown>; model: ScriptedModel }> {
    const directory = judgeDirectory([...JUDGE_FILE.slice(0, 3), "timeout_ms = 100", `repeats = ${repeats}`, ...settings]);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: ["The box came in open."] }]);
    const model = new ScriptedModel(answers);
    await judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(model));
    const [lines] = judgementFiles(runsDirectory);
    return { line: lines.find((line) => line.situation === "box") as Record<string, unknown>, model };
  }

  it("asks each question with texts repeats times, each its own call, and gives the majority's verdict with the first answer that gave it", async () => {
    const { line, model } = await boxLine([verdict("yes", "came in", "First."), verdict("no", "", "Second."), verdict("yes", "came in open", "Third.")]);

    expect(model.received).toHaveLength(3);
    for (const received of model.received) expect(received.filter((message) => message.role !== "system")).toHaveLength(1);
    expect(line).toMatchObject({ outcome: "success", verdict: "yes", quoted: "came in", reason: "First.", quoted_found: true, repeats: 3, agreement: { agreeing: 2, valid: 3 } });
    expect((line.answers as Record<string, unknown>[]).map(({ outcome, verdict, quoted, reason, quoted_found }) => ({ outcome, verdict, quoted, reason, quoted_found }))).toEqual([
      { outcome: "success", verdict: "yes", quoted: "came in", reason: "First.", quoted_found: true },
      { outcome: "success", verdict: "no", quoted: "", reason: "Second.", quoted_found: null },
      { outcome: "success", verdict: "yes", quoted: "came in open", reason: "Third.", quoted_found: true },
    ]);
  });

  it("sums its answers' tokens and cost", async () => {
    const { line } = await boxLine([verdict("yes", "", "First."), verdict("yes", "", "Second."), verdict("yes", "", "Third.")]);

    const answers = line.answers as { tokens: Record<string, number>; cost: Record<string, number> }[];
    for (const count of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) {
      expect((line.tokens as Record<string, number>)[count]).toBe(answers.reduce((sum, { tokens }) => sum + tokens[count], 0));
    }
    for (const count of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
      expect((line.cost as Record<string, number>)[count]).toBe(answers.reduce((sum, { cost }) => sum + cost[count], 0));
    }
    expect((line.tokens as Record<string, number>).totalTokens).toBeGreaterThan(answers[0].tokens.totalTokens);
  });

  it("takes the majority over the valid answers only, and gives an answer's provider message", async () => {
    const { line } = await boxLine([{ error: "400 bad request", delayMs: 0 }, verdict("no", "", "Second."), verdict("no", "", "Third.")]);

    expect(line).toMatchObject({ outcome: "success", verdict: "no", reason: "Second.", agreement: { agreeing: 2, valid: 2 } });
    expect((line.answers as Record<string, unknown>[])[0]).toMatchObject({ outcome: "model_error", message: "400 bad request", verdict: null, quoted: null, reason: null, quoted_found: null });
  });

  it("gives a tie, with no verdict, when the valid answers split evenly", async () => {
    const late = { ...verdict("yes", "", "Late."), delayMs: 1000 };
    const { line } = await boxLine([verdict("yes", "came in", "First."), late, verdict("no", "", "Third.")]);

    expect(line).toMatchObject({ outcome: "tie", verdict: null, quoted: null, reason: null, quoted_found: null, agreement: { agreeing: 1, valid: 2 } });
    expect((line.answers as Record<string, unknown>[]).map(({ outcome }) => outcome)).toEqual(["success", "timeout", "success"]);
  });

  it("gives the first answer's outcome, and its message, with no verdict and no agreement, when no answer is valid", async () => {
    const { line } = await boxLine([{ error: "overloaded", delayMs: 0 }, { text: "No verdict.", delayMs: 0 }, { error: "down", delayMs: 0 }]);

    expect(line).toMatchObject({ outcome: "model_error", message: "overloaded", verdict: null, quoted: null, reason: null, quoted_found: null, agreement: null });
  });

  it("answers a question with no texts without a call, with no answers and no agreement", async () => {
    const directory = judgeDirectory([...JUDGE_FILE, "repeats = 3"]);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: [] }]);
    const model = new ScriptedModel([]);

    await judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(model));

    expect(model.received).toHaveLength(0);
    expect(judgementFiles(runsDirectory)[0].find((line) => line.situation === "jar")).toMatchObject({ verdict: "no", repeats: 3, answers: null, agreement: null });
  });

  it("gives each repeat a parallel_questions slot of its own", async () => {
    const slow = { ...verdict("no", "", "Slow."), delayMs: 300 };
    const directory = judgeDirectory([...JUDGE_FILE, "repeats = 3", "parallel_questions = 2"]);
    const runsDirectory = runsDirectoryOf(directory, [{ runId: "run-1", status: "completed", notes: ["The box came in open."] }]);
    const model = new ScriptedModel([slow, slow, slow]);

    const judging = judgeRuns(runsDirectory, join(directory, "judge.toml"), scenarios, resolving(model));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const atOnce = model.received.length;
    await judging;

    expect(atOnce).toBe(2);
    expect(model.received).toHaveLength(3);
  });
});
