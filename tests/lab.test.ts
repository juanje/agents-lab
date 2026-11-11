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
    'thinking_level = "off"',
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

/** How the command is used, as an error for other arguments says. */
const USAGE = "Usage: lab run <experiment.toml> [--progress-interval-ms <ms>] or lab inventory <experiment.toml>";

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

  it("prints each run's start and end, in the order the runs ran, and last the experiment's totals", async () => {
    const { path, environment } = setUp(experimentFile());
    let printed = "";

    await lab(["run", path], { ...environment, print: (text) => (printed += text) });

    const lines = printed.split("\n").filter((line) => line !== "");
    expect(lines.filter((line) => / started: /.test(line)).map((line) => line.split(" started")[0])).toEqual(
      Array.from({ length: 8 }, (_, at) => `Run ${at + 1} of 8`),
    );
    expect(lines.filter((line) => / completed in /.test(line) && line.startsWith("Run"))).toHaveLength(8);
    expect(lines.at(-1)).toMatch(/^8 runs completed and 0 stopped in \d+\.\d s, cost \$\d+\.\d{4}$/);
  });

  it("prints the experiment's totals also when a run stopped it, and fails", async () => {
    const { path, environment } = setUp(experimentFile({ models: 'models = ["scripted/one"]' }));
    // Opening a session reads the model's provider, which this one cannot give.
    const unopenable = { model: { reasoning: false, get provider(): never { throw new Error("no provider") } } } as unknown as ScriptedModel;
    let printed = "";

    await expect(lab(["run", path], { ...environment, model: async () => unopenable, print: (text) => (printed += text) })).rejects.toThrow(/stopped/);

    expect(printed.split("\n").filter((line) => line !== "").at(-1)).toMatch(/^0 runs completed and 1 stopped in \d+\.\d s, cost \$0\.0000$/);
  });

  it("ends the run in progress when it is interrupted, lists it as stopped, starts no run after it, prints the totals, and fails", async () => {
    const { directory, path, environment } = setUp(experimentFile({ models: 'models = ["scripted/one"]' }));
    const slow = new ScriptedModel(Array.from({ length: 10 }, () => ({ text: "Nothing to do.", delayMs: 500 })));
    const interruption = new AbortController();
    let printed = "";
    const print = (text: string) => {
      printed += text;
      // Interrupted while the first run's first model turn is running.
      if (text.startsWith("Run 1 of 4 started")) setTimeout(() => interruption.abort(), 100);
    };

    await expect(lab(["run", path], { ...environment, model: async () => slow, print, interruption: interruption.signal })).rejects.toThrow("interrupted");

    const index = readFileSync(join(directory, "runs", "e-test", "index.jsonl"), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
    expect(index.map(({ status }) => status)).toEqual(["stopped"]);
    expect(printed.split("\n").filter((line) => line !== "").at(-1)).toMatch(/^0 runs completed and 1 stopped in /);
  });

  it("prints each run's progress at the interval it is given", async () => {
    const { path, environment } = setUp(experimentFile({ models: 'models = ["scripted/one"]' }));
    // Turns long enough for two reports at the interval in each run.
    const slow = new ScriptedModel(Array.from({ length: 10 }, () => ({ text: "Nothing to do.", delayMs: 250 })));
    let printed = "";

    await lab(["run", path, "--progress-interval-ms", "100"], { ...environment, model: async () => slow, print: (text) => (printed += text) });

    const lines = printed.split("\n").filter((line) => line !== "");
    for (let number = 1; number <= 4; number += 1) {
      const running = lines.filter((line) => line.startsWith(`Run ${number} of 4 running: `));
      expect(running.length).toBeGreaterThanOrEqual(2);
    }
  });

  it.each([
    ["no interval", ["--progress-interval-ms"]],
    ["an interval of 0", ["--progress-interval-ms", "0"]],
    ["an interval that is not a whole number of milliseconds", ["--progress-interval-ms", "1.5"]],
    ["another option", ["--quiet", "100"]],
  ])("refuses %s, saying how the command is used, before any run", async (_case, options) => {
    const { directory, path, environment } = setUp(experimentFile());

    await expect(lab(["run", path, ...options], environment)).rejects.toThrow(USAGE);
    expect(existsSync(join(directory, "runs"))).toBe(false);
  });

  it.each([
    ["another command", ["walk", "e-test.toml"]],
    ["no experiment file", ["run"]],
    ["more than one experiment file", ["run", "e-test.toml", "e-other.toml"]],
    ["no experiment file to list", ["inventory"]],
    ["a progress interval for the inventory", ["inventory", "e-test.toml", "--progress-interval-ms", "100"]],
  ])("refuses %s, saying how the command is used", async (_case, args) => {
    const { environment } = setUp(experimentFile());

    await expect(lab(args, environment)).rejects.toThrow(USAGE);
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
