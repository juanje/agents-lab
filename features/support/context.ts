import { World as CucumberWorld, setWorldConstructor } from "@cucumber/cucumber";
import type { Grid, Position, WindowCell } from "../../src/engine/grid.ts";
import type { Condition, Scenario } from "../../src/engine/scenario.ts";
import type { ModelTurn } from "../../src/engine/adapter.ts";
import type { RunResult } from "../../src/engine/run.ts";
import type { ScriptedModel } from "../../src/engine/scripted-model.ts";
import type { Channel, Stimuli } from "../../src/engine/stimuli.ts";
import type { ActionResult, World } from "../../src/engine/world.ts";
import { type Slots, rhythmChannel } from "../../tests/fixtures/slots.ts";

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
  /** How many activations each agent makes, when the scenario gives it; otherwise one. */
  readonly activations = new Map<string, number>();
  /** The model id an agent's scripted model has, when the scenario names one. */
  readonly modelIds = new Map<string, string>();
  /** The agent the scenario spoke of last, for a step that says "its model". */
  lastAgent?: string;
  /** Every file in the person's Pi directory and its content, as the scenario left it before the run. */
  personsPiFiles?: Map<string, string>;
  /** The model turns the run gave, in the order they ended. */
  turns?: readonly ModelTurn[];
  /** The tool calls the run gave. */
  toolCalls?: RunResult["toolCalls"];
  /** The tool call the scenario checked last, for a step that says "the call". */
  lastToolCall?: RunResult["toolCalls"][number];
  /** What each agent's session held when the run ended. */
  sessionMessages?: RunResult["messages"];
  /** The stimulus channels the scenario declares: the test world's rhythm channel, and any the scenario adds. */
  readonly channels: Channel[] = [rhythmChannel];
  /** The run's stimuli, from the moment the run starts, for what the scenario delivers while it runs. */
  stimuli!: Stimuli;
  /** The system prompt the scenario declares. */
  systemPrompt = "";
  /** How long a model turn may run, unless the scenario says: long enough for any scripted turn here. */
  modelTurnTimeoutMs = 10_000;
  /** How many model calls may run at once, unless the scenario says: more than the agents of any scenario here. */
  parallelismLimit = 10;
  /** How long each agent waits before an activation. */
  waitBeforeActivationMs = 0;
  /** An agent's rhythm, when the scenario gives it one of its own; it is called each time the agent starts to rest. */
  readonly rhythms = new Map<string, () => number>();
  /** The text of the stimulus the scenario checked last, for a step that says "did not". */
  lastStimulusRead?: string;
  /** The scenario the engine is given, and the condition it is loaded with. */
  scenario!: Partial<Scenario<Slots>>;
  condition?: Condition;
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
}

setWorldConstructor(Context);
