import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, stringify } from "smol-toml";
import type { Context } from "../support/context.ts";
import { change, congressChanges, hourMsOf, organiserTurns, setupOf, turnsBefore } from "./congress.steps.ts";
import { assertBetween, before, changePools, dayOf, fieldsOf, minutesOf, minutesOfWorld, moneyLines, outcomeOf, ranLines, sentBy, sentWith, untilTime } from "./congress-parties.steps.ts";
import { drawing, setUpSpeakersCongress } from "./speakers.steps.ts";
import { runTheScenario, script } from "./tool.steps.ts";

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The caterer of the Background. */
export const C1: TomlTable = {
  id: "c1",
  price_per_head: 30,
  diets: { vegan: {}, gluten_free: { limit: 5 } },
  minimum: 20,
  final_days: 7,
  deposit_share: 0.2,
  deposit_due_days: 3,
  cancellation: [{ share: 0.3 }],
};

/** The sponsors of the Background. */
const SPONSORS: TomlTable[] = [
  { id: "sp1", amount: 1200, conditions: ["logo", "morning_slot"], insists: ["morning_slot"], pay_days: [2, 2] },
  { id: "sp2", amount: 1000, conditions: ["logo", "attendee_list"], insists: [], counter_acceptance: 1, pay_days: [2, 2] },
];

/** The interpreter agency of the Background. */
const A1: TomlTable = { id: "a1", price: 400, notice_days: 7 };

Given(
  "the congress scenario of FR-CONGRESS-04, whose calendar starts at {string} with one segment of scale {int}, so one world hour is {int} milliseconds of the run",
  function (this: Context, start: string, scale: number, hourMs: number) {
    setUpServicesCongress(this, start, scale, hourMs);
  },
);

/** FR-CONGRESS-05's congress: FR-CONGRESS-04's, with the caterer "c1", the sponsors "sp1" and "sp2" and the agency "a1". */
export function setUpServicesCongress(context: Context, start: string, scale: number, hourMs: number): void {
  setUpSpeakersCongress(context, start, scale, hourMs);
  changePools(context, (pool) => {
    pool.caterer = [structuredClone(C1)];
    pool.sponsor = structuredClone(SPONSORS);
    pool.agency = [structuredClone(A1)];
  });
  drawing(context, { caterer: 1, sponsor: 2, agency: 1 });
}

Given('the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1', function (this: Context) {
  change(this, (configuration) => {
    (configuration.mail as TomlTable).delivery_minutes = [1, 1];
    for (const settings of Object.values(configuration.kinds as TomlTable)) {
      delete (settings as TomlTable).hours;
      (settings as TomlTable).reply_minutes = [0, 0];
    }
  });
  changePools(this, (pool) => {
    for (const [kind, templates] of Object.entries(pool)) {
      if (kind === "topics") continue;
      for (const template of templates) {
        delete template.reply_minutes;
        delete template.hours;
        template.pick_up = 1;
      }
    }
  });
});

Given(
  /^the variant has the caterer "c1" \("price_per_head" 30, diets "vegan" with no limit and "gluten_free" with the limit 5, "minimum" 20, "final_days" 7, "deposit_share" 0\.2, "deposit_due_days" 3, cancellation "any time: 0\.3"\)$/,
  function (this: Context) {
    // In C1.
  },
);

Given(
  /^the sponsors "sp1" \(amount 1200, conditions "logo" and "morning_slot", insisting on "morning_slot", "pay_days" \[2, 2\]\) and "sp2" \(amount 1000, conditions "logo" and "attendee_list", insisting on none, "counter_acceptance" 1, "pay_days" \[2, 2\]\)$/,
  function (this: Context) {
    // In SPONSORS.
  },
);

Given('the agency "a1" \\("price" 400, "notice_days" 7\\)', function (this: Context) {
  // In A1.
});

Given('the congress is on {string}, and the organiser\'s account opens at {int}', function (this: Context, day: string, opening: number) {
  change(this, (configuration) => {
    configuration.event_day = Number(/^day (\d+)$/.exec(day)?.[1]);
    (((configuration.money as TomlTable).accounts as TomlTable)[ORGANISER] as TomlTable).opening = opening;
  });
});

Then(
  'the message from "c1" has the act "quote", the price per head 30, the limit 5 for "gluten_free", the minimum 20, the final-numbers date "day 19", the deposit share 0.2 and the cancellation schedule',
  function (this: Context) {
    const fields = fieldsOf(sentWith(this, "c1", "quote"));
    assert.match(String(fields.diets), /gluten_free: 5/);
    assert.match(String(fields.diets), /vegan: no limit/);
    assert.deepEqual(
      { price_per_head: fields.price_per_head, minimum: fields.minimum, final_numbers_by: fields.final_numbers_by, deposit_share: fields.deposit_share, cancellation: fields.cancellation },
      { price_per_head: 30, minimum: 20, final_numbers_by: "day 19", deposit_share: 0.2, cancellation: "0 days or fewer: 0.3" },
    );
  },
);

Then(/^"(c\d+|a\d+|sp\d+)" answered "(\w+)"$/, function (this: Context, party: string, act: string) {
  sentWith(this, party, act);
});

/** The organiser's last result of a tool: a sensor's result, or an effector's text. */
export function resultOf(context: Context, tool: string): { outcome: string; text: string } {
  const calls = ranLines(context).filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === tool);
  assert.ok(calls.length > 0, `the organiser made no "${tool}" call`);
  const last = calls.at(-1) as Record<string, unknown>;
  return { outcome: String(last.outcome), text: String(last.result ?? last.text) };
}

Then('the "ledger" result gives a commitment to "c1" of 1800 and an unpaid invoice of 360 due "day 4"', function (this: Context) {
  const ledger = JSON.parse(resultOf(this, "ledger").text) as Record<string, Record<string, unknown>[]>;
  assert.ok(ledger.commitments_bound.some((each) => each.by === "c1" && each.amount === 1800), `the ledger gives ${JSON.stringify(ledger)}`);
  assert.ok(ledger.invoices_to_pay.some((each) => each.from === "c1" && each.amount === 360 && each.due === "day 4" && each.paid === false), `the ledger gives ${JSON.stringify(ledger)}`);
});

Then('"c1" answered "order_refused" naming "gluten_free"', function (this: Context) {
  assert.equal(fieldsOf(sentWith(this, "c1", "order_refused")).diet, "gluten_free");
});

/** The organiser's turns that order 60 standard meals from "c1" for "day 26", then wait for its answer. */
function ordering(context: Context) {
  return organiserTurns('call "send_mail" to "c1" with the act "order", counts "standard" 60, and date "day 26", then wait 1 world hour, then "check_time"', hourMsOf(context));
}

Given('"c1" has confirmed an order of 60 in all', function (this: Context) {
  before(this, ordering(this));
});

Given("it is {string}", function (this: Context, day: string) {
  untilTime(this, `${day} 09:00`);
  script(this, ORGANISER, [...(turnsBefore.get(this) ?? []), { text: "Done.", delayMs: 0 }]);
});

/** The organiser's money summary as the run ended. */
export function organiserSummary(context: Context): Record<string, unknown> {
  const summary = ranLines(context).find((line) => line.type === "money_summary" && line.account === ORGANISER);
  assert.ok(summary !== undefined, "the log has no money summary for the organiser");
  return summary;
}

Then('"c1" answered {string} and the organiser\'s commitment to "c1" is {int}', function (this: Context, act: string, commitment: number) {
  sentWith(this, "c1", act);
  assert.equal(organiserSummary(this).committed, commitment);
});

Given('"c1" has confirmed an order of 60 in all, and its deposit is paid', function (this: Context) {
  // The deposit is the run's first invoice.
  before(this, [...ordering(this), ...organiserTurns('call "pay" "i-1"', hourMsOf(this))]);
});

Then('"c1" issued an invoice of {int} on {string}', function (this: Context, amount: number, day: string) {
  const invoices = moneyLines(this, "invoice").filter((line) => line.from === "c1" && line.amount === amount);
  assert.equal(invoices.length, 1, `"c1" issued ${invoices.length} invoices of ${amount}`);
  assert.equal(`day ${dayOf(invoices[0])}`, day);
});

Given('the pools have the caterer "c9" with "in_house_for" "v1", and the variant chooses "v1"', function (this: Context) {
  // The draw chooses both venues of the pools, "v1" among them.
  changePools(this, (pool) => pool.caterer.push({ ...structuredClone(C1), id: "c9", in_house_for: "v1" }));
});

Then('"c9" is a participant of the run, besides the caterers the draw chose', function (this: Context) {
  const [variant] = ranLines(this).filter((line) => line.type === "variant");
  const chosen = (variant.chosen as Record<string, string[]>).caterer;
  assert.deepEqual(chosen, ["c1"]);
  const participants = (setupOf(this).loaded?.participants ?? []).map(({ name }) => name);
  for (const caterer of ["c1", "c9"]) assert.ok(participants.includes(caterer), `"${caterer}" is no participant`);
});

Then('"sp1" answered "conditions" with 1200, "logo" and "morning_slot", then "agreement"', function (this: Context) {
  const conditions = sentWith(this, "sp1", "conditions");
  assert.deepEqual({ amount: fieldsOf(conditions).amount, conditions: fieldsOf(conditions).conditions }, { amount: 1200, conditions: "logo, morning_slot" });
  const agreement = sentWith(this, "sp1", "agreement");
  assert.ok((agreement.atMs as number) > (conditions.atMs as number));
});

Then('"sp2" answered "agreement" on {string} and {string}', function (this: Context, first: string, second: string) {
  assert.equal(fieldsOf(sentWith(this, "sp2", "agreement")).conditions, `${first}, ${second}`);
});

/** The organiser's turns that agree with a sponsor on its own conditions, then wait for its answer. */
function agreeing(context: Context, sponsor: string) {
  const conditions = (SPONSORS.find(({ id }) => id === sponsor)?.conditions as string[]).map((condition) => `"${condition}"`).join(" and ");
  return organiserTurns(`call "send_mail" to "${sponsor}" with the act "accept_sponsorship" and conditions ${conditions}, then wait 1 world hour, then "check_time"`, hourMsOf(context));
}

Given(/^"(sp\d+)" has agreed on "(day \d+)"$/, function (this: Context, sponsor: string, day: string) {
  untilTime(this, `${day} 09:00`);
  before(this, agreeing(this, sponsor));
});

Then('"sp1" paid 1200 two days after the invoice landed', function (this: Context) {
  const [invoice] = moneyLines(this, "invoice").filter((line) => line.to === "sp1");
  const payments = moneyLines(this, "payment").filter((line) => line.from === "sp1");
  assert.equal(payments.length, 1, `"sp1" paid ${payments.length} times`);
  assert.equal(payments[0].amount, 1200);
  const after = minutesOfWorld(payments[0].worldTime) - minutesOfWorld(invoice.worldTime);
  // Within the moments of the run its reading and paying take, here a few world minutes.
  assert.ok(Math.abs(after - 2 * 1440) <= 10, `"sp1" paid ${after} world minutes after the invoice landed`);
});

Then("the organiser's balance is {int}", function (this: Context, balance: number) {
  assert.equal(organiserSummary(this).balance, balance);
});

Given(
  'the configuration declares the perturbation "sponsor_withdraws" for {string} between {string} and {string}',
  function (this: Context, sponsor: string, from: string, to: string) {
    change(this, (configuration) => ((configuration.perturbations as TomlTable).sponsor_withdraws = { between: [from, to], for: sponsor }));
  },
);

Then('"sp2" mailed the organiser "withdraw" on "day 10" between "09:00" and "12:00"', function (this: Context) {
  const withdrawn = sentWith(this, "sp2", "withdraw");
  assert.equal(withdrawn.to, ORGANISER);
  assert.equal(dayOf(withdrawn), 10);
  assertBetween(withdrawn, "day 10 09:00", "day 10 12:00");
});

Then('an invoice to "sp2" issued after that is never paid', function (this: Context) {
  const withdrawnAt = minutesOfWorld(sentWith(this, "sp2", "withdraw").worldTime);
  const later = moneyLines(this, "invoice").filter((line) => line.to === "sp2" && minutesOfWorld(line.worldTime) >= withdrawnAt);
  const paid = moneyLines(this, "payment").filter((line) => line.from === "sp2");
  assert.ok(paid.every((payment) => minutesOfWorld(payment.worldTime) < withdrawnAt), `"sp2" paid after it withdrew: ${JSON.stringify(paid)}`);
  assert.ok(later.every((invoice) => !paid.some((payment) => payment.invoice === invoice.invoice)));
});

Then('"sp2" answered "received" and "acknowledged"', function (this: Context) {
  assert.deepEqual(
    sentBy(this, "sp2").map((line) => line.act),
    ["received", "acknowledged"],
  );
});

/** The travel material with the train "t1" from "north" at 08:10, base price 40. */
function travelWithT1(context: Context): void {
  change(context, (configuration) => (configuration.travel = stringify({ stations: ["north"], trains: [{ id: "t1", from: "north", arrives: "08:10", price: 40 }], hotels: [], sold_out_probability: 0 })));
}

Given('the travel material has a train "t1" from "north" arriving at "station" at "08:10" on any day, with the base price 40', function (this: Context) {
  travelWithT1(this);
});

Given('the travel material has a train "t1" from "north" arriving at "station" at "08:10", with the base price 40', function (this: Context) {
  travelWithT1(this);
});

Given(/^the organiser's scripted turns, on "(day \d+)", (call .+), then end$/, function (this: Context, day: string, written: string) {
  untilTime(this, `${day} 09:00`);
  script(this, ORGANISER, [...(turnsBefore.get(this) ?? []), ...organiserTurns(written, hourMsOf(this)), { text: "Done.", delayMs: 0 }]);
});

Then('the train "t1" costs {int}', function (this: Context, price: number) {
  const options = JSON.parse(resultOf(this, "travel_options").text) as { trains: { id: string; price: number }[] };
  assert.equal(options.trains.find(({ id }) => id === "t1")?.price, price);
});

Then('the "ledger" result gives an unpaid invoice from "travel" of 40 for "t1 day 26 s2"', function (this: Context) {
  const ledger = JSON.parse(resultOf(this, "ledger").text) as Record<string, Record<string, unknown>[]>;
  assert.ok(
    ledger.invoices_to_pay.some((each) => each.from === "travel" && each.amount === 40 && each.for === "t1 day 26 s2" && each.paid === false),
    `the ledger gives ${JSON.stringify(ledger)}`,
  );
});

/** The similar congresses of the material: three on the topic "soil", priced 60, 80 and 120. */
const SIMILAR = [
  { topic: "soil", name: "Soil Days", price: 60, size: 80 },
  { topic: "soil", name: "Living Soils", price: 80, size: 120 },
  { topic: "soil", name: "Earth Forum", price: 120, size: 200 },
];

Given("the similar events material has three congresses priced 60, 80 and 120", function (this: Context) {
  change(this, (configuration) => (configuration.similar_events = stringify({ events: [...SIMILAR, { topic: "rivers", name: "River Week", price: 300, size: 50 }] })));
});

Then('the "similar_events" result lists the three, with their prices and sizes', function (this: Context) {
  const listed = JSON.parse(resultOf(this, "similar_events").text) as { name: string; price: number; size: number }[];
  assert.deepEqual(
    listed,
    SIMILAR.map(({ name, price, size }) => ({ name, price, size })),
  );
});

Then("the congress's reference price is {int}", function (this: Context, price: number) {
  const [variant] = ranLines(this).filter((line) => line.type === "variant");
  assert.equal(variant.reference_price, price);
});

Given('"c1" has confirmed an order and "sp1" has agreed and paid', function (this: Context) {
  before(this, [
    ...ordering(this),
    ...agreeing(this, "sp1"),
    ...organiserTurns('call "issue_invoice" to "sp1" for 1200, due "day 10", for "sponsorship", then wait 50 world hours, then "check_time"', hourMsOf(this)),
  ]);
});

Then(
  'the run\'s log has "participant_outcome" lines for "c1", with its order, and for "sp1", with its agreement and payment',
  function (this: Context) {
    const c1 = outcomeOf(this, "c1");
    assert.deepEqual({ order: c1.order, ordered: c1.ordered }, { order: "standard: 60", ordered: 60 });
    const sp1 = outcomeOf(this, "sp1");
    assert.deepEqual({ agreement: sp1.agreement, paid: sp1.paid, withdrew: sp1.withdrew }, { agreement: "logo, morning_slot", paid: 1200, withdrew: false });
  },
);

/** Changes a template of a kind. */
function changeTemplate(context: Context, kind: string, id: string, changing: (template: TomlTable) => void): void {
  changePools(context, (pool) => changing(pool[kind].find((template) => template.id === id) as TomlTable));
}

// The changes FR-CONGRESS-05's refusals make, beside the earlier FRs'.
congressChanges.push(
  [/^"c1"'s "price_per_head" is -1$/, (setup) => changeTemplate(setup.context, "caterer", "c1", (c1) => (c1.price_per_head = -1))],
  [/^"c1"'s "final_days" is 0$/, (setup) => changeTemplate(setup.context, "caterer", "c1", (c1) => (c1.final_days = 0))],
  [/^"sp1" has the condition "free_coffee"$/, (setup) => changeTemplate(setup.context, "sponsor", "sp1", (sp1) => (sp1.conditions = ["logo", "morning_slot", "free_coffee"]))],
  [/^"sp1" insists on "attendee_list", not among its conditions$/, (setup) => changeTemplate(setup.context, "sponsor", "sp1", (sp1) => (sp1.insists = ["attendee_list"]))],
  [/^"sp2"'s "counter_acceptance" is 2$/, (setup) => changeTemplate(setup.context, "sponsor", "sp2", (sp2) => (sp2.counter_acceptance = 2))],
  [/^"sp2"'s "pay_days" is \[5, 2\]$/, (setup) => changeTemplate(setup.context, "sponsor", "sp2", (sp2) => (sp2.pay_days = [5, 2]))],
  [/^"c9" is in house for "v9", no venue in the pools$/, (setup) => changePools(setup.context, (pool) => pool.caterer.push({ ...structuredClone(C1), id: "c9", in_house_for: "v9" }))],
  [
    /^a train leaves from "moon", no station$/,
    (setup) => change(setup.context, (configuration) => (configuration.travel = stringify({ stations: ["north"], trains: [{ id: "t9", from: "moon", arrives: "08:10", price: 40 }], hotels: [] }))),
  ],
  [/^"sponsor_withdraws" is for "c1"$/, (setup) => change(setup.context, (configuration) => ((configuration.perturbations as TomlTable).sponsor_withdraws = { between: ["day 10 09:00", "day 10 12:00"], for: "c1" }))],
);

// FR-CONGRESS-05's addition: charges, hotels, P19 and sponsors' payments.

/** The travel material with the train "t1" (40) from "north" and the hotel "h1" near "v1" with these rooms. */
function travelWith(context: Context, rooms: number): void {
  change(context, (configuration) => (configuration.travel = stringify({ stations: ["north"], trains: [{ id: "t1", from: "north", arrives: "08:10", price: 40 }], hotels: [{ id: "h1", near: "v1", rooms, price: 90 }], sold_out_probability: 0 })));
}

Given('the organiser\'s ceiling is 30 and the train "t1" from "north" costs 40', function (this: Context) {
  travelWith(this, 5);
  // The board approves a budget of costs 20 and contingency 10.
  before(this, organiserTurns('call "send_mail" to "board" with the act "submit_budget", costs 20, income 0, contingency 10 and funds_requested 1, then wait 1 world hour, then "check_time"', hourMsOf(this)));
});

Then('"travel" committed 40 with the organiser, then issued an invoice of 40', function (this: Context) {
  const lines = ranLines(this).filter((line) => line.type === "money");
  const commitment = lines.findIndex((line) => line.kind === "commitment" && line.to === "travel");
  const invoice = lines.findIndex((line) => line.kind === "invoice" && line.from === "travel");
  assert.deepEqual({ from: lines[commitment]?.from, amount: lines[commitment]?.amount }, { from: ORGANISER, amount: 40 });
  assert.equal(lines[invoice]?.amount, 40);
  assert.ok(commitment < invoice, "the invoice came before the commitment");
});

Then('the world recorded an "unapproved_overrun" for that commitment', function (this: Context) {
  const [commitment] = moneyLines(this, "commitment").filter((line) => line.to === "travel");
  assert.ok(moneyLines(this, "unapproved_overrun").some((line) => line.commitment === commitment.commitment && line.limit === 30), `the overruns are ${JSON.stringify(moneyLines(this, "unapproved_overrun"))}`);
});

Given('"c1" has confirmed an order and its cancellation schedule charges 0.3', function (this: Context) {
  // C1's schedule charges 0.3 at any time.
  assert.deepEqual(C1.cancellation, [{ share: 0.3 }]);
  before(this, ordering(this));
});

Then('"c1" released its order\'s commitment, committed the charge and invoiced it', function (this: Context) {
  const [order] = moneyLines(this, "commitment").filter((line) => line.to === "c1" && line.for === "order c1");
  assert.ok(order !== undefined, `"c1" committed no order; it sent ${sentBy(this, "c1").map((line) => line.act).join(", ")}; its commitments: ${JSON.stringify(moneyLines(this, "commitment"))}`);
  assert.ok(moneyLines(this, "release").some((line) => line.commitment === order.commitment), "the order's commitment was not released");
  assert.ok(moneyLines(this, "commitment").some((line) => line.to === "c1" && line.amount === 540 && line.for === "cancellation order c1"), '"c1" committed no charge of 540');
  assert.ok(moneyLines(this, "invoice").some((line) => line.from === "c1" && line.amount === 540), '"c1" invoiced no charge of 540');
});

Given('the travel material has the hotel "h1" near "v1" with {int} rooms', function (this: Context, rooms: number) {
  travelWith(this, rooms);
});

When('the organiser reads "travel_options" for the night of "day 25"', { timeout: 60_000 }, async function (this: Context) {
  script(this, ORGANISER, [...(turnsBefore.get(this) ?? []), ...organiserTurns('call "travel_options" from "north" for "day 26"', hourMsOf(this)), { text: "Done.", delayMs: 0 }]);
  await runTheScenario(this);
});

Then('"h1" has {int} rooms left', function (this: Context, rooms: number) {
  const options = JSON.parse(resultOf(this, "travel_options").text) as { hotels: { id: string; option: string; rooms_left: number }[] };
  const h1 = options.hotels.find(({ id }) => id === "h1");
  assert.deepEqual({ option: h1?.option, rooms: h1?.rooms_left }, { option: "h1 day 25", rooms });
});

Given('the configuration declares "hotel_overbooks" at {string}, and the organiser booked "h1" for "s2" for the night of "day 25"', function (this: Context, at: string) {
  travelWith(this, 5);
  change(this, (configuration) => ((configuration.perturbations as TomlTable).hotel_overbooks = { at }));
  before(this, organiserTurns('call "book_travel" "h1 day 25" for "s2"', hourMsOf(this)));
});

Then('"h1"\'s room for "s2" was cancelled and its commitment released', function (this: Context) {
  const [commitment] = moneyLines(this, "commitment").filter((line) => line.to === "travel" && line.for === "h1 day 25 s2");
  assert.ok(commitment !== undefined, "the room was not committed");
  assert.ok(moneyLines(this, "release").some((line) => line.commitment === commitment.commitment), "its commitment was not released");
  assert.ok(ranLines(this).some((line) => line.type === "component_action" && line.component === "hotel_overbooks" && line.outcome === "success"), "hotel_overbooks cancelled nothing");
});

Then('"s2" called the organiser at {string}, within one world hour, with the act "no_room"', function (this: Context, at: string) {
  const calls = ranLines(this).filter((line) => line.type === "call" && line.from === "s2" && line.to === ORGANISER);
  assert.equal(calls.length, 1, `"s2" called the organiser ${calls.length} times`);
  assert.equal(calls[0].act, "no_room");
  const rang = minutesOfWorld((calls[0].rang as { worldTime: unknown }).worldTime);
  assert.ok(Math.abs(rang - minutesOf(at)) <= 60, `it rang at ${JSON.stringify((calls[0].rang as { worldTime: unknown }).worldTime)}`);
});

Given('"sp1" agreed to 1200', function (this: Context) {
  assert.equal(SPONSORS[0].amount, 1200);
  before(this, agreeing(this, "sp1"));
});

Then('"sp1" mailed "invoice_disputed" with 1200 and paid nothing', function (this: Context) {
  assert.equal(fieldsOf(sentWith(this, "sp1", "invoice_disputed")).amount, 1200);
  assert.deepEqual(moneyLines(this, "payment").filter((line) => line.from === "sp1"), []);
});
