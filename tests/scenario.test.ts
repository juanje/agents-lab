import { describe, expect, it } from "vitest";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { START_HOLDER, type Slots, slotsScenario } from "./fixtures/slots.ts";

/** Any seed: the slots test scenario draws nothing from it. */
const seed = 1;

/** The slots test scenario with another base configuration, which need not name its agents: the scenario names "a". */
const withBase = (baseConfiguration: string): Partial<Scenario<Slots>> => ({ ...slotsScenario, agents: () => ["a"], baseConfiguration });

describe("loadScenario", () => {
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
        ...slotsScenario,
        baseConfiguration: "agents = ['a', 'b']\n[slots]\ncount = 2\nheld = 0\n",
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

  it("applies the condition's change over the base configuration, keeping what the change does not set", () => {
    const loaded = loadScenario(
      withBase("label = 'base'\nmode = 'plain'\n[slots]\ncount = 2\nheld = 0\n"),
      seed,
      { name: "new-label", change: "label = 'changed'\n" },
    );

    expect(loaded.configuration).toEqual({ label: "changed", mode: "plain", slots: { count: 2, held: 0 } });
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

  it.each([
    ["initialState", "initial state"],
    ["tools", "tools"],
    ["channels", "stimulus channels"],
    ["metrics", "metrics"],
    ["systemPrompt", "system prompt"],
    ["baseConfiguration", "base configuration"],
  ] as const)("refuses a scenario without its %s, with an error that names the %s", (property, part) => {
    const { [property]: _left, ...rest } = slotsScenario;

    expect(() => loadScenario(rest, seed)).toThrow(`Scenario "slots" lacks its ${part}`);
  });

  it("refuses a scenario whose stimulus channels include none named rhythm, which wakes each agent", () => {
    const channels = [{ name: "notice", source: "board", stimulus: "A notice is posted." }];

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
