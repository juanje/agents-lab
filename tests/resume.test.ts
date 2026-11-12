import { describe, expect, it } from "vitest";
import { type ComparedSetup, setupDifferences } from "../src/engine/resume.ts";

/** A run's setup, as a completed run's log gives it. */
const recorded: ComparedSetup = {
  configuration: { slots: { count: 3, agents: ["a", "b"] }, rhythm: { min_ms: 10 } },
  model: "scripted/one",
  seed: 917784860,
  sampling: { thinkingLevels: { a: "off", b: "off" }, otherParameters: "the provider's defaults" },
  materials: [{ path: "texts/rules.md", key: "rules", hash: "sha256:aaa", heldOut: false }],
  code: { commit: "1111111111111111111111111111111111111111", uncommittedChanges: false },
};

describe("setupDifferences (FR-RUN-07)", () => {
  it("finds none when the setup is the same, whether or not the code had changes not committed", () => {
    expect(setupDifferences(recorded, structuredClone(recorded))).toEqual([]);
    expect(setupDifferences(recorded, { ...recorded, code: { ...recorded.code, uncommittedChanges: true } })).toEqual([]);
  });

  it.each<[string, Partial<ComparedSetup>, string[]]>([
    ["a configuration value", { configuration: { slots: { count: 4, agents: ["a", "b"] }, rhythm: { min_ms: 10 } } }, ['"slots.count"', "3", "4"]],
    ["a configuration value only one of them has", { configuration: { slots: { count: 3, agents: ["a", "b"] }, rhythm: {} } }, ['"rhythm.min_ms"', "10"]],
    ["a list in the configuration", { configuration: { slots: { count: 3, agents: ["a"] }, rhythm: { min_ms: 10 } } }, ['"slots.agents"']],
    ["the model", { model: "scripted/two" }, ["model", "scripted/one", "scripted/two"]],
    ["the seed", { seed: 42 }, ["seed", "917784860", "42"]],
    ["the sampling", { sampling: { thinkingLevels: { a: "high", b: "high" }, otherParameters: "the provider's defaults" } }, ["sampling", "off", "high"]],
    ["a material's hash", { materials: [{ ...recorded.materials[0], hash: "sha256:bbb" }] }, ["material", "texts/rules.md", "sha256:aaa", "sha256:bbb"]],
    ["the code's commit", { code: { commit: "2222222222222222222222222222222222222222", uncommittedChanges: false } }, ["commit", "1111111111111111111111111111111111111111", "2222222222222222222222222222222222222222"]],
  ])("names %s that differs, with what it was and what it is now", (_case, change, named) => {
    const differences = setupDifferences(recorded, { ...recorded, ...change });

    expect(differences).toHaveLength(1);
    for (const name of named) expect(differences[0]).toContain(name);
  });
});
