import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import type { TomlTable } from "smol-toml";
import { inventoryMarkdown } from "../../src/engine/inventory.ts";
import type { RuleSet, RuleStep } from "../../src/engine/participants.ts";
import type { Context } from "../support/context.ts";
import { madeInventory } from "./calendar.steps.ts";
import { ranLines, setUpParticipants, setupOf } from "./participant.steps.ts";

/** Each participant's scripted steps, in order, by its name. */
const scripts = new WeakMap<Context, Map<string, RuleStep[]>>();

function scriptsOf(context: Context): Map<string, RuleStep[]> {
  const steps = scripts.get(context);
  assert.ok(steps !== undefined, "the scenario set up no money test scenario");
  return steps;
}

/**
 * "scripted": a rule set that takes its participant's scripted steps in order, the first as the run starts, whatever it
 * perceives, then ends. Its participant is named in its parameters.
 */
function scripted(context: Context): RuleSet {
  return {
    start: (params) => {
      const left = [...(scriptsOf(context).get(params.name as string) ?? [])];
      return { atStart: () => left.shift(), next: () => left.shift() ?? { kind: "end" }, outcome: () => ({}) };
    },
  };
}

Given(
  "a test scenario with the agent {string} and the participants {string} and {string}, whose rule sets take scripted steps",
  function (this: Context, agent: string, first: string, second: string) {
    scripts.set(this, new Map());
    const participant = (name: string) => ({ decides: "rules", rules: "scripted", tools: [], channels: [], params: { name } });
    setUpParticipants(this, {
      agents: [agent],
      participants: { [first]: participant(first), [second]: participant(second) },
      ruleSets: { scripted: scripted(this) },
      echo: {},
      inputs: [],
      givenAtMs: [],
    });
  },
);

/** The configuration's [money]. */
function moneyOf(context: Context): TomlTable {
  const { money } = setupOf(context);
  assert.ok(money !== undefined, "the configuration declares no money");
  return money;
}

Given(
  /^the money's accounts are "(\w+)" with the opening (\d+), "(\w+)" unlimited and "(\w+)" with the opening (\d+), and its "discretionary_limit" is (\d+)$/,
  function (this: Context, first: string, opening: string, unlimited: string, third: string, other: string, limit: string) {
    setupOf(this).money = {
      accounts: { [first]: { opening: Number(opening) }, [unlimited]: { unlimited: true }, [third]: { opening: Number(other) } },
      discretionary_limit: Number(limit),
    };
  },
);

/** The names in a list as the contract writes it: `"a", "b" and "c"`. */
function namesIn(written: string): string[] {
  return [...written.matchAll(/"([^"]+)"/g)].map(([, name]) => name);
}

Given(/^"(\w+)" has the tools (.+); "(\w+)" has (.+); "(\w+)" has (.+)$/, function (this: Context, first: string, firstTools: string, second: string, secondTools: string, third: string, thirdTools: string) {
  const setup = setupOf(this);
  const written = [first, firstTools, second, secondTools, third, thirdTools];
  for (let index = 0; index < written.length; index += 2) {
    const [party, tools] = [written[index], namesIn(written[index + 1])];
    if (setup.agents.includes(party)) (moneyOf(this).accounts as Record<string, TomlTable>)[party].tools = tools;
    else setup.participants[party].tools = tools;
  }
});

Given(/^the durations are (.+) world minutes$/, function (this: Context, written: string) {
  setupOf(this).durations = Object.fromEntries([...written.matchAll(/"(\w+)" (\d+)/g)].map(([, tool, minutes]) => [tool, Number(minutes)]));
});

/** A participant's step as the contract writes it. */
function stepOf(written: string): RuleStep {
  const wait = /^wait (\d+) world minutes$/.exec(written);
  if (wait !== null) return { kind: "wait", minutes: Number(wait[1]) };
  const [, tool, rest = ""] = /^"(\w+)"\s*(.*)$/.exec(written) ?? [];
  assert.ok(tool !== undefined, `the steps do not read the step "${written}"`);
  const forms: Record<string, [RegExp, (match: RegExpExecArray) => Record<string, unknown>]> = {
    transfer: [/^(-?\d+) to "(\w+)" for "([^"]*)"$/, ([, amount, to, what]) => ({ to, amount: Number(amount), for: what })],
    issue_invoice: [/^to "(\w+)" for (-?\d+), due "([^"]*)", for "([^"]*)"$/, ([, to, amount, due, what]) => ({ to, amount: Number(amount), due, for: what })],
    commit: [/^with "(\w+)" (-?\d+) for "([^"]*)"$/, ([, account, amount, what]) => ({ with: account, amount: Number(amount), for: what })],
    release: [/^"([^"]+)"$/, ([, commitment]) => ({ commitment })],
    approve: [/^"(\w+)" with the ceiling (\d+)$/, ([, account, ceiling]) => ({ account, ceiling: Number(ceiling) })],
    ledger: [/^$/, () => ({})],
  };
  const form = forms[tool];
  const match = form?.[0].exec(rest);
  assert.ok(form !== undefined && match !== null, `the steps do not read the arguments "${rest}" of "${tool}"`);
  return { kind: "call", tool, arguments: form[1](match) };
}

/** A participant's steps as the contract writes them, joined by ", then ". */
function stepsOf(written: string): RuleStep[] {
  // An invoice's arguments hold commas of their own; the steps are joined by ", then ".
  return written.split(", then ").map(stepOf);
}

Given(/^"(\w+)"'s first step is (.+)$/, function (this: Context, participant: string, written: string) {
  scriptsOf(this).set(participant, [stepOf(written)]);
});

Given(/^"(\w+)"'s steps are (.+)$/, function (this: Context, participant: string, written: string) {
  scriptsOf(this).set(participant, stepsOf(written));
});

Given(/^"(\w+)"'s steps (wait .+)$/, function (this: Context, participant: string, written: string) {
  scriptsOf(this).set(participant, stepsOf(written));
});

/** A party's calls of a tool, in order. */
function callsOf(context: Context, party: string | undefined, tool: string): Record<string, unknown>[] {
  return ranLines(context).filter((line) => line.type === "tool_call" && line.tool === tool && (party === undefined || line.agent === party));
}

/** What a "ledger" call gave, as JSON. */
function ledgerOf(call: Record<string, unknown> | undefined): Record<string, unknown> {
  assert.ok(call !== undefined, "no ledger call was made");
  assert.equal(call.outcome, "success");
  return JSON.parse(call.result as string) as Record<string, unknown>;
}

Then(
  /^the "ledger" result gives the balance (\d+) and the invoice "([^"]+)" from "(\w+)", (\d+), due "([^"]+)", for "([^"]+)", paid$/,
  function (this: Context, balance: string, id: string, from: string, amount: string, due: string, what: string) {
    const ledger = ledgerOf(callsOf(this, undefined, "ledger")[0]);
    assert.equal(ledger.balance, Number(balance));
    // The time it was issued, which the ledger also gives (FR-CONGRESS-09), is not what this step checks.
    const { issued, ...invoice } = (ledger.invoices_to_pay as Record<string, unknown>[]).find((each) => each.id === id) ?? {};
    assert.equal(typeof issued, "string");
    assert.deepEqual(invoice, { id, from, amount: Number(amount), due, for: what, paid: true });
  },
);

/** The money_summary line of each account, by its name. */
function summaries(context: Context): Map<string, Record<string, unknown>> {
  return new Map(ranLines(context).filter((line) => line.type === "money_summary").map((line) => [line.account as string, line]));
}

Then(/^the run's "money_summary" lines give "(\w+)" (\d+) and "(\w+)" (\d+)$/, function (this: Context, first: string, balance: string, second: string, other: string) {
  const lines = summaries(this);
  assert.equal(lines.get(first)?.balance, Number(balance));
  assert.equal(lines.get(second)?.balance, Number(other));
});

Then("the last {string} call failed with the outcome {string}", function (this: Context, tool: string, outcome: string) {
  assert.equal(callsOf(this, undefined, tool).at(-1)?.outcome, outcome);
});

Then("{string}'s balance is {int}", function (this: Context, account: string, balance: number) {
  assert.equal(summaries(this).get(account)?.balance, balance);
});

Then("both {string} calls succeeded", function (this: Context, tool: string) {
  assert.deepEqual(
    callsOf(this, undefined, tool).map(({ outcome }) => outcome),
    ["success", "success"],
  );
});

/** The facts of a kind the world recorded, from its money as the run left it. */
function recorded(context: Context, kind: string): Record<string, unknown>[] {
  ranLines(context);
  assert.equal(kind, "unapproved_overrun");
  const money = setupOf(context).loaded?.world.state.money as { overruns: Record<string, unknown>[] } | undefined;
  assert.ok(money !== undefined, "the world keeps no money");
  return money.overruns;
}

Then(
  /^the world recorded one "(\w+)": the commitment "([^"]+)", the committed total (\d+) and the limit (\d+)$/,
  function (this: Context, kind: string, commitment: string, committed: string, limit: string) {
    const facts = recorded(this, kind);
    assert.equal(facts.length, 1, `the world recorded ${facts.length} "${kind}" facts`);
    assert.deepEqual({ commitment: facts[0].commitment, committed: facts[0].committed, limit: facts[0].limit }, { commitment, committed: Number(committed), limit: Number(limit) });
  },
);

Then("the world recorded no {string}", function (this: Context, kind: string) {
  assert.deepEqual(recorded(this, kind), []);
});

Then(/^the world recorded one "(\w+)" for the commitment "([^"]+)", with the limit (\d+)$/, function (this: Context, kind: string, commitment: string, limit: string) {
  const facts = recorded(this, kind);
  assert.equal(facts.length, 1, `the world recorded ${facts.length} "${kind}" facts`);
  assert.deepEqual({ commitment: facts[0].commitment, limit: facts[0].limit }, { commitment, limit: Number(limit) });
});

Then("{string}'s committed total is {int}", function (this: Context, account: string, committed: number) {
  assert.equal(summaries(this).get(account)?.committed, committed);
});

Then(/^"(\w+)"'s "ledger" result gives the invoice "([^"]+)" it issued to "(\w+)", paid$/, function (this: Context, party: string, id: string, to: string) {
  const ledger = ledgerOf(callsOf(this, party, "ledger")[0]);
  const invoice = (ledger.invoices_issued as Record<string, unknown>[]).find((each) => each.id === id);
  assert.deepEqual({ to: invoice?.to, paid: invoice?.paid }, { to, paid: true });
});

/** The one call the participant "venue" made. */
function venueCall(context: Context): Record<string, unknown> {
  const calls = ranLines(context).filter((line) => line.type === "tool_call" && line.agent === "venue");
  assert.equal(calls.length, 1, `"venue" made ${calls.length} calls`);
  return calls[0];
}

Then("that call failed with the outcome {string} and took no time", function (this: Context, outcome: string) {
  const call = venueCall(this);
  assert.equal(call.outcome, outcome);
  assert.ok((call.endedAtMs as number) - (call.startedAtMs as number) <= 10, "the call took time");
});

Then("that call failed with the outcome {string}", function (this: Context, outcome: string) {
  assert.equal(venueCall(this).outcome, outcome);
});

Then(
  /^the run's log has "money" lines for the transfer, the invoice, the commitment, the overrun and the payment, each with its parties, amount, ids, run time and world time$/,
  function (this: Context) {
    const lines = ranLines(this).filter((line) => line.type === "money");
    const ofKind = (kind: string) => {
      const found = lines.filter((line) => line.kind === kind);
      assert.equal(found.length, 1, `the log has ${found.length} "money" lines of the kind "${kind}"`);
      assert.ok(typeof found[0].atMs === "number" && found[0].worldTime !== undefined, `the "${kind}" line gives no run time or world time`);
      return found[0];
    };
    assert.deepEqual(pick(ofKind("transfer"), ["from", "to", "amount"]), { from: "board", to: "ana", amount: 1000 });
    assert.deepEqual(pick(ofKind("invoice"), ["from", "to", "amount", "invoice"]), { from: "venue", to: "ana", amount: 400, invoice: "i-1" });
    assert.deepEqual(pick(ofKind("commitment"), ["from", "to", "amount", "commitment"]), { from: "ana", to: "venue", amount: 400, commitment: "k-1" });
    assert.deepEqual(pick(ofKind("unapproved_overrun"), ["from", "amount", "commitment", "limit"]), { from: "ana", amount: 400, commitment: "k-1", limit: 300 });
    assert.deepEqual(pick(ofKind("payment"), ["from", "to", "amount", "invoice"]), { from: "ana", to: "venue", amount: 400, invoice: "i-1" });
  },
);

/** Some of a line's keys. */
function pick(line: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, line[key]]));
}

Then("a {string} line for each account with its balance, committed total, ceiling and unpaid invoices", function (this: Context, type: string) {
  assert.equal(type, "money_summary");
  const lines = summaries(this);
  assert.deepEqual([...lines.keys()].sort(), ["ana", "board", "venue"]);
  assert.deepEqual(pick(lines.get("ana") as Record<string, unknown>, ["balance", "committed", "ceiling", "unpaid"]), { balance: 600, committed: 400, ceiling: null, unpaid: [] });
  assert.deepEqual(pick(lines.get("venue") as Record<string, unknown>, ["balance", "committed", "ceiling", "unpaid"]), { balance: "unlimited", committed: 0, ceiling: null, unpaid: [] });
});

Then(
  /^it gives the accounts "(\w+)" \(opening (\d+)\), "(\w+)" \(unlimited\) and "(\w+)" \(opening (\d+)\), the "discretionary_limit" (\d+), and each party's money tools$/,
  function (this: Context, first: string, opening: string, unlimited: string, third: string, other: string, limit: string) {
    const [condition] = madeInventory(this).conditions;
    const money = (condition as { money?: Record<string, unknown> }).money;
    assert.deepEqual(money, {
      accounts: [
        { name: first, opening: Number(opening) },
        { name: unlimited, unlimited: true },
        { name: third, opening: Number(other) },
      ],
      discretionaryLimit: Number(limit),
      tools: { ana: ["ledger", "pay"], venue: ["issue_invoice", "commit", "release", "ledger"], board: ["approve", "transfer"] },
    });
    const printed = inventoryMarkdown(madeInventory(this));
    for (const text of ["### Money", `${first}: opening ${opening}`, `${unlimited}: unlimited`, `discretionary_limit ${limit}`, "issue_invoice, commit, release, ledger"]) {
      assert.ok(printed.includes(text), `the printed inventory does not give ${text}`);
    }
  },
);

/** Each change the contract makes to the configuration's money, by how it writes it. */
const moneyChanges: [RegExp, (context: Context, value: string) => void][] = [
  [/^the configuration has no calendar$/, (context) => (context.calendar = undefined)],
  [/^it has no accounts$/, (context) => (moneyOf(context).accounts = {})],
  [/^it gives an account to "(\w+)"$/, (context, name) => ((moneyOf(context).accounts as TomlTable)[name] = { opening: 10 })],
  [/^"ana"'s opening is (-?\d+)$/, (context, opening) => (((moneyOf(context).accounts as TomlTable).ana as TomlTable).opening = Number(opening))],
  [/^"venue" has both an opening and "unlimited"$/, (context) => (((moneyOf(context).accounts as TomlTable).venue as TomlTable).opening = 10)],
  [/^its "discretionary_limit" is (-?\d+)$/, (context, limit) => (moneyOf(context).discretionary_limit = Number(limit))],
];

Given("the configuration's money is changed so that {}", function (this: Context, change: string) {
  const known = moneyChanges.find(([written]) => written.test(change));
  assert.ok(known !== undefined, `the steps do not read the change "${change}"`);
  known[1](this, known[0].exec(change)?.[1] ?? "");
});
