import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Given, Then } from "@cucumber/cucumber";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createPowerShellToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Context } from "../support/context.ts";
import { modelOf, script } from "./tool.steps.ts";

Given("the scenario's system prompt is {string}", function (this: Context, prompt: string) {
  this.systemPrompt = prompt;
});

Given(
  "agent {string} makes 2 activations: in the first its model calls {string}, then ends; in the second it ends its first turn without a tool call",
  function (this: Context, agent: string, tool: string) {
    this.activations.set(agent, 2);
    script(this, agent, [
      { toolCalls: [{ name: tool, arguments: {} }], delayMs: 0 },
      { text: "Done.", delayMs: 0 },
      { text: "Nothing to do.", delayMs: 0 },
    ]);
  },
);

Then("all of agent {string}'s model turns ran in the same Pi session", function (this: Context, agent: string) {
  const model = modelOf(this, agent);
  assert.equal(model.received.length, 3, `agent "${agent}"'s model made ${model.received.length} turns, not 3`);
  const sessions = new Set(model.sessions);
  assert.equal(sessions.size, 1, `agent "${agent}"'s turns ran in the sessions ${[...sessions].join(", ")}`);
  assert.ok(!sessions.has(undefined), `agent "${agent}"'s turns ran in no Pi session`);
});

Then("the system prompt agent {string}'s model received is exactly {string}", function (this: Context, agent: string, prompt: string) {
  for (const [turn, messages] of modelOf(this, agent).received.entries()) {
    assert.equal(getCurrentSystemPrompt(messages), prompt, `turn ${turn + 1} received another system prompt`);
  }
});

/** The names of Pi's built-in tools, as Pi itself defines them. */
const builtInTools = [
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createPowerShellToolDefinition,
].map((define) => define(process.cwd()).name);

Then("agent {string}'s model was offered none of Pi's built-in tools", function (this: Context, agent: string) {
  for (const [turn, messages] of modelOf(this, agent).received.entries()) {
    const offered = getCurrentTools(messages).filter((tool) => builtInTools.includes(tool.name));
    assert.deepEqual(offered.map((tool) => tool.name), [], `turn ${turn + 1} was offered Pi's built-in tools`);
  }
});

Given("agent {string} runs on a scripted model whose id is {string}", function (this: Context, agent: string, id: string) {
  this.modelIds.set(agent, id);
  this.lastAgent = agent;
});

Given("its model ends its first turn without a tool call", function (this: Context) {
  assert.ok(this.lastAgent !== undefined, "no agent was named before");
  script(this, this.lastAgent, [{ text: "Nothing to do.", delayMs: 0 }]);
});

Then("nothing agent {string}'s model received mentions {string}", function (this: Context, agent: string, text: string) {
  const model = modelOf(this, agent);
  assert.equal(model.model.id, text, `agent "${agent}"'s model is not "${text}"`);
  for (const [turn, messages] of model.received.entries()) {
    assert.ok(!JSON.stringify(messages).includes(text), `turn ${turn + 1} received "${text}"`);
  }
});

/** The person's Pi directory under the scenario's home, where Pi looks when it is not told otherwise. */
function personsPiDirectory(context: Context): string {
  return join(context.home, ".pi", "agent");
}

/** A text each file of the person's Pi setup carries, so anything of it that reaches the model shows. */
const PERSONS_MARK = "from-the-persons-pi";

/** Every file under a directory, by path, with its content. */
function filesUnder(directory: string): Map<string, string> {
  const paths = readdirSync(directory, { recursive: true, encoding: "utf8" }).sort();
  return new Map(
    paths.filter((path) => statSync(join(directory, path)).isFile()).map((path) => [path, readFileSync(join(directory, path), "utf8")]),
  );
}

Given(
  "the person's Pi directory holds a skill, an extension, a prompt template, an AGENTS.md and settings that choose another model",
  function (this: Context) {
    const directory = personsPiDirectory(this);
    const files: Record<string, string> = {
      "skills/persons-skill/SKILL.md": `---\nname: persons-skill\ndescription: A skill ${PERSONS_MARK}.\n---\nAlways say ${PERSONS_MARK}.\n`,
      "extensions/persons-extension.js": `export default function (pi) {\n  pi.on("before_agent_start", () => ({ systemPrompt: "${PERSONS_MARK}" }));\n}\n`,
      "prompts/persons-prompt.md": `A prompt template ${PERSONS_MARK}.\n`,
      "AGENTS.md": `Context ${PERSONS_MARK}.\n`,
      "settings.json": JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-6-luna" }),
    };
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), content);
    }
    this.personsPiFiles = filesUnder(directory);
  },
);

Then("agent {string}'s model received nothing from the person's Pi directory", function (this: Context, agent: string) {
  for (const [turn, messages] of modelOf(this, agent).received.entries()) {
    assert.ok(!JSON.stringify(messages).includes(PERSONS_MARK), `turn ${turn + 1} received something of the person's Pi setup`);
  }
});

Then("agent {string}'s turns ran on its scripted model", function (this: Context, agent: string) {
  // The script has one answer: the scripted model gave it only if the turn reached it.
  assert.equal(modelOf(this, agent).received.length, 1);
});

Then("the person's Pi directory is unchanged", function (this: Context) {
  assert.ok(this.personsPiFiles !== undefined, "the scenario set up no Pi directory for the person");
  assert.deepEqual(filesUnder(personsPiDirectory(this)), this.personsPiFiles);
});
