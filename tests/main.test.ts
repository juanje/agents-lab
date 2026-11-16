import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** The `lab` command as the package installs it (`npm link`): the file its "bin" entry names, run as an executable. */
const LAB = resolve((JSON.parse(readFileSync("package.json", "utf8")) as { bin?: { lab?: string } }).bin?.lab ?? "no bin entry for lab");

/**
 * The environment the `lab` process gets: what node needs to start it, and no other variable of the person's, such as a
 * key. TMPDIR is the person's, read before any test gives it its own, so tsx keeps compiling into its existing cache.
 */
const LAB_ENV = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR };

/**
 * Runs `lab` as a process with these arguments, in a new directory outside this repository with its own home, and gives
 * what it did.
 */
function labProcess(args: readonly string[], files: Readonly<Record<string, string>> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "agents-lab-cwd-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content);
  const { status, stderr } = spawnSync(LAB, args, {
    cwd: directory,
    env: { ...LAB_ENV, HOME: directory },
    encoding: "utf8",
  });
  return { directory, status, stderr };
}

describe("the lab command's process", () => {
  it("fails with the usage, and no stack, on arguments it does not take", () => {
    const { status, stderr } = labProcess(["walk"]);

    expect(status).toBe(1);
    expect(stderr.trim()).toBe('lab was given ["walk"]. Usage: lab run <experiment.toml> [--resume] [--progress-interval-ms <ms>], lab inventory <experiment.toml>, lab summarize <runs-dir> [--json], lab parts <runs-dir> [--json], lab reevaluate <runs-dir> <parts.toml> or lab judge <runs-dir> <judge.toml>');
  });

  it("runs an experiment file from its current directory with the lab's scenario library", () => {
    const file = [
      'id = "e-test"',
      'scenario = "slots"',
      'models = ["openai/any"]',
      'thinking_level = "off"',
      "replicas = 1",
      "seed = 7",
      "[limits]",
      "time_limit_ms = 1000",
      "activations_per_agent = 1",
      "parallelism_limit = 1",
      "model_turn_timeout_ms = 1000",
      "[compaction]",
      "enabled = false",
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
