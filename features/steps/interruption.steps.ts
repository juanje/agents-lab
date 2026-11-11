import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { waitAtLeast } from "../../src/engine/clock.ts";
import type { ScriptedModel } from "../../src/engine/scripted-model.ts";
import type { Context } from "../support/context.ts";
import { idleModels, indexOf, logOf, runLogs } from "./lab.steps.ts";
import { watchSessionsClose } from "./record.steps.ts";

Given(
  "the scripted model {string}, whose turns take {int} milliseconds and end without a tool call",
  function (this: Context, name: string, delayMs: number) {
    idleModels(this, [name], { delayMs });
  },
);

Given(
  "an experiment file {string} for the scenario {string}, with the model {string}, {int} replicas, {int} activations per agent, and the condition {string}, with no change",
  function (this: Context, id: string, scenario: string, model: string, replicas: number, activationsPerAgent: number, condition: string) {
    this.experimentFile = {
      id,
      scenario,
      models: [model],
      // The scripted model cannot reason.
      thinking_level: "off",
      replicas,
      seed: 7,
      // Limits no run here reaches but its activations.
      limits: { time_limit_ms: 60_000, activations_per_agent: activationsPerAgent, parallelism_limit: 10, model_turn_timeout_ms: 10_000 },
      conditions: { [condition]: {} },
    };
  },
);

/** How often the step looks at what "lab run" printed while it waits for its first run to start. */
const LOOK_EVERY_MS = 5;

When("it is interrupted {int} milliseconds into its first run", async function (this: Context, intoMs: number) {
  const running = this.labRunning;
  assert.ok(running !== undefined, '"lab run" is not running');
  let ended = false;
  void running.finally(() => {
    ended = true;
  });
  try {
    while (!/^Run 1 of \d+ started/m.test(this.labOutput ?? "")) {
      assert.ok(!ended, `"lab run" ended before its first run started; it printed:\n${this.labOutput}`);
      await waitAtLeast(LOOK_EVERY_MS);
    }
    // Watched from here: no session closes before the run ends.
    watchSessionsClose(this);
    await waitAtLeast(intoMs);
    assert.ok(!ended, `"lab run" ended before it was interrupted; it printed:\n${this.labOutput}`);
    this.labInterruption.abort();
  } finally {
    await running;
  }
});

/** The first run of the experiment, as its index lists it. */
function firstRun(context: Context) {
  const [first] = indexOf(context);
  assert.ok(first !== undefined, "the index lists no run");
  return first;
}

Then("the first run's log ends with a line saying the run stopped because it was interrupted", function (this: Context) {
  const last = logOf(this, firstRun(this).runId).at(-1);
  assert.equal(last?.type, "run_stopped", `the first run's log ends with: ${JSON.stringify(last)}`);
  assert.match(String(last.error), /interrupted/, `the first run's log ends with: ${JSON.stringify(last)}`);
});

Then('{string} lists the first run as stopped', function (this: Context, path: string) {
  assert.equal(path, `runs/${String(this.experimentFile.id)}/index.jsonl`);
  const first = firstRun(this);
  assert.equal(first.status, "stopped", `the index lists the first run as ${first.status}`);
  assert.ok(runLogs(this).includes(`${first.runId}.jsonl`), "the index's first run names no run log");
});

Then("every session of the first run is closed", function (this: Context) {
  // Only the first run ran, so the sessions that called its model are its own: one for each agent.
  const agents = Object.keys((logOf(this, firstRun(this).runId)[0].sampling as { thinkingLevels: Record<string, string> }).thinkingLevels);
  const opened = new Set([...this.labModels.values()].flatMap((model) => (model as ScriptedModel).sessions ?? []));
  assert.equal(opened.size, agents.length, `${opened.size} sessions called the model, for ${agents.length} agents`);
  for (const session of opened) assert.ok(this.closedSessionIds?.includes(session as string), `session ${session} was not closed`);
});

Then("no second run started", function (this: Context) {
  assert.equal(indexOf(this).length, 1, "the index lists another count of runs than one");
  assert.equal(runLogs(this).length, 1, "another count of runs than one wrote a log");
  assert.ok(!/^Run 2 of \d+ started/m.test(this.labOutput ?? ""), `it printed that a second run started:\n${this.labOutput}`);
});
