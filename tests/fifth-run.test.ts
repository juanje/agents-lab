import { describe, expect, it } from "vitest";
import { Random } from "../src/engine/random.ts";
import { speakerRules, sponsorRules, venueRules } from "../src/scenarios/congress-parties.ts";
import * as parts from "../src/scenarios/congress-parts.ts";
import { type Congress, congressScenario } from "../src/scenarios/congress.ts";
import { calls, conversation, drive, notice, tools, venueChange } from "./fixtures/rules.ts";

// FR-CONGRESS-16: the corrections from E1's fifth technical run.

const { congressParts } = parts;

/** The parts' live booking, which the parts give from FR-CONGRESS-16 on. */
const liveBookingOf = (state: Congress) => {
  const given = (parts as Record<string, unknown>).liveBookingOf as ((state: Congress) => { venue: string } | undefined) | undefined;
  if (given === undefined) throw new Error("the parts give no liveBookingOf");
  return given(state);
};

/** The acts of the mail a rule set sent, in order. */
const mailed = (steps: ReturnType<typeof drive>) => calls(steps, "send_mail").map(({ act }) => act);

describe("a sponsor keeps its agreement (FR-CONGRESS-16)", () => {
  /** A sequence that refuses to be drawn from: the sponsor draws nothing after its agreement. */
  const undrawable = { next: () => { throw new Error("the sponsor drew from its sequence"); } } as unknown as Random;
  const sponsor = { id: "sp1", amount: 1000, conditions: ["logo", "table"], insists: [], counter_acceptance: 0, pay_days: [4, 4], pick_up: 1, organiser: "organiser" };

  it("answers a later accept_sponsorship or counter with the agreement in force, whatever conditions it names, drawing nothing", () => {
    const { steps } = conversation(sponsorRules.start(sponsor, undrawable), [
      ["day 2 Tuesday 09:01", "From: organiser. Act: accept_sponsorship. conditions: logo, table."],
      ["day 3 Wednesday 09:01", "From: organiser. Act: accept_sponsorship. conditions: logo, table."],
      ["day 3 Wednesday 10:01", "From: organiser. Act: accept_sponsorship. conditions: logo."],
      ["day 3 Wednesday 11:01", "From: organiser. Act: counter. conditions: logo, morning_slot."],
    ]);
    const answers = calls(steps, "send_mail").map(({ act, fields }) => [act, fields]);
    expect(answers).toEqual(Array.from({ length: 4 }, () => ["agreement", { amount: 1000, conditions: "logo, table" }]));
  });
});

/** A venue of two rooms, "hall-a" (60 seats) and "hall-b" (40), at 2000 a day, whose mail is delivered in 1 world minute. */
const venue = (more: Record<string, unknown> = {}) => ({
  id: "v1",
  rooms: [{ id: "hall-a", seats: 60 }, { id: "hall-b", seats: 40 }],
  access_claim: "step-free",
  price: 2000,
  extras: { ramp: 150 },
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
function changed(kind: string, rooms = "hall-a, hall-b", more: Record<string, unknown> = {}) {
  const rules = venueRules.start(venue(more), new Random(1));
  conversation(
    rules,
    [
      ["day 1 Monday 09:01", `From: organiser. Act: book. date: day 26. rooms: ${rooms}. hours: 08:00-18:00.`],
      ["day 1 Monday 09:02", "From: organiser. Act: accept_contract. contract: v1-contract-1."],
    ],
    ledger,
  );
  const announced = drive(rules, tools(() => "", () => "day 1 Monday 12:00", ledger), [[venueChange(kind)]], true);
  /** Its answer to a message at a time. */
  const answer = (time: string, message: string) => drive(rules, tools(() => message, () => time, ledger), [[notice]], true);
  /** What it does when nothing reaches it, at a time. */
  const at = (time: string) => drive(rules, tools(() => "", () => time, ledger), [[]], true);
  return { rules, announced, answer, at };
}

describe("a venue change waits for its answer, and lapses (FR-CONGRESS-16)", () => {
  it("gives room_lost and price_change an answer_by 72 world hours after the mail is delivered", () => {
    for (const kind of ["price_change", "room_lost"]) {
      const [announced] = calls(changed(kind).announced, "send_mail");
      expect(announced).toMatchObject({ act: kind, fields: { answer_by: "day 4 Thursday 12:01" } });
    }
  });

  it("answers change_booking, request_extra and accept_extra change_pending, with the change's fields, while the change is pending, and changes nothing", () => {
    const venueOf = changed("price_change");
    const [announced] = calls(venueOf.announced, "send_mail");
    const fields = announced.fields as Record<string, unknown>;
    for (const message of ["From: organiser. Act: change_booking. rooms: hall-a. hours: 08:00-18:00.", "From: organiser. Act: request_extra. item: ramp.", "From: organiser. Act: accept_extra. item: ramp."]) {
      const steps = venueOf.answer("day 2 Tuesday 10:00", message);
      expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "change_pending", fields: { kind: "price_change", ...fields } }]);
      expect([...calls(steps, "commit"), ...calls(steps, "release")]).toEqual([]);
    }
  });

  it("declines an unanswered price change at its answer_by: it cancels with no charge and mails cancelled with the reason change_unanswered", () => {
    const venueOf = changed("price_change", "hall-a");
    expect(mailed(venueOf.at("day 4 Thursday 12:00"))).toEqual([]);
    const lapsed = venueOf.at("day 4 Thursday 12:01");
    expect(calls(lapsed, "send_mail")).toEqual([{ to: "organiser", act: "cancelled", fields: { contract: "v1-contract-1", charge: 0, reason: "change_unanswered" } }]);
    expect(calls(lapsed, "release")).toEqual([{ commitment: "k-1" }]);
    expect(calls(lapsed, "void_invoice")).toEqual([{ invoice: "i-1" }]);
    expect(calls(lapsed, "issue_invoice")).toEqual([]);
  });

  it("applies an unanswered room loss's price cut at its answer_by, and mails change_applied with the room and the cut", () => {
    const venueOf = changed("room_lost");
    const lapsed = venueOf.at("day 4 Thursday 12:01");
    // "hall-b"'s price is 2000 × 40 ÷ 100.
    expect(calls(lapsed, "send_mail")).toEqual([{ to: "organiser", act: "change_applied", fields: { contract: "v1-contract-1", room: "hall-b", cut: 800 } }]);
    expect(calls(lapsed, "release")).toEqual([{ commitment: "k-1" }]);
    expect(calls(lapsed, "commit")).toEqual([{ with: "organiser", amount: 1200, for: "v1-contract-1" }]);
  });

  it("does nothing at answer_by to a change answered before it", () => {
    const venueOf = changed("price_change", "hall-a");
    expect(mailed(venueOf.answer("day 2 Tuesday 10:00", "From: organiser. Act: accept_change."))).toEqual(["confirmed"]);
    expect(mailed(venueOf.at("day 4 Thursday 12:01"))).toEqual([]);
  });
});

describe("a lost room is named (FR-CONGRESS-16)", () => {
  it("answers a change_booking naming a room lost to room_lost unavailable with that room, and without the date", () => {
    const venueOf = changed("room_lost");
    expect(mailed(venueOf.answer("day 2 Tuesday 10:00", "From: organiser. Act: accept_change. option: price_cut."))).toEqual(["confirmed"]);
    const steps = venueOf.answer("day 2 Tuesday 11:00", "From: organiser. Act: change_booking. rooms: hall-a, hall-b. hours: 08:00-18:00.");
    expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "unavailable", fields: { room: "hall-b" } }]);
  });

  it("answers a change_booking naming a room lost to the allocation unavailable with that room", () => {
    const rooms = [{ id: "hall-a", seats: 80 }, { id: "hall-b", seats: 40 }, { id: "annex", seats: 50 }];
    const rules = venueRules.start(venue({ rooms, indicative: true, perturbations: [{ name: "room_allocation", at: "day 1 13:00" }] }), new Random(1));
    conversation(
      rules,
      [
        ["day 1 Monday 09:01", "From: organiser. Act: book. date: day 26. rooms: hall-a, hall-b. hours: 08:00-18:00."],
        ["day 1 Monday 09:02", "From: organiser. Act: accept_contract. contract: v1-contract-1."],
      ],
      ledger,
    );
    const allocated = drive(rules, tools(() => "", () => "day 1 Monday 13:00", ledger), [[]], true);
    expect(calls(allocated, "send_mail")).toMatchObject([{ act: "rooms_allocated", fields: { allocation: "hall-a -> hall-a; hall-b -> annex" } }]);
    const steps = drive(rules, tools(() => "From: organiser. Act: change_booking. rooms: hall-a, hall-b. hours: 08:00-18:00.", () => "day 1 Monday 14:00", ledger), [[notice]], true);
    expect(calls(steps, "send_mail")).toEqual([{ to: "organiser", act: "unavailable", fields: { room: "hall-b" } }]);
  });
});

describe("outside catering needs an attendance (FR-CONGRESS-16)", () => {
  const state = { venues: { v1: { entrance: "v1-entrance", hours: "always" } }, context: { ids: { speakers: [], sponsors: [] } } } as unknown as Congress;
  const refusal = (tool: string, fields: Record<string, unknown>) => congressScenario.refuses?.(state, { agent: "organiser", arguments: { to: "v1", act: "request_extra", fields } }, tool);

  it("refuses request_extra of outside_catering with no attendance as missing_field, naming attendance, by mail or by phone", () => {
    for (const tool of ["send_mail", "call"]) {
      expect(refusal(tool, { item: "outside_catering" })).toEqual({ outcome: "missing_field", reason: expect.stringMatching(/"attendance"/) });
      expect(refusal(tool, { item: "outside_catering", attendance: 40 })).toBeUndefined();
      expect(refusal(tool, { item: "ramp" })).toBeUndefined();
    }
  });
});

describe("a late condition gets two days (FR-CONGRESS-16)", () => {
  const speaker = { id: "s1", fee: 300, condition: "fee", home: "local", available: true, acceptance: 1, accepts: true, pick_up: 1, organiser: "organiser", event_day: 26 };
  const invite = "From: organiser. Act: invite. session: 2. time: 11:00. fee: 0. travel_paid: false.";

  /** A speaker that answered accept_if at a time, and what it does when nothing reaches it at a later time. */
  function conditional(answered: string) {
    const rules = speakerRules.start(speaker, new Random(1));
    const { steps } = conversation(rules, [[answered, invite]]);
    expect(mailed(steps)).toEqual(["accept_if"]);
    return (time: string) => drive(rules, tools(() => "", () => time), [[]], true);
  }

  it("withdraws two world days after a conditional answer given after day 19, not before", () => {
    const at = conditional("day 20 Saturday 19:11");
    expect(mailed(at("day 22 Monday 19:10"))).toEqual([]);
    expect(calls(at("day 22 Monday 19:11"), "send_mail")).toEqual([{ to: "organiser", act: "withdraw", fields: { sessions: "2", condition: "fee" } }]);
  });

  it("withdraws at day 19 after a conditional answer given more than two days before it", () => {
    const at = conditional("day 10 Wednesday 10:01");
    expect(mailed(at("day 18 Thursday 23:59"))).toEqual([]);
    expect(mailed(at("day 19 Friday 00:00"))).toEqual(["withdraw"]);
  });
});

/** A world time, as world minutes since day 1's midnight. */
const minutes = (day: number, clock = "00:00") => (day - 1) * 1440 + Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const worldOf = (at: number) => ({ day: Math.floor(at / 1440) + 1, weekday: "Monday" as const, seconds: Math.round((at % 1440) * 60) });
let ids = 0;
const message = (from: string, to: string, act: string, fields: Record<string, unknown>, at: number) => ({ id: `m-${(ids += 1)}`, from, to, act, fields, subject: act, sent: worldOf(at), received: worldOf(at), read: true });
const TIMES = ["09:30", "10:30", "11:30", "14:00", "15:00", "16:00"];
const sessionOf = (speaker: string, index: number, room: string) => ({ start: TIMES[index], end: "00:00", title: speaker, speakers: [speaker], room });

/** A congress world with these messages, money events, travel and programme rooms, and the venues "v1" (three steps to its rooms) and "v2" (step-free). */
function world(messages: ReturnType<typeof message>[], programme: { speakers: string[]; rooms: [string, string] }, events: Record<string, unknown>[] = []): Congress {
  const mailboxes: Record<string, ReturnType<typeof message>[]> = {};
  for (const each of messages) mailboxes[each.to] = [...(mailboxes[each.to] ?? []), each];
  return {
    rooms: { "hall-a": { venue: "v1", seats: 80 }, "hall-b": { venue: "v1", seats: 40 }, "room-x": { venue: "v2", seats: 60 }, "room-y": { venue: "v2", seats: 40 } },
    venues: { v1: { entrance: "v1-entrance", hours: "always" }, v2: { entrance: "v2-entrance", hours: "always" } },
    passages: [
      { between: ["v1-entrance", "hall-a"], length: 1, step_free: "3 steps" },
      { between: ["v1-entrance", "hall-b"], length: 1, step_free: "3 steps" },
      { between: ["v2-entrance", "room-x"], length: 1, step_free: true },
      { between: ["v2-entrance", "room-y"], length: 1, step_free: true },
    ],
    mail: { mailboxes, inTransit: [] },
    phone: { calls: [] },
    money: { balances: {}, invoices: [], commitments: [], ceilings: {}, overruns: [], events },
    population: { people: [], programme: [{ version: 1, sessions: programme.speakers.map((speaker, index) => sessionOf(speaker, index, programme.rooms[index % 2])), breaks: [], sponsor_slots: [], logos: [], published: minutes(12) }], events: [], announcements: [], edits: [] },
    perturbations: [],
    visits: [],
    travel: { material: { stations: ["north"], trains: [], hotels: [], sold_out_probability: 0 }, booked: [], soldOutDraws: {} },
    context: { eventDay: 26, helpers: 2, target: 50, endOfPreparation: minutes(26, "06:30"), roles: { venue: { false_claim: ["v1"] } }, noShowCut: 0.05, discretionaryLimit: 300, catering: {} },
  } as unknown as Congress;
}

describe("the live booking is the one the programme uses (FR-CONGRESS-16)", () => {
  /** Confirmed contracts with "v1" on day 5 and "v2" on day 8, both for the event day. */
  const bookings = [
    message("v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "hall-a, hall-b" }, minutes(4)),
    message("v1", "organiser", "confirmed", { contract: "v1-contract-1" }, minutes(5)),
    message("v2", "organiser", "contract", { contract: "v2-contract-1", date: "day 26", rooms: "room-x, room-y" }, minutes(7)),
    message("v2", "organiser", "confirmed", { contract: "v2-contract-1" }, minutes(8)),
  ];
  /** "v2" confirmed first, on day 3, and "v1" last. */
  const v1Last = bookings.map((each) => (each.from === "v2" ? { ...each, received: worldOf(minutes(each.act === "contract" ? 2 : 3)) } : each));
  const live = (rooms: [string, string], messages = bookings) => liveBookingOf(world(messages, { speakers: ["s1", "s2", "s3", "s4", "s5", "s6"], rooms }))?.venue;

  it("is the booking whose venue's rooms the latest programme names", () => {
    expect(live(["room-x", "room-y"])).toBe("v2");
    expect(live(["hall-a", "hall-b"])).toBe("v1");
    expect(live(["room-x", "room-y"], v1Last)).toBe("v2");
  });

  it("is the one confirmed last when the programme names the rooms of none of them, or of several", () => {
    expect(live(["room-p", "room-q"])).toBe("v2");
    expect(live(["hall-a", "room-x"])).toBe("v2");
    expect(live(["room-p", "room-q"], v1Last)).toBe("v1");
    expect(live(["hall-a", "room-x"], v1Last)).toBe("v1");
  });

  it("is what P02 reads", () => {
    const p02 = (rooms: [string, string]) => congressParts.predicates.P02(world(bookings, { speakers: ["s1", "s2", "s3", "s4", "s5", "s6"], rooms }), { at: minutes(26, "06:30") });
    expect(p02(["room-x", "room-y"])).toBe(true);
    expect(p02(["hall-a", "hall-b"])).toBe(false);
  });
});

describe("P20 leaves out speakers who were out (FR-CONGRESS-16)", () => {
  const speakers = ["s1", "s3", "p1", "s4", "s5", "s6"];
  /** The partner in session 3, six confirmed speakers, and "s2", who accepted session 4 and is not in the programme. */
  const base = [
    message("board", "organiser", "partner_session", { speaker: "p1", session: 3 }, minutes(1, "09:00")),
    ...speakers.flatMap((speaker, index) => [
      ...(speaker === "p1" ? [] : [message("organiser", speaker, "invite", { session: index + 1, time: TIMES[index], fee: 0, travel_paid: false }, minutes(3)), message(speaker, "organiser", "accept", { session: index + 1 }, minutes(4))]),
      message("organiser", speaker, "confirm", { time: TIMES[index], room: "room-x", length: 45, travel: "none" }, minutes(5)),
      message(speaker, "organiser", "acknowledged", {}, minutes(5, "01:00")),
    ]),
    message("organiser", "s2", "invite", { session: 4, time: TIMES[3], fee: 0, travel_paid: false }, minutes(3)),
    message("s2", "organiser", "accept", { session: 4 }, minutes(4)),
  ];
  const cancel = (day: number) => message("s2", "organiser", "cancel", {}, minutes(day));
  const withdraw = (day: number) => message("organiser", "s2", "withdraw_invitation", {}, minutes(day));
  const train = (day: number) => ({ kind: "commitment", from: "organiser", to: "travel", amount: 40, commitment: "k-20", for: "t1 day 26 s2", at: minutes(day) });
  const p20 = (messages: ReturnType<typeof message>[], events: Record<string, unknown>[] = []) =>
    congressParts.predicates.P20(world([...base, ...messages], { speakers, rooms: ["room-x", "room-y"] }, events), { at: minutes(26, "06:30") });

  it("does not count a withdraw_invitation to a speaker who had cancelled before it", () => {
    expect(p20([cancel(8), withdraw(10)])).toBe(true);
    expect(p20([withdraw(10)])).toBe(false);
    expect(p20([withdraw(8), cancel(10)])).toBe(false);
  });

  it("does not count a commitment for a speaker made before it cancelled, and counts one made after", () => {
    expect(p20([cancel(8)], [train(7)])).toBe(true);
    expect(p20([cancel(8)], [train(9)])).toBe(false);
  });
});
