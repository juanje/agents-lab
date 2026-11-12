import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import { type TomlTable, parse } from "smol-toml";
import type { ToolCall } from "../../src/engine/adapter.ts";
import type { ComponentAction } from "../../src/engine/components.ts";
import { leave, put, where } from "../../src/engine/places.ts";
import type { ScriptedModel } from "../../src/engine/scripted-model.ts";
import type { Action } from "../../src/engine/world.ts";
import { type Workplace, workplaceScenario } from "../../src/scenarios/workplace.ts";
import type { Context } from "../support/context.ts";
import { stateAt } from "./acting.steps.ts";
import { itemOf, under } from "./inventory.steps.ts";
import { MODEL } from "./measures.steps.ts";
import { samplesIn } from "./metric.steps.ts";
import { linesOf } from "./record.steps.ts";
import { editText } from "./workplace.steps.ts";

/** The worker, the workplace's one agent. */
const WORKER = "worker";

/** Less than this apart, two moments of the run are the same: the engine takes a moment to apply and record a change. */
const SAME_MOMENT_MS = 20;

/** What the worker is told follows a text when it is followed by who is in sight, as the inventory gives it. */
const IN_SIGHT = "who is in sight";

/** Changes the world's text. */
function editWorld(context: Context, edit: (world: TomlTable) => void): void {
  editText(context, "world", edit);
}

/** The people the world's text declares. */
function peopleOf(world: TomlTable): TomlTable[] {
  return (world.people ?? []) as TomlTable[];
}

/** A person the world's text declares, by id. */
function declaredPerson(world: TomlTable, id: string): TomlTable {
  const person = peopleOf(world).find((each) => each.id === id);
  assert.ok(person !== undefined, `the world declares no person "${id}"`);
  return person;
}

/** A list as the contract writes it, such as "lamp", "jar". */
function listOf(items: string): string[] {
  return JSON.parse(`[${items}]`) as string[];
}

/** The configuration's value under a key, as the scenario sets it up. */
function configured(context: Context, key: string): unknown {
  return parse(context.libraryScenario.baseConfiguration ?? "")[key];
}

/** The length of the passage between two places, as the world's text declares it. */
function passageLength(context: Context, one: string, other: string): number {
  const world = parse(configured(context, "world") as string);
  const passage = ((world.passages ?? []) as TomlTable[]).find((each) => {
    const between = each.between as string[];
    return between.includes(one) && between.includes(other);
  });
  assert.ok(passage !== undefined, `the world has no passage between "${one}" and "${other}"`);
  return passage.length as number;
}

Given(
  "the world has the person {string}, named {string}, in {string}, after {string}, named {string}, in {string}",
  function (this: Context, id: string, name: string, place: string, before: string, beforeName: string, beforePlace: string) {
    editWorld(this, (world) => {
      const first = declaredPerson(world, before);
      assert.deepEqual({ name: first.name, place: first.place }, { name: beforeName, place: beforePlace });
      const people = peopleOf(world);
      people.splice(people.indexOf(first) + 1, 0, { id, name, description: "A neighbour waiting for a parcel.", place });
      world.people = people;
    });
  },
);

Given(
  "the world's {string} is {string}, named {string}, who enters {string}, drops in {string} and has the rounds [{}], so he is in the passage between {string} and {string} from the start until {int} milliseconds into the run",
  function (this: Context, key: string, id: string, name: string, enters: string, dropsIn: string, rounds: string, one: string, other: string, untilMs: number) {
    assert.equal(key, "[porter]");
    editWorld(this, (world) => {
      world.porter = { id, name, description: "The porter, bringing the day's deliveries.", enters, drops_in: dropsIn, rounds: listOf(rounds) };
    });
    // He walks the passage at the worker's pace: its length times the time per unit of length.
    const msPerLength = (configured(this, "durations") as TomlTable).ms_per_length as number;
    assert.equal(passageLength(this, one, other) * msPerLength, untilMs, `the passage between "${one}" and "${other}" does not take ${untilMs} ms`);
    this.setupChecks.push(() => {
      assert.ok(this.runStartedAtMs !== undefined, "the run gave no start");
      for (const intoRunMs of [SAME_MOMENT_MS, untilMs - SAME_MOMENT_MS]) {
        const at = where(stateAt<Workplace>(this, this.runStartedAtMs + intoRunMs).space, id);
        assert.ok(at !== undefined && "passage" in at && at.passage.includes(one) && at.passage.includes(other), `${intoRunMs} ms into the run, "${id}" was at ${JSON.stringify(at)}`);
      }
    });
  },
);

/** Puts people of the world in another place than the one it declares for them. */
function movePeople(context: Context, ids: readonly string[], place: string): void {
  editWorld(context, (world) => {
    for (const id of ids) declaredPerson(world, id).place = place;
  });
}

Given("the person {string} is in {string} instead", function (this: Context, id: string, place: string) {
  movePeople(this, [id], place);
});

Given("the people {string} and {string} are in {string} instead", function (this: Context, first: string, second: string, place: string) {
  movePeople(this, [first, second], place);
});

Given(
  "{string} is a visitor named {string}: she enters {string}, arrives between {string} and {string}, waits {int} minutes, and comes for [{}]",
  function (this: Context, id: string, name: string, enters: string, from: string, to: string, waitsMinutes: number, comesFor: string) {
    editWorld(this, (world) => {
      world.visitors = [
        ...((world.visitors ?? []) as TomlTable[]),
        { id, name, description: "A neighbour who comes for a parcel.", enters, arrives_between: [from, to], waits_minutes: waitsMinutes, comes_for: listOf(comesFor) },
      ];
    });
  },
);

Given("the situation {string} is chosen and placed in {string}", function (this: Context, id: string, place: string) {
  assert.ok((configured(this, "chosen_situations") as string[]).includes(id), `the situation "${id}" is not chosen`);
  editText(this, "situations", (text) => {
    const declared = (text.situations ?? {}) as Record<string, TomlTable>;
    assert.ok(Object.hasOwn(declared, id), `no situation "${id}" is declared`);
    declared[id].places = [place];
  });
});

/** A change the scenario makes to the workplace's space, which the world applies as any other. */
function moving(change: (state: Workplace) => Workplace): Action<Workplace, unknown> {
  return { precondition: () => ({ holds: true }), effect: change };
}

Given(
  "the person {string} leaves {string} towards {string} {int} milliseconds into the run, and is back in {string} {int} milliseconds into the run",
  function (this: Context, id: string, from: string, towards: string, leavesAtMs: number, back: string, backAtMs: number) {
    this.atRunStart.push(() => {
      const world = this.workplaceWorld;
      assert.ok(world !== undefined, "the workplace's world was not built");
      setTimeout(() => {
        assert.deepEqual(where(world.state.space, id), { place: from });
        world.apply(moving((state) => ({ ...state, space: leave.effect(state.space, { entity: id, towards }) })), {});
      }, leavesAtMs);
      setTimeout(() => {
        world.apply(moving((state) => ({ ...state, space: put(state.space, id, back) })), {});
      }, backAtMs);
    });
  },
);

/** The worker's calls of a tool, as the run gave them, in the order it made them. */
function workerCalls(context: Context, tool: string): ToolCall[] {
  assert.ok(context.toolCalls !== undefined, "the worker did not run");
  return context.toolCalls.filter((call) => call.agent === WORKER && call.tool === tool);
}

/** The worker's only call of a tool, which "its" names in the steps that follow. */
function onlyCall(context: Context, tool: string): ToolCall {
  const calls = workerCalls(context, tool);
  assert.equal(calls.length, 1, `the worker made ${calls.length} "${tool}" calls`);
  context.lastToolCall = calls[0];
  return calls[0];
}

/** The call the scenario checked last. */
function theCall(context: Context): ToolCall {
  assert.ok(context.lastToolCall !== undefined, "no call was checked before");
  return context.lastToolCall;
}

/** The text a call gave the worker, which the run recorded. */
function textOf(call: ToolCall): string {
  assert.ok(call.text !== undefined, `the "${call.tool}" call recorded no text`);
  return call.text;
}

Then("{string} appeared in {string} {int} milliseconds into the run", function (this: Context, id: string, place: string, atMs: number) {
  const appearing = linesOf(this, `${this.runId}.jsonl`)
    .map((line) => JSON.parse(line) as { type: string } & ComponentAction)
    .find((line) => line.type === "component_action" && line.component === id && line.action.startsWith(`appear in "${place}"`));
  assert.ok(appearing !== undefined && this.runStartedAtMs !== undefined, `"${id}" did not appear in "${place}"`);
  const intoRunMs = appearing.endedAtMs - this.runStartedAtMs;
  assert.ok(intoRunMs >= atMs && intoRunMs <= atMs + SAME_MOMENT_MS, `"${id}" appeared ${Math.round(intoRunMs)} ms into the run`);
});

Then(
  "the {string} call's text names {string} after {string}, with {string} and {string} in the order look gives them",
  function (this: Context, tool: string, named: string, after: string, first: string, second: string) {
    const call = onlyCall(this, tool);
    // Look gives the people in the worker's place in the order the space holds them, as the call ended.
    const state = stateAt<Workplace>(this, call.endedAtMs);
    const look = workplaceScenario.tools.find((each) => each.name === "look");
    assert.ok(look?.kind === "sensor", "the workplace has no look");
    const seen = JSON.parse(look.sense(state, WORKER, {}, 0)) as { people: { id: string; name: string }[] };
    const shown = seen.people.map(({ id, name }) => `${name} (${id})`);
    assert.deepEqual([...shown].sort(), [named, first, second].sort(), `look shows ${shown.join("; ")} as the call ended`);
    assert.ok(shown.indexOf(first) < shown.indexOf(second), `look shows ${first} after ${second}`);
    assert.ok(textOf(call).includes(`${after} ${shown.join("; ")}.`), `the "${tool}" call's text is ${JSON.stringify(call.text)}`);
  },
);

Then("the {string} call's text does not hold {string}, {string} or {string}", function (this: Context, tool: string, first: string, second: string, third: string) {
  const text = textOf(onlyCall(this, tool));
  for (const held of [first, second, third]) assert.ok(!text.includes(held), `the "${tool}" call's text holds "${held}": ${text}`);
});

Then("the {string} call took {int} milliseconds", function (this: Context, tool: string, durationMs: number) {
  const call = onlyCall(this, tool);
  const took = call.endedAtMs - call.startedAtMs;
  assert.ok(took >= durationMs && took <= durationMs + SAME_MOMENT_MS, `the "${tool}" call took ${Math.round(took)} ms`);
});

Then(
  "the {string} call ended with the outcome {string} and exactly the text {string}",
  function (this: Context, tool: string, outcome: string, text: string) {
    const call = onlyCall(this, tool);
    assert.deepEqual({ outcome: call.outcome, text: call.text }, { outcome, text });
  },
);

Then("its text holds neither {string} nor {string}", function (this: Context, first: string, second: string) {
  const text = textOf(theCall(this));
  for (const held of [first, second]) assert.ok(!text.includes(held), `its text holds "${held}": ${text}`);
});

Then("the {string} call succeeded, at least {int} milliseconds after it started", function (this: Context, tool: string, durationMs: number) {
  const call = onlyCall(this, tool);
  assert.equal(call.outcome, "success");
  const took = call.endedAtMs - call.startedAtMs;
  assert.ok(took >= durationMs, `the "${tool}" call took ${Math.round(took)} ms`);
});

Then("its text ends with {string}", function (this: Context, end: string) {
  const text = textOf(theCall(this));
  assert.ok(text.endsWith(end), `its text is ${JSON.stringify(text)}`);
});

Then(
  "the {string} call ended with the outcome {string}, and its result does not hold {string}",
  function (this: Context, tool: string, outcome: string, held: string) {
    assert.equal(onlyCall(this, tool).outcome, outcome);
    // A call refused before it runs keeps no text in its record; its result is what the worker's model received for it.
    const model = this.labModels.get(MODEL) as ScriptedModel | undefined;
    const messages = model?.received.at(-1) ?? [];
    const results = messages.flatMap((message) => (message.role === "toolResult" && message.toolName === tool ? [message] : []));
    assert.equal(results.length, 1, `the worker's model received ${results.length} "${tool}" results`);
    const result = results[0].content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    assert.ok(result !== "" && !result.includes(held), `its result holds "${held}": ${result}`);
  },
);

/** The lines of the log this run wrote, parsed. */
function runLines(context: Context): ({ type: string } & Record<string, unknown>)[] {
  return linesOf(context, `${context.runId}.jsonl`).map((line) => JSON.parse(line) as { type: string } & Record<string, unknown>);
}

/** The worker's tool calls, as the run's log records them, in the order they ended. */
function loggedCalls(context: Context): Record<string, unknown>[] {
  return runLines(context).filter((line) => line.type === "tool_call" && line.agent === WORKER);
}

Then("the log's line for the {string} call gives the text {string}", function (this: Context, tool: string, text: string) {
  const lines = loggedCalls(this).filter((line) => line.tool === tool);
  assert.equal(lines.length, 1, `the log has ${lines.length} lines for "${tool}" calls`);
  assert.equal(lines[0].text, text);
});

Then("the log has no sensor call by the worker after the {string}", function (this: Context, sensor: string) {
  const sensors = workplaceScenario.tools.filter((tool) => tool.kind === "sensor").map((tool) => tool.name);
  const calls = loggedCalls(this);
  const after = calls.slice(calls.findIndex((line) => line.tool === sensor) + 1);
  assert.ok(calls.some((line) => line.tool === sensor), `the log has no "${sensor}" call`);
  assert.deepEqual(after.filter((line) => sensors.includes(line.tool as string)).map((line) => line.tool), []);
  // The worker's last sensing, from which its effectors read their targets, is that one too.
  assert.equal(this.sensings?.last(WORKER)?.tool, sensor);
});

Then("the metric {string} of {string} has no value", function (this: Context, metric: string, key: string) {
  const sample = samplesIn(runLines(this)).at(-1);
  assert.ok(sample !== undefined, "the run's log has no metric sample");
  const values = sample.metrics[metric] as Record<string, unknown> | undefined;
  assert.ok(typeof values === "object" && values !== null, `the sample gives no "${metric}"`);
  assert.equal(values[key], undefined, `"${metric}" gives "${key}" ${JSON.stringify(values[key])}`);
});

Then("the {string} call succeeded and recorded its target as {string}", function (this: Context, tool: string, target: string) {
  const call = onlyCall(this, tool);
  assert.deepEqual({ outcome: call.outcome, targetAsSensed: call.targetAsSensed }, { outcome: "success", targetAsSensed: target });
});

Then(
  "the {string} call ended with the outcome {string} and recorded its target as {string}",
  function (this: Context, tool: string, outcome: string, target: string) {
    const call = onlyCall(this, tool);
    assert.deepEqual({ outcome: call.outcome, targetAsSensed: call.targetAsSensed }, { outcome, targetAsSensed: target });
  },
);

Then("the first {string} showed {string} in {string}", function (this: Context, sensor: string, person: string, place: string) {
  const [first] = workerCalls(this, sensor);
  assert.ok(first?.result !== undefined, `the worker's first "${sensor}" gave no result`);
  const seen = JSON.parse(first.result) as { place: string; people: { id: string }[] };
  assert.equal(seen.place, place);
  assert.ok(seen.people.some(({ id }) => id === person), `the first "${sensor}" showed ${first.result}`);
});

Then("the second {string} call's text is {string}", function (this: Context, tool: string, text: string) {
  const second = workerCalls(this, tool)[1];
  assert.ok(second !== undefined, `the worker made no second "${tool}" call`);
  assert.equal(second.text, text);
});

/** The inventory's text for an outcome of a tool, as "lab inventory" printed it for the condition "base". */
function listedText(context: Context, tool: string, outcome: string): string {
  const tools = under(under(context.labOutput ?? "", '## Condition "base"'), "### Tools");
  return itemOf(under(tools, `#### Tool "${tool}"`), outcome);
}

/** The text the workplace's tool declares for an outcome. */
function declaredText(tool: string, outcome: string): string {
  const declared = workplaceScenario.tools.find((each) => each.name === tool);
  assert.ok(declared?.kind === "effector" && declared.texts?.[outcome] !== undefined, `"${tool}" declares no text for "${outcome}"`);
  return declared.texts[outcome];
}

/** How the inventory lists a text that is followed by who is in sight. */
const followed = (text: string) => `${text} (followed by ${IN_SIGHT})`;

Then("it lists {string}'s {string} text {string} as followed by who is in sight", function (this: Context, tool: string, outcome: string, text: string) {
  assert.equal(declaredText(tool, outcome), text);
  assert.equal(listedText(this, tool, outcome), followed(text));
});

Then("it lists {string}'s {string} and {string} texts as followed by who is in sight", function (this: Context, tool: string, first: string, second: string) {
  for (const outcome of [first, second]) assert.equal(listedText(this, tool, outcome), followed(declaredText(tool, outcome)));
});

Then("it lists {string}'s {string} and {string} texts as they are", function (this: Context, tool: string, first: string, second: string) {
  for (const outcome of [first, second]) assert.equal(listedText(this, tool, outcome), declaredText(tool, outcome));
});
