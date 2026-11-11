import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ContextCompaction, EffectorStart, ModelTurn, ToolCall } from "./adapter.ts";
import type { CodeVersion } from "./code-version.ts";
import type { ComponentAction } from "./components.ts";
import type { Compaction } from "./experiment.ts";
import type { ConditionInventory } from "./inventory.ts";
import { JsonlFile } from "./jsonl.ts";
import type { Material } from "./materials.ts";
import type { Configuration, MetricValue } from "./scenario.ts";
import type { Stimulus } from "./stimuli.ts";

/**
 * What a run of an experiment ran, which its log's first line gives (FR-RECORD-02): the experiment, its scenario, the condition and
 * its resolved configuration, the replica and its seed, the model, the code, and the condition's inventory; the run adds
 * the sampling settings its sessions use, or null when they failed to open.
 */
export interface RunSetup {
  experiment: string;
  /** The scenario's name in the library, which the run's analysis asks what it declares (FR-ANALYSIS-02). */
  scenario: string;
  condition: string;
  configuration: Configuration;
  /** The replica, from 1. */
  replica: number;
  seed: number;
  model: string;
  code: CodeVersion;
  inventory: ConditionInventory;
  /** Each material the condition set a value to, by its path, with the hash of its content (FR-EXPERIMENT-04). */
  materials: readonly Material[];
  /** The context compaction every session of the run uses (FR-ADAPTER-03). */
  compaction: Compaction;
  /** How many runs of the experiment may be in progress at once (FR-RUN-06). */
  parallelRuns: number;
  /** The level of each factor, by the factor's name, when the condition is a combination of levels; otherwise none (FR-EXPERIMENT-02). */
  levels?: Readonly<Record<string, string>>;
}

/**
 * The sampling settings a run's sessions use: each agent's thinking level, as Pi gives its session, and that every
 * other parameter is the provider's default, since the engine sends none.
 */
export interface Sampling {
  thinkingLevels: Record<string, string>;
  otherParameters: string;
}

/**
 * A line of a run's log: what the run ran, first, then one event of the run. Every time in it is by performance.now().
 */
export type LogLine =
  | ({ type: "run_setup"; runId: string; sampling: Sampling | null } & RunSetup)
  | { type: "activation"; agent: string; wokeAtMs: number; endedAtMs: number }
  | ({ type: "stimulus"; agent: string; deliveredAtMs: number } & Stimulus)
  | ({ type: "model_turn" } & ModelTurn)
  | ({ type: "tool_call" } & ToolCall)
  | ({ type: "effector_start" } & EffectorStart)
  | ({ type: "component_action" } & ComponentAction)
  | ({ type: "compaction" } & ContextCompaction)
  | { type: "metric_sample"; atMs: number; version: number; metrics: Record<string, MetricValue> }
  | { type: "run_stopped"; error: string };

/** Writes a run's log: one new JSONL file, named with the run's id, with a line for each event (FR-RECORD-01). */
export class Recorder {
  readonly runId: string;
  readonly #file: JsonlFile;
  readonly #onRecord: ((line: LogLine) => void) | undefined;
  #stopped = false;

  private constructor(runId: string, file: JsonlFile, onRecord: ((line: LogLine) => void) | undefined) {
    this.runId = runId;
    this.#file = file;
    this.#onRecord = onRecord;
  }

  /**
   * Opens a new log for a run, in the directory, under an id of its own unless one is given. It refuses a file that is
   * already there: a run never writes to an existing file. Each line it writes is then handed to `onRecord`, when given,
   * so whoever follows the run reads it from what the log records.
   */
  static open(directory: string, runId: string = randomUUID(), onRecord?: (line: LogLine) => void): Recorder {
    return new Recorder(runId, JsonlFile.create(join(directory, `${runId}.jsonl`)), onRecord);
  }

  /** Writes one line at once. */
  record(line: LogLine): void {
    if (this.#stopped) return;
    this.#file.write(line);
    this.#onRecord?.(line);
  }

  /**
   * Ends the log of a run that stopped on an error with a line that says so and gives the error; nothing is written
   * after it, so a stopped run's log never reads as a run that simply ended. Only the first error is the run's.
   */
  stop(error: Error): void {
    this.record({ type: "run_stopped", error: error.message });
    this.#stopped = true;
  }

  close(): void {
    this.#file.close();
  }
}
