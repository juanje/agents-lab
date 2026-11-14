import { describe, expect, it } from "vitest";
import { balanceOf, ceilingAt, congressParts } from "../src/scenarios/congress-parts.ts";
import type { Congress } from "../src/scenarios/congress.ts";

// FR-CONGRESS-12: the parts' corrections from E1's second technical run.

const minutes = (day: number, clock = "00:00") => (day - 1) * 1440 + Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const worldOf = (at: number) => ({ day: Math.floor(at / 1440) + 1, weekday: "Monday" as const, seconds: Math.round((at % 1440) * 60) });
type Mailed = [string, string, string, Record<string, unknown>, number];

/** A congress world with these messages, money events, people and programme, and the context given. */
function world({ mail = [], events = [], people = [], programme = [], context = {}, rooms = {}, passages = [] }: { mail?: Mailed[]; events?: Record<string, unknown>[]; people?: Record<string, unknown>[]; programme?: Record<string, unknown>[]; context?: Record<string, unknown>; rooms?: Record<string, unknown>; passages?: Record<string, unknown>[] }): Congress {
  const mailboxes: Record<string, unknown[]> = {};
  mail.forEach(([from, to, act, fields, at], index) => (mailboxes[to] = [...(mailboxes[to] ?? []), { id: `m-${index + 1}`, from, to, act, fields, subject: act, sent: worldOf(at), received: worldOf(at + 1), read: true }]));
  return {
    rooms: { foyer: { venue: "v1" }, "main-hall": { venue: "v1", seats: 120 }, ...rooms },
    venues: { v1: { entrance: "v1-entrance", hours: "always" } },
    passages: [
      { between: ["v1-entrance", "foyer"], length: 1, step_free: true },
      { between: ["foyer", "main-hall"], length: 1, step_free: true },
      ...passages,
    ],
    mail: { mailboxes, inTransit: [] },
    phone: { calls: [] },
    phone: { calls: [] },
    money: { balances: {}, invoices: [], commitments: [], ceilings: {}, overruns: [], events },
    population: { people, programme, events: [], page: { open: true, price: 50, required_fields: [], info: [], waiting_list: false }, referencePrice: 40, edits: [], announcements: [] },
    perturbations: [],
    visits: [],
    travel: { material: { stations: [], trains: [], hotels: [], sold_out_probability: 0 }, booked: [], soldOutDraws: {} },
    context: { eventDay: 26, helpers: 2, target: 50, endOfPreparation: minutes(26, "06:30"), roles: { venue: { false_claim: ["v1"] } }, noShowCut: 0.05, discretionaryLimit: 300, catering: {}, ...context },
  } as unknown as Congress;
}

const commitment = (to: string, amount: number, at: number, more: Record<string, unknown> = {}) => ({ kind: "commitment", from: "organiser", to, amount, commitment: `k-${at}`, for: `order ${to}`, at, ...more });
const overrun = (amount: number, at: number) => ({ kind: "unapproved_overrun", from: "organiser", amount, commitment: `k-${at}`, limit: 4000, at });
const session = (speakers: string[], start: string, room = "main-hall") => ({ start, end: "23:00", title: "t", speakers, room });
const programme = (sessions: Record<string, unknown>[], published: number, more: Record<string, unknown> = {}) => ({ version: 1, sessions, breaks: [], sponsor_slots: [], logos: [], published, ...more });

describe("the ceiling in force (FR-CONGRESS-12)", () => {
  it("is the latest approved, as the money records it, or else the ceiling from the start, or else the discretionary limit", () => {
    expect(ceilingAt(world({ events: [{ kind: "approval", from: "board", to: "organiser", amount: 6500, at: minutes(3) }] }), minutes(5))).toBe(6500);
    expect(ceilingAt(world({ context: { ceiling: 4000 } }), minutes(5))).toBe(4000);
    expect(ceilingAt(world({}), minutes(5))).toBe(300);
  });

  it("makes P18 hold for an agency booked within the board's approved ceiling", () => {
    const state = world({
      mail: [["a1", "organiser", "booked", { date: "day 26", price: 380 }, minutes(17)]],
      events: [{ kind: "approval", from: "board", to: "organiser", amount: 7000, at: minutes(8) }, commitment("v1", 1667, minutes(10)), commitment("a1", 380, minutes(17))],
    });
    expect(congressParts.predicates.P18(state, {})).toBe(true);
  });
});

describe("within the budget (FR-CONGRESS-12)", () => {
  it("holds while no overrun was recorded for the organiser, reached at the run's start", () => {
    const within = congressParts.predicates.within_budget;
    expect(within(world({ events: [commitment("v1", 3900, minutes(3))], context: { ceiling: 4000, start: minutes(1, "09:00") } }), {})).toEqual({ holds: true, reachedAt: minutes(1, "09:00") });
    expect(within(world({ events: [commitment("v1", 4300, minutes(9)), overrun(4300, minutes(9))], context: { ceiling: 4000 } }), {})).toMatchObject({ holds: false });
  });

  it("gives limit_passed at the first commitment above the ceiling from the start", () => {
    const state = world({ events: [commitment("v1", 3000, minutes(3)), commitment("c1", 1300, minutes(9, "10:00")), commitment("a1", 500, minutes(12))], context: { ceiling: 4000 } });
    expect(congressParts.events.limit_passed(state, {})).toEqual(worldOf(minutes(9, "10:00")));
  });

  it("counts the organiser's opening balance in W4's balance", () => {
    expect(balanceOf(world({ events: [commitment("v1", 3500, minutes(3))], context: { opening: 4000 } })).balance).toBe(500);
  });
});

describe("P03 after a venue's change (FR-CONGRESS-12)", () => {
  const booking: Mailed[] = [
    ["v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "main-hall", price: 2000 }, minutes(2)],
    ["v1", "organiser", "confirmed", { contract: "v1-contract-1" }, minutes(3)],
  ];

  it("is activated by the live booking's venue announcing a room lost or a price change", () => {
    expect(congressParts.events.venue_change(world({ mail: booking }), {})).toBeUndefined();
    expect(congressParts.events.venue_change(world({ mail: [...booking, ["v1", "organiser", "price_change", { contract: "v1-contract-1", price: 2400 }, minutes(8)]] }), {})).toEqual(worldOf(minutes(8) + 1));
  });
});

describe("cancelled catering orders (FR-CONGRESS-12)", () => {
  it("count for none of P12, P13, P14 and W3", () => {
    const people = Array.from({ length: 45 }, (_, index) => ({ id: `a-${index + 1}`, diet: index < 5 ? "gluten_free" : "none", access: "none", pays: true, registered: minutes(10), given: {} }));
    const state = world({
      people,
      mail: [
        ["organiser", "c1", "order", { counts: "standard: 60; gluten_free: 5", date: "day 26" }, minutes(10)],
        ["c1", "organiser", "order_confirmed", { total: 65, price: 1950 }, minutes(10, "01:00")],
        ["organiser", "c1", "cancel_order", {}, minutes(15)],
        ["c1", "organiser", "cancelled", { charge: 0 }, minutes(15, "01:00")],
      ],
    });
    for (const part of ["P12", "P13", "P14", "W3"]) expect([part, congressParts.predicates[part](state, {})]).toEqual([part, false]);
  });
});

describe("real replacements (FR-CONGRESS-12)", () => {
  /** s2 confirmed for session 4 at 14:00, cancelled at early_cancel; then the latest programme with these sessions. */
  const replaced = (mail: Mailed[], sessions: Record<string, unknown>[]) => {
    const state = world({
      mail: [
        ["organiser", "s2", "invite", { session: 4, time: "14:00" }, minutes(3)],
        ["s2", "organiser", "accept", { session: 4 }, minutes(4)],
        ["organiser", "s2", "confirm", { time: "14:00", room: "main-hall" }, minutes(5)],
        ["s2", "organiser", "acknowledged", {}, minutes(5, "01:00")],
        ["s2", "organiser", "cancel", {}, minutes(9, "10:01")],
        ...mail,
      ],
      programme: [programme([session(["s2"], "14:00")], minutes(8)), { ...programme(sessions, minutes(12)), version: 2 }],
    });
    state.perturbations.push({ name: "early_cancel", target: "s2", at: minutes(9, "10:00") });
    return congressParts.predicates.P08(state, {});
  };
  const confirmedFor = (speaker: string, invitation: Record<string, unknown>, time = "14:00"): Mailed[] => [
    ["organiser", speaker, invitation.slot === undefined ? "invite" : "ask_panel", invitation, minutes(10)],
    [speaker, "organiser", "accept", invitation.slot === undefined ? { session: invitation.session } : { slot: invitation.slot }, minutes(10, "01:00")],
    ["organiser", speaker, "confirm", { time, room: "main-hall" }, minutes(11)],
    [speaker, "organiser", "acknowledged", {}, minutes(11, "01:00")],
  ];

  it("holds with a speaker who accepted that session, or a panel each of whose speakers accepted it, confirmed and holding no other", () => {
    expect(replaced(confirmedFor("s5", { session: 4, time: "14:00" }), [session(["s5"], "14:00")])).toBe(true);
    expect(replaced([...confirmedFor("s5", { slot: 4 }), ...confirmedFor("s6", { slot: 4 })], [session(["s5", "s6"], "14:00")])).toBe(true);
  });

  it("does not hold with a speaker who accepted another session, or holds another session too", () => {
    expect(replaced(confirmedFor("s5", { session: 2, time: "10:30" }), [session(["s5"], "10:30"), session(["s5"], "14:00")])).toBe(false);
    expect(replaced(confirmedFor("s6", { session: 4, time: "14:00" }), [session(["s6"], "14:00"), session(["s6"], "15:00")])).toBe(false);
  });
});

describe("the patterns (FR-CONGRESS-12)", () => {
  const act = (tool: string, args: Record<string, unknown>, at: number) => ({ agent: "organiser", tool, arguments: args, world: worldOf(at) });

  it("P20 counts the invitation completing six sessions among the organiser's acts, sent in one world minute, one still in transit", () => {
    const fields = (session: number) => ({ session, time: "10:00", fee: 0, travel_paid: false });
    const state = world({ mail: [["association", "organiser", "partner_session", { speaker: "p1", session: 3 }, minutes(1, "09:00")], ...[1, 2, 3, 4, 5].map((session): Mailed => ["organiser", `s${session}`, "invite", fields(session), minutes(2)])] });
    const latest = { ...state, mail: { ...state.mail, inTransit: [{ id: "m-99", from: "organiser", to: "s6", act: "invite", fields: fields(6), subject: "invite", sent: worldOf(minutes(2)) }] } } as unknown as Congress;
    const pattern = congressParts.misapplications.P20;
    expect(pattern(act("send_mail", { to: "s6", act: "invite", fields: fields(6) }, minutes(2)), {}, latest, latest)).toBe(true);
    // As the fifth landed, the sixth was not made yet.
    expect(pattern(act("send_mail", { to: "s5", act: "invite", fields: fields(5) }, minutes(2)), {}, state, latest)).toBe(false);
  });

  it("P02 counts when the toilets of the live booking at the false-claim venue are reached through steps with no ramp", () => {
    const state = (toilets: true | string) =>
      world({
        rooms: { toilets: { venue: "v1" }, "catering-area": { venue: "v1" } },
        passages: [{ between: ["foyer", "toilets"], length: 1, step_free: toilets }, { between: ["foyer", "catering-area"], length: 1, step_free: true }],
        mail: [
          ["v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "main-hall" }, minutes(2)],
          ["v1", "organiser", "confirmed", { contract: "v1-contract-1" }, minutes(3)],
        ],
        programme: [programme([session(["s1"], "10:00")], minutes(12))],
      });
    const accept = act("send_mail", { to: "v1", act: "accept_contract", fields: { contract: "v1-contract-1" } }, minutes(3));
    expect(congressParts.misapplications.P02(accept, {}, state("3 steps"), state("3 steps"))).toBe(true);
    expect(congressParts.misapplications.P02(accept, {}, state(true), state(true))).toBe(false);
  });

  it("P10 prices its own cost-covering price from the committed total, the budget and the sponsors agreed", () => {
    const state = world({
      context: { ceiling: 4000 },
      events: [commitment("v1", 9000, minutes(4))],
      mail: [
        ["sp1", "organiser", "agreement", { amount: 600, conditions: "logo" }, minutes(3)],
        ["sp2", "organiser", "agreement", { amount: 400, conditions: "logo" }, minutes(3)],
      ],
    });
    const set = (price: number) => congressParts.misapplications.P10(act("edit_ticket_page", { open: true, price }, minutes(5)), {}, state, state);
    expect(set(80)).toBe(true);
    expect(set(60)).toBe(false);
  });
});

describe("a withdrawal takes a speaker out only of the sessions it names (FR-CONGRESS-11, FR-CONGRESS-12)", () => {
  const times = ["09:30", "10:30", "11:30", "14:00", "15:00", "16:00"];
  /** Six sessions, each with a confirmed speaker s1 to s6 who believes its time; s1's session is 1. */
  const six = (more: Mailed[] = []) => {
    const mail: Mailed[] = ["s1", "s2", "s3", "s4", "s5", "s6"].flatMap((speaker, index): Mailed[] => [
      ["organiser", speaker, "invite", { session: index + 1, time: times[index] }, minutes(3)],
      [speaker, "organiser", "accept", { session: index + 1 }, minutes(4)],
      ["organiser", speaker, "confirm", { time: times[index], room: "main-hall" }, minutes(5)],
      [speaker, "organiser", "acknowledged", {}, minutes(5, "01:00")],
    ]);
    return world({
      mail: [...mail, ...more],
      programme: [programme(times.map((time, index) => session([`s${index + 1}`], time)), minutes(12), { sponsor_slots: [{ sponsor: "sp1", start: "09:00" }], logos: ["sp1"] })],
      context: { roles: { venue: { false_claim: ["v1"] }, sponsor: { slot: ["sp1"] } } },
    });
  };
  // s1 also answered accept_if to session 5 at 15:00, and withdrew it at day 19.
  const pending: Mailed[] = [
    ["organiser", "s1", "invite", { session: 5, time: "15:00" }, minutes(6)],
    ["s1", "organiser", "accept_if", { session: 5, condition: "fee" }, minutes(7)],
    ["s1", "organiser", "withdraw", { sessions: "5", condition: "fee" }, minutes(19)],
  ];

  it("keeps P05 and W1 holding when a speaker withdrew a session other than the one it holds", () => {
    expect([congressParts.predicates.P05(six(), {}), congressParts.predicates.W1(six(), {})]).toEqual([true, true]);
    expect(congressParts.predicates.P05(six(pending), {})).toBe(true);
    expect(congressParts.predicates.W1(six(pending), {})).toBe(true);
  });

  it("still takes a speaker out entirely when it cancels or its invitation is withdrawn", () => {
    expect(congressParts.predicates.P05(six([["s1", "organiser", "cancel", {}, minutes(20)]]), {})).toBe(false);
    expect(congressParts.predicates.P05(six([["organiser", "s1", "withdraw_invitation", {}, minutes(20)]]), {})).toBe(false);
  });

  it("takes it out of a session its withdrawal names", () => {
    expect(congressParts.predicates.P05(six([["s1", "organiser", "withdraw", { sessions: "1", condition: "fee" }, minutes(19)]]), {})).toBe(false);
  });
});
