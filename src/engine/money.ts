import type { TomlTable, TomlValue } from "smol-toml";
import type { Calendar, WorldTime } from "./calendar.ts";
import type { Stimuli } from "./stimuli.ts";
import type { RunClock } from "./clock.ts";
import type { ParticipantSettings } from "./participants.ts";
import type { AgentCall, Effector, Refusal, Sensor, Tool } from "./tools.ts";
import type { Action, World } from "./world.ts";

/** An account as the configuration gives it: its holder, its opening balance or that it is unlimited, and for an agent the money tools it has. */
export type AccountSettings = { name: string; tools?: readonly string[] } & ({ opening: number } | { unlimited: true });

/** A configuration's [money] (FR-MONEY-01), as the engine follows it. */
export interface MoneySettings {
  accounts: readonly AccountSettings[];
  discretionaryLimit: number;
  /** Each money tool's duration, in world minutes, from the configuration's [durations]; 0 when it gives none. */
  durations: Readonly<Record<string, number>>;
}

/** The money tools, in the order the inventory lists them. */
export const MONEY_TOOLS = ["issue_invoice", "pay", "transfer", "commit", "release", "approve", "ledger"] as const;

/** A key of the money that cannot be followed: an error that names it, its value and why. */
function refused(key: string, value: unknown, why: string): Error {
  return new Error(`The configuration's ${key} ${JSON.stringify(value) ?? "(none)"} cannot be followed: ${why}`);
}

/** Whether a TOML value is a table. */
function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Reads a configuration's [money] (FR-MONEY-01) against the names of the agents and participants and the
 * configuration's [durations]; money that cannot be followed is refused, with an error that names the key: no
 * [calendar], no accounts, an account for no agent or participant, a negative opening, an opening beside unlimited, a
 * negative discretionary_limit, and a negative duration of a money tool.
 */
export function readMoney(value: TomlValue, calendar: Calendar | undefined, names: readonly string[], durations: Readonly<Record<string, unknown>> = {}): MoneySettings {
  if (calendar === undefined) throw new Error("The configuration's money cannot be followed: its durations are world time, and the configuration declares no [calendar]");
  const table = isTable(value) ? value : {};
  const written = isTable(table.accounts) ? table.accounts : {};
  if (Object.keys(written).length === 0) throw refused("money.accounts", table.accounts, "money needs at least one account");
  const accounts = Object.entries(written).map(([name, account]): AccountSettings => {
    const key = `money.accounts.${name}`;
    if (!names.includes(name)) throw refused(key, account, `"${name}" is no agent or participant`);
    const { opening, unlimited, tools } = (isTable(account) ? account : {}) as { opening?: unknown; unlimited?: unknown; tools?: string[] };
    const kept = tools === undefined ? { name } : { name, tools };
    if (unlimited === true) {
      if (opening !== undefined) throw refused(key, account, "an unlimited account has no opening");
      return { ...kept, unlimited: true };
    }
    if (typeof opening !== "number" || !(opening >= 0)) throw refused(`${key}.opening`, opening, "it is not an amount of at least 0");
    return { ...kept, opening };
  });
  const limit = table.discretionary_limit;
  if (typeof limit !== "number" || !(limit >= 0)) throw refused("money.discretionary_limit", limit, "it is not an amount of at least 0");
  const minutes = Object.fromEntries(
    MONEY_TOOLS.map((tool) => {
      const given = durations[tool] ?? 0;
      if (typeof given !== "number" || !(given >= 0)) throw refused(`durations.${tool}`, given, "it is not a number of world minutes of at least 0");
      return [tool, given];
    }),
  );
  return { accounts, discretionaryLimit: limit, durations: minutes };
}

/** An invoice: its id, issuer, addressee, amount, due day, what it is for, and whether it was paid. */
export interface Invoice {
  id: string;
  from: string;
  to: string;
  amount: number;
  due: string;
  for: string;
  paid: boolean;
}

/**
 * The money with an invoice issued, numbered after the others, and its event: as issue_invoice applies it, and as the
 * world issues one from an account of its own (FR-CONGRESS-05).
 */
export function invoiced(money: Money, invoice: Omit<Invoice, "id" | "paid">): Money {
  const issued: Invoice = { id: `i-${money.invoices.length + 1}`, ...invoice, paid: false };
  return { ...money, invoices: [...money.invoices, issued], events: [...money.events, { kind: "invoice", from: issued.from, to: issued.to, amount: issued.amount, invoice: issued.id, due: issued.due, for: issued.for }] };
}

/**
 * The money with a commitment recorded, numbered after the others, and its event; one that leaves its account's committed
 * total above its ceiling, or the discretionary limit without one, adds an unapproved overrun, never a refusal: as commit
 * applies it, and as the world commits from an account of its own (FR-CONGRESS-05).
 */
export function withCommitment(money: Money, given: Omit<Commitment, "id" | "released">, discretionaryLimit: number): Money {
  const commitment: Commitment = { id: `k-${money.commitments.length + 1}`, ...given, released: false };
  const after = { ...money, commitments: [...money.commitments, commitment] };
  const committed = committedOf(after, commitment.with);
  const limit = money.ceilings[commitment.with] ?? discretionaryLimit;
  const events: MoneyEvent[] = [{ kind: "commitment", from: commitment.with, to: commitment.by, amount: commitment.amount, commitment: commitment.id, for: commitment.for }];
  if (committed <= limit) return { ...after, events: [...money.events, ...events] };
  const overrun: Overrun = { commitment: commitment.id, account: commitment.with, committed, limit };
  return { ...after, overruns: [...money.overruns, overrun], events: [...money.events, ...events, { kind: "unapproved_overrun", from: commitment.with, amount: committed, commitment: commitment.id, limit }] };
}

/** The money with a commitment released, by its id, and its event: as release applies it, and as the world releases one. */
export function withRelease(money: Money, id: string): Money {
  const commitment = money.commitments.find((each) => each.id === id) as Commitment;
  return {
    ...money,
    commitments: money.commitments.map((each) => (each.id === id ? { ...each, released: true } : each)),
    events: [...money.events, { kind: "release", from: commitment.with, to: commitment.by, amount: commitment.amount, commitment: commitment.id }],
  };
}

/**
 * The money with the events a change added stamped with the world time it applied, as `at`, in world minutes since day
 * 1's midnight (FR-CONGRESS-06); unstamped without a world time.
 */
export function stamped(before: Money, after: Money, world: WorldTime | undefined): Money {
  if (world === undefined) return after;
  const at = (world.day - 1) * 1440 + world.seconds / 60;
  return { ...after, events: [...after.events.slice(0, before.events.length), ...after.events.slice(before.events.length).map((event) => ({ ...event, at }))] };
}

/** The money with an amount moved from one account to another, and its event: as transfer applies it, and as the world pays from an account of its own (FR-POPULATION-01). */
export function withTransfer(money: Money, { from, to, amount, for: what }: { from: string; to: string; amount: number; for: string }): Money {
  return { ...money, balances: moved(money, from, to, amount), events: [...money.events, { kind: "transfer", from, to, amount, for: what }] };
}

/** A commitment: its id, who recorded it, the account bound by it, its amount, what it is for, and whether it was released. */
export interface Commitment {
  id: string;
  by: string;
  with: string;
  amount: number;
  for: string;
  released: boolean;
}

/** An overrun the world recorded: the commitment, the account, its committed total then, and the limit it passed. */
export interface Overrun {
  commitment: string;
  account: string;
  committed: number;
  limit: number;
}

/** A money event as the log gives it (FR-MONEY-01): its kind, its parties, amount and ids. */
export type MoneyEvent = { kind: "invoice" | "payment" | "transfer" | "commitment" | "release" | "approval" | "unapproved_overrun" } & Readonly<Record<string, string | number>>;

/** The money as the world keeps it (FR-MONEY-01). */
export interface Money {
  /** Each account's balance, by its holder; null for an unlimited account, whose money the world does not follow. */
  balances: Readonly<Record<string, number | null>>;
  invoices: readonly Invoice[];
  commitments: readonly Commitment[];
  /** The ceiling approved for each account, by its holder. */
  ceilings: Readonly<Record<string, number>>;
  overruns: readonly Overrun[];
  /** Every money event, in the order applied. */
  events: readonly MoneyEvent[];
}

/** Where a scenario's state keeps the money (FR-MONEY-01). */
export interface MoneyKeeper<State> {
  of(state: State): Money;
  with(state: State, money: Money): State;
}

/** The money as a run starts: each account at its opening, no invoice, commitment, ceiling or event. */
export function startingMoney(settings: MoneySettings): Money {
  const balances = Object.fromEntries(settings.accounts.map((account) => [account.name, "unlimited" in account ? null : account.opening]));
  return { balances, invoices: [], commitments: [], ceilings: {}, overruns: [], events: [] };
}

/** An account's committed total: the sum of its commitments not released. */
function committedOf(money: Money, account: string): number {
  return money.commitments.filter((commitment) => commitment.with === account && !commitment.released).reduce((sum, { amount }) => sum + amount, 0);
}

/** The money with an amount moved from one account to another; an unlimited account's balance stays unfollowed. */
function moved(money: Money, from: string, to: string, amount: number): Money["balances"] {
  const { balances } = money;
  const change = (account: string, by: number) => (balances[account] === null ? {} : { [account]: (balances[account] as number) + by });
  return { ...balances, ...change(from, -amount), ...change(to, amount) };
}

/** Why an account cannot pay an amount: a balance below it; an unlimited account always can. */
function shortOf(money: Money, account: string, amount: number): boolean {
  const balance = money.balances[account];
  return balance !== null && balance < amount;
}

/** The time a money tool takes, from the configuration's [durations]. */
function minutesOf(settings: MoneySettings, tool: string) {
  return () => ({ worldSeconds: (settings.durations[tool] ?? 0) * 60 });
}

/** Whether a value is an amount: a positive number. */
const isAmount = (value: unknown): value is number => typeof value === "number" && value > 0;

/** An argument a money tool does not take: invalid_arguments, and the call takes no time. */
const invalid = (reason: string): Refusal => ({ outcome: "invalid_arguments", reason });

/** The money tools (FR-MONEY-01): issue_invoice, pay, transfer, commit, release and approve, effectors through the arbiter, and ledger, a sensor. */
export function moneyTools<State>(settings: MoneySettings, keeper: MoneyKeeper<State>): Tool<State>[] {
  const accounts = settings.accounts.map(({ name }) => name);
  const moneyOf = (state: State) => keeper.of(state);
  /** A money action: its failure, checked as it lands, and its change of the money, with the events it adds. */
  const acting = (fails: (money: Money, call: AgentCall) => string | undefined, change: (money: Money, call: AgentCall) => Money): Action<State, AgentCall> => ({
    precondition: (state, call) => {
      const reason = fails(moneyOf(state), call);
      return reason === undefined ? { holds: true } : { holds: false, reason };
    },
    effect: (state, call) => keeper.with(state, stamped(moneyOf(state), change(moneyOf(state), call), (call as { world?: WorldTime }).world)),
  });
  /** Refuses a call from a caller without an account, or that names no account, or an amount that is not positive. */
  const refusing = (account: string | undefined, amount: unknown): Refusal | undefined => {
    if (account !== undefined && !accounts.includes(account)) return invalid(`there is no account "${account}"`);
    return isAmount(amount) ? undefined : invalid("the amount is not a positive number");
  };
  const callerRefusal = (call: AgentCall) => (accounts.includes(call.agent) ? undefined : invalid("you have no account"));
  const effector = (name: string, description: string, properties: Record<string, object>, required: string[], rest: Partial<Effector<State>>): Effector<State> => ({
    kind: "effector",
    name,
    description,
    parameters: { type: "object", properties, required },
    durationMs: minutesOf(settings, name),
    texts: { success: "Done." },
    readTarget: () => "not_sensed",
    ...rest,
  });
  const issueInvoice = effector(
    "issue_invoice",
    "Send an invoice from your account: to whom, the amount, when it is due (\"day <n>\") and what it is for.",
    { to: { type: "string" }, amount: { type: "number" }, due: { type: "string" }, for: { type: "string" } },
    ["to", "amount", "due", "for"],
    {
      refuses: (_state, call) => {
        const { to, amount, due } = call.arguments;
        if (typeof due !== "string" || !/^day \d+$/.test(due)) return invalid('the due date is not "day <n>"');
        return callerRefusal(call) ?? refusing(to as string, amount);
      },
      action: acting(
        () => undefined,
        (money, { agent, arguments: { to, amount, due, for: what } }) => invoiced(money, { from: agent, to: to as string, amount: amount as number, due: due as string, for: what as string }),
      ),
      texts: { success: "Invoice sent." },
    },
  );
  const invoiceFor = (money: Money, call: AgentCall) => money.invoices.find(({ id, to }) => id === call.arguments.invoice && to === call.agent);
  const pay = effector("pay", "Pay an invoice addressed to you, by its id.", { invoice: { type: "string" } }, ["invoice"], {
    refuses: (_state, call) => callerRefusal(call),
    action: acting(
      (money, call) => {
        const invoice = invoiceFor(money, call);
        if (invoice === undefined) return "no_such_invoice";
        if (invoice.paid) return "already_paid";
        return shortOf(money, call.agent, invoice.amount) ? "insufficient_funds" : undefined;
      },
      (money, call) => {
        const invoice = invoiceFor(money, call) as Invoice;
        return {
          ...money,
          balances: moved(money, call.agent, invoice.from, invoice.amount),
          invoices: money.invoices.map((each) => (each.id === invoice.id ? { ...each, paid: true } : each)),
          events: [...money.events, { kind: "payment", from: call.agent, to: invoice.from, amount: invoice.amount, invoice: invoice.id }],
        };
      },
    ),
    texts: { success: "Paid.", no_such_invoice: "no_such_invoice: no invoice with that id is addressed to you", already_paid: "already_paid: that invoice is paid", insufficient_funds: "insufficient_funds: your balance is below the amount" },
  });
  const transfer = effector("transfer", "Move money from your account to another, without an invoice: to whom, the amount and what it is for.", { to: { type: "string" }, amount: { type: "number" }, for: { type: "string" } }, ["to", "amount", "for"], {
    refuses: (_state, call) => callerRefusal(call) ?? refusing(call.arguments.to as string, call.arguments.amount),
    action: acting(
      (money, call) => (shortOf(money, call.agent, call.arguments.amount as number) ? "insufficient_funds" : undefined),
      (money, { agent, arguments: { to, amount, for: what } }) => withTransfer(money, { from: agent, to: to as string, amount: amount as number, for: what as string }),
    ),
    texts: { success: "Transferred.", insufficient_funds: "insufficient_funds: your balance is below the amount" },
  });
  const commit = effector("commit", "Record that an account is now committed to pay you: whose account, the amount and what it is for.", { with: { type: "string" }, amount: { type: "number" }, for: { type: "string" } }, ["with", "amount", "for"], {
    refuses: (_state, call) => refusing(call.arguments.with as string, call.arguments.amount),
    action: acting(
      () => undefined,
      (money, { agent, arguments: { with: account, amount, for: what } }) => withCommitment(money, { by: agent, with: account as string, amount: amount as number, for: what as string }, settings.discretionaryLimit),
    ),
    texts: { success: "Committed." },
  });
  const recordedBy = (money: Money, call: AgentCall) => money.commitments.find(({ id, by, released }) => id === call.arguments.commitment && by === call.agent && !released);
  const release = effector("release", "End a commitment you recorded, by its id, as when a booking or an order is cancelled.", { commitment: { type: "string" } }, ["commitment"], {
    action: acting(
      (money, call) => (recordedBy(money, call) === undefined ? "no_such_commitment" : undefined),
      (money, call) => withRelease(money, (recordedBy(money, call) as Commitment).id),
    ),
    texts: { success: "Released.", no_such_commitment: "no_such_commitment: you recorded no such commitment" },
  });
  const approve = effector("approve", "Approve the ceiling an account's holder may commit to without asking again.", { account: { type: "string" }, ceiling: { type: "number" } }, ["account", "ceiling"], {
    refuses: (_state, call) => refusing(call.arguments.account as string, call.arguments.ceiling),
    action: acting(
      () => undefined,
      (money, { agent, arguments: { account, ceiling } }) => ({
        ...money,
        ceilings: { ...money.ceilings, [account as string]: ceiling as number },
        events: [...money.events, { kind: "approval", from: agent, to: account as string, amount: ceiling as number }],
      }),
    ),
    texts: { success: "Approved." },
  });
  const ledger: Sensor<State> = {
    kind: "sensor",
    name: "ledger",
    description: "Read your account: its balance, the invoices addressed to you and those you issued, the commitments you are bound by and those you recorded, and your ceiling.",
    parameters: { type: "object", properties: {} },
    durationMs: minutesOf(settings, "ledger"),
    sense: (state, agent) => JSON.stringify(ledgerOf(moneyOf(state), agent)),
  };
  return [issueInvoice, pay, transfer, commit, release, approve, ledger];
}

/** An account as its ledger shows it to its holder. */
function ledgerOf(money: Money, account: string): Record<string, unknown> {
  const invoice = (other: "from" | "to") => ({ id, from, to, amount, due, for: what, paid }: Invoice) => ({ id, [other]: other === "from" ? from : to, amount, due, for: what, paid });
  const commitment = (other: "by" | "with") => ({ id, by, with: account2, amount, for: what }: Commitment) => ({ id, [other]: other === "by" ? by : account2, amount, for: what });
  const balance = money.balances[account];
  return {
    balance: balance === null ? "unlimited" : (balance ?? 0),
    invoices_to_pay: money.invoices.filter(({ to }) => to === account).map(invoice("from")),
    invoices_issued: money.invoices.filter(({ from }) => from === account).map(invoice("to")),
    commitments_bound: money.commitments.filter(({ with: bound, released }) => bound === account && !released).map(commitment("by")),
    commitments_recorded: money.commitments.filter(({ by, released }) => by === account && !released).map(commitment("with")),
    ...(Object.hasOwn(money.ceilings, account) ? { ceiling: money.ceilings[account] } : {}),
  };
}

/** A line of the run's log the money writes (FR-MONEY-01): each event as it is applied, and each account's summary as the run ends. */
export type MoneyLine =
  | ({ type: "money"; kind: MoneyEvent["kind"]; atMs: number; worldTime: WorldTime } & Readonly<Record<string, unknown>>)
  | { type: "money_summary"; account: string; balance: number | "unlimited"; committed: number; ceiling: number | null; unpaid: string[] };

/** What the money's book runs in: the world, where it keeps the money, the run's clock and the log. */
export interface MoneyRun<State> {
  world: World<State>;
  keeper: MoneyKeeper<State>;
  settings: MoneySettings;
  clock: RunClock;
  record(line: MoneyLine): void;
  /** The run's stimuli, given when its scenario declares the channel invoice_notice (FR-CONGRESS-05). */
  notices?: Stimuli;
}

/** The channel by which an invoice's recipient learns of it, when its scenario declares it: `{from}` and `{for}` fill its text. */
export const INVOICE_NOTICE = "invoice_notice";

/** The money's book in a run (FR-MONEY-01): it writes each money event as the world applies it, and each account's summary as the run ends. */
export class MoneyBook<State> {
  readonly #run: MoneyRun<State>;

  constructor(run: MoneyRun<State>) {
    this.#run = run;
  }

  /** Watches the world from now on for money events. */
  start(): void {
    const { world, keeper, clock, record, notices } = this.#run;
    world.watch((before, after) => {
      const seen = keeper.of(before).events.length;
      for (const event of keeper.of(after).events.slice(seen)) {
        record({ type: "money", ...event, atMs: performance.now(), worldTime: clock.worldTime() as WorldTime });
        // An invoice reaches its recipient as a message does, from its issuer (FR-CONGRESS-05).
        if (event.kind === "invoice") notices?.deliver(String(event.to), INVOICE_NOTICE, { from: String(event.from), for: String(event.for) }, { source: String(event.from) });
      }
    });
  }

  /** Writes each account's summary: its balance, committed total, ceiling and unpaid invoices addressed to it. */
  summarise(): void {
    const { world, keeper, settings, record } = this.#run;
    const money = keeper.of(world.state);
    for (const { name } of settings.accounts) {
      const balance = money.balances[name];
      record({
        type: "money_summary",
        account: name,
        balance: balance === null ? "unlimited" : balance,
        committed: committedOf(money, name),
        ceiling: money.ceilings[name] ?? null,
        unpaid: money.invoices.filter(({ to, paid }) => to === name && !paid).map(({ id }) => id),
      });
    }
  }
}

/** The money tools an agent's account gives it, or a participant's own tools, among the money tools. */
export function moneyToolsOf(settings: MoneySettings, participants: readonly ParticipantSettings[], party: string): string[] {
  const participant = participants.find(({ name }) => name === party);
  const tools = participant?.tools ?? settings.accounts.find(({ name }) => name === party)?.tools ?? [];
  return tools.filter((tool) => (MONEY_TOOLS as readonly string[]).includes(tool));
}

/** How each money tool's duration is computed, for the inventory. */
export const MONEY_DURATIONS: Readonly<Record<string, string>> = Object.fromEntries(MONEY_TOOLS.map((tool) => [tool, `durations.${tool}, in world minutes`]));

/** The money as the inventory gives it (FR-MONEY-01): the accounts with their openings, the discretionary limit, and each party's money tools. */
export interface MoneyInventory {
  accounts: ({ name: string; opening: number } | { name: string; unlimited: true })[];
  discretionaryLimit: number;
  tools: Record<string, string[]>;
}

/** The money's settings as the inventory gives them. */
export function moneyInventory(settings: MoneySettings, participants: readonly ParticipantSettings[]): MoneyInventory {
  return {
    accounts: settings.accounts.map((account) => ("unlimited" in account ? { name: account.name, unlimited: true } : { name: account.name, opening: account.opening })),
    discretionaryLimit: settings.discretionaryLimit,
    tools: Object.fromEntries(settings.accounts.map(({ name }) => [name, moneyToolsOf(settings, participants, name)])),
  };
}
