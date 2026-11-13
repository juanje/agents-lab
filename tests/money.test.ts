import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentTools } from "@earendil-works/pi-ai";
import { stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { readCalendar } from "../src/engine/calendar.ts";
import { inventory, inventoryMarkdown } from "../src/engine/inventory.ts";
import { readExperiment } from "../src/engine/experiment.ts";
import { INVOICE_NOTICE, type Money, MoneyBook, type MoneyKeeper, invoiced, moneyTools, readMoney, startingMoney } from "../src/engine/money.ts";
import { RunClock } from "../src/engine/clock.ts";
import type { Sensor } from "../src/engine/tools.ts";
import { Stimuli } from "../src/engine/stimuli.ts";
import { World } from "../src/engine/world.ts";
import type { RuleSet, RuleStep } from "../src/engine/participants.ts";
import { run } from "../src/engine/run.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { type Post, postKeeper, postScenario } from "./fixtures/post.ts";

const calendar = readCalendar({ start: "day 1 Monday 09:00", segments: [{ scale: 6000 }] });

/** FR-MONEY-01's Background money, with any keys replaced. */
function money(changes: Record<string, unknown> = {}) {
  return {
    accounts: { ana: { opening: 0, tools: ["ledger", "pay"] }, venue: { unlimited: true }, board: { opening: 5000 } },
    discretionary_limit: 300,
    ...changes,
  };
}

describe("readMoney (FR-MONEY-01)", () => {
  it("reads each account's opening or that it is unlimited, the tools an agent's account gives it, the discretionary limit and the money tools' durations", () => {
    expect(readMoney(money() as never, calendar, ["ana", "venue", "board"], { pay: 5, ledger: 3 })).toEqual({
      accounts: [
        { name: "ana", opening: 0, tools: ["ledger", "pay"] },
        { name: "venue", unlimited: true },
        { name: "board", opening: 5000 },
      ],
      discretionaryLimit: 300,
      durations: { issue_invoice: 0, pay: 5, transfer: 0, commit: 0, release: 0, approve: 0, ledger: 3 },
    });
  });

  it("refuses, naming the key, money without a calendar or accounts, an account for no party, a negative opening, an opening beside unlimited, a negative limit and a negative duration", () => {
    const names = ["ana", "venue", "board"];
    expect(() => readMoney(money() as never, undefined, names)).toThrow(/money.*\[calendar\]/);
    expect(() => readMoney(money({ accounts: {} }) as never, calendar, names)).toThrow(/money\.accounts/);
    expect(() => readMoney(money({ accounts: { zoe: { opening: 1 } } }) as never, calendar, names)).toThrow(/money\.accounts\.zoe/);
    expect(() => readMoney(money({ accounts: { ana: { opening: -10 } } }) as never, calendar, names)).toThrow(/money\.accounts\.ana\.opening/);
    expect(() => readMoney(money({ accounts: { venue: { opening: 10, unlimited: true } } }) as never, calendar, names)).toThrow(/money\.accounts\.venue/);
    expect(() => readMoney(money({ discretionary_limit: -1 }) as never, calendar, names)).toThrow(/money\.discretionary_limit/);
    expect(() => readMoney(money() as never, calendar, names, { pay: -1 })).toThrow(/durations\.pay/);
  });
});

/** A world that keeps the mail and the money. */
interface Bank extends Post {
  money: unknown;
}

/** A rule set that takes each participant's steps in order, the first as the run starts. */
function scripted(steps: Record<string, RuleStep[]>): RuleSet {
  return {
    start: (params) => {
      const left = [...(steps[params.name as string] ?? [])];
      return { atStart: () => left.shift(), next: () => left.shift() ?? { kind: "end" }, outcome: () => ({}) };
    },
  };
}

const call = (tool: string, args: Record<string, unknown> = {}): RuleStep => ({ kind: "call", tool, arguments: args });

/** The post scenario with FR-MONEY-01's money: "ana" an agent, "venue" and "board" participants that take the steps given. */
function bank(steps: Record<string, RuleStep[]>, changes: Record<string, unknown> = {}): Scenario<Bank> {
  const base = postScenario.baseConfiguration.replace('agents = ["ana", "ben"]', 'agents = ["ana"]').replace("scale = 600", "scale = 6000");
  const participant = (name: string, tools: string[]) => ({ decides: "rules", rules: "scripted", tools, channels: [], params: { name } });
  const configuration = stringify({
    money: money(changes),
    durations: { ledger: 3, pay: 5, issue_invoice: 2, commit: 1, release: 1, approve: 1, transfer: 1 },
    participants: { venue: participant("venue", ["issue_invoice", "commit", "release", "ledger"]), board: participant("board", ["approve", "transfer"]) },
  });
  return {
    ...(postScenario as unknown as Scenario<Bank>),
    initialState: () => ({ mail: { mailboxes: {}, inTransit: [] }, money: undefined }),
    mail: { of: (state) => postKeeper.of(state), with: (state, mail) => ({ ...state, mail }) },
    money: { of: (state: Bank) => state.money, with: (state: Bank, kept: unknown) => ({ ...state, money: kept }) },
    ruleSets: { scripted: scripted(steps) },
    baseConfiguration: `${base}\n${configuration}`,
  } as Scenario<Bank>;
}

/** Runs the bank, "ana" making the calls given after the delay; gives the log's lines, the world as it ended and ana's model. */
async function runBank(scenario: Scenario<Bank>, anaCalls: { name: string; arguments: Record<string, unknown> }[] = [], delayMs = 100) {
  const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));
  const ana = new ScriptedModel([...anaCalls.map((made, index) => ({ toolCalls: [made as never], delayMs: index === 0 ? delayMs : 0 })), { text: "Done.", delayMs: 0 }]);
  const loaded = loadScenario(scenario, 1);
  const { runId } = await run(loaded, [{ name: "ana", model: ana, activations: 1 }], 1, {
    logDirectory,
    modelTurnTimeoutMs: 10_000,
    thinkingLevel: "off",
    compaction: { enabled: false },
    parallelismLimit: 2,
    timeLimitMs: 10_000,
  });
  const lines = readFileSync(join(logDirectory, `${runId}.jsonl`), "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
  const callsOf = (party: string, tool: string) => lines.filter((line) => line.type === "tool_call" && line.agent === party && line.tool === tool);
  const summary = (account: string) => lines.find((line) => line.type === "money_summary" && line.account === account);
  return { lines, callsOf, summary, state: loaded.world.state as Bank & { money: { overruns: Record<string, unknown>[] } }, ana };
}

describe("run, with money (FR-MONEY-01)", () => {
  it("moves a transfer and a paid invoice's money, gives the ledger, and writes a money line for each event and a summary for each account", async () => {
    const { lines, callsOf, summary } = await runBank(
      bank({ board: [call("transfer", { to: "ana", amount: 1000, for: "funds" })], venue: [call("issue_invoice", { to: "ana", amount: 400, due: "day 3", for: "deposit" })] }),
      [
        { name: "pay", arguments: { invoice: "i-1" } },
        { name: "ledger", arguments: {} },
      ],
    );

    expect(callsOf("ana", "pay")[0].outcome).toBe("success");
    const ledger = JSON.parse(callsOf("ana", "ledger")[0].result as string);
    expect(ledger).toMatchObject({ balance: 600, invoices_to_pay: [{ id: "i-1", from: "venue", amount: 400, due: "day 3", for: "deposit", paid: true }], invoices_issued: [] });
    expect(summary("ana")).toMatchObject({ balance: 600, committed: 0, ceiling: null, unpaid: [] });
    expect(summary("board")).toMatchObject({ balance: 4000 });
    expect(summary("venue")).toMatchObject({ balance: "unlimited" });
    const events = lines.filter(({ type }) => type === "money");
    expect(events.map(({ kind }) => kind)).toEqual(["transfer", "invoice", "payment"]);
    expect(events[2]).toMatchObject({ from: "ana", to: "venue", amount: 400, invoice: "i-1", worldTime: { day: 1, weekday: "Monday" } });
    expect(typeof events[2].atMs).toBe("number");
  });

  it("fails a payment, checked in order, as no_such_invoice, already_paid or insufficient_funds, moving nothing", async () => {
    const invoice = call("issue_invoice", { to: "ana", amount: 400, due: "day 3", for: "deposit" });
    const unknown = await runBank(bank({ board: [call("transfer", { to: "ana", amount: 1000, for: "f" })], venue: [invoice] }), [{ name: "pay", arguments: { invoice: "i-9" } }]);
    expect(unknown.callsOf("ana", "pay")[0].outcome).toBe("no_such_invoice");
    expect(unknown.summary("ana")?.balance).toBe(1000);

    const twice = await runBank(bank({ board: [call("transfer", { to: "ana", amount: 1000, for: "f" })], venue: [invoice] }), [
      { name: "pay", arguments: { invoice: "i-1" } },
      { name: "pay", arguments: { invoice: "i-1" } },
    ]);
    expect(twice.callsOf("ana", "pay").map(({ outcome }) => outcome)).toEqual(["success", "already_paid"]);
    expect(twice.summary("ana")?.balance).toBe(600);

    const poor = await runBank(bank({ board: [call("transfer", { to: "ana", amount: 100, for: "f" })], venue: [invoice] }), [{ name: "pay", arguments: { invoice: "i-1" } }]);
    expect(poor.callsOf("ana", "pay")[0].outcome).toBe("insufficient_funds");
    expect(poor.summary("ana")?.balance).toBe(100);
  });

  it("records an unapproved_overrun when a commitment takes an account above its ceiling, or the discretionary limit, refusing nothing", async () => {
    const { callsOf, state, summary } = await runBank(
      bank({ venue: [call("commit", { with: "ana", amount: 250, for: "hold" }), call("commit", { with: "ana", amount: 100, for: "projector" })] }),
    );

    expect(callsOf("venue", "commit").map(({ outcome }) => outcome)).toEqual(["success", "success"]);
    expect(state.money.overruns).toEqual([{ commitment: "k-2", account: "ana", committed: 350, limit: 300 }]);
    expect(summary("ana")).toMatchObject({ committed: 350 });
  });

  it("measures against an approved ceiling, counts no released commitment, and keeps an overrun a later approval would not have had", async () => {
    const wait: RuleStep = { kind: "wait", minutes: 10 };
    const approved = await runBank(
      bank({
        board: [call("approve", { account: "ana", ceiling: 2000 })],
        venue: [wait, call("commit", { with: "ana", amount: 1500, for: "booking" }), call("release", { commitment: "k-1" }), call("commit", { with: "ana", amount: 900, for: "elsewhere" })],
      }),
    );
    expect(approved.state.money.overruns).toEqual([]);
    expect(approved.summary("ana")).toMatchObject({ committed: 900, ceiling: 2000 });

    const late = await runBank(bank({ venue: [call("commit", { with: "ana", amount: 400, for: "hold" })], board: [wait, call("approve", { account: "ana", ceiling: 2000 })] }));
    expect(late.state.money.overruns).toEqual([{ commitment: "k-1", account: "ana", committed: 400, limit: 300 }]);
    expect(late.lines.filter(({ type, kind }) => type === "money" && kind === "approval")).toHaveLength(1);
  });

  it("refuses arguments it cannot follow as invalid_arguments, taking no time; a release of a commitment the caller did not record fails as no_such_commitment", async () => {
    for (const made of [
      call("issue_invoice", { to: "ana", amount: 0, due: "day 3", for: "x" }),
      call("issue_invoice", { to: "zoe", amount: 10, due: "day 3", for: "x" }),
      call("issue_invoice", { to: "ana", amount: 10, due: "Friday", for: "x" }),
      call("commit", { with: "ana", amount: -5, for: "x" }),
    ]) {
      const { lines } = await runBank(bank({ venue: [made] }));
      const [refused] = lines.filter((line) => line.type === "tool_call" && line.agent === "venue");
      expect(refused.outcome).toBe("invalid_arguments");
      expect((refused.endedAtMs as number) - (refused.startedAtMs as number)).toBeLessThan(10);
    }
    const { callsOf } = await runBank(bank({ venue: [call("release", { commitment: "k-7" })] }));
    expect(callsOf("venue", "release")[0].outcome).toBe("no_such_commitment");
  });

  it("offers an agent only the money tools its account gives it", async () => {
    const { ana } = await runBank(bank({}), [{ name: "ledger", arguments: {} }]);

    const offered = getCurrentTools(ana.received[0]).map(({ name }) => name);
    expect(offered.filter((name) => ["issue_invoice", "pay", "transfer", "commit", "release", "approve", "ledger"].includes(name)).sort()).toEqual(["ledger", "pay"]);
  });
});

describe("inventory, money (FR-MONEY-01)", () => {
  it("gives the accounts, their openings, the discretionary limit and each party's money tools", () => {
    const experiment = readExperiment(
      ['id = "e"', 'scenario = "bank"', 'models = ["scripted/one"]', 'thinking_level = "off"', "replicas = 1", "seed = 1", "[limits]", "time_limit_ms = 1000", "activations_per_agent = 1", "parallelism_limit = 1", "model_turn_timeout_ms = 500", "[compaction]", "enabled = false", "[conditions.base]", ""].join("\n"),
    );
    const made = inventory(experiment, bank({}));

    expect((made.conditions[0] as { money?: unknown }).money).toEqual({
      accounts: [
        { name: "ana", opening: 0 },
        { name: "venue", unlimited: true },
        { name: "board", opening: 5000 },
      ],
      discretionaryLimit: 300,
      tools: { ana: ["ledger", "pay"], venue: ["issue_invoice", "commit", "release", "ledger"], board: ["approve", "transfer"] },
    });
    expect(inventoryMarkdown(made)).toContain(["### Money\n", "- ana: opening 0; tools ledger, pay", "- venue: unlimited; tools issue_invoice, commit, release, ledger", "- board: opening 5000; tools approve, transfer", "- discretionary_limit 300", ""].join("\n"));
  });
});

describe("the invoice notice (FR-CONGRESS-05)", () => {
  /** A world of money alone, with a book that watches it, and the stimuli given. */
  function booked(stimuli: Stimuli | undefined) {
    const keeper: MoneyKeeper<Money> = { of: (state) => state, with: (_state, money) => money };
    const world = new World<Money>({ balances: { a: 0, b: 0 }, invoices: [], commitments: [], ceilings: {}, overruns: [], events: [] });
    const clock = new RunClock(readCalendar({ start: "day 1 Monday 09:00", segments: [{ scale: 60 }] }));
    clock.start();
    const settings = readMoney({ discretionary_limit: 300, accounts: { a: { opening: 0 }, b: { opening: 0 } } } as never, readCalendar({ start: "day 1 Monday 09:00", segments: [{ scale: 60 }] }), ["a", "b"]);
    new MoneyBook({ world, keeper, settings, clock, record: () => {}, ...(stimuli === undefined ? {} : { notices: stimuli }) }).start();
    const invoice = { precondition: () => ({ holds: true }) as const, effect: (money: Money) => invoiced(money, { from: "a", to: "b", amount: 100, due: "day 3", for: "sponsorship" }) };
    world.apply(invoice, undefined);
  }

  it("tells an invoice's recipient, from its issuer, on the channel invoice_notice when the run declares it", () => {
    const stimuli = new Stimuli([{ name: INVOICE_NOTICE, source: "money", stimulus: "New invoice from {from}: {for}" }]);
    booked(stimuli);
    expect(stimuli.take("b")).toEqual([{ channel: INVOICE_NOTICE, source: "a", content: "New invoice from a: sponsorship" }]);
    expect(stimuli.take("a")).toEqual([]);
  });

  it("tells nobody without the channel", () => {
    expect(() => booked(undefined)).not.toThrow();
  });
});

describe("the ledger's invoices (FR-CONGRESS-09)", () => {
  it("gives when each invoice was issued, as the world time its event was stamped with", () => {
    const settings = readMoney(money() as never, calendar, ["ana", "venue", "board"]);
    const keeper: MoneyKeeper<{ money: Money }> = { of: (state) => state.money, with: (state, given) => ({ ...state, money: given }) };
    const issued = { id: "i-1", from: "venue", to: "ana", amount: 100, due: "day 22", for: "hall", paid: false };
    const state = { money: { ...startingMoney(settings), invoices: [issued], events: [{ kind: "invoice" as const, from: "venue", to: "ana", amount: 100, invoice: "i-1", due: "day 22", for: "hall", at: 19 * 1440 + 17 * 60 + 30 }] } };
    const ledger = moneyTools(settings, keeper).find(({ name }) => name === "ledger") as Sensor<{ money: Money }>;

    expect(JSON.parse(ledger.sense(state, "ana", {}, 0)).invoices_to_pay).toEqual([{ id: "i-1", from: "venue", amount: 100, due: "day 22", for: "hall", paid: false, issued: "day 20 17:30" }]);
  });
});
