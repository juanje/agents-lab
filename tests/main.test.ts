import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** The `lab` command as the package installs it (`npm link`): the file its "bin" entry names, run as an executable. */
const LAB = resolve((JSON.parse(readFileSync("package.json", "utf8")) as { bin?: { lab?: string } }).bin?.lab ?? "no bin entry for lab");

/**
 * Runs `lab` as a process with these arguments, in a new directory outside this repository with its own home, and gives
 * what it did.
 */
function labProcess(args: readonly string[], files: Readonly<Record<string, string>> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "agents-lab-cwd-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content);
  const { status, stderr } = spawnSync(LAB, args, {
    cwd: directory,
    env: { ...process.env, HOME: directory },
    encoding: "utf8",
  });
  return { directory, status, stderr };
}

describe("the lab command's process", () => {
  it("fails with the usage, and no stack, on arguments it does not take", () => {
    const { status, stderr } = labProcess(["walk"]);

    expect(status).toBe(1);
    expect(stderr.trim()).toBe('lab was given ["walk"]. Usage: lab run <experiment.toml> or lab inventory <experiment.toml>');
  });

  it("runs an experiment file from its current directory with the lab's scenario library", () => {
    const file = [
      'id = "e-test"',
      'scenario = "slots"',
      'models = ["openai/any"]',
      "replicas = 1",
      "seed = 7",
      "[limits]",
      "time_limit_ms = 1000",
      "activations_per_agent = 1",
      "parallelism_limit = 1",
      "model_turn_timeout_ms = 1000",
      "[conditions.baseline]",
      "",
    ].join("\n");

    // The library has no test scenario, so the file is refused before any model is resolved.
    const { directory, status, stderr } = labProcess(["run", "e-test.toml"], { "e-test.toml": file });

    expect(status).toBe(1);
    expect(stderr.trim()).toBe('The scenario library has no scenario "slots"');
    expect(existsSync(join(directory, "runs"))).toBe(false);
  });
});
