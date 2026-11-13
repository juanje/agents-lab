import { type CalendarInventory, calendarInventory } from "./calendar.ts";
import { type SummaryInstructions, summaryInstructions } from "./compaction.ts";
import type { Component } from "./components.ts";
import type { Compaction, Experiment, Limits, ThinkingLevel } from "./experiment.ts";
import { MAIL_DURATIONS, type MailInventory, mailInventory, mailTools } from "./mail.ts";
import { type LoadedScenario, type Scenario, loadScenario } from "./scenario.ts";
import { Stimuli, type Stimulus } from "./stimuli.ts";
import type { Tool } from "./tools.ts";

/**
 * The environment inventory of an experiment: for each of its conditions, everything its agents meet in its scenario
 * as that condition configures it (FR-INVENTORY-01). It is data: `lab inventory` prints it as Markdown, and a run's
 * log holds its condition's part as JSON (FR-RECORD-02).
 */
export interface Inventory {
  experiment: string;
  scenario: string;
  conditions: ConditionInventory[];
}

/** What the agents meet in one condition of an experiment. */
export interface ConditionInventory {
  condition: string;
  /** Each agent with its rhythm, its system prompt and the stimuli it receives once, as it first wakes. */
  agents: { name: string; rhythm: string; systemPrompt: string; firstStimuli: Stimulus[] }[];
  tools: ToolInventory[];
  /** The outcomes the engine itself gives a call, whatever its tool, with the text the agent receives for each. */
  engineOutcomes: Record<string, string>;
  channels: { name: string; source: string; delivers: string }[];
  energyModel: string;
  environmentProcesses: string;
  /** How fast information travels (NFR-12). */
  informationSpeed: string;
  models: string[];
  /** The thinking level every session uses (FR-EXPERIMENT-05). */
  thinkingLevel: ThinkingLevel;
  /**
   * The context compaction every session uses and, when it is on, the instructions Pi gives the model to write the
   * summary the agent has in view afterwards (FR-ADAPTER-03).
   */
  compaction: Compaction & { instructions?: SummaryInstructions };
  limits: Limits;
  /**
   * Each material the condition sets a value to, by its path, with the hash of its content; a held-out one by its path
   * only (FR-EXPERIMENT-04).
   */
  materials: { path: string; hash?: string }[];
  /** The situations the condition chooses, by id only, for a scenario that has situations (FR-WORKPLACE-01). */
  situations?: string[];
  /** Each component the condition declares, with its kind and its cycle as the scenario describes it, for a scenario that has components (FR-PROCESS-01). */
  components?: { name: string; kind: Component<unknown>["kind"]; cycle: string }[];
  /** The world's clock as the condition sets it, for a scenario that has one (FR-WORKPLACE-05). */
  clock?: { start: string; timeScale: number };
  /** The world's calendar, for a condition whose configuration declares one (FR-CLOCK-03). */
  calendar?: CalendarInventory;
  /** The mail, for a condition whose configuration declares a [mail] (FR-MESSAGE-01). */
  mail?: MailInventory;
}

/** A tool as its agents see it, with its duration as the scenario describes it and the text for each of its outcomes. */
export interface ToolInventory {
  name: string;
  kind: Tool<unknown>["kind"];
  description: string;
  parameters: unknown;
  duration: string;
  effort: string;
  /** The text the agent receives for each outcome the tool gives it. */
  texts: Record<string, string>;
  /** What the agent receives for any outcome the tool declares no text for (FR-TOOL-02). */
  otherOutcomes: string;
}

/** The descriptions a scenario gives only for the inventory, and how an error names each. */
const describedParts = [
  ["describeRhythm", "rhythm description"],
  ["describeDuration", "description of its tools' durations"],
] as const satisfies readonly (readonly [keyof Scenario<unknown>, string])[];

/** What the engine does not provide yet. */
const NONE = "none";

/** The outcome's name, which the agent receives for an outcome nothing gives a text for. */
const OUTCOME_NAME = "the outcome's name";

/** The outcomes the engine gives a call whatever its tool (FR-TOOL-02, FR-CLOCK-02), and what the agent receives. */
const ENGINE_OUTCOMES = {
  invalid_arguments: "the harness's explanation of the arguments it rejects",
  unknown_tool: "the harness's explanation: Tool <name> not found",
  cut_off: OUTCOME_NAME,
};

/**
 * The environment inventory of an experiment over its scenario. It runs nothing and calls no model; a scenario without
 * the descriptions it needs is refused, naming what it lacks.
 */
export function inventory<State>(experiment: Experiment, scenario: Partial<Scenario<State>>): Inventory {
  // Scenarios reach the engine as modules, not through the type checker, so a description may be missing.
  for (const [part, named] of describedParts) {
    if (scenario[part] === undefined) throw new Error(`Scenario "${scenario.name}" lacks its ${named}`);
  }
  const conditions = experiment.conditions.map((condition) =>
    conditionInventory(experiment, condition.name, loadScenario(scenario, experiment.seed, condition)),
  );
  return { experiment: experiment.id, scenario: String(scenario.name), conditions };
}

/** What the agents meet in a condition, from the scenario as that condition loads it. */
function conditionInventory<State>(
  { models, thinkingLevel, compaction, limits }: Experiment,
  condition: string,
  { scenario, configuration, systemPrompts, channels, firstStimuli, materials, components, calendar, mail }: LoadedScenario<State>,
): ConditionInventory {
  // Each agent's first wake, as a run's stimuli give it, without the rhythm's stimulus, which every wake starts with.
  const stimuli = new Stimuli(channels, undefined, firstStimuli);
  // The mail's tools are every agent's, beside the scenario's own, and the mail describes their durations (FR-MESSAGE-01).
  const mailToolsOf = mail === undefined ? [] : mailTools(mail.settings, mail.keeper);
  const durationOf = (tool: string) => MAIL_DURATIONS[tool] ?? scenario.describeDuration(configuration, tool);
  return {
    condition,
    agents: [...systemPrompts].map(([name, systemPrompt]) => ({
      name,
      rhythm: scenario.describeRhythm(configuration, name),
      systemPrompt,
      firstStimuli: stimuli.wake(name).slice(1),
    })),
    tools: [...scenario.tools, ...mailToolsOf].map((tool) => ({
      name: tool.name,
      kind: tool.kind,
      description: tool.description,
      parameters: tool.parameters,
      duration: durationOf(tool.name),
      effort: NONE,
      texts: textsOf(tool),
      otherOutcomes: OUTCOME_NAME,
    })),
    engineOutcomes: { ...ENGINE_OUTCOMES },
    channels: channels.map(({ name, source, stimulus }) => ({ name, source, delivers: stimulus })),
    energyModel: NONE,
    environmentProcesses: NONE,
    informationSpeed:
      mail === undefined
        ? "Every sensor and channel is instant."
        : `Every sensor and channel is instant, but mail, which takes from ${mail.settings.deliveryMinutes.join(" to ")} world minutes to arrive.`,
    models: [...models],
    thinkingLevel,
    compaction: compaction.enabled ? { ...compaction, instructions: summaryInstructions } : { ...compaction },
    limits: { ...limits },
    materials: materials.map(({ path, hash, heldOut }) => (heldOut ? { path } : { path, hash })),
    ...(scenario.situations === undefined ? {} : { situations: [...scenario.situations(configuration)] }),
    ...(scenario.components === undefined ? {} : { components: components.map(({ name, kind, description }) => ({ name, kind, cycle: description })) }),
    ...(scenario.clock === undefined ? {} : { clock: scenario.clock(configuration) }),
    ...(calendar === undefined ? {} : { calendar: calendarInventory(calendar) }),
    ...(mail === undefined ? {} : { mail: mailInventory(mail.settings) }),
  };
}

/**
 * The text the agent receives for each outcome a tool gives it: a sensor's success gives what it senses; an effector's
 * outcomes give the texts it declares, each followed by what its sight sees for the outcomes the sight names, and its
 * success what its reply gives, when it declares one.
 */
function textsOf<State>(tool: Tool<State>): Record<string, string> {
  if (tool.kind === "sensor") return { success: "the part of the world it senses" };
  const { sight, reply } = tool;
  const texts = Object.fromEntries(
    Object.entries(tool.texts ?? {}).map(([outcome, text]) => [outcome, sight?.outcomes.includes(outcome) ? `${text} (followed by ${sight.of})` : text]),
  );
  return reply === undefined ? texts : { success: reply.of, ...texts };
}

/** An inventory in Markdown, as `lab inventory` prints it: a section for each condition. */
export function inventoryMarkdown({ experiment, scenario, conditions }: Inventory): string {
  const sections = conditions.map((condition) =>
    [
      `## Condition "${condition.condition}"\n`,
      agentsMarkdown(condition),
      toolsMarkdown(condition),
      itemsMarkdown("Outcomes the engine gives", condition.engineOutcomes),
      channelsMarkdown(condition),
      `### Energy model\n\n${condition.energyModel}\n`,
      `### Environment processes\n\n${condition.environmentProcesses}\n`,
      `### How fast information travels\n\n${condition.informationSpeed}\n`,
      modelsAndLimitsMarkdown(condition),
      compactionMarkdown(condition),
      materialsMarkdown(condition),
      ...(condition.situations === undefined ? [] : [situationsMarkdown(condition.situations)]),
      ...(condition.components === undefined ? [] : [componentsMarkdown(condition.components)]),
      ...(condition.clock === undefined ? [] : [clockMarkdown(condition.clock)]),
      ...(condition.calendar === undefined ? [] : [calendarMarkdown(condition.calendar)]),
      ...(condition.mail === undefined ? [] : [mailMarkdown(condition.mail)]),
    ].join("\n"),
  );
  return [`# Environment inventory of experiment "${experiment}", scenario "${scenario}"\n`, ...sections].join("\n");
}

function agentsMarkdown({ agents }: ConditionInventory): string {
  const listed = agents.map(({ name, rhythm, systemPrompt, firstStimuli }) =>
    [
      `#### Agent "${name}"\n`,
      `- Rhythm: ${rhythm}\n`,
      "System prompt:\n",
      fenced(systemPrompt, "text"),
      ...firstStimuli.flatMap(({ channel, source, content }) => [`First stimulus on the channel "${channel}", from ${source}:\n`, fenced(content, "text")]),
    ].join("\n"),
  );
  return ["### Agents\n", ...listed].join("\n");
}

function toolsMarkdown({ tools }: ConditionInventory): string {
  const listed = tools.map((tool) =>
    [
      `#### Tool "${tool.name}"\n`,
      `- Kind: ${tool.kind}`,
      `- Duration: ${tool.duration}`,
      `- Effort: ${tool.effort}\n`,
      "Description:\n",
      fenced(tool.description, "text"),
      "Parameters:\n",
      fenced(JSON.stringify(tool.parameters, null, 2), "json"),
      "Texts for each outcome:\n",
      ...Object.entries(tool.texts).map(([outcome, text]) => `- ${outcome}: ${text}`),
      `- any other outcome: ${tool.otherOutcomes}`,
      "",
    ].join("\n"),
  );
  return ["### Tools\n", ...listed].join("\n");
}

/** A heading over a "- name: text" line for each entry. */
function itemsMarkdown(heading: string, items: Record<string, string>): string {
  return [`### ${heading}\n`, ...Object.entries(items).map(([name, text]) => `- ${name}: ${text}`), ""].join("\n");
}

function channelsMarkdown({ channels }: ConditionInventory): string {
  const listed = channels.map(({ name, source, delivers }) =>
    [`#### Channel "${name}"\n`, `- Source: ${source}\n`, "Delivers:\n", fenced(delivers, "text")].join("\n"),
  );
  return ["### Stimulus channels\n", ...listed].join("\n");
}

function modelsAndLimitsMarkdown({ models, thinkingLevel, limits }: ConditionInventory): string {
  return [
    "### Model and limits\n",
    `- Models: ${models.join(", ")}`,
    `- Thinking level: ${thinkingLevel}`,
    `- Activations per agent: ${limits.activationsPerAgent}`,
    `- Time limit: ${limits.timeLimitMs} ms`,
    `- Parallelism limit: ${limits.parallelismLimit}`,
    `- Model turn timeout: ${limits.modelTurnTimeoutMs} ms`,
    "",
  ].join("\n");
}

/** The headings over each of Pi's texts for writing a summary, in the order the inventory gives them. */
const SUMMARY_TEXTS: readonly [keyof SummaryInstructions, string][] = [
  ["systemPrompt", "The system prompt for writing a summary:"],
  ["first", "The instructions for a first summary, after the conversation it summarizes:"],
  ["update", "The instructions for updating the previous summary, after the new conversation and that summary:"],
  ["splitTurn", "The instructions for the start of a turn the compaction cuts through, after that start:"],
];

function compactionMarkdown({ compaction }: ConditionInventory): string {
  if (!compaction.enabled) return "### Compaction\n\n- Compaction: off\n";
  const setting = `- Compaction: enabled, with trigger_at ${compaction.triggerAt} and keep_recent_tokens ${compaction.keepRecentTokens}\n`;
  const { instructions } = compaction;
  const texts = instructions === undefined ? [] : SUMMARY_TEXTS.flatMap(([key, heading]) => [`${heading}\n`, fenced(instructions[key], "text")]);
  return ["### Compaction\n", setting, ...texts].join("\n");
}

function materialsMarkdown({ materials }: ConditionInventory): string {
  if (materials.length === 0) return `### Materials\n\n${NONE}\n`;
  return ["### Materials\n", ...materials.map(({ path, hash }) => `- ${path}: ${hash ?? "held out"}`), ""].join("\n");
}

function situationsMarkdown(situations: readonly string[]): string {
  if (situations.length === 0) return `### Situations\n\n${NONE}\n`;
  return ["### Situations\n", ...situations.map((id) => `- ${id}`), ""].join("\n");
}

/** How the inventory names each kind of component. */
const COMPONENT_KINDS: Record<Component<unknown>["kind"], string> = { world: "part of the world", perturbation: "external perturbation" };

function componentsMarkdown(components: NonNullable<ConditionInventory["components"]>): string {
  if (components.length === 0) return `### Components\n\n${NONE}\n`;
  const listed = components.map(({ name, kind, cycle }) => [`#### Component "${name}"\n`, `- Kind: ${COMPONENT_KINDS[kind]}`, `- Cycle: ${cycle}`, ""].join("\n"));
  return ["### Components\n", ...listed].join("\n");
}

/** The world's clock, in Markdown: the time it shows when the run starts, and how fast it goes. */
function clockMarkdown({ start, timeScale }: NonNullable<ConditionInventory["clock"]>): string {
  return `### Clock\n\n- Start: ${start}\n- Time scale: ${timeScale} world seconds for each second of the run\n`;
}

/** The world's calendar, in Markdown: its start, each segment with its scale and run time, and each set of hours. */
function calendarMarkdown({ start, segments, hours }: CalendarInventory): string {
  const listed = segments.map(({ scale, until, runTime }, index) => {
    const lasts = until === undefined ? runTime : `until ${until}, taking ${runTime} of the run`;
    return `- Segment ${index + 1}: ${scale} world seconds for each second of the run, ${lasts}`;
  });
  const named = Object.entries(hours).map(([name, { days, from, to }]) => `- Hours "${name}": ${days.join(", ")}, from ${from} to ${to}`);
  return ["### Calendar\n", `- Start: ${start}`, ...listed, ...named, ""].join("\n");
}

/** The keys of the mail's durations as a configuration writes them, by the inventory's names. */
const MAIL_DURATION_KEYS: Readonly<Record<string, string>> = {
  sendMinutes: "send_minutes",
  sendMinutesPerField: "send_minutes_per_field",
  sendWordsPerMinute: "send_words_per_minute",
  checkMinutes: "check_minutes",
  readMinutes: "read_minutes",
  readWordsPerMinute: "read_words_per_minute",
};

/** The mail, in Markdown: its mailboxes, each recipient's acts with their fields, its delivery delay, its durations and its notice. */
function mailMarkdown({ mailboxes, acts, deliveryMinutes, durations, notice }: MailInventory): string {
  const actsOf = Object.entries(acts).map(
    ([recipient, byAct]) => `- Acts of ${recipient}: ${Object.entries(byAct).map(([act, fields]) => `${act} (${fields.length === 0 ? NONE : fields.join(", ")})`).join(", ")}`,
  );
  const given = Object.entries(durations).map(([name, value]) => `${MAIL_DURATION_KEYS[name]} ${value}`);
  return [
    "### Mail\n",
    `- Mailboxes: ${mailboxes.join(", ")}`,
    ...actsOf,
    `- Delivery: ${deliveryMinutes.join(" to ")} world minutes`,
    `- Durations: ${given.join(", ")}`,
    notice === undefined ? `- Notice: ${NONE}` : `- Notice from ${notice.source}: ${notice.text}`,
    "",
  ].join("\n");
}

/** A text as a fenced block, with a fence longer than any run of backticks in it, so the text is given whole. */
function fenced(text: string, language: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}\n`;
}
