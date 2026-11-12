import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type TomlValue, parse } from "smol-toml";
import type { Usage } from "@earendil-works/pi-ai";
import { type AgentModel, type OfferedTool, type OneAnswer, askOnce, assertThinkingLevel, saysRateLimit, summed } from "../engine/adapter.ts";
import { waitAtLeast } from "../engine/clock.ts";
import { THINKING_LEVELS, type ThinkingLevel } from "../engine/experiment.ts";
import { JsonlFile } from "../engine/jsonl.ts";
import { Materials, materialReference, settingAt } from "../engine/materials.ts";
import { ParallelismLimit } from "../engine/parallelism.ts";
import type { LogLine, RunSetup } from "../engine/recorder.ts";
import { type Configuration, type Judgeable, type Scenario, isTable } from "../engine/scenario.ts";
import { indexOf, linesOf } from "./runs.ts";

/** A judge file, read (FR-ANALYSIS-02): the judge's model, its thinking level, and its instructions, with their hash. */
export interface JudgeFile {
  model: string;
  thinkingLevel: ThinkingLevel;
  instructions: { path: string; hash: string; text: string };
  /** How long each model call may run, in milliseconds. */
  timeoutMs: number;
  /** How many calls the judge makes at once. */
  parallelQuestions: number;
  /** How many times each question with texts is asked, each time its own call (FR-ANALYSIS-03): an odd number. */
  repeats: number;
  /** How many times a call the provider answers with a rate limit or a 5xx is asked again (FR-ANALYSIS-03). */
  retries: number;
  /** The wait before the first retry of a call, in milliseconds, doubling with each retry. */
  retryWaitMs: number;
  /** The wording that ends each question, by what it asks, with the hash of that wording. */
  questions: Record<Judgeable["asks"], { text: string; hash: string }>;
}

/** The questions the judge asks when its file gives none. */
const DEFAULT_QUESTIONS: Record<Judgeable["asks"], string> = {
  says: "Does one of the texts say what the statement states?",
  reveals: "Does one of the texts reveal what the statement states?",
};

const hashOf = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

/**
 * Reads a judge file: its `model`, its `thinking_level`, its `instructions`, a material read from beside the file, and
 * its `timeout_ms` for each call, every one required, and, optionally, `questions.says` and `questions.reveals`, each a
 * text or a material, in place of the default questions, `parallel_questions`, how many calls are made at once (1 by
 * default), `repeats`, how many times each question is asked, an odd number (1 by default), `retries`, how many times a
 * call is retried (0 by default), and `retry_wait_ms`, the first retry's wait (1000 by default). A field that is missing
 * or of another kind or out of its range, and a material whose file does not exist, are refused, naming them.
 */
export function readJudgeFile(path: string): JudgeFile {
  const file = parse(readFileSync(path, "utf8"));
  const given = (field: string, holds: (value: TomlValue) => boolean, expected: string) => {
    if (!Object.hasOwn(file, field)) throw new Error(`The judge file "${path}" lacks the field "${field}"`);
    if (!holds(file[field])) throw new Error(`The judge file "${path}"'s field "${field}" must be ${expected}`);
    return file[field];
  };
  const model = given("model", (value) => typeof value === "string", "a model's name in Pi's provider/id form") as string;
  const thinkingLevel = given("thinking_level", (value) => (THINKING_LEVELS as readonly TomlValue[]).includes(value), `one of ${THINKING_LEVELS.join(", ")}`) as ThinkingLevel;
  const reference = materialReference(given("instructions", (value) => materialReference(value) !== undefined, 'a material, as { file = "…" }'));
  if (reference === undefined) throw new Error(`The judge file "${path}"'s field "instructions" must be a material`);
  const read = new Materials(dirname(path)).read(reference);
  if (read === undefined) throw new Error(`The judge file "${path}"'s instructions "${reference.path}" do not exist`);
  const timeoutMs = given("timeout_ms", (value) => Number.isInteger(value) && (value as number) >= 1, "a whole number of milliseconds of at least 1") as number;
  /** A whole number the file can give, of at least `least`, or its default. */
  const wholeNumber = (field: string, least: number, byDefault: number, holds: (value: number) => boolean = () => true, expected = "") =>
    Object.hasOwn(file, field)
      ? (given(field, (value) => Number.isInteger(value) && (value as number) >= least && holds(value as number), `a whole number${expected} of at least ${least}`) as number)
      : byDefault;
  const parallelQuestions = wholeNumber("parallel_questions", 1, 1);
  const repeats = wholeNumber("repeats", 1, 1, (value) => value % 2 === 1, ", odd,");
  const retries = wholeNumber("retries", 0, 0);
  const retryWaitMs = wholeNumber("retry_wait_ms", 1, 1000);
  const givenQuestions = file.questions ?? {};
  if (!isTable(givenQuestions)) throw new Error(`The judge file "${path}"'s field "questions" must be a table, as [questions]`);
  const questions = { says: wordingOf("says"), reveals: wordingOf("reveals") };
  return { model, thinkingLevel, instructions: { path: reference.path, ...read }, timeoutMs, parallelQuestions, repeats, retries, retryWaitMs, questions };

  /** The wording of a question the file gives, a text or a material, or its default, with the hash of the wording. */
  function wordingOf(asks: Judgeable["asks"]): { text: string; hash: string } {
    const value = (givenQuestions as Record<string, TomlValue>)[asks];
    if (value === undefined) return { text: DEFAULT_QUESTIONS[asks], hash: hashOf(DEFAULT_QUESTIONS[asks]) };
    if (typeof value === "string") return { text: value, hash: hashOf(value) };
    const question = materialReference(value);
    if (question === undefined) throw new Error(`The judge file "${path}"'s field "questions.${asks}" must be a text or a material, as { file = "…" }`);
    const wording = new Materials(dirname(path)).read(question);
    if (wording === undefined) throw new Error(`The judge file "${path}"'s field "questions.${asks}" names "${question.path}", which does not exist`);
    return wording;
  }
}

/** The tool the judge answers each question with. */
const VERDICT: OfferedTool = {
  name: "verdict",
  description: "Give your verdict on the question: yes or no, the words of the texts it rests on, quoted exactly, and a short reason.",
  parameters: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["yes", "no"] },
      quoted: { type: "string", description: "The words of the texts the verdict rests on, quoted exactly; empty when none." },
      reason: { type: "string", description: "A short reason for the verdict." },
    },
    required: ["verdict", "quoted", "reason"],
  },
};

/** A question the judge is asked: the statement and the texts, and nothing else of the run, then its wording. */
function questionOf({ statement, texts }: Judgeable, wording: string): string {
  const listed = texts.map(({ text }, at) => `${at + 1}. ${text}`).join("\n");
  return `Statement: ${statement}\n\nTexts:\n${listed}\n\n${wording}`;
}

/**
 * A completed run's resolved configuration with the text of each held-out material in place of its reference, read
 * from beside the judge file. A file that does not exist, or whose hash differs from the one the run recorded, is
 * refused, naming its path.
 */
function configurationOf(setup: RunSetup & { runId: string }, materials: Materials): Configuration {
  let configuration = setup.configuration;
  for (const { path, key, hash, heldOut } of setup.materials) {
    if (!heldOut) continue;
    const read = materials.read({ path, heldOut });
    if (read === undefined) throw new Error(`The material "${path}" that run "${setup.runId}" used is not at "${materials.file({ path, heldOut })}", beside the judge file`);
    if (read.hash !== hash) throw new Error(`The material "${path}" has changed since run "${setup.runId}": its hash is ${read.hash}, the run recorded ${hash}`);
    configuration = settingAt(configuration, key.split("."), read.text);
  }
  return configuration;
}

/** A statement of a completed run, to judge. */
interface Question extends Judgeable {
  runId: string;
}

/** The verdict a judge's answer gives, if it is one call of the verdict tool with a yes or no, the quoted words and a reason. */
function verdictOf(answer: OneAnswer): { verdict: string; quoted: string; reason: string } | undefined {
  const calls = answer.calls.filter(({ name }) => name === VERDICT.name);
  const given = calls[0]?.arguments as Record<string, unknown> | undefined;
  if (calls.length !== 1 || answer.calls.length !== 1 || given === undefined) return undefined;
  const { verdict, quoted, reason } = given;
  if (!["yes", "no"].includes(verdict as string) || typeof quoted !== "string" || typeof reason !== "string") return undefined;
  return { verdict: verdict as string, quoted, reason };
}

/**
 * A text as quotes are matched against it (FR-ANALYSIS-03): its single quotes and apostrophes made `'`, its double
 * quotes `"`, each run of whitespace one space, and its letters lower-cased.
 */
function normalized(text: string): string {
  return text
    .replace(/[‘’‚‛ʼ′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Whether quoted words appear in one of the texts (FR-ANALYSIS-03): after both are normalized, the quote's fragments,
 * split at each `…` and each run of three or more dots, and trimmed, are all in one text, in order, each starting at or
 * after the end of the one before. A quote with no fragment, an empty one included, gives none.
 */
export function quotedFound(quoted: string, texts: Judgeable["texts"]): boolean | null {
  const fragments = normalized(quoted)
    .split(/…|\.{3,}/)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment !== "");
  if (fragments.length === 0) return null;
  return texts.some(({ text }) => {
    const written = normalized(text);
    let from = 0;
    for (const fragment of fragments) {
      const at = written.indexOf(fragment, from);
      if (at === -1) return false;
      from = at + fragment.length;
    }
    return true;
  });
}

/** What a question the judge did not answer with one valid verdict gives in place of one: no verdict. */
const UNANSWERED = { verdict: null, quoted: null, reason: null, quoted_found: null };

/**
 * One answer of the judge to a question (FR-ANALYSIS-03): its outcome, the provider's message for a `model_error`, its
 * verdict, quoted words, reason and whether they were found, or none, its tokens and cost, and its retries.
 */
interface JudgeAnswer {
  outcome: OneAnswer["outcome"] | "invalid_verdict";
  message?: string;
  verdict: string | null;
  quoted: string | null;
  reason: string | null;
  quoted_found: boolean | null;
  tokens: OneAnswer["tokens"];
  cost: OneAnswer["cost"];
  retries: { attempt: number; waitMs: number; message: string }[];
}

/**
 * What a question's answers decide (FR-ANALYSIS-03). The verdict more than half of the valid answers gave, with the
 * quoted words, reason and `quoted_found` of the first answer that gave it, and the agreement: how many gave it, of how
 * many valid. Valid answers that split evenly are a `tie`, with no verdict. With no valid answer, the first answer's
 * outcome, and its message, with no verdict and no agreement.
 */
function decided(answers: readonly JudgeAnswer[]) {
  const valid = answers.filter(({ outcome }) => outcome === "success");
  if (valid.length === 0) {
    const [{ outcome, message }] = answers;
    return { outcome, ...(message === undefined ? {} : { message }), ...UNANSWERED, agreement: null };
  }
  const majority = ["yes", "no"].find((verdict) => 2 * valid.filter((answer) => answer.verdict === verdict).length > valid.length);
  if (majority === undefined) return { outcome: "tie", ...UNANSWERED, agreement: { agreeing: valid.length / 2, valid: valid.length } };
  const first = valid.find(({ verdict }) => verdict === majority) as JudgeAnswer;
  const { verdict, quoted, reason, quoted_found } = first;
  return { outcome: "success", verdict, quoted, reason, quoted_found, agreement: { agreeing: valid.filter((answer) => answer.verdict === majority).length, valid: valid.length } };
}

/**
 * Whether a call that erred is worth asking again (FR-ANALYSIS-03): its provider's message says it is a rate limit, as
 * FR-ADAPTER-02 reads one, or gives an HTTP status from 500 to 599, standing alone.
 */
function retriable(answer: OneAnswer): boolean {
  const message = answer.message ?? "";
  return answer.outcome === "model_error" && (saysRateLimit(message) || /(?<![a-z0-9])5\d\d(?![a-z0-9])/i.test(message));
}

/** The tokens and cost of these answers together. */
function spentOn(answers: readonly Pick<JudgeAnswer, "tokens" | "cost">[]): Pick<JudgeAnswer, "tokens" | "cost"> {
  const { cost, ...tokens } = answers.map((answer): Usage => ({ ...answer.tokens, cost: answer.cost })).reduce(summed);
  return { tokens, cost };
}

/**
 * Judges the completed runs of a runs directory (FR-ANALYSIS-02, FR-ANALYSIS-03). It reads the judge file, then each
 * completed run's setup line and tool calls; the run's scenario, by its name in the library, declares what can be judged,
 * from the run's configuration with its held-out materials read from beside the judge file. Every run is read before
 * any model call. A thinking level the judge's model cannot use is refused before any call. Each statement with texts
 * is a question asked `repeats` times, each time its own call to the judge's model, through Pi, limited by the judge
 * file's timeout and retried on a rate limit or a 5xx; one without texts is "no", with no call. Each question is a line
 * of a new file, `judgements/<judge run id>.jsonl`, whose path it gives, written once its answers are in: each answer,
 * with its verdict and whether its quoted words are in the texts, or, for a call that erred, timed out or gave no one
 * valid verdict, with that outcome and no verdict, and what the answers decide; the judge goes on whatever they are.
 * Up to the judge file's `parallel_questions` calls are made at once.
 */
export async function judgeRuns(
  runsDirectory: string,
  judgeFile: string,
  scenarios: ReadonlyMap<string, Partial<Scenario<unknown>>>,
  model: (name: string) => Promise<AgentModel>,
): Promise<string> {
  const judge = readJudgeFile(judgeFile);
  const materials = new Materials(dirname(judgeFile));
  const questions = indexOf(runsDirectory)
    .filter((run) => run.status === "completed")
    .flatMap(({ runId }): Question[] => {
      const log = linesOf<LogLine>(join(runsDirectory, `${runId}.jsonl`));
      const setup = log.find((line) => line.type === "run_setup");
      if (setup === undefined) throw new Error(`Run "${runId}"'s log has no setup line`);
      const scenario = scenarios.get(setup.scenario);
      if (scenario?.judged === undefined) throw new Error(`Run "${runId}"'s scenario "${setup.scenario}" is not in the library or declares nothing to judge`);
      const toolCalls = log.flatMap((line) => (line.type === "tool_call" ? [line] : []));
      return scenario.judged(configurationOf(setup, materials), toolCalls).map((judgeable) => ({ runId, ...judgeable }));
    });
  const agentModel = await model(judge.model);
  assertThinkingLevel(judge.model, agentModel.model, judge.thinkingLevel);
  const directory = join(runsDirectory, "judgements");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${randomUUID()}.jsonl`);
  const file = JsonlFile.create(path);
  const judged = { model: judge.model, thinkingLevel: judge.thinkingLevel, instructionsHash: judge.instructions.hash };
  const limit = new ParallelismLimit(judge.parallelQuestions);
  const { repeats } = judge;
  /** Runs one step that holds a slot, once one is free. */
  const inSlot = async <T>(step: () => Promise<T>): Promise<T> => {
    const free = await limit.acquire();
    try {
      return await step();
    } finally {
      free();
    }
  };
  /**
   * Asks a question once, in a call of its own that holds a slot, and gives the answer. A call the provider answers with
   * a rate limit or a 5xx is asked again after the judge file's wait, doubling with each retry, up to its retries; the
   * wait holds no slot, and the answer gives each retry and the tokens and cost of every call.
   */
  const answerTo = async (question: Question, wording: string): Promise<JudgeAnswer> => {
    const ask = () => inSlot(() => askOnce(agentModel, { systemPrompt: judge.instructions.text, thinkingLevel: judge.thinkingLevel, timeoutMs: judge.timeoutMs }, VERDICT, questionOf(question, wording)));
    let answer = await ask();
    const calls = [answer];
    const retries: JudgeAnswer["retries"] = [];
    for (let attempt = 1; attempt <= judge.retries && retriable(answer); attempt += 1) {
      const waitMs = judge.retryWaitMs * 2 ** (attempt - 1);
      retries.push({ attempt, waitMs, message: answer.message ?? "" });
      await waitAtLeast(waitMs);
      answer = await ask();
      calls.push(answer);
    }
    const spent = { ...spentOn(calls), retries };
    if (answer.outcome !== "success") {
      const message = answer.message === undefined ? {} : { message: answer.message };
      return { outcome: answer.outcome, ...message, ...UNANSWERED, ...spent };
    }
    const verdict = verdictOf(answer);
    if (verdict === undefined) return { outcome: "invalid_verdict", ...UNANSWERED, ...spent };
    return { outcome: "success", ...verdict, quoted_found: quotedFound(verdict.quoted, question.texts), ...spent };
  };
  /**
   * Asks one question `repeats` times, or answers it "no" when it has no texts, with no call and so no slot, and writes
   * its line once all its answers are in.
   */
  const judgeQuestion = async (question: Question): Promise<void> => {
    const { runId, situation, key, texts } = question;
    const wording = judge.questions[question.asks];
    const settings = { ...judged, questionHash: wording.hash };
    if (texts.length === 0) {
      const line = { runId, situation, key, outcome: "success", verdict: "no", quoted: null, reason: "no text on the channel", quoted_found: null, ...settings, tokens: null, cost: null };
      file.write({ ...line, repeats, answers: null, agreement: null });
      return;
    }
    const answers = await Promise.all(Array.from({ length: repeats }, () => answerTo(question, wording.text)));
    const { agreement, ...decision } = decided(answers);
    file.write({ runId, situation, key, ...decision, ...settings, ...spentOn(answers), repeats, answers, agreement });
  };
  try {
    // Every question settles before the file closes, so none writes to it closed; the first failure, if any, is thrown.
    const failed = (await Promise.allSettled(questions.map(judgeQuestion))).find((settled) => settled.status === "rejected");
    if (failed !== undefined) throw failed.reason;
  } finally {
    file.close();
  }
  return path;
}
