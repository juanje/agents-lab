import type { AgentModel } from "../engine/adapter.ts";
import type { ThinkingLevel } from "../engine/experiment.ts";
import type { Scenario } from "../engine/scenario.ts";

/** A judge file, read (FR-ANALYSIS-02): the judge's model, its thinking level, and its instructions, with their hash. */
export interface JudgeFile {
  model: string;
  thinkingLevel: ThinkingLevel;
  instructions: { path: string; hash: string; text: string };
}

/** A stub that reads nothing, for the test to fail on its assertions. */
export function readJudgeFile(_path: string): JudgeFile {
  return { model: "", thinkingLevel: "off", instructions: { path: "", hash: "", text: "" } };
}

/** A stub that judges nothing, for the test to fail on its assertions. */
export async function judgeRuns(
  _runsDirectory: string,
  _judgeFile: string,
  _scenarios: ReadonlyMap<string, Partial<Scenario<unknown>>>,
  _model: (name: string) => Promise<AgentModel>,
): Promise<string> {
  return "";
}
