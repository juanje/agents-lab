import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readExperiment } from "../src/engine/experiment.ts";
import { loadScenario } from "../src/engine/scenario.ts";
import { rhythmOf, slotsScenario } from "./fixtures/slots.ts";

/** The directory the experiment file is in, which its materials' paths start from. */
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agents-lab-materials-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** Writes a file, by its path from the experiment file's directory. */
function writeMaterial(path: string, text: string): void {
  const file = join(directory, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** An experiment file for the slots test scenario whose one condition, "baseline", makes the change given in TOML. */
function experimentFile(change: string): string {
  return [
    'id = "e-test"',
    'scenario = "slots"',
    'models = ["scripted/one"]',
    'thinking_level = "off"',
    "replicas = 1",
    "seed = 1",
    "[limits]",
    "time_limit_ms = 1000",
    "activations_per_agent = 1",
    "parallelism_limit = 1",
    "model_turn_timeout_ms = 500",
    "[conditions.baseline]",
    change,
    "",
  ].join("\n");
}

/** The slots test scenario loaded under the only condition of an experiment file, read from the directory. */
function loadedWith(change: string) {
  const [condition] = readExperiment(experimentFile(change), directory).conditions;
  return loadScenario(slotsScenario, 1, condition);
}

describe("materials", () => {
  it("give a configuration value the text of a file, named by its path from the experiment file", () => {
    writeMaterial("materials/wake.md", "Morning comes.");

    const loaded = loadedWith('rhythm.text = { file = "materials/wake.md" }');

    expect(rhythmOf(loaded.configuration).text).toBe("Morning comes.");
  });
});
