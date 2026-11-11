import { World as CucumberWorld, setWorldConstructor } from "@cucumber/cucumber";
import type { Grid, Position, WindowCell } from "../../src/engine/grid.ts";
import type { TomlTable } from "smol-toml";
import type { Experiment } from "../../src/engine/experiment.ts";
import type { Condition, LoadedScenario, Rhythm, Scenario } from "../../src/engine/scenario.ts";
import type { AgentModel, ModelTurn } from "../../src/engine/adapter.ts";
import type { RunResult } from "../../src/engine/run.ts";
import type { ScriptedAnswer, ScriptedModel } from "../../src/engine/scripted-model.ts";
import type { Channel, Stimuli } from "../../src/engine/stimuli.ts";
import type { Action, ActionResult, World } from "../../src/engine/world.ts";
import type { Tool } from "../../src/engine/tools.ts";
import type { LibraryScenario } from "../../src/scenarios/library.ts";
import type { Neighbourhood } from "../../src/scenarios/neighbourhood.ts";
import { type Slots, rhythmChannel, slotTools, slotsScenario } from "../../tests/fixtures/slots.ts";

/**
 * What one scenario's steps share. Cucumber builds a fresh one for each scenario, so no state leaks
 * between scenarios, and step files of different FRs reach the same test world.
 */
export class Context extends CucumberWorld {
  world!: World<Slots>;
  /** The home directory the scenario runs with, in place of the person's. */
  home!: string;
  versionBefore!: number;
  result!: ActionResult;
  results!: ActionResult[];
  /** Each agent's scripted model, as the scenario gives it before the run. */
  readonly models = new Map<string, ScriptedModel>();
  /** Each agent's real model, for the smoke run, which runs outside the gate. */
  readonly realModels = new Map<string, AgentModel>();
  /** The answers each agent's script holds, in order. */
  readonly scripts = new Map<string, readonly ScriptedAnswer[]>();
  /** How many activations each agent makes, when the scenario gives it; otherwise one. */
  readonly activations = new Map<string, number>();
  /** The model id an agent's scripted model has, when the scenario names one. */
  readonly modelIds = new Map<string, string>();
  /** The agent the scenario spoke of last, for a step that says "its model". */
  lastAgent?: string;
  /** Every file in the person's Pi directory, with its size and when it last changed, as it was before the run. */
  personsPiFiles?: Map<string, string>;
  /** The model turns the run gave, in the order they ended. */
  turns?: readonly ModelTurn[];
  /** Every effect the arbiter applied during the run, in order: the action, what it was applied for, and when. */
  readonly applied: { action: Action<unknown, never>; args: unknown; atMs: number }[] = [];
  /** The world's state as the run started, from which the applied effects replay what it was at any moment. */
  stateBefore: unknown;
  /** Checks that what the scenario set up happened as it said, run once the run ends. */
  readonly setupChecks: (() => void)[] = [];
  /** The directory the run writes its log into: one of the scenario's own, under its home. */
  logDirectory!: string;
  /** The id the run gave itself, which names its log file. */
  runId?: string;
  /** A log an earlier run of the scenario wrote: its file's name and its content. */
  previousLog?: { file: string; content: string };
  /** The tool the scenario declares to throw an error when it runs, and that error's message. */
  throwingTool?: { name: string; message: string };
  /** The provider of each session's model, as each session was closed, for a scenario that watches them close. */
  closedSessions?: string[];
  /** Puts back what the scenario watched, once it ends. */
  readonly unwatch: (() => void)[] = [];
  /** The error the run stopped on, for a scenario whose run stops. */
  runError?: Error;
  /** The tool calls the run gave. */
  toolCalls?: RunResult["toolCalls"];
  /** What the engine kept of each agent's sensing, as the run gave it. */
  sensings?: RunResult["sensings"];
  /** The tool call the scenario checked last, for a step that says "the call". */
  lastToolCall?: RunResult["toolCalls"][number];
  /** The agent and the tool whose call's result the scenario checked last, for a step that says "the result it received". */
  lastResultOf?: { agent: string; tool: string };
  /** What each agent's session held when the run ended. */
  sessionMessages?: RunResult["messages"];
  /** The stimulus channels the scenario declares: the test world's rhythm channel, and any the scenario adds. */
  readonly channels: Channel[] = [rhythmChannel];
  /** The run's stimuli, from the moment the run starts, for what the scenario delivers while it runs. */
  stimuli!: Stimuli;
  /** The tools the scenario declares: the test world's, as the scenario sets them. */
  tools: readonly Tool<Slots>[] = slotTools;
  /** The metrics the scenario declares: the test world's, and any the scenario adds. */
  metrics: Scenario<Slots>["metrics"] = slotsScenario.metrics;
  /** How long the run waits between metric samples, when the scenario gives an interval. */
  metricIntervalMs?: number;
  /** The system prompt the scenario declares. */
  systemPrompt = "";
  /** How long a model turn may run, unless the scenario says: long enough for any scripted turn here. */
  modelTurnTimeoutMs = 10_000;
  /** How long the run may last, unless the scenario says: longer than any scenario here runs. */
  timeLimitMs = 60_000;
  /** When the run started, as it gives it: when its agents could start and its time limit began; and when it ended. */
  runStartedAtMs?: number;
  runEndedAtMs?: number;
  /** How many model calls may run at once, unless the scenario says: more than the agents of any scenario here. */
  parallelismLimit = 10;
  /** How long each agent waits before an activation. */
  waitBeforeActivationMs = 0;
  /** An agent's rhythm, when the scenario gives it one of its own; it is called each time the agent starts to rest. */
  readonly rhythms = new Map<string, Rhythm>();
  /** The replica's seed the run is given; any, unless the scenario says, for rhythms that draw nothing from it. */
  seed = 1;
  /** The intervals each agent's rhythm drew, in order, for an agent whose rhythm draws from its random sequence. */
  readonly drawnMs = new Map<string, number[]>();
  /** When each agent woke, by performance.now(): when its session took its rhythm's stimulus. */
  readonly wokeAtMs = new Map<string, number[]>();
  /** When each agent started each rest, by performance.now(), for an agent whose rhythm the scenario watches. */
  readonly restedAtMs = new Map<string, number[]>();
  /** The text of the stimulus the scenario checked last, for a step that says "did not". */
  lastStimulusRead?: string;
  /** The scenario the engine is given, and the condition it is loaded with. */
  scenario!: Partial<Scenario<Slots>>;
  condition?: Condition;
  /** The error loading the scenario gave, if it was refused. */
  loadingError?: Error;
  /** The scenario as the engine loaded it, if it loaded. */
  loaded?: LoadedScenario<Slots>;
  /** The initial state each replica started with, in the order the scenario starts them. */
  replicaStarts!: Slots[];
  /** The range each agent's waiting interval is drawn from, as the scenario gives it. */
  rhythmRange!: { minMs: number; maxMs: number };
  /** The intervals each agent's rhythm drew in each replica, in the order the scenario runs them. */
  replicaIntervals!: Map<string, number[]>[];
  /** The grid the scenario sets up. */
  grid!: Grid;
  /** The window the scenario took. */
  window!: WindowCell[];
  /** The cell a random draw gave, or undefined when it gave none. */
  drawnCell?: Position;
  /** A world whose state is the grid, for what goes through its arbiter. */
  gridWorld!: World<Grid>;
  /** The error a refused move gave, if it was refused. */
  moveError?: Error;
  /** The test grid world's tools, when the scenario runs its agents on the grid rather than in the slots world. */
  gridTools?: readonly Tool<Grid>[];
  /** The neighbourhood scenario as the scenario configures it. */
  neighbourhood!: Partial<Scenario<Neighbourhood>>;
  /** Each neighbourhood the engine loaded, in order. */
  readonly neighbourhoodLoads: LoadedScenario<Neighbourhood>[] = [];
  /** The residents the scenario places, each with its kind and the cell it starts on, in the order it names them. */
  readonly residents: { name: string; kind: string; x: number; y: number }[] = [];
  /** The neighbourhood's world the run acted on, for a scenario that runs residents. */
  neighbourhoodWorld?: World<Neighbourhood>;
  /**
   * Assembles the loaded scenario the run is given from what the scenario set up, with the agents that run in it, when
   * the scenario runs a world other than the test worlds.
   */
  assembleRun?: (agents: readonly string[]) => LoadedScenario<unknown>;
  /** The experiment file the scenario writes, as a table the engine is given in TOML. */
  experimentFile!: TomlTable;
  /** The experiment as the engine read it, if it read it. */
  experiment?: Experiment;
  /** The error reading the experiment file gave, if it was refused. */
  readingError?: Error;
  /** The scenario library "lab run" is given: the lab's own, with the test scenarios the scenario adds. */
  library?: ReadonlyMap<string, LibraryScenario>;
  /** The model each name gives "lab run", as the scenario sets them up. */
  readonly labModels = new Map<string, AgentModel>();
  /** The error "lab run" or "lab inventory" failed with, if it failed. */
  labError?: Error;
  /** What "lab inventory" printed, if it ran. */
  labOutput?: string;
}

setWorldConstructor(Context);
