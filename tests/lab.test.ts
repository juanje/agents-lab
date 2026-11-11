import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type LabEnvironment, lab } from "../src/cli/lab.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { slotsScenario } from "./fixtures/slots.ts";

/** An experiment file over the slots test scenario, in TOML, with these lines in place of its scenario and models. */
function experimentFile(lines: { scenario?: string; models?: string } = {}): string {
  return [
    'id = "e-test"',
    lines.scenario ?? 'scenario = "slots"',
    lines.models ?? 'models = ["scripted/one", "scripted/two"]',
    "replicas = 2",
    "seed = 7",
    "[limits]",
    "time_limit_ms = 60000",
    "activations_per_agent = 1",
    "parallelism_limit = 10",
    "model_turn_timeout_ms = 10000",
    "[conditions.baseline]",
    "[conditions.five-slots]",
    "slots.count = 5",
    "",
  ].join("\n");
}

/** A directory to run "lab" in, holding the experiment file, and the environment it runs with. */
function setUp(file: string) {
  const directory = mkdtempSync(join(tmpdir(), "agents-lab-cwd-"));
  const path = join(directory, "e-test.toml");
  writeFileSync(path, file);
  const answers = () => Array.from({ length: 10 }, () => ({ text: "Nothing to do.", delayMs: 0 }));
  const models = new Map([
    ["scripted/one", new ScriptedModel(answers())],
    ["scripted/two", new ScriptedModel(answers())],
  ]);
  const environment: LabEnvironment = {
    directory,
    print: () => {},
    scenarios: new Map([["slots", slotsScenario]]),
    model: async (name) => {
      const model = models.get(name);
      if (model === undefined) throw new Error(`No model is named "${name}"`);
      return model;
    },
  };
  return { directory, path, models, environment };
}

describe("lab run", () => {
  it("runs the experiment file with its scenario from the library and its models by name, into runs/<id>/ under its directory", async () => {
    const { directory, path, models, environment } = setUp(experimentFile());

    await lab(["run", path], environment);

    const runs = join(directory, "runs", "e-test");
    const index = readFileSync(join(runs, "index.jsonl"), "utf8").split("\n").filter((line) => line !== "");
    expect(index).toHaveLength(8);
    expect(readdirSync(runs)).toHaveLength(9);
    for (const model of models.values()) expect(model.received).toHaveLength(4);
  });

  it("refuses a file that names a scenario the library does not have, naming it, before any model is resolved or run", async () => {
    const { directory, path, models, environment } = setUp(experimentFile({ scenario: 'scenario = "slotz"' }));
    const resolve = environment.model;
    const resolved: string[] = [];

    const running = lab(["run", path], { ...environment, model: (name) => (resolved.push(name), resolve(name)) });

    await expect(running).rejects.toThrow('The scenario library has no scenario "slotz"');
    expect(resolved).toEqual([]);
    expect(existsSync(join(directory, "runs"))).toBe(false);
    for (const model of models.values()) expect(model.received).toHaveLength(0);
  });

  it("refuses a file that names a model it cannot resolve, with the error that names it, before any run", async () => {
    const { directory, path, models, environment } = setUp(experimentFile({ models: 'models = ["scripted/one", "scripted/none"]' }));

    await expect(lab(["run", path], environment)).rejects.toThrow('No model is named "scripted/none"');
    expect(existsSync(join(directory, "runs"))).toBe(false);
    for (const model of models.values()) expect(model.received).toHaveLength(0);
  });

  it.each([
    ["another command", ["walk", "e-test.toml"]],
    ["no experiment file", ["run"]],
    ["more than one experiment file", ["run", "e-test.toml", "e-other.toml"]],
    ["no experiment file to list", ["inventory"]],
  ])("refuses %s, saying how the command is used", async (_case, args) => {
    const { environment } = setUp(experimentFile());

    await expect(lab(args, environment)).rejects.toThrow("Usage: lab run <experiment.toml> or lab inventory <experiment.toml>");
  });
});

describe("lab inventory", () => {
  it("prints a section for each condition, in the file's order, without resolving any model or writing any run", async () => {
    const { directory, path, environment } = setUp(experimentFile());
    const resolved: string[] = [];
    let printed = "";

    await lab(["inventory", path], {
      ...environment,
      model: (name) => (resolved.push(name), environment.model(name)),
      print: (text) => (printed += text),
    });

    expect(printed.split("\n").filter((line) => line.startsWith("## "))).toEqual(['## Condition "baseline"', '## Condition "five-slots"']);
    expect(resolved).toEqual([]);
    expect(existsSync(join(directory, "runs"))).toBe(false);
  });
});
