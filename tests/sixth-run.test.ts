import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { effortMoney } from "../src/engine/parts.ts";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { catererRules, speakerRules, venueRules } from "../src/scenarios/congress-parties.ts";
import * as parts from "../src/scenarios/congress-parts.ts";
import { type Congress, congressScenario } from "../src/scenarios/congress.ts";
import { type ToolAnswer, calls, conversation, drive, notice, tools, venueChange } from "./fixtures/rules.ts";

// FR-CONGRESS-17: the corrections from E1's sixth technical run.

const { congressParts, bookingsOf } = parts;

/** The parts' confirmed speakers, which the parts give from FR-CONGRESS-17 on. */
const confirmedOf = (state: Congress) => {
  const given = (parts as Record<string, unknown>).confirmedOf as ((state: Congress) => string[]) | undefined;
  if (given === undefined) throw new Error("the parts give no confirmedOf");
  return given(state);
};

/** The acts of the mail a rule set sent, in order. */
const mailed = (steps: ReturnType<typeof drive>) => calls(steps, "send_mail").map(({ act }) => act);

/** A venue of three rooms, "hall-a" (90 seats), "hall-b" (90) and "room-c" (30), at 2000 a day, whose mail is delivered in 1 world minute. */
const venue = (more: Record<string, unknown> = {}) => ({
  id: "v1",
  rooms: [{ id: "hall-a", seats: 90 }, { id: "hall-b", seats: 90 }, { id: "room-c", seats: 30 }],
  access_claim: "step-free",
  catering: "outside_free",
  price: 2000,
  extras: {},
  hold_days: 2,
  deposit_share: 0.25,
  deposit_due_days: 3,
  cancellation: [{ share: 0.5 }],
  pick_up: 1,
  organiser: "organiser",
  event_day: 26,
  floor_plan: [],
  perturbations: [],
  mail_delivery_minutes: [1, 1],
  ...more,
});

/** Its ledger once the organiser accepted "v1-contract-1": the contract's commitment and its deposit invoice. */
const ledger = () => ({ commitments_recorded: [{ id: "k-1", for: "v1-contract-1" }], invoices_issued: [{ id: "i-1", for: "deposit v1-contract-1", paid: true }] });

/** A venue whose contract for these rooms the organiser accepted, and which announced a change of a kind at "day 1 12:00". */
function changed(kind: string, rooms: string) {
  const rules = venueRules.start(venue(), new Random(1));
  conversation(
    rules,
    [
      ["day 1 Monday 09:01", `From: organiser. Act: book. date: day 26. rooms: ${rooms}. hours: 08:00-18:00.`],
      ["day 1 Monday 09:02", "From: organiser. Act: accept_contract. contract: v1-contract-1."],
    ],
    ledger,
  );
  const announced = drive(rules, tools(() => "", () => "day 1 Monday 12:00", ledger), [[venueChange(kind)]], true);
  const answer = (time: string, message: string) => drive(rules, tools(() => message, () => time, ledger), [[notice]], true);
  const at = (time: string) => drive(rules, tools(() => "", () => time, ledger), [[]], true);
  return { announced, answer, at };
}

describe("a one-room booking can lose its room (FR-CONGRESS-17)", () => {
  it("offers its largest free room with fewer seats, smaller_room only, and no price cut", () => {
    const [announced] = calls(changed("room_lost", "hall-a").announced, "send_mail");
    expect(announced).toEqual({ to: "organiser", act: "room_lost", fields: { contract: "v1-contract-1", room: "hall-a", offer: "smaller_room", smaller: "room-c", answer_by: "day 4 Thursday 12:01" } });
  });

  it("raises the price instead when it has no free room with fewer seats", () => {
    expect(mailed(changed("room_lost", "room-c").announced)).toEqual(["price_change"]);
  });

  it("answers accept_change with the option price_cut not_available, and keeps the change pending", () => {
    const venueOf = changed("room_lost", "hall-a");
    expect(mailed(venueOf.announced)).toEqual(["room_lost"]);
    expect(calls(venueOf.answer("day 2 Tuesday 10:00", "From: organiser. Act: accept_change. option: price_cut."), "send_mail")).toEqual([{ to: "organiser", act: "not_available", fields: { what: "price_cut" } }]);
    expect(mailed(venueOf.answer("day 2 Tuesday 11:00", "From: organiser. Act: change_booking. rooms: hall-a. hours: 08:00-18:00."))).toEqual(["change_pending"]);
  });

  it("moves the booking to the smaller room at the same price when the change is unanswered, mailing change_applied with the lost and the smaller room", () => {
    const lapsed = changed("room_lost", "hall-a").at("day 4 Thursday 12:01");
    expect(calls(lapsed, "send_mail")).toEqual([{ to: "organiser", act: "change_applied", fields: { contract: "v1-contract-1", room: "hall-a", smaller: "room-c" } }]);
    expect([...calls(lapsed, "commit"), ...calls(lapsed, "release")]).toEqual([]);
  });
});

/** An in-house venue whose caterer serves "gluten_free" with the limit 5 and "vegetarian" with none, with the organiser's confirmed booking. */
function inHouse(more: Record<string, unknown> = {}) {
  const rules = venueRules.start(venue({ id: "v2", catering: "in_house", outside_diet_fee_per_head: 5, in_house_diets: { gluten_free: { limit: 5 }, vegetarian: {} }, ...more }), new Random(1));
  const v2Ledger = () => ({ commitments_recorded: [{ id: "k-1", for: "v2-contract-1" }] });
  conversation(
    rules,
    [
      ["day 1 Monday 09:01", "From: organiser. Act: book. date: day 26. rooms: hall-a. hours: 08:00-18:00."],
      ["day 1 Monday 09:02", "From: organiser. Act: accept_contract. contract: v2-contract-1."],
    ],
    v2Ledger,
  );
  return (message: string) => drive(rules, tools(() => message, () => "day 2 Tuesday 10:00", v2Ledger), [[notice]], true);
}

describe("outside diet meals at a venue with its own caterer (FR-CONGRESS-17)", () => {
  it("quotes outside catering at outside_diet_fee_per_head × attendance for a diet its caterer serves with a limit or does not serve", () => {
    for (const diet of ["gluten_free", "vegan"]) {
      const steps = inHouse()(`From: organiser. Act: request_extra. item: outside_catering. attendance: 8. diet: ${diet}.`);
      expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "extra_quote", fields: { item: "outside_catering", price: 40 } }]);
    }
  });

  it("quotes 0 when the venue gives no fee", () => {
    const steps = inHouse({ outside_diet_fee_per_head: undefined })("From: organiser. Act: request_extra. item: outside_catering. attendance: 8. diet: gluten_free.");
    expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "extra_quote", fields: { item: "outside_catering", price: 0 } }]);
  });

  it("answers not_available for a diet its caterer serves with no limit, or with no diet", () => {
    for (const diet of [" diet: vegetarian.", ""]) {
      const steps = inHouse()(`From: organiser. Act: request_extra. item: outside_catering. attendance: 8.${diet}`);
      expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "not_available", fields: { what: "outside_catering" } }]);
    }
  });

  it("confirms the extra with a permit that carries the diet and the attendance, and commits the fee", () => {
    const answer = inHouse();
    answer("From: organiser. Act: request_extra. item: outside_catering. attendance: 8. diet: gluten_free.");
    const steps = answer("From: organiser. Act: accept_extra. item: outside_catering.");
    expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "extra_confirmed", fields: { item: "outside_catering", price: 40, permit: "v2-permit-1", diet: "gluten_free", attendance: 8 } }]);
    expect(calls(steps, "commit")).toEqual([{ with: "organiser", amount: 40, for: "v2-contract-1 extra outside_catering" }]);
  });
});

const DAY = "day 1 Monday 09:01";

/** A caterer that serves "gluten_free" with no limit, knowing "v1" as outside_free and "v2" as in_house. */
const caterer = (more: Record<string, unknown> = {}) =>
  catererRules.start(
    { id: "c1", price_per_head: 30, diets: { gluten_free: {} }, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }], organiser: "organiser", event_day: 26, venues: { v1: { catering: "outside_free" }, v2: { catering: "in_house" } }, ...more },
    new Random(1),
  );

/** Its tools, with read_permit giving "v2-permit-1" for 8 gluten-free meals at "v2". */
const withPermit =
  (message: string): ToolAnswer =>
  (tool, args) =>
    tool === "read_permit"
      ? { text: args.permit === "v2-permit-1" ? JSON.stringify({ permit: "v2-permit-1", venue: "v2", diet: "gluten_free", attendance: 8 }) : "No such permit." }
      : tools(() => message, () => DAY)(tool, args);

/** A caterer's answer to one message, read with its tools. */
function answered(rules: ReturnType<typeof caterer>, message: string) {
  drive(rules, withPermit(""));
  return drive(rules, withPermit(message), [[notice]], true);
}

describe("a diet permit covers only its diet and its attendance (FR-CONGRESS-17)", () => {
  const order = (counts: string) => `From: organiser. Act: order. counts: ${counts}. date: day 26. venue: v2. permit: v2-permit-1.`;

  it("reads the permit an order gives, and confirms an order within its diet and attendance", () => {
    const steps = answered(caterer(), order("gluten_free: 8"));
    expect(calls(steps, "read_permit")).toEqual([{ permit: "v2-permit-1" }]);
    expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "order_confirmed", fields: { total: 8, price: 240 } }]);
  });

  it("refuses an order with more meals than the attendance, or meals of another kind, with the reason permit_exceeded", () => {
    for (const counts of ["gluten_free: 9", "gluten_free: 6; standard: 2"]) {
      expect(calls(answered(caterer(), order(counts)), "send_mail")).toEqual([{ to: "organiser", act: "order_refused", fields: { reason: "permit_exceeded" } }]);
    }
  });

  it("takes an order under a permit it cannot read as before", () => {
    const steps = answered(caterer(), "From: organiser. Act: order. counts: gluten_free: 40. date: day 26. venue: v2. permit: v2-permit-7.");
    expect(mailed(steps)).toEqual(["order_confirmed"]);
  });
});

describe("an in-house caterer serves only its venue (FR-CONGRESS-17)", () => {
  it("refuses an order that names another venue, with the reason own_venue_only and its venue", () => {
    const rules = caterer({ id: "c2", in_house_for: "v2" });
    const { steps } = conversation(rules, [[DAY, "From: organiser. Act: order. counts: standard: 40. date: day 26. venue: v1."]]);
    expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "order_refused", fields: { reason: "own_venue_only", venue: "v2" } }]);
  });
});

/** The congress with the venue "v1" given these pool fields. */
function congress(v1: Record<string, unknown>): Scenario<unknown> {
  const configuration = parse(congressScenario.baseConfiguration);
  configuration.city = stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "hall", seats: 100 }] }], passages: [{ between: ["office", "v1-entrance"], length: 10, step_free: true }] });
  (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
  const template = { id: "v1", rooms: [{ id: "hall", seats: 100 }], access_claim: "step-free", catering: "in_house", price: 2000, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }], ...v1 };
  configuration.pools = stringify({ topics: ["soil"], venue: [template], board: [], speaker: [], partner: [], caterer: [{ id: "c2", in_house_for: "v1", price_per_head: 25, diets: { gluten_free: { limit: 5 } }, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }] }], sponsor: [], agency: [] });
  configuration.draw = stringify({ attendance: [50, 50], venue: 1 });
  return { ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) };
}

describe("a venue's outside_diet_fee_per_head (FR-CONGRESS-17)", () => {
  it("is refused when negative, naming it", () => {
    expect(() => loadScenario(congress({ outside_diet_fee_per_head: -1 }), 1)).toThrow(/outside_diet_fee_per_head/);
  });

  it("is given to the venue with its in-house caterer's diets", () => {
    const loaded = loadScenario(congress({ outside_diet_fee_per_head: 5 }), 1);
    const params = ((loaded.configuration.participants as TomlTable).v1 as TomlTable).params as TomlTable;
    expect([params.outside_diet_fee_per_head, params.in_house_diets]).toEqual([5, { gluten_free: { limit: 5 } }]);
  });
});

describe("read_permit (FR-CONGRESS-17)", () => {
  const readPermit = congressScenario.tools.find(({ name }) => name === "read_permit") as { kind: string; sense: (state: unknown, agent: string, args: Record<string, unknown>, ms: number) => string } | undefined;

  it("gives the diet and the attendance a venue's permit carries, from the venue's extra_confirmed", () => {
    expect(readPermit?.kind).toBe("sensor");
    const received = { day: 2, weekday: "Tuesday", seconds: 0 };
    const state = { mail: { mailboxes: { organiser: [{ id: "m-3", from: "v2", to: "organiser", act: "extra_confirmed", fields: { item: "outside_catering", price: 40, permit: "v2-permit-1", diet: "gluten_free", attendance: 8 }, subject: "extra_confirmed", received, read: true }] }, inTransit: [] } };
    expect(JSON.parse(readPermit?.sense(state, "c1", { permit: "v2-permit-1" }, 0) ?? "{}")).toEqual({ permit: "v2-permit-1", venue: "v2", diet: "gluten_free", attendance: 8 });
    expect(readPermit?.sense(state, "c1", { permit: "v2-permit-2" }, 0)).toBe("No such permit.");
  });
});

/** A speaker with a hotel room the night before the event, its tools answering nothing but the time. */
function speakerOut(messages: [string, string][]) {
  const rules = speakerRules.start({ id: "s2", title: "Soil water", fee: 0, home: "local", available: true, acceptance: 1, accepts: true, pick_up: 1, organiser: "organiser", event_day: 26 }, new Random(1));
  conversation(rules, messages);
  return drive(rules, tools(() => "", () => "day 25 Thursday 21:00"), [[{ channel: "hotel_overbooks", source: "the hotel", content: "Your hotel room is cancelled." }]], true);
}

describe("a speaker who is out does not phone about its hotel (FR-CONGRESS-17)", () => {
  const invited = (session: number): [string, string] => ["day 2 Tuesday 09:01", `From: organiser. Act: invite. session: ${session}. time: 10:30. fee: 0. travel_paid: false.`];

  it("phones when it is in", () => {
    expect(calls(speakerOut([invited(2)]), "call")).toEqual([{ to: "organiser", act: "no_room" }]);
  });

  it("does not phone once it cancelled, had its invitation withdrawn, or withdrew from every session", () => {
    const ill = (() => {
      const rules = speakerRules.start({ id: "s2", title: "Soil water", fee: 0, home: "local", available: true, acceptance: 1, pick_up: 1, organiser: "organiser", event_day: 26 }, new Random(1));
      conversation(rules, [invited(2)]);
      drive(rules, tools(() => "", () => "day 10 Wednesday 09:00"), [[{ channel: "early_cancel", source: "illness", content: "You are ill." }]], true);
      return drive(rules, tools(() => "", () => "day 25 Thursday 21:00"), [[{ channel: "hotel_overbooks", source: "the hotel", content: "Your hotel room is cancelled." }]], true);
    })();
    expect(calls(ill, "call")).toEqual([]);
    expect(calls(speakerOut([invited(2), ["day 3 Wednesday 09:01", "From: organiser. Act: withdraw_invitation."]]), "call")).toEqual([]);
    const conditional = speakerRules.start({ id: "s2", title: "Soil water", fee: 300, condition: "fee", home: "local", available: true, acceptance: 1, accepts: true, pick_up: 1, organiser: "organiser", event_day: 26 }, new Random(1));
    conversation(conditional, [invited(2)]);
    // Its condition unmet by day 19, it withdraws from its only session.
    expect(mailed(drive(conditional, tools(() => "", () => "day 19 Friday 00:00"), [[]], true))).toEqual(["withdraw"]);
    expect(calls(drive(conditional, tools(() => "", () => "day 25 Thursday 21:00"), [[{ channel: "hotel_overbooks", source: "the hotel", content: "Your hotel room is cancelled." }]], true), "call")).toEqual([]);
  });
});

/** A mail the world records, delivered on a day. */
type Recorded = { from: string; to: string; act: string; fields: Record<string, string | number | boolean>; day: number };

/** An empty congress world with the venue "v1"'s rooms "hall-a", "hall-b" and "room-c", and the records given. */
function world(acts: Recorded[], more: Partial<Congress> = {}): Congress {
  const mailboxes: Record<string, unknown[]> = {};
  acts.forEach(({ from, to, act, fields, day }, index) => {
    mailboxes[to] = [...(mailboxes[to] ?? []), { id: `m-${index + 1}`, from, to, act, fields, subject: act, received: { day, weekday: "Monday", seconds: index * 60 }, read: true }];
  });
  return {
    rooms: { "hall-a": { venue: "v1", seats: 90 }, "hall-b": { venue: "v1", seats: 90 }, "room-c": { venue: "v1", seats: 30 } },
    venues: { v1: { entrance: "v1-entrance", hours: "always" } },
    passages: [],
    mail: { mailboxes, inTransit: [] },
    phone: { calls: [] },
    money: { balances: {}, invoices: [], commitments: [], ceilings: {}, overruns: [], events: [] },
    travel: { material: { stations: [], trains: [], hotels: [{ id: "h1", near: "v1", rooms: 5, price: 90 }], sold_out_probability: 0 }, soldOutDraws: {}, booked: [] },
    population: { material: {}, eventDay: 26, referencePrice: 35, draws: {}, people: [], page: { open: true, price: 50, required_fields: [], info: [], waiting_list: false }, announced: true, promotions: [], programme: [], sponsorData: {}, events: [], announcements: [], edits: [] },
    perturbations: [],
    visits: [],
    context: { eventDay: 26, helpers: 2, target: 50, endOfPreparation: 25 * 1440 + 390, roles: {}, noShowCut: 0.05, discretionaryLimit: 300, homes: {}, catering: {} },
    ...more,
  } as unknown as Congress;
}

const contract = (rooms: string): Recorded[] => [
  { from: "v1", to: "organiser", act: "contract", fields: { contract: "v1-contract-1", date: "day 26", rooms, hours: "08:00-18:00", price: 2000 }, day: 2 },
  { from: "v1", to: "organiser", act: "confirmed", fields: { contract: "v1-contract-1" }, day: 3 },
];

describe("the parts read what the venues and speakers settled (FR-CONGRESS-17)", () => {
  it("take a room lost by change_applied out of its booking, and put the smaller room it names in", () => {
    const cut = world([...contract("hall-a, hall-b"), { from: "v1", to: "organiser", act: "change_applied", fields: { contract: "v1-contract-1", room: "hall-b", cut: 800 }, day: 11 }]);
    expect(bookingsOf(cut)[0].rooms).toEqual(["hall-a"]);
    const moved = world([...contract("hall-a"), { from: "v1", to: "organiser", act: "change_applied", fields: { contract: "v1-contract-1", room: "hall-a", smaller: "room-c" }, day: 11 }]);
    expect(bookingsOf(moved)[0].rooms).toEqual(["room-c"]);
  });

  it("confirm a speaker who accepted a session and acknowledged a change naming a time and a room", () => {
    const state = world([
      { from: "organiser", to: "s1", act: "invite", fields: { session: 5, time: "15:00", fee: 0, travel_paid: false }, day: 3 },
      { from: "s1", to: "organiser", act: "accept", fields: { session: 5 }, day: 4 },
      { from: "organiser", to: "s1", act: "change", fields: { time: "14:00", room: "hall-a" }, day: 16 },
      { from: "s1", to: "organiser", act: "acknowledged", fields: {}, day: 16 },
    ]);
    expect(confirmedOf(state)).toEqual(["s1"]);
  });

  it("subtract a release from a part's effort money only when the commitment it releases is counted in the same window", () => {
    const money = [
      { event: { kind: "commitment", from: "organiser", to: "v1", amount: 3000, commitment: "k-1" }, at: 3 * 1440 },
      { event: { kind: "release", from: "organiser", to: "v1", amount: 3000, commitment: "k-1" }, at: 7 * 1440 },
    ];
    expect(effortMoney(money, ["organiser"], ["v1"], 5 * 1440, 25 * 1440)).toBe(0);
    expect(effortMoney(money, ["organiser"], ["v1"], 0, 25 * 1440)).toBe(0);
    expect(effortMoney(money, ["organiser"], ["v1"], 0, 5 * 1440)).toBe(3000);
  });

  it("P19 leaves out a speaker who is out", () => {
    const state = world([{ from: "s2", to: "organiser", act: "cancel", fields: {}, day: 10 }], { perturbations: [{ name: "hotel_overbooks", target: "s2", at: 24 * 1440 + 1260 }] });
    expect(congressParts.predicates.P19(state, {})).toBe(true);
  });

  it("P19 leaves out a speaker who withdrew from every session it was invited to, and not one who accepted another", () => {
    const hit = { perturbations: [{ name: "hotel_overbooks", target: "s2", at: 24 * 1440 + 1260 }] };
    const invited = (session: number, answer: string): Recorded[] => [
      { from: "organiser", to: "s2", act: "invite", fields: { session, time: "10:30", fee: 0, travel_paid: false }, day: 3 },
      { from: "s2", to: "organiser", act: answer, fields: answer === "withdraw" ? { sessions: String(session) } : { session }, day: 4 },
    ];
    expect(congressParts.predicates.P19(world(invited(2, "withdraw"), hit), {})).toBe(true);
    expect(congressParts.predicates.P19(world([...invited(2, "withdraw"), ...invited(4, "accept")], hit), {})).toBe(false);
  });
});

/** The partner "p1" in session 3, confirmed and acknowledged, in a programme of six sessions whose fifth speaker is not confirmed. */
function partnerWorld(more: Recorded[] = []): Congress {
  const times = ["09:30", "10:30", "11:30", "14:00", "15:00", "16:00"];
  const speakers = ["s1", "s3", "p1", "s4", "s5", "s6"];
  const acts: Recorded[] = [
    { from: "association", to: "organiser", act: "partner_session", fields: { speaker: "p1", session: 3 }, day: 1 },
    ...speakers.flatMap((speaker, index): Recorded[] =>
      speaker === "s5"
        ? []
        : [
            ...(speaker === "p1" ? [] : [{ from: "organiser", to: speaker, act: "invite", fields: { session: index + 1, time: times[index], fee: 0, travel_paid: false }, day: 3 }, { from: speaker, to: "organiser", act: "accept", fields: { session: index + 1 }, day: 4 }]),
            { from: "organiser", to: speaker, act: "confirm", fields: { time: times[index], room: "hall-a", length: 45, travel: "none" }, day: 5 },
            { from: speaker, to: "organiser", act: "acknowledged", fields: {}, day: 5 },
          ],
    ),
    ...more,
  ];
  const state = world(acts);
  const sessions = speakers.map((speaker, index) => ({ start: times[index], end: times[index], title: speaker, speakers: [speaker], room: "hall-a" }));
  (state.population as NonNullable<Congress["population"]>).programme = [{ version: 1, sessions, breaks: [], sponsor_slots: [], logos: [], published: 11 * 1440 }];
  return state;
}

describe("P20 tests the partner's session and broken agreements (FR-CONGRESS-17)", () => {
  it("holds with the partner confirmed and no agreement broken, whatever the other sessions", () => {
    expect(congressParts.predicates.P20(partnerWorld(), {})).toBe(true);
  });

  it("counts a repeated invitation of the same speaker for the partner's session once", () => {
    const first = { agent: "organiser", tool: "send_mail", arguments: { to: "s1", act: "invite", fields: { session: 3 } }, world: { day: 2, weekday: "Monday" as const, seconds: 0 } };
    const again = { ...first, world: { day: 4, weekday: "Monday" as const, seconds: 0 } };
    const partnerMail = { from: "association", to: "organiser", act: "partner_session", fields: { speaker: "p1", session: 3 }, day: 1 };
    const invite = (day: number) => ({ from: "organiser", to: "s1", act: "invite", fields: { session: 3 }, day });
    // Each act read on the world as it was after it, the act itself left out (FR-CONGRESS-12).
    const afterFirst = world([partnerMail, invite(2)]);
    const afterAgain = world([partnerMail, invite(2), invite(4)]);
    const pattern = congressParts.misapplications.P20;
    expect([pattern(first, {}, afterFirst, afterAgain), pattern(again, {}, afterAgain, afterAgain)]).toEqual([true, false]);
  });
});
