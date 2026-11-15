import { type CalendarInventory, calendarInventory } from "./calendar.ts";
import { type SummaryInstructions, summaryInstructions } from "./compaction.ts";
import type { Component } from "./components.ts";
import { type Compaction, type Experiment, type Limits, type ThinkingLevel, replicaSeed } from "./experiment.ts";
import { MAIL_DURATIONS, type MailInventory, mailInventory, mailTools } from "./mail.ts";
import type { ParticipantSettings } from "./participants.ts";
import { MONEY_DURATIONS, type MoneyInventory, type MoneySettings, moneyInventory, moneyTools } from "./money.ts";
import { toolsOf } from "./run.ts";
import { PHONE_DURATIONS, type PhoneSettings, phoneInventory, phoneTools } from "./phone.ts";
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
  /** Each replica's variant, for a scenario that draws one (FR-CONGRESS-22). */
  replicas?: ReplicaInventory[];
}

/**
 * A replica's variant: its seed, what it drew, and what the scenario gives of it beside, such as the plans a check kept
 * (FR-CONGRESS-22). The variant comes from the seed alone, so it is the same in every condition; it is read with the
 * experiment's first condition.
 */
export interface ReplicaInventory {
  replica: number;
  seed: number;
  variant: Readonly<Record<string, unknown>>;
  [more: string]: unknown;
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
  /** Each participant, as the condition's configuration declares it, for a condition that declares any (FR-PARTICIPANT-01). */
  participants?: ParticipantSettings[];
  /** The phone, for a condition whose configuration declares a [phone] (FR-PHONE-01). */
  phone?: PhoneSettings;
  /** The money, for a condition whose configuration declares [money] (FR-MONEY-01). */
  money?: MoneyInventory;
  /** What the scenario says of its world, for a scenario that says (FR-CONGRESS-01). */
  world?: Readonly<Record<string, unknown>>;
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
  const replicas = scenario.variant === undefined ? undefined : replicasOf(experiment, scenario);
  return { experiment: experiment.id, scenario: String(scenario.name), conditions, ...(replicas === undefined ? {} : { replicas }) };
}

/** Each replica's variant, as loading that replica draws it with the first condition (FR-CONGRESS-22). */
function replicasOf<State>(experiment: Experiment, scenario: Partial<Scenario<State>>): ReplicaInventory[] {
  return Array.from({ length: experiment.replicas }, (_, index) => {
    const replica = index + 1;
    const seed = replicaSeed(experiment.seed, replica);
    const { configuration, variant = {} } = loadScenario(scenario, seed, experiment.conditions[0]);
    return { replica, seed, variant, ...scenario.variantInventory?.(configuration, seed) };
  });
}

/** What the agents meet in a condition, from the scenario as that condition loads it. */
function conditionInventory<State>(
  { models, thinkingLevel, compaction, limits }: Experiment,
  condition: string,
  { scenario, configuration, systemPrompts, channels, firstStimuli, materials, components, calendar, mail, phone, money, participants = [] }: LoadedScenario<State>,
): ConditionInventory {
  // Each agent's first wake, as a run's stimuli give it, without the rhythm's stimulus, which every wake starts with.
  const stimuli = new Stimuli(channels, undefined, firstStimuli);
  // The mail's tools are every agent's, beside the scenario's own, and the mail describes their durations (FR-MESSAGE-01).
  const mailToolsOf = mail === undefined ? [] : mailTools(mail.settings, mail.keeper);
  // So are the phone's, which describes theirs (FR-PHONE-01).
  const phoneToolsOf = phone === undefined ? [] : phoneTools({ ...phone, acts: mail?.settings.acts ?? {}, inHours: () => true });
  // So are the money's (FR-MONEY-01).
  const moneyToolsOf = money === undefined ? [] : moneyTools(money.settings, money.keeper);
  const durationOf = (tool: string) => MAIL_DURATIONS[tool] ?? PHONE_DURATIONS[tool] ?? MONEY_DURATIONS[tool] ?? scenario.describeDuration(configuration, tool);
  return {
    condition,
    agents: [...systemPrompts].map(([name, systemPrompt]) => ({
      name,
      rhythm: scenario.describeRhythm(configuration, name),
      systemPrompt,
      firstStimuli: stimuli.wake(name).slice(1),
    })),
    // Only the tools the agents' sessions are offered: of the money's, those their accounts give them (FR-CONGRESS-08).
    tools: offered([...scenario.tools, ...mailToolsOf, ...phoneToolsOf, ...moneyToolsOf], [...systemPrompts.keys()], participants, money?.settings).map((tool) => ({
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
    ...(participants.length === 0 ? {} : { participants: participants.map((participant) => ({ ...participant })) }),
    ...(phone === undefined ? {} : { phone: phoneInventory(phone.settings) }),
    ...(money === undefined ? {} : { money: moneyInventory(money.settings, participants) }),
    ...(scenario.worldInventory === undefined ? {} : { world: scenario.worldInventory(configuration) }),
  };
}

/** The tools any of the agents' sessions is offered, in the order given (FR-CONGRESS-08). */
function offered<State>(tools: readonly Tool<State>[], agents: readonly string[], participants: readonly ParticipantSettings[], money: MoneySettings | undefined): Tool<State>[] {
  const names = new Set(agents.flatMap((agent) => toolsOf(tools, participants, agent, money).map(({ name }) => name)));
  return tools.filter(({ name }) => names.has(name));
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
export function inventoryMarkdown({ experiment, scenario, conditions, replicas }: Inventory): string {
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
      ...(condition.participants === undefined ? [] : [participantsMarkdown(condition.participants)]),
      ...(condition.phone === undefined ? [] : [phoneMarkdown(condition.phone)]),
      ...(condition.money === undefined ? [] : [moneyMarkdown(condition.money)]),
      ...(condition.world === undefined ? [] : [`### World\n\n${fenced(JSON.stringify(condition.world, null, 2), "json")}`]),
    ].join("\n"),
  );
  return [`# Environment inventory of experiment "${experiment}", scenario "${scenario}"\n`, ...sections, ...(replicas === undefined ? [] : [replicasMarkdown(replicas)])].join("\n");
}

/** Each replica's variant, in Markdown: its seed, what it drew, and each list the scenario gives of it, one item a line (FR-CONGRESS-22). */
function replicasMarkdown(replicas: readonly ReplicaInventory[]): string {
  const listed = replicas.map(({ replica, seed, variant, ...more }) =>
    [
      `### Replica ${replica}, seed ${seed}\n`,
      "Variant:\n",
      fenced(JSON.stringify(variant, null, 2), "json"),
      ...Object.entries(more).flatMap(([name, value]) => [`${name[0].toUpperCase()}${name.slice(1)}:\n`, fenced(Array.isArray(value) ? value.map((each) => JSON.stringify(each)).join("\n") : JSON.stringify(value, null, 2), "json")]),
    ].join("\n"),
  );
  return ["## Replicas\n", ...listed].join("\n");
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

/** The money, in Markdown: each account with its opening or that it is unlimited and its holder's money tools, and the discretionary limit. */
function moneyMarkdown({ accounts, discretionaryLimit, tools }: MoneyInventory): string {
  const listed = accounts.map((account) => {
    const held = "unlimited" in account ? "unlimited" : `opening ${account.opening}`;
    const given = tools[account.name] ?? [];
    return `- ${account.name}: ${held}; tools ${given.length === 0 ? NONE : given.join(", ")}`;
  });
  return ["### Money\n", ...listed, `- discretionary_limit ${discretionaryLimit}`, ""].join("\n");
}

/** The phone, in Markdown: its lines, its durations as a configuration writes them, and its ring. */
function phoneMarkdown({ lines, ringMinutes, callMinutes, callWordsPerMinute, ring }: PhoneSettings): string {
  const words = `call_words_per_minute${callWordsPerMinute === undefined ? `: ${NONE}` : ` ${callWordsPerMinute}`}`;
  return ["### Phone\n", `- Lines: ${lines.join(", ")}`, `- Durations: ring_minutes ${ringMinutes}, call_minutes ${callMinutes}, ${words}`, `- Ring: ${ring}`, ""].join("\n");
}

/** The participants, in Markdown: each one's decider, tools, channels, hours and reply delay. */
function participantsMarkdown(participants: readonly ParticipantSettings[]): string {
  const listed = participants.map((participant) => {
    const params = participant.decides === "rules" ? Object.entries(participant.params).map(([name, value]) => `${name} = ${JSON.stringify(value)}`) : [];
    const decider =
      participant.decides === "rules"
        ? `the rule set "${participant.rules}"${params.length === 0 ? "" : `, with ${params.join(", ")}`}`
        : `the model "${participant.model}", with the system prompt ${JSON.stringify(participant.systemPrompt)}`;
    return [
      `#### Participant "${participant.name}"\n`,
      `- Decided by: ${decider}`,
      `- Tools: ${participant.tools.length === 0 ? NONE : participant.tools.join(", ")}`,
      `- Channels: ${participant.channels.length === 0 ? NONE : participant.channels.join(", ")}`,
      `- Hours: ${participant.hours ?? NONE}`,
      `- Reply delay: ${participant.replyMinutes === undefined ? NONE : `${participant.replyMinutes.join(" to ")} world minutes`}`,
      "",
    ].join("\n");
  });
  return ["### Participants\n", ...listed].join("\n");
}

/** A text as a fenced block, with a fence longer than any run of backticks in it, so the text is given whole. */
function fenced(text: string, language: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}\n`;
}
