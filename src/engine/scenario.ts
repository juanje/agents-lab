import { type TomlTable, type TomlValue, parse } from "smol-toml";
import type { ToolCall } from "./adapter.ts";
import { type Calendar, readCalendar } from "./calendar.ts";
import type { Component } from "./components.ts";
import type { PartsProvided } from "./parts.ts";
import { MAIL_NOTICE, type MailKeeper, type MailSettings, mailTools, readMail, startingMail } from "./mail.ts";
import { type ParticipantSettings, type RuleSet, readParticipants } from "./participants.ts";
import { type MoneyKeeper, type MoneySettings, moneyTools, readMoney, startingMoney } from "./money.ts";
import { PHONE_CHANNEL, type PhoneKeeper, type PhoneSettings, assertAnswering, phoneTools, readPhone, startingPhone } from "./phone.ts";
import { type Material, type MaterialReference, type Materials, materialReference } from "./materials.ts";
import { Random } from "./random.ts";
import { type Channel, RHYTHM_CHANNEL } from "./stimuli.ts";
import type { Tool } from "./tools.ts";
import { World } from "./world.ts";

/** A resolved configuration: the scenario's base configuration with the condition's change over it. */
export type Configuration = TomlTable;

/**
 * A metric's value: one number for the world, null when the state gives it no value, or a number for each agent or
 * other part it applies to, by its name (an agent's, a situation's id).
 */
export type MetricValue = number | null | Readonly<Record<string, number>>;

/** How an agent's waits between activations are drawn: each call draws the next interval, in milliseconds, from the agent's random sequence. */
export type Rhythm = (random: Random) => number;

/** What a scenario provides to the engine. */
export interface Scenario<State> {
  name: string;
  /** The names of the agents that run in the scenario, from the resolved configuration. */
  agents: (configuration: Configuration) => readonly string[];
  /** Builds the world's initial state from the resolved configuration, drawing any chance from its own sequence. */
  initialState: (configuration: Configuration, random: Random) => State;
  /** The agents' only interface with the world: its sensors and effectors. */
  tools: readonly Tool<State>[];
  /** The declared paths by which stimuli reach agents, from the resolved configuration. */
  channels: (configuration: Configuration) => readonly Channel[];
  /** Each metric by its name, computed from the world's state and the agents' tool calls so far, in the order they ended. */
  metrics: Readonly<Record<string, (state: State, toolCalls: readonly ToolCall[]) => MetricValue>>;
  /**
   * The channels whose stimuli an agent receives once, as it first wakes, right after its rhythm's, from the resolved
   * configuration and the agent's name; none when the scenario does not give this.
   */
  firstStimuli?: (configuration: Configuration, agent: string) => readonly string[];
  /** What an agent is told it is, from the resolved configuration and the agent's name; never the world's state. */
  systemPrompt: (configuration: Configuration, agent: string) => string;
  /** How an agent's waits between activations are drawn, from the resolved configuration and the agent's name. */
  rhythm: (configuration: Configuration, agent: string) => Rhythm;
  /** How a tool's duration is computed, as text from the resolved configuration, by the tool's name (FR-INVENTORY-01). */
  describeDuration: (configuration: Configuration, tool: string) => string;
  /** How an agent's rhythm is computed, as text from the resolved configuration and the agent's name (FR-INVENTORY-01). */
  describeRhythm: (configuration: Configuration, agent: string) => string;
  /** The base configuration, in TOML. */
  baseConfiguration: string;
  /**
   * The ids of the situations the resolved configuration chooses, for a scenario that seeds situations; the inventory
   * lists them by id only (FR-WORKPLACE-01).
   */
  situations?: (configuration: Configuration) => readonly string[];
  /**
   * The world's clock, for a scenario that keeps one: the time it shows when the run starts ("HH:MM") and how many of
   * its seconds pass per second of the run, from the resolved configuration; the inventory gives both (FR-WORKPLACE-05).
   */
  clock?: (configuration: Configuration) => { start: string; timeScale: number };
  /** The components besides the agents, from the resolved configuration; none when the scenario declares none (FR-PROCESS-01). */
  components?: (configuration: Configuration) => readonly Component<State>[];
  /**
   * What can be judged in a run, from its resolved configuration, held-out materials included, and its agents' tool
   * calls, in the order they ended; none when the scenario declares nothing to judge (FR-ANALYSIS-02).
   */
  judged?: (configuration: Configuration, toolCalls: readonly ToolCall[]) => Judgeable[];
  /** Where the state keeps the mail, for a scenario whose configuration may declare a [mail] (FR-MESSAGE-01). */
  mail?: MailKeeper<State>;
  /** The rule sets the scenario provides, by name, which its configuration's participants may be decided by (FR-PARTICIPANT-01). */
  ruleSets?: Readonly<Record<string, RuleSet>>;
  /** The predicates, events and misapplication patterns of its parts, by name (FR-PARTS-01). */
  parts?: PartsProvided<State>;
  /** The lines of the run's log the scenario gives for a change of its world, each with its type, recorded as the world applies it (FR-POPULATION-01). */
  logLines?: (before: State, after: State) => readonly ({ type: string } & Readonly<Record<string, unknown>>)[];
  /** The accounts of the world itself, besides its agents' and participants', that its configuration's [money] may give (FR-CONGRESS-05). */
  worldAccounts?: readonly string[];
  /** Where the state keeps the phone, for a scenario whose configuration may declare a [phone] (FR-PHONE-01). */
  phone?: PhoneKeeper<State>;
  /** Where the state keeps the money, for a scenario whose configuration may declare [money] (FR-MONEY-01). */
  money?: MoneyKeeper<State>;
  /**
   * A replica's variant, for a scenario that draws one (FR-CONGRESS-01): from the resolved configuration and the
   * replica's sequence for `variant`, what was drawn, which the run's log gives, and the configuration completed with it.
   */
  variant?: (configuration: Configuration, random: Random) => { configuration: Configuration; drawn: Readonly<Record<string, unknown>> };
  /**
   * How many times their duration the engine's own tools (the mail's and the phone's) take for a caller, from the state
   * as a call starts, for a scenario where that changes (FR-CONGRESS-01); 1 when it does not say.
   */
  slowedBy?: (state: State, agent: string, tool: string) => number;
  /** What the inventory gives of the scenario's world, from the resolved configuration, for a scenario that says (FR-CONGRESS-01). */
  worldInventory?: (configuration: Configuration) => Readonly<Record<string, unknown>>;
}

/**
 * A statement a judge decides from the texts an agent wrote in a run (FR-ANALYSIS-02): the situation and the key that
 * give it, whether a text must say it or reveal it, and the texts it is judged on, each with when it was written.
 */
export interface Judgeable {
  situation: string;
  key: string;
  statement: string;
  asks: "says" | "reveals";
  texts: { text: string; atMs: number }[];
}

/** A named change over a scenario's base configuration. */
export interface Condition {
  name: string;
  /** The change, in TOML. */
  change: string;
  /** The change common to every condition of its experiment, in TOML, applied before its own (FR-EXPERIMENT-02). */
  common?: string;
  /** The level of each factor, by the factor's name, when the condition is a combination of levels; otherwise none (FR-EXPERIMENT-02). */
  levels?: Readonly<Record<string, string>>;
  /** Where the materials the change refers to are read from (FR-EXPERIMENT-04). */
  materials?: Materials;
  /** The experiment's kind_factor, with its levels when it is one of the experiment's factors (FR-PARTS-01). */
  kindFactor?: { name: string; levels?: readonly string[] };
}

/**
 * A scenario ready to run as one replica: its parts, its resolved configuration, its world in its initial state, and
 * each of its agents with its system prompt.
 */
export interface LoadedScenario<State> {
  scenario: Scenario<State>;
  configuration: Configuration;
  world: World<State>;
  /** The scenario's agents, in the order it names them, each with its system prompt. */
  systemPrompts: ReadonlyMap<string, string>;
  /** The scenario's stimulus channels, as its configuration gives them. */
  channels: readonly Channel[];
  /** Each of the scenario's agents, in the order it names them, with the channels of the stimuli it receives as it first wakes. */
  firstStimuli: ReadonlyMap<string, readonly string[]>;
  /** Each of the scenario's agents, in the order it names them, with its rhythm. */
  rhythms: ReadonlyMap<string, Rhythm>;
  /** Each material the condition set a value to, in the order the change gives them (FR-EXPERIMENT-04). */
  materials: readonly Material[];
  /** The scenario's components besides its agents, as its configuration declares them (FR-PROCESS-01). */
  components: readonly Component<State>[];
  /** The world's calendar, for a configuration that declares a [calendar] (FR-CLOCK-03). */
  calendar?: Calendar;
  /** The mail, for a configuration that declares a [mail]: its settings, and where the state keeps it (FR-MESSAGE-01). */
  mail?: LoadedMail<State>;
  /** The participants its configuration declares in its [participants] (FR-PARTICIPANT-01). */
  participants?: readonly ParticipantSettings[];
  /** The phone, for a configuration that declares a [phone]: its settings, and where the state keeps it (FR-PHONE-01). */
  phone?: LoadedPhone<State>;
  /** The money, for a configuration that declares [money]: its settings, and where the state keeps it (FR-MONEY-01). */
  money?: LoadedMoney<State>;
  /** What the replica's variant drew, for a scenario that draws one (FR-CONGRESS-01). */
  variant?: Readonly<Record<string, unknown>>;
}

/** A scenario's money as loaded: its configuration's settings, and where the scenario's state keeps it (FR-MONEY-01). */
export interface LoadedMoney<State> {
  settings: MoneySettings;
  keeper: MoneyKeeper<State>;
}

/** A scenario's phone as loaded: its configuration's settings, and where the scenario's state keeps it (FR-PHONE-01). */
export interface LoadedPhone<State> {
  settings: PhoneSettings;
  keeper: PhoneKeeper<State>;
}

/** A scenario's mail as loaded: its configuration's settings, and where the scenario's state keeps it (FR-MESSAGE-01). */
export interface LoadedMail<State> {
  settings: MailSettings;
  keeper: MailKeeper<State>;
}

/** Each part a scenario must provide, and how an error names it. */
const requiredParts = [
  ["initialState", "initial state"],
  ["agents", "agents"],
  ["tools", "tools"],
  ["channels", "stimulus channels"],
  ["metrics", "metrics"],
  ["systemPrompt", "system prompt"],
  ["rhythm", "rhythm"],
  ["baseConfiguration", "base configuration"],
] as const satisfies readonly (readonly [keyof Scenario<unknown>, string])[];

/**
 * Loads a scenario as one replica, with its seed, under a condition or under its base configuration alone. Scenarios
 * reach the engine as modules, not through the type checker, so any part may be missing; a scenario that lacks one is
 * refused before anything runs.
 */
export function loadScenario<State>(
  parts: Partial<Scenario<State>>,
  seed: number,
  condition?: Condition,
): LoadedScenario<State> {
  const lacks = (part: string) => new Error(`Scenario "${parts.name}" lacks its ${part}`);
  for (const [property, part] of requiredParts) {
    if (parts[property] === undefined) throw lacks(part);
  }
  const scenario = parts as Scenario<State>;
  const base = parse(scenario.baseConfiguration);
  // A text part that holds nothing gives the agents nothing, so it counts as missing.
  if (Object.keys(base).length === 0) throw lacks("base configuration");
  const { configuration: resolved, materials } = condition === undefined ? { configuration: base, materials: [] } : applyCondition(base, condition, scenario.name);
  // From the seed alone, so every condition of a replica meets the same variant (FR-CONGRESS-01).
  const varied = scenario.variant?.(resolved, Random.derive(seed, "variant"));
  const configuration = varied?.configuration ?? resolved;
  const channels = scenario.channels(configuration);
  // Each agent wakes by its rhythm's stimulus: without that channel the run would fail at the first wake.
  if (!channels.some((channel) => channel.name === RHYTHM_CHANNEL)) {
    throw new Error(`Scenario "${scenario.name}" declares no stimulus channel named "${RHYTHM_CHANNEL}", which wakes each agent`);
  }
  const systemPrompts = new Map<string, string>();
  const firstStimuli = new Map<string, readonly string[]>();
  const rhythms = new Map<string, Rhythm>();
  for (const agent of scenario.agents(configuration)) {
    const systemPrompt = scenario.systemPrompt(configuration, agent);
    if (systemPrompt.trim() === "") throw lacks(`system prompt for agent "${agent}"`);
    systemPrompts.set(agent, systemPrompt);
    const first = scenario.firstStimuli?.(configuration, agent) ?? [];
    // Refused here rather than when the agent first wakes, after model calls.
    for (const name of first) {
      if (!channels.some((channel) => channel.name === name)) {
        throw new Error(`Scenario "${scenario.name}" gives agent "${agent}" a first stimulus on the channel "${name}", which it does not declare`);
      }
    }
    firstStimuli.set(agent, first);
    rhythms.set(agent, scenario.rhythm(configuration, agent));
  }
  const initial = scenario.initialState(configuration, Random.derive(seed, "initial state"));
  const components = scenario.components?.(configuration) ?? [];
  const { calendar } = calendarOf(configuration);
  const declaredParticipants = isTable(configuration.participants ?? {}) ? Object.keys(configuration.participants ?? {}) : [];
  const phone = phoneOf(scenario, configuration, calendar, [...systemPrompts.keys(), ...declaredParticipants]);
  // The world's own accounts, such as a service's that invoices the agents (FR-CONGRESS-05), hold money too.
  const money = moneyOf(scenario, configuration, calendar, [...systemPrompts.keys(), ...declaredParticipants, ...(scenario.worldAccounts ?? [])]);
  const mail = mailOf(scenario, configuration, calendar);
  const allChannels = [...channels, ...noticeChannels(mail), ...ringChannels(phone)];
  const participants = readParticipants(configuration.participants, {
    tools: [
      ...scenario.tools,
      ...(mail === undefined ? [] : mailTools(mail.settings, mail.keeper)),
      ...(phone === undefined ? [] : phoneTools({ ...phone, acts: {}, inHours: () => true })),
      ...(money === undefined ? [] : moneyTools(money.settings, money.keeper)),
    ].map(({ name }) => name),
    channels: allChannels.map(({ name }) => name),
    ...(calendar === undefined ? {} : { calendar }),
    ruleSets: Object.keys(scenario.ruleSets ?? {}),
    taken: [...systemPrompts.keys(), ...components.map(({ name }) => name)],
  });
  if (phone !== undefined) assertAnswering(participants);
  // A participant decided by a model runs as an agent of the run, with its own system prompt and the scenario's rhythm.
  for (const participant of participants) {
    if (participant.decides !== "model") continue;
    systemPrompts.set(participant.name, participant.systemPrompt);
    firstStimuli.set(participant.name, []);
    rhythms.set(participant.name, scenario.rhythm(configuration, participant.name));
  }
  return {
    scenario,
    configuration,
    world: new World(withStarting(initial, mail, phone, money)),
    systemPrompts,
    channels: allChannels,
    firstStimuli,
    rhythms,
    materials,
    components,
    participants,
    ...(calendar === undefined ? {} : { calendar }),
    ...(mail === undefined ? {} : { mail }),
    ...(phone === undefined ? {} : { phone }),
    ...(money === undefined ? {} : { money }),
    ...(varied === undefined ? {} : { variant: varied.drawn }),
  };
}

/** The scenario's initial state with the mail and the phone at their start in it, for a configuration that declares them. */
function withStarting<State>(initial: State, mail: LoadedMail<State> | undefined, phone: LoadedPhone<State> | undefined, money: LoadedMoney<State> | undefined): State {
  const withMail = mail === undefined ? initial : mail.keeper.with(initial, startingMail(mail.settings));
  const withPhone = phone === undefined ? withMail : phone.keeper.with(withMail, startingPhone());
  return money === undefined ? withPhone : money.keeper.with(withPhone, startingMoney(money.settings));
}

/** The money a configuration declares in its [money], if it declares any, kept where the scenario's state keeps it (FR-MONEY-01). */
function moneyOf<State>(scenario: Scenario<State>, configuration: Configuration, calendar: Calendar | undefined, names: readonly string[]): LoadedMoney<State> | undefined {
  if (configuration.money === undefined) return undefined;
  if (scenario.money === undefined) throw new Error(`Scenario "${scenario.name}" keeps no money in its state, but its configuration declares [money]`);
  const durations = isTable(configuration.durations ?? {}) ? ((configuration.durations ?? {}) as Readonly<Record<string, unknown>>) : {};
  return { settings: readMoney(configuration.money, calendar, names, durations), keeper: scenario.money };
}

/**
 * The phone a configuration declares in its [phone], if it declares one, kept where the scenario's state keeps it; its
 * lines are checked against the names of the agents and participants given (FR-PHONE-01).
 */
function phoneOf<State>(scenario: Scenario<State>, configuration: Configuration, calendar: Calendar | undefined, names: readonly string[]): LoadedPhone<State> | undefined {
  if (configuration.phone === undefined) return undefined;
  if (scenario.phone === undefined) throw new Error(`Scenario "${scenario.name}" keeps no phone in its state, but its configuration declares a [phone]`);
  return { settings: readPhone(configuration.phone, calendar, names), keeper: scenario.phone };
}

/** The ring's channel, for a configuration that declares a [phone]; its source is each ring's caller (FR-PHONE-01). */
function ringChannels<State>(phone: LoadedPhone<State> | undefined): Channel[] {
  return phone === undefined ? [] : [{ name: PHONE_CHANNEL, source: "the caller", stimulus: phone.settings.ring }];
}

/** The mail a configuration declares in its [mail], if it declares one, kept where the scenario's state keeps it (FR-MESSAGE-01). */
function mailOf<State>(scenario: Scenario<State>, configuration: Configuration, calendar: Calendar | undefined): LoadedMail<State> | undefined {
  if (configuration.mail === undefined) return undefined;
  if (scenario.mail === undefined) throw new Error(`Scenario "${scenario.name}" keeps no mail in its state, but its configuration declares a [mail]`);
  return { settings: readMail(configuration.mail, calendar), keeper: scenario.mail };
}

/** The mail notice's channel, for mail that declares a notice; none otherwise (FR-MESSAGE-01). */
function noticeChannels<State>(mail: LoadedMail<State> | undefined): Channel[] {
  const notice = mail?.settings.notice;
  return notice === undefined ? [] : [{ name: MAIL_NOTICE, source: notice.source, stimulus: notice.text }];
}

/** The calendar a configuration declares in its [calendar], if it declares one (FR-CLOCK-03). */
export function calendarOf(configuration: Configuration): { calendar?: Calendar } {
  return configuration.calendar === undefined ? {} : { calendar: readCalendar(configuration.calendar) };
}

/**
 * A condition applied over a base configuration: the change common to every condition first, when it has one, then its
 * own, whose values win; and each material whose text reached the configuration, the common change's first.
 */
function applyCondition(base: TomlTable, condition: Condition, scenario: string): { configuration: Configuration; materials: Material[] } {
  const applying = (materials: Material[]): Applying => ({ condition: condition.name, scenario, read: condition.materials, materials });
  const common: Material[] = [];
  const own: Material[] = [];
  const change = parse(condition.change);
  const withCommon = condition.common === undefined ? base : applyChange(base, parse(condition.common), [], applying(common));
  const configuration = applyChange(withCommon, change, [], applying(own));
  // A common material whose key the condition sets again never reached its configuration.
  return { configuration, materials: [...common.filter(({ key }) => !setsKey(change, key.split("."))), ...own] };
}

/** Whether a change sets the key at a path of keys, or a key on that path, which replaces it whole. */
function setsKey(change: TomlTable, [key, ...rest]: readonly string[]): boolean {
  if (!Object.hasOwn(change, key)) return false;
  const value = change[key];
  return rest.length === 0 || !isTable(value) || setsKey(value, rest);
}

/**
 * The names of the condition being applied and of the scenario whose base configuration it changes, for errors, and
 * where the condition's materials are read from, and the materials it set values to so far.
 */
interface Applying {
  condition: string;
  scenario: string;
  read?: Materials;
  materials: Material[];
}

/** Whether a TOML value is a table: an object that is neither an array nor a date and time. */
export function isTable(value: TomlValue): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Applies a condition's change over a configuration: a value replaces the one under the same key, and a table is
 * applied the same way inside the configuration's table, so the keys it does not name keep their values. A key the
 * configuration lacks is refused: a misspelled key would otherwise leave the condition the same as the baseline. Where
 * the configuration has no table, a table that refers to a material gives the material's text instead.
 */
function applyChange(configuration: TomlTable, change: TomlTable, path: readonly string[], applying: Applying): TomlTable {
  const changed: TomlTable = { ...configuration };
  for (const [key, given] of Object.entries(change)) {
    const keyPath = [...path, key];
    if (!Object.hasOwn(configuration, key)) {
      throw new Error(
        `Condition "${applying.condition}" sets ${keyPath.join(".")}, which the base configuration of scenario "${applying.scenario}" does not have`,
      );
    }
    const current = configuration[key];
    const reference = isTable(current) ? undefined : materialReference(given);
    const value = reference === undefined ? given : materialText(reference, keyPath, applying);
    if (kindOf(value) !== kindOf(current)) {
      throw new Error(
        `Condition "${applying.condition}" gives ${keyPath.join(".")} ${kindOf(value)}, where the base configuration of scenario "${applying.scenario}" has ${kindOf(current)}`,
      );
    }
    changed[key] = isTable(value) && isTable(current) ? applyChange(current, value, keyPath, applying) : value;
  }
  return changed;
}

/** The text of the material a condition sets a key to, read where the condition's materials are; it lists the material. */
function materialText(reference: MaterialReference, keyPath: readonly string[], applying: Applying): string {
  if (applying.read === undefined) {
    throw new Error(
      `Condition "${applying.condition}" sets ${keyPath.join(".")} to the material "${reference.path}", but was given no directory to read materials from`,
    );
  }
  const read = applying.read.read(reference);
  if (read === undefined) {
    throw new Error(
      `Condition "${applying.condition}" sets ${keyPath.join(".")} to the material "${reference.path}", whose file does not exist: ${applying.read.file(reference)}`,
    );
  }
  const { hash, text } = read;
  applying.materials.push({ path: reference.path, key: keyPath.join("."), hash, heldOut: reference.heldOut });
  return text;
}

/**
 * The kind of a TOML value, with its article, as errors name it. Integers and fractions are one kind, numbers, as
 * smol-toml reads both as JavaScript numbers.
 */
function kindOf(value: TomlValue): string {
  if (Array.isArray(value)) return "an array";
  if (value instanceof Date) return "a date and time";
  if (isTable(value)) return "a table";
  return `a ${typeof value}`;
}
