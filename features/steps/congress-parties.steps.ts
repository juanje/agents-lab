import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { inventory } from "../../src/engine/inventory.ts";
import { readExperiment } from "../../src/engine/experiment.ts";
import type { Context } from "../support/context.ts";
import {
  type CongressSetup,
  FIRST_CONTRACT,
  change,
  congressChanges,
  configurationOf,
  hourMsOf,
  organiserTurns,
  runCongress,
  setUpCongress,
  setupOf,
  turnsBefore,
} from "./congress.steps.ts";
import { linesOf } from "./record.steps.ts";
import { runTheScenario, script } from "./tool.steps.ts";

/** The congress's one agent. */
const ORGANISER = "organiser";

/** FR-CONGRESS-02's city: an office, and the venues "v1" (foyer, main hall, room B) and "v2" (one hall), every interior open all week. */
const CITY = {
  places: [{ id: "office" }],
  venues: [
    { id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "foyer" }, { id: "main-hall", seats: 120, equipment: ["projector"] }, { id: "room-b", seats: 40 }] },
    { id: "v2", entrance: "v2-entrance", hours: "always", rooms: [{ id: "hall-2", seats: 90 }] },
  ],
  passages: [
    { between: ["office", "v1-entrance"], length: 40, step_free: true },
    { between: ["office", "v2-entrance"], length: 60, step_free: true },
    { between: ["v1-entrance", "foyer"], length: 1, step_free: true },
    { between: ["foyer", "main-hall"], length: 1, step_free: true },
    { between: ["foyer", "room-b"], length: 1, step_free: "3 steps" },
    { between: ["v2-entrance", "hall-2"], length: 1, step_free: true },
  ],
};

/** "v1"'s template, as the Background gives it. */
const V1 = {
  id: "v1",
  rooms: [
    { id: "main-hall", seats: 120, equipment: ["projector"] },
    { id: "room-b", seats: 40, equipment: [] },
  ],
  access_claim: "step-free access throughout",
  catering: "approved caterers only",
  opening: "doors open one hour before",
  price: 2000,
  extras: { ramp: 150 },
  hold_days: 2,
  deposit_share: 0.25,
  deposit_due_days: 3,
  cancellation: [{ more_than_days: 14, share: 0.1 }, { share: 0.5 }],
  indicative: true,
  enquiries_per_day: 0,
  pick_up: 1,
};

/** "v2"'s template: another venue the variant has. */
const V2 = { ...V1, id: "v2", rooms: [{ id: "hall-2", seats: 90, equipment: [] }], access_claim: "lift to every floor", price: 1800, indicative: false };

/** The pools of FR-CONGRESS-02's Background. */
function pools(changes: (pool: { venue: TomlTable[]; board: TomlTable[] }) => void = () => {}): string {
  const pool = { venue: [structuredClone(V1), structuredClone(V2)] as TomlTable[], board: [{ id: "board", funds: 6000, reserve: 1000 }] as TomlTable[] };
  changes(pool);
  return stringify({ topics: ["soil"], ...pool });
}

/** Changes the pools of the scenario. */
export function changePools(context: Context, changing: (pool: { venue: TomlTable[]; board: TomlTable[] } & Record<string, TomlTable[]>) => void): void {
  change(context, (configuration) => {
    const pool = parse(configuration.pools as string) as unknown as { topics: string[]; venue: TomlTable[]; board: TomlTable[] } & Record<string, TomlTable[]>;
    changing(pool);
    configuration.pools = stringify(pool as unknown as TomlTable);
  });
}

/** Changes "v1"'s template. */
function changeV1(context: Context, changing: (v1: TomlTable) => void): void {
  changePools(context, (pool) => changing(pool.venue.find(({ id }) => id === "v1") as TomlTable));
}

Given(
  "the congress scenario of FR-CONGRESS-01, whose calendar starts at {string} with one segment of scale {int}, so one world hour is {int} milliseconds of the run",
  function (this: Context, start: string, scale: number, hourMs: number) {
    setUpPartiesCongress(this, start, scale, hourMs);
  },
);

/** FR-CONGRESS-02's congress: its city, its venues "v1" and "v2" and its board, under a calendar of one segment. */
export function setUpPartiesCongress(context: Context, start: string, scale: number, hourMs: number): void {
  assert.equal((3600 * 1000) / scale, hourMs);
  const always = { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" };
  setUpCongress(context, { start, segments: [{ scale }], hours: { always } });
  change(context, (configuration) => {
    configuration.city = stringify(CITY);
    configuration.pools = pools();
    configuration.draw = stringify({ attendance: [50, 80], venue: 2, board: 1 });
  });
}

Given('the mail delivers in 1 world minute and the parties have no hours, no reply delay and "pick_up" 1', function (this: Context) {
  change(this, (configuration) => {
    (configuration.mail as TomlTable).delivery_minutes = [1, 1];
    for (const kind of ["venue", "board"]) delete ((configuration.kinds as TomlTable)[kind] as TomlTable).hours;
  });
});

Given('the variant has the venues "v1" and "v2" and the board "board"', function (this: Context) {
  // The draw chooses both venues and the one board of the pools.
});

Given(
  /^"v1"'s\ template\ has\ the\ room\ "main\-hall"\ \(120\ seats,\ a\ projector\)\ and\ "room\-b"\ \(40\ seats\),\ the\ access\ claim\ "step\-free\ access\ throughout",\ "foyer"\ to\ "room\-b"\ with\ "step_free"\ "3\ steps",\ the\ price\ 2000,\ the\ extra\ "ramp"\ at\ 150,\ "hold_days"\ 2,\ "deposit_share"\ 0\.25,\ "deposit_due_days"\ 3,\ the\ cancellation\ schedule\ "more\ than\ 14\ days:\ 0\.1;\ 14\ days\ or\ fewer:\ 0\.5",\ indicative\ rooms,\ and\ "enquiries_per_day"\ 0$/,
  function (this: Context) {
    // In V1 and CITY.
  },
);

Given('the board\'s template has "funds" 6000 and "reserve" 1000', function (this: Context) {
  // In the pools.
});

Given(
  'the organiser\'s account opens at 0, with the money tools "ledger", "pay" and "issue_invoice", and the "discretionary_limit" is 300',
  function (this: Context) {
    change(this, (configuration) => (configuration.money = { discretionary_limit: 300, accounts: { [ORGANISER]: { opening: 0, tools: ["ledger", "pay", "issue_invoice"] } } }));
  },
);

Given("the congress is on {string}", function (this: Context, day: string) {
  change(this, (configuration) => (configuration.event_day = Number(/^day (\d+)$/.exec(day)?.[1])));
});

/** The world minutes since day 1's midnight of a world time written "day <n> [<weekday>] HH:MM". */
export function minutesOf(time: string): number {
  const [, day, hours, minutes] = /^day (\d+)(?: \w+)? (\d\d):(\d\d)$/.exec(time) ?? [];
  assert.ok(day !== undefined, `"${time}" is no world time`);
  return (Number(day) - 1) * 1440 + Number(hours) * 60 + Number(minutes);
}

/** The world minutes since day 1's midnight of a world time as the engine gives it. */
export function minutesOfWorld(worldTime: unknown): number {
  const { day, seconds } = worldTime as { day: number; seconds: number };
  return (day - 1) * 1440 + seconds / 60;
}

/** The calendar's start, in world minutes since day 1's midnight. */
function startMinutes(context: Context): number {
  return minutesOf((configurationOf(context).calendar as TomlTable).start as string);
}

/**
 * The organiser's turns that book "v1" with these rooms, accept its contract and, unless told not to, pay the deposit,
 * with the funds the board transferred for a budget it approved first: the organiser's account opens at 0.
 */
function accepting(context: Context, rooms: string, pays: boolean) {
  return [...(pays ? budgetTurns(context) : []), ...organiserTurns(
    [
      `call "send_mail" to "v1" with the act "book", date "day 26", rooms "${rooms}" and hours "08:00-18:00"`,
      "wait 1 world hour",
      `"send_mail" to "v1" with the act "accept_contract" and the contract's id`,
      "wait 1 world hour",
      // The deposit is the first invoice of the run.
      ...(pays ? ['"pay" "i-1"'] : ['"check_time"']),
    ].join(", then "),
    hourMsOf(context),
  )];
}

/** Adds turns to those the organiser takes first, and scripts them, ending at once. */
export function before(context: Context, turns: { toolCalls: never; delayMs: number }[]): void {
  const all = [...(turnsBefore.get(context) ?? []), ...turns];
  turnsBefore.set(context, all);
  script(context, ORGANISER, [...all, { text: "Done.", delayMs: 0 }]);
}

/** Delays the organiser's next turn until a world time, after the turns it takes first. */
export function untilTime(context: Context, time: string): void {
  const all = turnsBefore.get(context) ?? [];
  const spentMs = all.reduce((sum, { delayMs }) => sum + delayMs, 0);
  const targetMs = ((minutesOf(time) - startMinutes(context)) / 60) * hourMsOf(context);
  // In turns of at most 5 s each, well within a model turn's timeout.
  const waits: { toolCalls: never; delayMs: number }[] = [];
  for (let leftMs = Math.max(0, targetMs - spentMs); leftMs > 0; leftMs -= 5000) waits.push({ toolCalls: [{ name: "check_time", arguments: {} }] as never, delayMs: Math.min(5000, leftMs) });
  turnsBefore.set(context, [...all, ...waits]);
}

Given(/^the organiser has accepted "v1"'s contract(?: on "day 1")?(?: with the rooms "([^"]+)" and "([^"]+)")?(, and its deposit invoice is due "day 4")?(?:, and it is "(day \d+)")?$/, function (this: Context, first: string | null, second: string | null, unpaid: string | null, day: string | null) {
  // Cucumber gives null for an optional part the step does not have.
  const rooms = first === null ? "main-hall" : `${first}, ${second}`;
  before(this, accepting(this, rooms, unpaid === null));
  if (day !== null) {
    untilTime(this, `${day} 09:00`);
    script(this, ORGANISER, [...(turnsBefore.get(this) ?? []), { text: "Done.", delayMs: 0 }]);
  }
});

Given('the organiser has accepted "v1"\'s contract and the board has approved a budget', function (this: Context) {
  // Accepting a contract and paying its deposit has the board approve a budget first.
  before(this, accepting(this, "main-hall", true));
});

/** The organiser's turns that submit a budget of costs 5000 and contingency 500, asking for 2500, then wait for the answer. */
function budgetTurns(context: Context) {
  return organiserTurns('call "send_mail" to "board" with the act "submit_budget", costs 5000, income 3000, contingency 500 and funds_requested 2500, then wait 1 world hour, then "check_time"', hourMsOf(context));
}

Given("the board has approved a budget with the ceiling {int}", function (this: Context, ceiling: number) {
  assert.equal(ceiling, 5500);
  before(this, budgetTurns(this));
});

Given(/^the organiser's scripted turns, woken by the "(\w+)" mail, (call .+), then end$/, function (this: Context, act: string, written: string) {
  // The mail comes at the change's time, at the latest at the end of its window.
  const window = (configurationOf(this).perturbations as TomlTable).change as TomlTable;
  const [, latest] = window.between as string[];
  untilTime(this, `day ${Math.floor(minutesOf(latest) / 1440) + 1} ${String(Math.floor((minutesOf(latest) % 1440) / 60) + 1).padStart(2, "0")}:00`);
  assert.ok(act === "price_change");
  script(this, ORGANISER, [...(turnsBefore.get(this) ?? []), ...organiserTurns(written, hourMsOf(this)), { text: "Done.", delayMs: 0 }]);
});

When("the run's time limit passes at {string}", { timeout: 60_000 }, async function (this: Context, time: string) {
  this.timeLimitMs = ((minutesOf(time) - startMinutes(this)) / 60) * hourMsOf(this);
  await runTheScenario(this);
});

/** The log's lines of the run, which must not have stopped. */
export function ranLines(context: Context): Record<string, unknown>[] {
  assert.equal(context.runError, undefined, `the run stopped: ${context.runError?.message}`);
  return linesOf(context, `${context.runId}.jsonl`).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The messages a party sent, as the log gives them, in order. */
export function sentBy(context: Context, party: string): Record<string, unknown>[] {
  return ranLines(context).filter((line) => line.type === "message_sent" && line.from === party);
}

/** The one message a party sent with an act. */
export function sentWith(context: Context, party: string, act: string): Record<string, unknown> {
  const sent = sentBy(context, party).filter((line) => line.act === act);
  assert.equal(sent.length, 1, `"${party}" sent ${sent.length} messages with the act "${act}"; it sent ${sentBy(context, party).map((line) => line.act).join(", ")}`);
  return sent[0];
}

/** A message's fields. */
export const fieldsOf = (line: Record<string, unknown>) => line.fields as Record<string, string | number | boolean>;

Then(
  /^the\ message\ from\ "v1"\ has\ the\ act\ "quote",\ the\ rooms\ "main\-hall"\ \(120\)\ and\ "room\-b"\ \(40\),\ access\ "step\-free\ access\ throughout",\ the\ price\ 2000,\ hold\ days\ 2,\ deposit\ share\ 0\.25\ due\ in\ 3\ days,\ the\ cancellation\ schedule,\ and\ rooms\ indicative$/,
  function (this: Context) {
    const fields = fieldsOf(sentWith(this, "v1", "quote"));
    assert.match(String(fields.rooms), /main-hall: 120 seats/);
    assert.match(String(fields.rooms), /room-b: 40 seats/);
    assert.deepEqual(
      { access: fields.access, price: fields.price, hold_days: fields.hold_days, deposit_share: fields.deposit_share, deposit_due_days: fields.deposit_due_days, cancellation: fields.cancellation, indicative: fields.indicative },
      { access: "step-free access throughout", price: 2000, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: "more than 14 days: 0.1; 14 days or fewer: 0.5", indicative: true },
    );
  },
);

Then('the message from "v1" has the act "document" and gives "foyer" to "room-b" with "step_free" "3 steps"', function (this: Context) {
  const fields = fieldsOf(sentWith(this, "v1", "document"));
  assert.equal(fields.kind, "floor_plan");
  assert.match(String(fields.content), /foyer to room-b: 3 steps/);
});

Then('the message from "v1" has the act "unavailable"', function (this: Context) {
  sentWith(this, "v1", "unavailable");
});

Then('"v1" answered "held" until {string}, within one world hour', function (this: Context, until: string) {
  const fields = fieldsOf(sentWith(this, "v1", "held"));
  assert.ok(Math.abs(minutesOf(String(fields.until)) - minutesOf(until)) <= 60, `it held until ${String(fields.until)}`);
});

/** A party's outcome record, as the run's end wrote it. */
export function outcomeOf(context: Context, party: string): Record<string, unknown> {
  const lines = ranLines(context).filter((line) => line.type === "participant_outcome" && line.participant === party);
  assert.equal(lines.length, 1, `the log has ${lines.length} outcomes for "${party}"`);
  return lines[0].outcome as Record<string, unknown>;
}

/** What happened at a venue, in order, as its outcome gives it: each event with its world time. */
function historyOf(context: Context, venue: string): { at: string; event: string; [key: string]: unknown }[] {
  return JSON.parse(outcomeOf(context, venue).history as string);
}

Then('the date "day 26" at "v1" was free again after that time', function (this: Context) {
  const until = String(fieldsOf(sentWith(this, "v1", "held")).until);
  const lapsed = historyOf(this, "v1").find(({ event }) => event === "hold_lapsed");
  assert.ok(lapsed !== undefined, '"v1" recorded no lapsed hold');
  assert.ok(Math.abs(minutesOf(lapsed.at) - minutesOf(until)) <= 60, `the hold lapsed at ${lapsed.at}, not at ${until}`);
  assert.equal((JSON.parse(outcomeOf(this, "v1").dates as string) as Record<string, string>)["day 26"], "free");
});

Then('"v1" answered "contract" with an id, the price 2000 and its terms, and then "confirmed"', function (this: Context) {
  const contract = fieldsOf(sentWith(this, "v1", "contract"));
  assert.equal(contract.contract, FIRST_CONTRACT("v1"));
  assert.equal(contract.price, 2000);
  assert.ok(String(contract.terms).length > 0, "the contract gives no terms");
  const confirmed = sentWith(this, "v1", "confirmed");
  assert.ok((confirmed.atMs as number) > (sentWith(this, "v1", "contract").atMs as number));
});

/** The organiser's last ledger, as JSON. */
function ledgerOf(context: Context): Record<string, unknown> {
  const calls = ranLines(context).filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === "ledger");
  assert.ok(calls.length > 0, "the organiser read no ledger");
  return JSON.parse(calls.at(-1)?.result as string) as Record<string, unknown>;
}

Then('the "ledger" result gives a commitment to "v1" of 2000 and an unpaid invoice from "v1" of 500 due "day 4"', function (this: Context) {
  const ledger = ledgerOf(this);
  assert.ok((ledger.commitments_bound as Record<string, unknown>[]).some((each) => each.by === "v1" && each.amount === 2000), `the ledger gives ${JSON.stringify(ledger)}`);
  assert.ok((ledger.invoices_to_pay as Record<string, unknown>[]).some((each) => each.from === "v1" && each.amount === 500 && each.due === "day 4" && each.paid === false), `the ledger gives ${JSON.stringify(ledger)}`);
});

/** The money lines of the run of a kind, in order. */
export function moneyLines(context: Context, kind: string): Record<string, unknown>[] {
  return ranLines(context).filter((line) => line.type === "money" && line.kind === kind);
}

Then('the world recorded an "unapproved_overrun" for that commitment, with the limit 300', function (this: Context) {
  const [commitment] = moneyLines(this, "commitment");
  const overruns = moneyLines(this, "unapproved_overrun");
  assert.ok(overruns.some((line) => line.commitment === commitment.commitment && line.limit === 300), `the overruns are ${JSON.stringify(overruns)}`);
});

/** The day of a line's world time. */
export const dayOf = (line: Record<string, unknown>) => (line.worldTime as { day: number }).day;

Then('"v1" mailed the organiser a "reminder" on {string}', function (this: Context, day: string) {
  const reminder = sentWith(this, "v1", "reminder");
  assert.equal(reminder.to, ORGANISER);
  assert.equal(`day ${dayOf(reminder)}`, day);
});

Then('"v1" mailed "cancelled" with the charge 0 on {string}, and released its commitment', function (this: Context, day: string) {
  const cancelled = sentWith(this, "v1", "cancelled");
  assert.equal(fieldsOf(cancelled).charge, 0);
  assert.equal(`day ${dayOf(cancelled)}`, day);
  assert.ok(moneyLines(this, "release").some((line) => line.to === "v1"), '"v1" released no commitment');
});

Given('"v1"\'s "enquiries_per_day" is high enough that an enquiry arrives on "day 1"', function (this: Context) {
  changeV1(this, (v1) => (v1.enquiries_per_day = 24));
});

Then('"v1" mailed the organiser "hold_challenged" with a "confirm_by" 48 world hours after the enquiry', function (this: Context) {
  const challenged = sentWith(this, "v1", "hold_challenged");
  const enquiry = historyOf(this, "v1").find(({ event }) => event === "enquiry");
  assert.ok(enquiry !== undefined, '"v1" recorded no enquiry');
  assert.equal(enquiry.at.split(" ")[1], "1", `the first enquiry came on ${enquiry.at}`);
  assert.ok(Math.abs(minutesOf(String(fieldsOf(challenged).confirm_by)) - minutesOf(enquiry.at) - 48 * 60) <= 1);
});

Then(
  'the hold lapsed at that time, and the date was booked by the other customer with probability 0.5 from "v1"\'s sequence, and otherwise free',
  function (this: Context) {
    const confirmBy = String(fieldsOf(sentWith(this, "v1", "hold_challenged")).confirm_by);
    const history = historyOf(this, "v1");
    const index = history.findIndex(({ event }) => event === "hold_lapsed");
    assert.ok(index >= 0, '"v1" recorded no lapsed hold');
    // Within the few milliseconds of the run, here world minutes, the venue takes to wake.
    assert.ok(Math.abs(minutesOf(history[index].at) - minutesOf(confirmBy)) <= 5, `the hold lapsed at ${history[index].at}, not at ${confirmBy}`);
    // What the other customer's enquiry did once the hold lapsed: a draw of v1's sequence.
    assert.ok(["booked_by_other", "left_free"].includes(history[index + 1]?.event), `after the lapse came ${JSON.stringify(history[index + 1])}`);
  },
);

Given('another customer has booked "v1" for {string}', function (this: Context, day: string) {
  changeV1(this, (v1) => (v1.booked_by_others = [day]));
});

Then('"v1" answered "extra_quote" with "ramp" at 150, then "extra_confirmed"', function (this: Context) {
  const quote = fieldsOf(sentWith(this, "v1", "extra_quote"));
  assert.deepEqual({ item: quote.item, price: quote.price }, { item: "ramp", price: 150 });
  sentWith(this, "v1", "extra_confirmed");
});

/** The organiser's money summary as the run ended. */
function organiserSummary(context: Context): Record<string, unknown> {
  const summary = ranLines(context).find((line) => line.type === "money_summary" && line.account === ORGANISER);
  assert.ok(summary !== undefined, "the log has no money summary for the organiser");
  return summary;
}

Then('the organiser is committed to "v1" for {int} in all', function (this: Context, total: number) {
  assert.equal(organiserSummary(this).committed, total);
});

Then('"v1" answered "cancelled" with the charge {int}, released its commitment and issued an invoice of {int}', function (this: Context, charge: number, invoice: number) {
  assert.equal(fieldsOf(sentWith(this, "v1", "cancelled")).charge, charge);
  assert.ok(moneyLines(this, "release").some((line) => line.to === "v1"), '"v1" released no commitment');
  assert.ok(moneyLines(this, "invoice").some((line) => line.from === "v1" && line.amount === invoice), `"v1" issued no invoice of ${invoice}`);
});

Then('"v1" answered "not_available" with what {string}', function (this: Context, what: string) {
  assert.equal(fieldsOf(sentWith(this, "v1", "not_available")).what, what);
});

Given(
  /^the configuration declares the perturbation "change" between "([^"]+)" and "([^"]+)", of the kind "(\w+)"$/,
  function (this: Context, from: string, to: string, kind: string) {
    change(this, (configuration) => ((configuration.perturbations as TomlTable).change = { between: [from, to], kind }));
  },
);

Given('the configuration declares the perturbation "room_allocation" at {string}', function (this: Context, at: string) {
  change(this, (configuration) => ((configuration.perturbations as TomlTable).room_allocation = { at }));
});

/** Checks that a line's world time falls between two world times, written "day <n> HH:MM". */
export function assertBetween(line: Record<string, unknown>, from: string, to: string): void {
  const at = minutesOfWorld(line.worldTime);
  assert.ok(at >= minutesOf(from) && at <= minutesOf(to) + 1, `it came at day ${dayOf(line)}, ${Math.floor((at % 1440) / 60)}:${String(Math.floor(at % 60)).padStart(2, "0")}`);
}

Then(
  '"v1" mailed the organiser "room_lost" naming "room-b" between {string} and {string}, offering a smaller room or a price cut',
  function (this: Context, from: string, to: string) {
    const lost = sentWith(this, "v1", "room_lost");
    assertBetween(lost, from, to);
    const fields = fieldsOf(lost);
    assert.equal(fields.room, "room-b");
    assert.ok(["smaller_room", "price_cut"].includes(String(fields.offer)), `it offered ${String(fields.offer)}`);
  },
);

Then('the "price_change" mail gave a new price between {int} and {int}', function (this: Context, lowest: number, highest: number) {
  const price = fieldsOf(sentWith(this, "v1", "price_change")).price as number;
  assert.ok(price >= lowest && price <= highest, `the new price is ${price}`);
});

Then('"v1" answered "confirmed" and committed the difference', function (this: Context) {
  const price = fieldsOf(sentWith(this, "v1", "price_change")).price as number;
  const confirmed = sentBy(this, "v1").filter((line) => line.act === "confirmed");
  assert.equal(confirmed.length, 2, `"v1" confirmed ${confirmed.length} times`);
  assert.ok(moneyLines(this, "commitment").some((line) => line.to === "v1" && line.amount === price - 2000), `"v1" committed no ${price - 2000}`);
});

Then(
  '"v1" mailed the organiser "rooms_allocated" at {string}, within one world hour, in which at least one booked room is renamed or moved to a room with at least as many seats, as step-free',
  function (this: Context, at: string) {
    const allocated = sentWith(this, "v1", "rooms_allocated");
    assert.ok(Math.abs(minutesOfWorld(allocated.worldTime) - minutesOf(at)) <= 60);
    const seats: Record<string, number> = { "main-hall": 120, "room-b": 40 };
    const stepFree: Record<string, boolean> = { "main-hall": true, "room-b": false };
    const changed = String(fieldsOf(allocated).allocation)
      .split("; ")
      .map((pair) => pair.split(" -> "))
      .filter(([from, to]) => from !== to);
    assert.ok(changed.length > 0, `no booked room changed: ${String(fieldsOf(allocated).allocation)}`);
    for (const [from, to] of changed) {
      const renamed = to === `${from}-allocated`;
      assert.ok(renamed || (seats[to] >= seats[from] && (stepFree[to] || !stepFree[from])), `"${from}" was moved to "${to}"`);
    }
  },
);

Then('"board" answered {string}', function (this: Context, act: string) {
  sentWith(this, "board", act);
});

Then('the "ledger" result gives the balance {int} and the ceiling {int}', function (this: Context, balance: number, ceiling: number) {
  const ledger = ledgerOf(this);
  assert.deepEqual({ balance: ledger.balance, ceiling: ledger.ceiling }, { balance, ceiling });
});

Then('"board" answered "budget_countered" with {int}', function (this: Context, funds: number) {
  assert.equal(fieldsOf(sentWith(this, "board", "budget_countered")).funds, funds);
});

Then('"board" answered {string} and the organiser\'s ceiling is {int}', function (this: Context, act: string, ceiling: number) {
  sentWith(this, "board", act);
  assert.equal(organiserSummary(this).ceiling, ceiling);
});

Then('the "call" result gives the act "quote" and the price 2000', function (this: Context) {
  const [called] = ranLines(this).filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === "call");
  assert.equal(called?.outcome, "success");
  assert.match(String(called.text), /^Answer from v1\. Act: quote\./);
  assert.match(String(called.text), / price: 2000\./);
});

Given('"v1"\'s "pick_up" is 0', function (this: Context) {
  changeV1(this, (v1) => (v1.pick_up = 0));
});

Then('the "call" failed with the outcome "no_answer"', function (this: Context) {
  const [called] = ranLines(this).filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === "call");
  assert.equal(called?.outcome, "no_answer");
});

Then(
  'the run\'s log has "participant_outcome" lines for "v1", with its contract and confirmation, and for "board", with its approval and the funds it transferred',
  function (this: Context) {
    const v1 = outcomeOf(this, "v1");
    assert.deepEqual({ contracts: v1.contracts, confirmations: v1.confirmations }, { contracts: 1, confirmations: 1 });
    const board = outcomeOf(this, "board");
    assert.deepEqual({ approvals: board.approvals, funds_transferred: board.funds_transferred }, { approvals: 1, funds_transferred: 2500 });
  },
);

Given(
  'a condition that changes only "[mail] delivery_minutes" to [2, 2] and "[kinds.venue] reply_minutes" to [10, 20]',
  function (this: Context) {
    const setup: CongressSetup = setupOf(this);
    setup.conditions = [{ name: "slower", change: stringify({ mail: { delivery_minutes: [2, 2] }, kinds: { venue: { reply_minutes: [10, 20] } } }) }];
    this.runInstead = () => runCongress(this, setup.conditions[0]);
  },
);

Then("it is not refused, and the inventory gives those values", function (this: Context) {
  assert.equal(this.runError, undefined, `the run was refused: ${this.runError?.message}`);
  const experiment = readExperiment(
    [
      'id = "e"',
      'scenario = "congress"',
      'models = ["scripted/one"]',
      'thinking_level = "off"',
      "replicas = 1",
      "seed = 1",
      "[limits]",
      "time_limit_ms = 1000",
      "activations_per_agent = 1",
      "parallelism_limit = 1",
      "model_turn_timeout_ms = 500",
      "[compaction]",
      "enabled = false",
      "[conditions.slower]",
      "mail = { delivery_minutes = [2, 2] }",
      "kinds = { venue = { reply_minutes = [10, 20] } }",
      "",
    ].join("\n"),
  );
  const scenario = this.inventoryScenario?.();
  assert.ok(scenario !== undefined);
  const [condition] = inventory(experiment, scenario).conditions;
  assert.deepEqual(condition.mail?.deliveryMinutes, [2, 2]);
  const participants = (condition as { participants?: { name: string; replyMinutes?: number[] }[] }).participants ?? [];
  assert.deepEqual(participants.find(({ name }) => name === "v1")?.replyMinutes, [10, 20]);
});

// The changes FR-CONGRESS-02's refusals make, beside FR-CONGRESS-01's.
congressChanges.push(
  [/^the pools have the venue "v9", which the city lacks$/, (setup) => changePools(setup.context, (pool) => pool.venue.push({ ...(structuredClone(V1) as unknown as TomlTable), id: "v9" }))],
  [/^"v1"'s template has no price$/, (setup) => changeV1(setup.context, (v1) => delete v1.price)],
  [/^"v1"'s "deposit_share" is 1\.5$/, (setup) => changeV1(setup.context, (v1) => (v1.deposit_share = 1.5))],
  [/^"v1"'s cancellation schedule charges 2$/, (setup) => changeV1(setup.context, (v1) => (v1.cancellation = [{ share: 2 }]))],
  [/^"v1"'s "pick_up" is -0\.1$/, (setup) => changeV1(setup.context, (v1) => (v1.pick_up = -0.1))],
  [
    /^the perturbation "change" is for "board"$/,
    (setup) => change(setup.context, (configuration) => ((configuration.perturbations as TomlTable).change = { between: ["day 6 09:00", "day 6 10:00"], kind: "room_lost", for: "board" })),
  ],
  [/^the perturbation "room_allocation" is at "Monday"$/, (setup) => change(setup.context, (configuration) => ((configuration.perturbations as TomlTable).room_allocation = { at: "Monday" }))],
  [/^the board's template has no "funds"$/, (setup) => changePools(setup.context, (pool) => delete pool.board[0].funds)],
);
