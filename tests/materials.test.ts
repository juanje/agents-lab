import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readExperiment } from "../src/engine/experiment.ts";
import { inventory, inventoryMarkdown } from "../src/engine/inventory.ts";
import { runExperiment } from "../src/engine/runner.ts";
import { loadScenario } from "../src/engine/scenario.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
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
    "[compaction]",
    "enabled = false",
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

  it("are listed, for the condition that sets them, by their path, the key they set, and the SHA-256 hash of their content", () => {
    writeMaterial("materials/wake.md", "Morning comes.");

    const loaded = loadedWith('rhythm.text = { file = "materials/wake.md" }');

    expect(loaded.materials).toEqual([{ path: "materials/wake.md", key: "rhythm.text", hash: `sha256:${sha256("Morning comes.")}`, heldOut: false }]);
  });

  describe("in the change common to every condition", () => {
    it("reach the condition and are listed for it", () => {
      writeMaterial("materials/wake.md", "Morning comes.");

      const loaded = loadedWith('[common]\nrhythm.text = { file = "materials/wake.md" }');

      expect(rhythmOf(loaded.configuration).text).toBe("Morning comes.");
      expect(loaded.materials.map(({ path, key }) => ({ path, key }))).toEqual([{ path: "materials/wake.md", key: "rhythm.text" }]);
    });

    it("are not listed for a condition whose own change sets their key again, as their text does not reach it", () => {
      writeMaterial("materials/wake.md", "Morning comes.");

      const loaded = loadedWith('rhythm.text = "Own."\n[common]\nrhythm.text = { file = "materials/wake.md", held_out = true }');

      expect(rhythmOf(loaded.configuration).text).toBe("Own.");
      expect(loaded.materials).toEqual([]);
    });
  });

  it("are read once for an experiment, so a file changed after its first run started does not reach a later run", () => {
    writeMaterial("materials/wake.md", "Morning comes.");
    const [condition] = readExperiment(experimentFile('rhythm.text = { file = "materials/wake.md" }'), directory).conditions;
    loadScenario(slotsScenario, 1, condition);

    writeMaterial("materials/wake.md", "Night falls.");
    const later = loadScenario(slotsScenario, 2, condition);

    expect(rhythmOf(later.configuration).text).toBe("Morning comes.");
    expect(later.materials).toEqual([{ path: "materials/wake.md", key: "rhythm.text", hash: `sha256:${sha256("Morning comes.")}`, heldOut: false }]);
  });

  it("are listed in the inventory of the condition that sets them, by their path and hash", () => {
    writeMaterial("materials/wake.md", "Morning comes.");
    const experiment = readExperiment(experimentFile('rhythm.text = { file = "materials/wake.md" }'), directory);

    const listed = inventory(experiment, slotsScenario);

    const hash = `sha256:${sha256("Morning comes.")}`;
    expect(listed.conditions[0].materials).toEqual([{ path: "materials/wake.md", hash }]);
    expect(inventoryMarkdown(listed)).toContain(`### Materials\n\n- materials/wake.md: ${hash}\n`);
  });

  it("whose file does not exist are refused, with an error that names the condition, the key and the material's path", () => {
    expect(() => loadedWith('rhythm.text = { file = "materials/missing.md" }')).toThrow(
      `Condition "baseline" sets rhythm.text to the material "materials/missing.md", whose file does not exist: ${join(directory, "materials/missing.md")}`,
    );
  });

  describe("held out", () => {
    const heldOut = 'slots.keys = { file = "materials/keys.toml", held_out = true }';

    beforeEach(() => {
      writeMaterial("materials/keys.toml", "secret = 42");
    });

    it("give the scenario their text, and are listed as held out", () => {
      const loaded = loadedWith(heldOut);

      expect((loaded.configuration.slots as { keys: string }).keys).toBe("secret = 42");
      expect(loaded.materials).toEqual([{ path: "materials/keys.toml", key: "slots.keys", hash: `sha256:${sha256("secret = 42")}`, heldOut: true }]);
    });

    it("are listed in the inventory by their path only", () => {
      const listed = inventory(readExperiment(experimentFile(heldOut), directory), slotsScenario);

      expect(listed.conditions[0].materials).toEqual([{ path: "materials/keys.toml" }]);
      const printed = inventoryMarkdown(listed);
      expect(printed).toContain("### Materials\n\n- materials/keys.toml: held out\n");
      expect(printed).not.toContain("secret = 42");
    });

    it("never reach a run's setup line: its configuration gives the material's reference in place of its text", async () => {
      const runs = mkdtempSync(join(directory, "runs-"));
      const models = new Map([["scripted/one", new ScriptedModel([{ text: "Nothing to do.", delayMs: 0 }])]]);

      await runExperiment(readExperiment(experimentFile(heldOut), directory), slotsScenario, models, runs);

      const [log] = readdirSync(runs).filter((file) => file !== "index.jsonl");
      const setup = JSON.parse(readFileSync(join(runs, log), "utf8").split("\n")[0]);
      expect(setup.configuration.slots.keys).toEqual({ file: "materials/keys.toml", held_out: true });
      expect(setup.materials).toEqual([{ path: "materials/keys.toml", key: "slots.keys", hash: `sha256:${sha256("secret = 42")}`, heldOut: true }]);
      expect(JSON.stringify(setup)).not.toContain("secret = 42");
    });
  });
});

/** The SHA-256 hash of a text, in hexadecimal. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
