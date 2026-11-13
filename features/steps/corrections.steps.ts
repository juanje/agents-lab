import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import type { TomlTable } from "smol-toml";
import type { Perceived, RuleSet, RuleStep } from "../../src/engine/participants.ts";
import { Random } from "../../src/engine/random.ts";
import type { Context } from "../support/context.ts";
import { change, hourMsOf, organiserTurns } from "./congress.steps.ts";
import { before, changePools, fieldsOf, minutesOfWorld, moneyLines, outcomeOf, ranLines, sentBy, sentWith, untilTime } from "./congress-parties.steps.ts";
import { C1, setUpServicesCongress } from "./services.steps.ts";
import { drawing } from "./speakers.steps.ts";

/** The congress's one agent. */
const ORGANISER = "organiser";

Given(
  "the congress scenario of FR-CONGRESS-05, whose calendar starts at {string} with one segment of scale {int}, so one world hour is {int} milliseconds of the run",
  function (this: Context, start: string, scale: number, hourMs: number) {
    setUpServicesCongress(this, start, scale, hourMs);
  },
);

Given(
  /^the variant has the venues "v1" \(catering "in_house", its in-house caterer "c9"\) and "v2" \(catering "outside_fee", "outside_fee_per_head" 5\), the caterer "c1", the speakers of FR-CONGRESS-04, the partner "p1" and the board$/,
  function (this: Context) {
    changePools(this, (pool) => {
      Object.assign(pool.venue.find(({ id }) => id === "v1") as TomlTable, { catering: "in_house" });
      Object.assign(pool.venue.find(({ id }) => id === "v2") as TomlTable, { catering: "outside_fee", outside_fee_per_head: 5 });
      pool.caterer.push({ ...structuredClone(C1), id: "c9", in_house_for: "v1", pick_up: 1 });
    });
  },
);

/**
 * The organiser's turns that book a venue with these rooms, accept its contract and pay its deposit, the run's first
 * invoice, waiting for each answer: an unpaid deposit would cancel the booking.
 */
function accepting(context: Context, venue: string, rooms: string) {
  return organiserTurns(
    `call "send_mail" to "${venue}" with the act "book", date "day 26", rooms "${rooms}" and hours "08:00-18:00", then wait 1 world hour, then "send_mail" to "${venue}" with the act "accept_contract" and the contract's id, then wait 1 world hour, then "pay" "i-1"`,
    hourMsOf(context),
  );
}

Given('the organiser has accepted "v2"\'s contract', function (this: Context) {
  before(this, accepting(this, "v2", "hall-2"));
});

Given('the organiser has accepted "v1"\'s contract with "main-hall"', function (this: Context) {
  before(this, accepting(this, "v1", "main-hall"));
});

/** The commitments a venue recorded with the organiser, less those it released, in all. */
function committedBy(context: Context, venue: string): number {
  const released = new Set(moneyLines(context, "release").map((line) => line.commitment));
  return moneyLines(context, "commitment")
    .filter((line) => line.to === venue && !released.has(line.commitment))
    .reduce((sum, line) => sum + (line.amount as number), 0);
}

Then('"v2" answered "extra_quote" with 200, then "extra_confirmed" with a permit id, and committed 200', function (this: Context) {
  const quote = fieldsOf(sentWith(this, "v2", "extra_quote"));
  assert.deepEqual({ item: quote.item, price: quote.price }, { item: "outside_catering", price: 200 });
  const confirmed = fieldsOf(sentWith(this, "v2", "extra_confirmed"));
  assert.match(String(confirmed.permit), /^v2-permit-\d+$/);
  assert.ok(moneyLines(this, "commitment").some((line) => line.to === "v2" && line.amount === 200), '"v2" committed no 200');
});

Then('"v1" answered "contract_changed" with the new price, and the commitment follows it', function (this: Context) {
  const changed = fieldsOf(sentWith(this, "v1", "contract_changed"));
  // main-hall 120 and room-b 40 seats: room-b adds 2000 × 40 / 160.
  assert.deepEqual({ rooms: changed.rooms, price: changed.price }, { rooms: "main-hall, room-b", price: 2500 });
  assert.equal(committedBy(this, "v1"), 2500);
});

Then('"v1" answered "extra_quote" for "room-b"', function (this: Context) {
  const quote = fieldsOf(sentWith(this, "v1", "extra_quote"));
  assert.deepEqual({ item: quote.item, room: quote.room, price: quote.price }, { item: "room", room: "room-b", price: 500 });
});

Given('"v1" lost "room-b", offering "room-c" or a cut of 300, and the organiser was committed for 2000', function (this: Context) {
  // room-b's share of the day price is its 30 seats of 200: 300.
  changePools(this, (pool) => {
    Object.assign(pool.venue.find(({ id }) => id === "v1") as TomlTable, {
      rooms: [
        { id: "main-hall", seats: 150, equipment: ["projector"] },
        { id: "room-b", seats: 30, equipment: [] },
        { id: "room-c", seats: 20, equipment: [] },
      ],
    });
  });
  change(this, (configuration) => ((configuration.perturbations as TomlTable).change = { at: "day 1 12:00", kind: "room_lost" }));
  before(this, accepting(this, "v1", "main-hall, room-b"));
  untilTime(this, "day 1 13:00");
});

Then(/^the booking has the rooms (.+) and the commitment is (\d+)$/, function (this: Context, rooms: string, commitment: string) {
  const lost = fieldsOf(sentWith(this, "v1", "room_lost"));
  assert.deepEqual({ room: lost.room, smaller: lost.smaller, cut: lost.cut }, { room: "room-b", smaller: "room-c", cut: 300 });
  const expected = [...rooms.matchAll(/"([^"]+)"/g)].map(([, room]) => room).join(", ");
  const confirmed = sentBy(this, "v1").filter((line) => line.act === "confirmed").at(-1) as Record<string, unknown>;
  assert.equal(fieldsOf(confirmed).rooms, expected);
  assert.equal(committedBy(this, "v1"), Number(commitment));
});

Then('"board" answered "refused" with the reason "no_budget"', function (this: Context) {
  assert.equal(fieldsOf(sentWith(this, "board", "refused")).reason, "no_budget");
});

Given(
  '"s6" is local, available, "acceptance" 1, the constraint "morning" and the condition "fee" with "fee" 300',
  function (this: Context) {
    changePools(this, (pool) => pool.speaker.push({ id: "s6", title: "Soil law", draw: 1, fee: 300, home: "local", available: true, acceptance: 1, constraint: "morning", condition: "fee", pick_up: 1 }));
    drawing(this, { speaker: 6 });
  },
);

Given('the configuration declares "early_cancel" between {string} and {string}, and only "p1" has been confirmed by then', function (this: Context, from: string, to: string) {
  change(this, (configuration) => ((configuration.perturbations as TomlTable).early_cancel = { between: [from, to] }));
  before(this, organiserTurns('call "send_mail" to "p1" with the act "confirm", time "11:00", room "main-hall", length 45 and travel "none", then wait 1 world hour, then "check_time"', hourMsOf(this)));
});

Then('"p1" did not cancel', function (this: Context) {
  sentWith(this, "p1", "acknowledged");
  assert.ok(!sentBy(this, "p1").some((line) => line.act === "cancel"), '"p1" mailed "cancel"');
  assert.ok(!ranLines(this).some((line) => line.type === "call" && line.from === "p1"), '"p1" called');
  assert.ok(!ranLines(this).some((line) => line.type === "stimulus" && line.agent === "p1" && line.channel === "early_cancel"), "the illness reached p1");
});

Then('"s1" answered "not_available" with what "acceptance", believes nothing about its session and committed nothing', function (this: Context) {
  assert.equal(fieldsOf(sentWith(this, "s1", "not_available")).what, "acceptance");
  const outcome = outcomeOf(this, "s1");
  assert.deepEqual({ time: outcome.believes_time, room: outcome.believes_room }, { time: "none", room: "none" });
  assert.ok(!moneyLines(this, "commitment").some((line) => line.to === "s1"), '"s1" committed');
});

Given('"s5" answered "accept_if" with the condition "fee" to an invitation with fee 100, and the organiser sent "accept_condition" with fee 300', function (this: Context) {
  before(
    this,
    organiserTurns(
      'call "send_mail" to "s5" with the act "invite", session 2, time "10:00", fee 100 and travel_paid false, then wait 1 world hour, then "send_mail" to "s5" with the act "accept_condition" and fee 300, then wait 1 world hour, then "check_time"',
      hourMsOf(this),
    ),
  );
});

Then('"s5" committed 300, its template\'s fee', function (this: Context) {
  assert.equal(fieldsOf(sentWith(this, "s5", "accept_if")).condition, "fee");
  const commitments = moneyLines(this, "commitment").filter((line) => line.to === "s5");
  assert.deepEqual(
    commitments.map(({ amount }) => amount),
    [300],
  );
});

Given('"v1"\'s "pick_up" is 0 for the first call and 1 afterwards, and its sequence draws a call back', function (this: Context) {
  // With pick_up 0.5, a seed whose "rules of v1" draws above it for the ring, then below 0.5 for the call back.
  changePools(this, (pool) => Object.assign(pool.venue.find(({ id }) => id === "v1") as TomlTable, { pick_up: 0.5 }));
  for (let seed = 1; seed < 1000; seed += 1) {
    const random = Random.derive(seed, "rules of v1");
    if (random.next() >= 0.5 && random.next() < 0.5) {
      this.seed = seed;
      return;
    }
  }
  assert.fail("no seed below 1000 has v1 miss the ring and call back");
});

Then('"v1" called the organiser back within its reply delay with the act "missed_call"', function (this: Context) {
  const calls = ranLines(this).filter((line) => line.type === "call");
  const missed = calls.find((line) => line.from === ORGANISER && line.to === "v1");
  assert.equal(missed?.outcome, "no_answer");
  const back = calls.find((line) => line.from === "v1" && line.to === ORGANISER);
  assert.ok(back !== undefined, '"v1" did not call back');
  assert.equal(back.act, "missed_call");
  // Its reply delay is none: it calls back as the missed ring ends, within the moments the run takes.
  const after = minutesOfWorld((back.rang as { worldTime: unknown }).worldTime) - minutesOfWorld((missed.ended as { worldTime: unknown }).worldTime);
  assert.ok(after >= 0 && after <= 30, `"v1" called back ${after} world minutes after the missed ring ended`);
});

/** "caller", the rule set of a party that calls the party its params name as the run starts, and does nothing more. */
const caller: RuleSet = {
  start: (params) => {
    let called = false;
    return {
      atStart: (): RuleStep => {
        called = true;
        return { kind: "call", tool: "call", arguments: { to: params.to as string, act: "ask_quote", fields: { date: "day 26", attendance: 10 } } };
      },
      next: (_perceived: Perceived): RuleStep => ({ kind: "end" }),
      outcome: () => ({ called }),
    };
  },
};

Given('"ben" is on a call with "v1"', function (this: Context) {
  this.libraryScenario = { ...this.libraryScenario, ruleSets: { ...this.libraryScenario.ruleSets, caller } };
  change(this, (configuration) => {
    (configuration.participants ??= {}) as TomlTable;
    (configuration.participants as TomlTable).ben = { decides: "rules", rules: "caller", tools: ["call", "answer_call"], channels: ["phone"], params: { to: "v1" } };
    const phone = configuration.phone as TomlTable;
    phone.lines = [...(phone.lines as string[]), "ben"];
    // v1 answers ben at once, and their call lasts two world hours.
    phone.call_minutes = 120;
  });
});

/** The organiser's one call of a tool, as the log gives it. */
function organiserCall(context: Context, tool: string): Record<string, unknown> {
  const calls = ranLines(context).filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === tool);
  assert.equal(calls.length, 1, `the organiser made ${calls.length} "${tool}" calls`);
  return calls[0];
}

/** A tool call's duration in world minutes, by the congress's calendar. */
function worldMinutesOf(context: Context, call: Record<string, unknown>): number {
  return (((call.endedAtMs as number) - (call.startedAtMs as number)) / hourMsOf(context)) * 60;
}

Then('the organiser\'s "call" failed with the outcome "busy" after 1 world minute, within 30 world minutes', function (this: Context) {
  const call = organiserCall(this, "call");
  assert.equal(call.outcome, "busy");
  assert.ok(Math.abs(worldMinutesOf(this, call) - 1) <= 30, `it took ${worldMinutesOf(this, call)} world minutes`);
  // Ben's call was connected when the organiser's was placed.
  assert.ok(ranLines(this).some((line) => line.type === "call" && line.from === "ben" && line.outcome === "answered"), "ben's call was not answered");
});

Given('the organiser starts in "v1-entrance", "[durations] ledger" is 3 and the configuration\'s "away_factor" is {float}', function (this: Context, awayFactor: number) {
  change(this, (configuration) => {
    configuration.organiser_place = "v1-entrance";
    (configuration.durations as TomlTable).ledger = 3;
    configuration.away_factor = awayFactor;
  });
});

Then('the "ledger" call took 4.5 world minutes, within 30 world minutes', function (this: Context) {
  const call = organiserCall(this, "ledger");
  assert.ok(Math.abs(worldMinutesOf(this, call) - 4.5) <= 30, `it took ${worldMinutesOf(this, call)} world minutes`);
});
