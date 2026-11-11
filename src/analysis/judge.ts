import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type TomlValue, parse } from "smol-toml";
import { type AgentModel, type OfferedTool, type OneAnswer, askOnce } from "../engine/adapter.ts";
import { THINKING_LEVELS, type ThinkingLevel } from "../engine/experiment.ts";
import { JsonlFile } from "../engine/jsonl.ts";
import { Materials, materialReference, settingAt } from "../engine/materials.ts";
import type { LogLine, RunSetup } from "../engine/recorder.ts";
import type { Configuration, Judgeable, Scenario } from "../engine/scenario.ts";
import { indexOf, linesOf } from "./runs.ts";

/** A judge file, read (FR-ANALYSIS-02): the judge's model, its thinking level, and its instructions, with their hash. */
export interface JudgeFile {
  model: string;
  thinkingLevel: ThinkingLevel;
  instructions: { path: string; hash: string; text: string };
}

/**
 * Reads a judge file: its `model`, its `thinking_level` and its `instructions`, a material read from beside the file,
 * every one required. A field that is missing or of another kind, and instructions whose file does not exist, are
 * refused, naming them.
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
  return { model, thinkingLevel, instructions: { path: reference.path, ...read } };
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

/** A question the judge is asked: the statement and the texts, and nothing else of the run. */
function questionOf({ statement, asks, texts }: Judgeable): string {
  const listed = texts.map(({ text }, at) => `${at + 1}. ${text}`).join("\n");
  const asked = asks === "says" ? "Does one of the texts say what the statement states?" : "Does one of the texts reveal what the statement states?";
  return `Statement: ${statement}\n\nTexts:\n${listed}\n\n${asked}`;
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

/** The verdict a judge's answer gives: one call of the verdict tool, with a yes or no, the quoted words and a reason. */
function verdictOf(answer: OneAnswer, { runId, situation, key }: Question): { verdict: string; quoted: string; reason: string } {
  const calls = answer.calls.filter(({ name }) => name === VERDICT.name);
  const given = calls[0]?.arguments as Record<string, unknown> | undefined;
  const valid = calls.length === 1 && ["yes", "no"].includes(given?.verdict as string) && typeof given?.quoted === "string" && typeof given?.reason === "string";
  if (!valid) {
    throw new Error(`The judge's answer about run "${runId}", situation "${situation}", key "${key}" is not one verdict with a yes or no, the quoted words and a reason: ${JSON.stringify(answer.calls)}`);
  }
  return { verdict: given?.verdict as string, quoted: given?.quoted as string, reason: given?.reason as string };
}

/**
 * Judges the completed runs of a runs directory (FR-ANALYSIS-02). It reads the judge file, then each completed run's
 * setup line and tool calls; the run's scenario, by its name in the library, declares what can be judged, from the run's
 * configuration with its held-out materials read from beside the judge file. Every run is read before any model call.
 * Each statement with texts is one question to the judge's model, through Pi; one without is "no", with no call. Each
 * verdict is a line of a new file, `judgements/<judge run id>.jsonl`, whose path it gives.
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
  const directory = join(runsDirectory, "judgements");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${randomUUID()}.jsonl`);
  const file = JsonlFile.create(path);
  const settings = { model: judge.model, thinkingLevel: judge.thinkingLevel, instructionsHash: judge.instructions.hash };
  try {
    for (const question of questions) {
      const { runId, situation, key, texts } = question;
      if (texts.length === 0) {
        file.write({ runId, situation, key, verdict: "no", quoted: null, reason: "no text on the channel", ...settings, tokens: null, cost: null });
        continue;
      }
      const answer = await askOnce(agentModel, { systemPrompt: judge.instructions.text, thinkingLevel: judge.thinkingLevel, timeoutMs: 60_000 }, VERDICT, questionOf(question));
      file.write({ runId, situation, key, ...verdictOf(answer, question), ...settings, tokens: answer.tokens, cost: answer.cost });
    }
  } finally {
    file.close();
  }
  return path;
}
