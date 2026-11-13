import { describe, expect, it } from "vitest";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { postKeeper, postScenario } from "./fixtures/post.ts";
import { START_HOLDER, type Slots, rhythmChannel, slotsScenario } from "./fixtures/slots.ts";

/** Any seed: the slots test scenario draws nothing from it. */
const seed = 1;

/**
 * The slots test scenario with another base configuration, which need not name its agents or its rhythm channel's
 * source, text and interval: the scenario names agent "a" and declares the test world's rhythm channel and no wait itself.
 */
const withBase = (baseConfiguration: string): Partial<Scenario<Slots>> => ({
  ...slotsScenario,
  agents: () => ["a"],
  channels: () => [rhythmChannel],
  rhythm: () => () => 0,
  baseConfiguration,
});

describe("loadScenario", () => {
  it("reads a configuration's [mail]: it puts the mail in the world where the scenario keeps it, declares the mail notice's channel, and gives the mail's settings (FR-MESSAGE-01)", () => {
    const loaded = loadScenario(postScenario, seed);

    expect(loaded.world.state).toEqual({ mail: { mailboxes: { ana: [], ben: [], desk: [] }, inTransit: [] } });
    expect(loaded.channels).toEqual([rhythmChannel, { name: "mail_notice", source: "mail client", stimulus: "New mail from {from}: {subject}" }]);
    expect(loaded.mail?.settings).toMatchObject({ mailboxes: ["ana", "ben", "desk"], deliveryMinutes: [1, 1] });
    expect(loaded.mail?.keeper).toBe(postKeeper);
  });

  it("declares no mail notice's channel for a [mail] without a notice, and no mail for a configuration without [mail]", () => {
    const quiet = loadScenario({ ...postScenario, baseConfiguration: postScenario.baseConfiguration.replace(/^notice.*\n/gm, "") }, seed);
    const none = loadScenario(slotsScenario, seed);

    expect(quiet.channels).toEqual([rhythmChannel]);
    expect(quiet.mail?.settings.notice).toBeUndefined();
    expect(none.mail).toBeUndefined();
  });

  it("refuses a [mail] in a scenario that keeps no mail in its state, naming the scenario", () => {
    expect(() => loadScenario({ ...postScenario, mail: undefined }, seed)).toThrow('Scenario "post" keeps no mail in its state, but its configuration declares a [mail]');
  });

  it("builds the world's initial state from the scenario's base configuration", () => {
    const loaded = loadScenario(withBase("[slots]\ncount = 2\nheld = 1\n"), seed);

    expect(loaded.configuration).toEqual({ slots: { count: 2, held: 1 } });
    expect(loaded.world.state).toEqual([START_HOLDER, null]);
    expect(loaded.world.version).toBe(0);
    expect(loaded.scenario.metrics).toBe(slotsScenario.metrics);
  });

  it("gives each of the scenario's agents, named from the configuration, its own system prompt from the configuration and the agent", () => {
    const loaded = loadScenario(
      {
        ...withBase("agents = ['a', 'b']\n[slots]\ncount = 2\nheld = 0\n"),
        agents: (configuration) => configuration.agents as string[],
        systemPrompt: (configuration, agent) => `You are "${agent}", among ${(configuration.slots as { count: number }).count} slots.`,
      },
      seed,
    );

    expect(loaded.systemPrompts).toEqual(
      new Map([
        ["a", 'You are "a", among 2 slots.'],
        ["b", 'You are "b", among 2 slots.'],
      ]),
    );
  });

  it("gives each of the scenario's agents its rhythm, from the resolved configuration and the agent", () => {
    const loaded = loadScenario(
      {
        ...withBase("agents = ['a', 'b']\n[slots]\ncount = 2\nheld = 0\n[rhythm]\ninterval_ms = 0\n"),
        agents: (configuration) => configuration.agents as string[],
        rhythm: (configuration, agent) => () => (configuration.rhythm as { interval_ms: number }).interval_ms + (agent === "b" ? 1 : 0),
      },
      seed,
      { name: "slow", change: "[rhythm]\ninterval_ms = 300\n" },
    );

    expect([...loaded.rhythms].map(([agent, rhythm]) => [agent, rhythm(new Random(seed))])).toEqual([
      ["a", 300],
      ["b", 301],
    ]);
  });

  it("builds the scenario's stimulus channels from the resolved configuration", () => {
    const loaded = loadScenario(
      {
        ...slotsScenario,
        channels: (configuration) => [{ name: "rhythm", source: "clock", stimulus: (configuration.rhythm as { text: string }).text }],
      },
      seed,
      { name: "slow", change: "[rhythm]\ntext = 'Later.'\n" },
    );

    expect(loaded.channels).toEqual([{ name: "rhythm", source: "clock", stimulus: "Later." }]);
  });

  it("gives each agent the channels whose stimuli it receives as it first wakes, from the resolved configuration; none when the scenario gives none", () => {
    const notice = { name: "notice", source: "board", stimulus: "A notice is posted." };
    const loaded = loadScenario(
      {
        ...withBase("agents = ['a', 'b']\nfirst = 'notice'\n[slots]\ncount = 2\nheld = 0\n"),
        agents: (configuration) => configuration.agents as string[],
        channels: () => [rhythmChannel, notice],
        firstStimuli: (configuration, agent) => (agent === "a" ? [configuration.first as string] : []),
      },
      seed,
    );

    expect(loaded.firstStimuli).toEqual(new Map([["a", ["notice"]], ["b", []]]));
    expect(loadScenario(withBase("[slots]\ncount = 2\nheld = 0\n"), seed).firstStimuli).toEqual(new Map([["a", []]]));
  });

  it("refuses a first stimulus from a channel the scenario does not declare, naming the channel and the agent", () => {
    const scenario = { ...withBase("[slots]\ncount = 2\nheld = 0\n"), firstStimuli: () => ["notice"] };

    expect(() => loadScenario(scenario, seed)).toThrow('Scenario "slots" gives agent "a" a first stimulus on the channel "notice", which it does not declare');
  });

  it("applies the condition's change over the base configuration, keeping what the change does not set", () => {
    const loaded = loadScenario(
      withBase("label = 'base'\nmode = 'plain'\n[slots]\ncount = 2\nheld = 0\n"),
      seed,
      { name: "new-label", change: "label = 'changed'\n" },
    );

    expect(loaded.configuration).toEqual({ label: "changed", mode: "plain", slots: { count: 2, held: 0 } });
  });

  it("applies the change common to every condition before the condition's own, whose value wins on the same key", () => {
    const loaded = loadScenario(withBase("label = 'base'\nmode = 'plain'\n[slots]\ncount = 2\nheld = 0\n"), seed, {
      name: "new-label",
      common: "label = 'common'\nmode = 'common'\n",
      change: "label = 'changed'\n",
    });

    expect(loaded.configuration).toEqual({ label: "changed", mode: "common", slots: { count: 2, held: 0 } });
  });

  it("applies a table in the change inside the base configuration's table, at any depth, and replaces arrays whole", () => {
    const loaded = loadScenario(
      withBase("[slots]\ncount = 2\nheld = 0\n[view]\nnames = ['a', 'b', 'c']\n[view.style]\nmark = 'x'\nwidth = 1\n"),
      seed,
      { name: "deep", change: "[slots]\nheld = 1\n[view]\nnames = ['z']\n[view.style]\nwidth = 3\n" },
    );

    expect(loaded.configuration).toEqual({
      slots: { count: 2, held: 1 },
      view: { names: ["z"], style: { mark: "x", width: 3 } },
    });
    expect(loaded.world.state).toEqual([START_HOLDER, null]);
  });

  it.each([
    ["at the top level", "colour = 'red'\n", "colour"],
    ["inside a table", "[slots]\ncuont = 5\n", "slots.cuont"],
    ["as a table", "[view]\nwidth = 3\n", "view"],
  ])("refuses a condition that sets a key the base configuration lacks %s, naming its full path", (_case, change, path) => {
    expect(() => loadScenario(slotsScenario, seed, { name: "typo", change })).toThrow(
      `Condition "typo" sets ${path}, which the base configuration of scenario "slots" does not have`,
    );
  });

  it("lets a condition add entries to a table the scenario declares open, and keeps refusing keys elsewhere (FR-CONGRESS-08)", () => {
    const open = { ...withBase("[slots]\ncount = 2\nheld = 0\n[agenda]\nstart = 'x'\n[agenda.hours]\n[events]\n"), openTables: ["agenda.hours", "events"] };
    const loaded = loadScenario(open, seed, {
      name: "adding",
      common: "[agenda.hours.office]\nfrom = '09:00'\n[events.fire]\nat = 'day 2 10:00'\n",
      change: "[events.flood]\nat = 'day 3 10:00'\n",
    });

    expect(loaded.configuration).toMatchObject({ agenda: { start: "x", hours: { office: { from: "09:00" } } }, events: { fire: { at: "day 2 10:00" }, flood: { at: "day 3 10:00" } } });
    expect(() => loadScenario(open, seed, { name: "typo", change: "[agenda]\nend = 'y'\n" })).toThrow('Condition "typo" sets agenda.end, which the base configuration of scenario "slots" does not have');
  });

  it.each([
    ["initialState", "initial state"],
    ["agents", "agents"],
    ["tools", "tools"],
    ["channels", "stimulus channels"],
    ["metrics", "metrics"],
    ["systemPrompt", "system prompt"],
    ["rhythm", "rhythm"],
    ["baseConfiguration", "base configuration"],
  ] as const)("refuses a scenario without its %s, with an error that names the %s", (property, part) => {
    const { [property]: _left, ...rest } = slotsScenario;

    expect(() => loadScenario(rest, seed)).toThrow(`Scenario "slots" lacks its ${part}`);
  });

  it("refuses a scenario whose stimulus channels include none named rhythm, which wakes each agent", () => {
    const channels = () => [{ name: "notice", source: "board", stimulus: "A notice is posted." }];

    expect(() => loadScenario({ ...slotsScenario, channels }, seed)).toThrow(
      'Scenario "slots" declares no stimulus channel named "rhythm", which wakes each agent',
    );
  });

  /** A base configuration with a value of each kind TOML has. */
  const everyKind = [
    "text = 'a'",
    "count = 2",
    "ratio = 0.5",
    "on = true",
    "since = 2026-01-01T00:00:00Z",
    "names = ['a']",
    "[slots]",
    "count = 2",
    "held = 0",
    "",
  ].join("\n");

  it.each([
    ["text = 1", "text", "a number", "a string"],
    ["[slots]\ncount = 'five'", "slots.count", "a string", "a number"],
    ["ratio = false", "ratio", "a boolean", "a number"],
    ["on = 'yes'", "on", "a string", "a boolean"],
    ["since = 'today'", "since", "a string", "a date and time"],
    ["names = 'a'", "names", "a string", "an array"],
    ["slots = 3", "slots", "a number", "a table"],
    ["[names]\nfirst = 'a'", "names", "a table", "an array"],
  ])("refuses the condition %j, naming the key and both kinds", (change, path, given, kind) => {
    expect(() => loadScenario(withBase(everyKind), seed, { name: "kind", change })).toThrow(
      `Condition "kind" gives ${path} ${given}, where the base configuration of scenario "slots" has ${kind}`,
    );
  });

  it("accepts a whole number where the base configuration has a fraction, as both are numbers", () => {
    const loaded = loadScenario(withBase(everyKind), seed, { name: "whole", change: "ratio = 1" });

    expect(loaded.configuration.ratio).toBe(1);
  });

  it.each<[string, Partial<Scenario<Slots>>, string]>([
    ["an empty system prompt", { systemPrompt: () => "" }, "system prompt"],
    ["a system prompt of whitespace only", { systemPrompt: () => " \n\t\r\n" }, "system prompt"],
    ["an empty base configuration", { baseConfiguration: "" }, "base configuration"],
    ["a base configuration that sets no key", { baseConfiguration: "# no key\n\n" }, "base configuration"],
  ])("refuses a scenario with %s, as lacking that part", (_case, empty, part) => {
    expect(() => loadScenario({ ...slotsScenario, ...empty }, seed)).toThrow(`Scenario "slots" lacks its ${part}`);
  });
});
