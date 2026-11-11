import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { entitiesAt } from "../../src/engine/grid.ts";
import { type Condition, type LoadedScenario, type Scenario, loadScenario } from "../../src/engine/scenario.ts";
import { RHYTHM_CHANNEL, Stimuli, type Stimulus } from "../../src/engine/stimuli.ts";
import { KINDS, type Neighbourhood, neighbourhoodScenario } from "../../src/scenarios/neighbourhood.ts";
import type { Context } from "../support/context.ts";

/**
 * The neighbourhood scenario with these values over its base configuration. Each key must be one the base configuration
 * already has, so the steps set the scenario's own configuration rather than keys it never reads.
 */
export function withBase(scenario: Partial<Scenario<Neighbourhood>>, values: TomlTable): Partial<Scenario<Neighbourhood>> {
  const base = parse(scenario.baseConfiguration ?? "");
  const merged: TomlTable = { ...base };
  for (const [key, value] of Object.entries(values)) {
    assert.ok(Object.hasOwn(base, key), `the neighbourhood scenario's base configuration has no key "${key}"`);
    const current = base[key];
    merged[key] = typeof value === "object" && typeof current === "object" ? { ...(current as TomlTable), ...(value as TomlTable) } : value;
  }
  return { ...scenario, baseConfiguration: stringify(merged) };
}

Given(
  "the neighbourhood scenario with a grid {int} cells wide and {int} cells high and {int} residents of two kinds",
  function (this: Context, width: number, height: number, residents: number) {
    this.neighbourhood = withBase(neighbourhoodScenario, { width, height, residents });
  },
);

/** Loads the neighbourhood scenario with a seed, and a condition if one is given, keeping what loading gave. */
function loadNeighbourhood(context: Context, seed: number, condition?: Condition): LoadedScenario<Neighbourhood> {
  const loaded = loadScenario(context.neighbourhood, seed, condition);
  context.neighbourhoodLoads.push(loaded);
  return loaded;
}

When("the engine loads it with the seed {int}", function (this: Context, seed: number) {
  loadNeighbourhood(this, seed);
});

When("the engine loads it twice with the seed {int}", function (this: Context, seed: number) {
  loadNeighbourhood(this, seed);
  loadNeighbourhood(this, seed);
});

Given("a condition {string} that adds the text {string}", function (this: Context, name: string, text: string) {
  // The condition sets the scenario's rule, the text the scenario adds to the system prompt.
  assert.ok(Object.hasOwn(parse(neighbourhoodScenario.baseConfiguration), "rule"), "the neighbourhood scenario has no rule to set");
  this.condition = { name, change: stringify({ rule: text }) };
});

When("the engine loads it with the seed {int} and the condition {string}", function (this: Context, seed: number, name: string) {
  assert.equal(this.condition?.name, name, "the scenario gives the condition before loading with it");
  loadNeighbourhood(this, seed, this.condition);
});

Given(
  "the configuration sets the rhythm channel's source to {string} and its text to {string}",
  function (this: Context, source: string, text: string) {
    this.neighbourhood = withBase(this.neighbourhood, { rhythm: { source, text } });
  },
);

/** The neighbourhood as the engine loaded it last. */
function lastLoaded(context: Context): LoadedScenario<Neighbourhood> {
  const loaded = context.neighbourhoodLoads.at(-1);
  assert.ok(loaded !== undefined, "the scenario was not loaded");
  return loaded;
}

/** Each resident on the grid, by the cell it starts on, row by row. */
function residentsByCell({ grid }: Neighbourhood): { resident: string; x: number; y: number }[] {
  const found: { resident: string; x: number; y: number }[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      for (const resident of entitiesAt(grid, { x, y })) found.push({ resident, x, y });
    }
  }
  return found;
}

Then("the grid holds {int} residents on {int} distinct cells", function (this: Context, residents: number, cells: number) {
  const { world, systemPrompts } = lastLoaded(this);
  const found = residentsByCell(world.state);
  assert.equal(found.length, residents, `expected ${residents} residents on the grid, found ${found.length}`);
  assert.equal(new Set(found.map(({ x, y }) => `${x},${y}`)).size, cells);
  // The residents on the grid are the scenario's agents, each once.
  assert.deepEqual(found.map(({ resident }) => resident).sort(), [...systemPrompts.keys()].sort());
  assert.equal(world.version, 0);
});

Then("{int} of them are of one kind and {int} of the other", function (this: Context, one: number, other: number) {
  const { world } = lastLoaded(this);
  const { kinds } = world.state;
  const residents = residentsByCell(world.state).map(({ resident }) => resident);
  assert.deepEqual(Object.keys(kinds).sort(), [...residents].sort(), "every resident on the grid, and only they, has a kind");
  const counts = KINDS.map((kind) => residents.filter((resident) => kinds[resident] === kind).length);
  assert.deepEqual(counts, [one, other]);
});

Then("the residents start on the same cells, with the same kinds, both times", function (this: Context) {
  const [first, second] = this.neighbourhoodLoads;
  assert.ok(first !== undefined && second !== undefined, "the scenario was not loaded twice");
  assert.deepEqual(second.world.state, first.world.state);
  assert.ok(residentsByCell(first.world.state).length > 0, "the neighbourhood holds no residents to compare");
});

Then("each resident's system prompt names its kind", function (this: Context) {
  const { world, systemPrompts } = lastLoaded(this);
  assert.ok(systemPrompts.size > 0, "the neighbourhood has no residents");
  for (const [resident, prompt] of systemPrompts) {
    const kind = world.state.kinds[resident];
    assert.ok(kind !== undefined, `resident "${resident}" has no kind`);
    // A kind is quoted where the prompt names it, so a kind that is also a word is not found by chance.
    if (!prompt.includes(`"${kind}"`)) assert.fail(`expected resident "${resident}"'s system prompt to name "${kind}", got: ${prompt}`);
    for (const other of KINDS.filter((named) => named !== kind)) {
      if (prompt.includes(`"${other}"`)) assert.fail(`expected resident "${resident}"'s system prompt not to name "${other}", got: ${prompt}`);
    }
  }
});

Then("it ends with {string}", function (this: Context, text: string) {
  const { systemPrompts } = lastLoaded(this);
  for (const [resident, prompt] of systemPrompts) {
    if (!prompt.endsWith(text)) assert.fail(`expected resident "${resident}"'s system prompt to end with the condition's text, got: ${prompt}`);
  }
});

/** Words a preference or a rule about where to live would use; the description of a resident uses none of them. */
const ruleWords = ["prefer", "rule", "like", "want", "would", "should", "only if", "move", "stay", "happy", "satisf", "fewer", "more than"];

Then("without the condition, the system prompt holds no preference or rule", function (this: Context) {
  const withCondition = lastLoaded(this);
  const without = loadNeighbourhood(this, 42);
  for (const [resident, prompt] of without.systemPrompts) {
    // The condition only adds its text: what the resident is told otherwise is the same.
    const conditioned = withCondition.systemPrompts.get(resident) ?? "";
    if (!conditioned.startsWith(prompt)) assert.fail(`expected the condition only to add to "${resident}"'s system prompt, got: ${conditioned}`);
    const used = ruleWords.filter((word) => prompt.toLowerCase().includes(word));
    if (used.length > 0) assert.fail(`expected resident "${resident}"'s system prompt to hold no rule, but it says ${used.join(", ")}: ${prompt}`);
  }
});

Then(
  "each resident's stimuli on the channel {string} have the source {string} and the content {string}",
  function (this: Context, channel: string, source: string, content: string) {
    assert.equal(channel, RHYTHM_CHANNEL, "the rhythm channel is the one each resident wakes by");
    const { channels, systemPrompts } = lastLoaded(this);
    assert.ok(systemPrompts.size > 0, "the neighbourhood has no residents");
    // What each resident receives when it wakes, as the run's stimuli give it from the loaded scenario's channels.
    const stimuli = new Stimuli(channels);
    for (const resident of systemPrompts.keys()) {
      const received: Stimulus[] = stimuli.wake(resident).filter((stimulus) => stimulus.channel === channel);
      assert.deepEqual(received,[{ channel, source, content }], `resident "${resident}" received other stimuli`);
    }
  },
);
