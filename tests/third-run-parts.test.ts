import { describe, expect, it } from "vitest";
import type { Act } from "../src/engine/parts.ts";
import { congressParts } from "../src/scenarios/congress-parts.ts";
import type { Congress } from "../src/scenarios/congress.ts";

// FR-CONGRESS-14: the parts' corrections from E1's third technical run.

const minutes = (day: number, clock = "00:00") => (day - 1) * 1440 + Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const worldOf = (at: number) => ({ day: Math.floor(at / 1440) + 1, weekday: "Monday" as const, seconds: Math.round((at % 1440) * 60) });
type Mailed = [string, string, string, Record<string, unknown>, number];
type Called = { from: string; to: string; act: string; fields: Record<string, unknown>; answer?: [string, Record<string, unknown>]; at: number };

/** A congress world with these messages (delivered at their time), calls, money events, people and programme. */
function world({ mail = [], calls = [], events = [], people = [], programme = [], beliefs = [], context = {}, perturbations = [], edits = [] }: { mail?: Mailed[]; calls?: Called[]; events?: Record<string, unknown>[]; people?: Record<string, unknown>[]; programme?: Record<string, unknown>[]; beliefs?: Record<string, unknown>[]; context?: Record<string, unknown>; perturbations?: Record<string, unknown>[]; edits?: Record<string, unknown>[] }): Congress {
  const mailboxes: Record<string, unknown[]> = {};
  mail.forEach(([from, to, act, fields, at], index) => (mailboxes[to] = [...(mailboxes[to] ?? []), { id: `m-${index + 1}`, from, to, act, fields, subject: act, sent: worldOf(at), received: worldOf(at), read: true }]));
  const phone = calls.map(({ from, to, act, fields, answer, at }, index) => ({ id: `c-${index + 1}`, from, to, act, fields, status: "ended", ...(answer === undefined ? { outcome: "no_answer" } : { outcome: "answered", answer: { act: answer[0], fields: answer[1] }, endedAt: worldOf(at) }) }));
  return {
    rooms: { foyer: { venue: "v1" }, "main-hall": { venue: "v1", seats: 120 }, "room-b": { venue: "v1", seats: 30 }, "room-d": { venue: "v1", seats: 120 } },
    venues: { v1: { entrance: "v1-entrance", hours: "always" } },
    passages: [
      { between: ["v1-entrance", "foyer"], length: 1, step_free: true },
      { between: ["foyer", "main-hall"], length: 1, step_free: true },
      { between: ["foyer", "room-b"], length: 1, step_free: "3 steps" },
      { between: ["foyer", "room-d"], length: 1, step_free: true },
    ],
    mail: { mailboxes, inTransit: [] },
    phone: { calls: phone },
    money: { balances: {}, invoices: [], commitments: [], ceilings: {}, overruns: [], events },
    population: { people, programme, events: beliefs, page: { open: true, price: 50, required_fields: [], info: [], waiting_list: false }, referencePrice: 40, edits, announcements: [] },
    perturbations,
    visits: [],
    travel: { material: { stations: [], trains: [], hotels: [], sold_out_probability: 0 }, booked: [], soldOutDraws: {} },
    context: { eventDay: 26, helpers: 2, target: 50, endOfPreparation: minutes(26, "06:30"), roles: { venue: { false_claim: ["v1"] }, sponsor: { slot: ["sp1"] } }, noShowCut: 0.05, discretionaryLimit: 300, catering: {}, ceiling: 4000, opening: 4000, ...context },
  } as unknown as Congress;
}

const SIX = ["s1", "s2", "s3", "s4", "s5", "s6"];
const TIMES = ["09:30", "10:30", "11:30", "14:00", "15:00", "16:00"];
const session = (speakers: string[], start: string, room = "main-hall") => ({ start, end: "23:00", title: "t", speakers, room });
const programme = (sessions: Record<string, unknown>[], published: number, version = 1) => ({ version, sessions, breaks: [], sponsor_slots: [{ sponsor: "sp1", start: "09:15", end: "09:30" }], logos: ["sp1"], published });
const six = (room = "main-hall") => programme(SIX.map((speaker, index) => session([speaker], TIMES[index], room)), minutes(12));
const live: Mailed[] = [
  ["v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "main-hall", hours: "08:00-18:00", price: 2000 }, minutes(2)],
  ["v1", "organiser", "confirmed", { contract: "v1-contract-1" }, minutes(3)],
];
const cancelled: Mailed = ["v1", "organiser", "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes(11)];
/** An organiser's act at a world time, with the world as it was then. */
const acted = (tool: string, args: Record<string, unknown>, at: number): Act => ({ agent: "organiser", tool, arguments: args, world: worldOf(at) });
const holds = (part: string, state: Congress) => {
  const result = congressParts.predicates[part](state, {});
  return typeof result === "boolean" ? { holds: result } : result;
};

describe("W3 and W4 only for a congress that happens (FR-CONGRESS-14)", () => {
  const catering: Mailed[] = [
    ["organiser", "c1", "order", { counts: "standard: 5", date: "day 26" }, minutes(9)],
    ["c1", "organiser", "order_confirmed", { total: 5, price: 150 }, minutes(10)],
  ];
  const balance = [{ kind: "commitment", from: "organiser", to: "c1", amount: 3700, commitment: "k-1", for: "order c1", at: minutes(10) }];

  it("holds W3 and W4 with a live booking and six sessions, and neither with no live booking", () => {
    const happens = world({ mail: [...live, ...catering], programme: [six()], events: balance });
    expect([holds("W3", happens).holds, holds("W4", happens).holds]).toEqual([true, true]);
    const given = world({ mail: [...live, cancelled, ...catering], programme: [six()], events: balance });
    expect([holds("W3", given).holds, holds("W4", given).holds]).toEqual([false, false]);
  });

  it("does not hold W4 with an unapproved overrun, and still gives the balance and the overruns", () => {
    const state = world({ mail: live, programme: [six()], events: [...balance, { kind: "unapproved_overrun", from: "organiser", amount: 4100, commitment: "k-2", limit: 4000, at: minutes(11) }] });
    expect(holds("W4", state)).toEqual({ holds: false, values: { balance: 300, overruns: 1 } });
  });
});

describe("P06's activation, conditional_answer (FR-CONGRESS-14)", () => {
  const event = (state: Congress) => congressParts.events.conditional_answer?.(state, {});

  it("is the first accept_if a first invitee answers, by mail or by phone", () => {
    expect(congressParts.events.conditional_answer).toBeTypeOf("function");
    const byPhone = world({ calls: [{ from: "organiser", to: "s1", act: "invite", fields: { session: 2 }, answer: ["accept_if", { session: 2, condition: "fee", fee: 300 }], at: minutes(2, "10:00") }] });
    expect(event(byPhone)).toEqual(worldOf(minutes(2, "10:00")));
    const byMail = world({ mail: [["organiser", "s1", "invite", { session: 2 }, minutes(2)], ["s1", "organiser", "accept_if", { session: 2, condition: "fee" }, minutes(3)]] });
    expect(event(byMail)).toEqual(worldOf(minutes(3)));
  });

  it("is none when only a speaker invited after the first to a session answered accept_if", () => {
    const state = world({
      mail: [
        ["organiser", "s1", "invite", { session: 2 }, minutes(2)],
        ["s1", "organiser", "accept", { session: 2 }, minutes(3)],
        ["organiser", "s2", "invite", { session: 2 }, minutes(4)],
        ["s2", "organiser", "accept_if", { session: 2, condition: "travel_paid" }, minutes(5)],
      ],
    });
    expect(event(state)).toBeUndefined();
  });
});

describe("P10's misapplication, a price above 1.25 × the reference still in force on day 12 (FR-CONGRESS-14)", () => {
  /** The organiser's price edits, each an act and a record of the page; the acts the pattern lists. */
  const listed = (prices: [number, number][]) => {
    const latest = world({ edits: prices.map(([price, day]) => ({ price, open: true, at: minutes(day) })) });
    return prices.map(([price, day]) => acted("edit_ticket_page", { open: true, price }, minutes(day))).filter((act) => congressParts.misapplications.P10(act, {}, latest, latest)).map(({ world: { day } }) => day);
  };

  it("lists the edit that set a price above 1.25 × the reference that is still in force at day 12 00:00", () => {
    expect(listed([[60, 4]])).toEqual([4]);
    expect(listed([[60, 4], [48, 10]])).toEqual([]);
    expect(listed([[45, 4], [70, 9]])).toEqual([9]);
    expect(listed([[50, 4]])).toEqual([]);
    expect(listed([[60, 4], [48, 13]])).toEqual([4]);
  });
});

describe("P20's withdrawals (FR-CONGRESS-14)", () => {
  const accepted: Mailed[] = [
    ["association", "organiser", "partner_session", { speaker: "p1", session: 5 }, minutes(1, "09:00")],
    ...live,
    ["organiser", "s3", "invite", { session: 3, time: "11:30" }, minutes(3)],
    ["s3", "organiser", "accept", { session: 3 }, minutes(4)],
  ];
  /** Whether the organiser's withdrawal of "s3" on a day counts, with these records before it and those after. */
  const counts = (before: Mailed[], day: number, after: Mailed[] = []) => {
    const withdrawal: Mailed = ["organiser", "s3", "withdraw_invitation", {}, minutes(day)];
    const then = world({ mail: [...accepted, ...before, withdrawal] });
    const latest = world({ mail: [...accepted, ...before, withdrawal, ...after] });
    return congressParts.misapplications.P20(acted("send_mail", { to: "s3", act: "withdraw_invitation" }, minutes(day)), {}, then, latest);
  };

  it("counts a withdrawal after an acceptance, but not from a speaker who had cancelled", () => {
    expect(counts([], 10)).toBe(true);
    expect(counts([["s3", "organiser", "cancel", {}, minutes(8)]], 10)).toBe(false);
  });

  it("does not count one made while no booking was live, unless a booking was made after it", () => {
    expect(counts([["v1", "organiser", "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes(19)]], 20)).toBe(false);
    const rebooked: Mailed[] = [
      ["v2", "organiser", "contract", { contract: "v2-contract-1", date: "day 26", rooms: "hall-2", hours: "08:00-18:00", price: 2000 }, minutes(21)],
      ["v2", "organiser", "confirmed", { contract: "v2-contract-1" }, minutes(21, "01:00")],
    ];
    expect(counts([["v1", "organiser", "cancelled", { contract: "v1-contract-1", charge: 0 }, minutes(19)]], 20, rebooked)).toBe(true);
  });
});

describe("P02 counts only an accept_contract that reached the venue (FR-CONGRESS-14)", () => {
  const booking: Mailed[] = [
    ["v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "main-hall, room-b", hours: "08:00-18:00", price: 2000 }, minutes(20)],
    ["v1", "organiser", "confirmed", { contract: "v1-contract-1" }, minutes(22, "01:00")],
  ];
  const latestWith = (mail: Mailed[], calls: Called[] = []) => world({ mail: [...booking, ...mail], calls, programme: [programme([session(["s1"], "10:00", "room-b")], minutes(12))] });

  it("lists a mailed accept_contract that was delivered, and neither a book nor an unanswered call", () => {
    const calls: Called[] = [{ from: "organiser", to: "v1", act: "book", fields: { date: "day 26" }, at: minutes(19) }];
    const latest = latestWith([["organiser", "v1", "book", { date: "day 26" }, minutes(19, "12:00")], ["organiser", "v1", "accept_contract", { contract: "v1-contract-1" }, minutes(22)]], calls);
    const acts = [acted("call", { to: "v1", act: "book", fields: { date: "day 26" } }, minutes(19)), acted("send_mail", { to: "v1", act: "book", fields: { date: "day 26" } }, minutes(19, "12:00")), acted("send_mail", { to: "v1", act: "accept_contract", fields: { contract: "v1-contract-1" } }, minutes(22))];
    expect(acts.filter((act) => congressParts.misapplications.P02(act, {}, latest, latest)).map(({ arguments: args }) => args.act)).toEqual(["accept_contract"]);
  });

  it("does not list a call with accept_contract nobody answered, nor a mail still in transit", () => {
    const latest = latestWith([], [{ from: "organiser", to: "v1", act: "accept_contract", fields: { contract: "v1-contract-1" }, at: minutes(22) }]);
    expect(congressParts.misapplications.P02(acted("call", { to: "v1", act: "accept_contract", fields: { contract: "v1-contract-1" } }, minutes(22)), {}, latest, latest)).toBe(false);
  });
});

describe("P21's misapplication, the requirement met late (FR-CONGRESS-14)", () => {
  const ALLOCATED = minutes(15, "10:00");
  /** The records: the indicative contract, six confirmed sessions with "s2" in "room-b", the day-12 programme told to registrants, the allocation, and what came after. */
  const records = ({ republished, told = true, s2 = "room-d", registrants = 2 }: { republished: number; told?: boolean; s2?: string; registrants?: number }) => {
    const rooms = SIX.map((speaker) => (speaker === "s2" ? "room-b" : "main-hall"));
    const mail: Mailed[] = [
      ["v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "main-hall, room-b", hours: "08:00-18:00", price: 2000, terms: "Rooms are indicative until allocated." }, minutes(4)],
      ["v1", "organiser", "confirmed", { contract: "v1-contract-1" }, minutes(4, "01:00")],
      ...SIX.flatMap((speaker, index): Mailed[] => [
        ["organiser", speaker, "invite", { session: index + 1, time: TIMES[index] }, minutes(5)],
        [speaker, "organiser", "accept", { session: index + 1 }, minutes(6)],
        ["organiser", speaker, "confirm", { time: TIMES[index], room: rooms[index] }, minutes(7)],
        [speaker, "organiser", "acknowledged", {}, minutes(7, "01:00")],
      ]),
      ["v1", "organiser", "rooms_allocated", { contract: "v1-contract-1", allocation: "main-hall -> main-hall; room-b -> room-d" }, ALLOCATED],
      ...(s2 === "unchanged" ? [] : ([["organiser", "s2", "change", { room: s2 }, republished + 2]] as Mailed[])),
    ];
    const versions = [
      programme(SIX.map((speaker, index) => session([speaker], TIMES[index], rooms[index])), minutes(12), 1),
      programme(SIX.map((speaker, index) => session([speaker], TIMES[index], rooms[index] === "room-b" ? "room-d" : rooms[index])), republished, 2),
    ];
    const people = Array.from({ length: registrants }, (_, index) => ({ id: `a-${index + 1}`, registered: minutes(11), diet: "none", access: "none", pays: true, given: {}, believes: told ? 2 : 1 }));
    const beliefs = people.flatMap(({ id }) => [{ event: "belief", person: id, version: 1, worldTime: worldOf(minutes(12, "01:00")) }, ...(told ? [{ event: "belief", person: id, version: 2, worldTime: worldOf(republished + 1) }] : [])]);
    return world({ mail, programme: versions, people, beliefs });
  };
  const acts = (republished: number) => [acted("publish_programme", { sessions: [session(["s2"], "10:30", "room-b")] }, minutes(12)), acted("publish_programme", { sessions: [session(["s2"], "10:30", "room-d")] }, republished)];
  const listed = (latest: Congress, republished: number) => acts(republished).filter((act) => congressParts.misapplications.P21(act, {}, latest, latest)).length;

  it("lists nothing when, 24 hours after the allocation, the programme, the registrants and every moved speaker have the allocated room", () => {
    expect(listed(records({ republished: minutes(16, "09:00") }), minutes(16, "09:00"))).toBe(0);
  });

  it("lists one misapplication when the programme with the allocated room came later than 24 hours", () => {
    expect(listed(records({ republished: minutes(17) }), minutes(17))).toBe(1);
  });

  it("lists one misapplication when a confirmed speaker of a moved room does not believe its allocated room, or the registrants were last told a version with a moved room", () => {
    expect(listed(records({ republished: minutes(16, "09:00"), s2: "room-b" }), minutes(16, "09:00"))).toBe(1);
    expect(listed(records({ republished: minutes(16, "09:00"), told: false }), minutes(16, "09:00"))).toBe(1);
  });
});
