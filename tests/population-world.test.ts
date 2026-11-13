import { describe, expect, it } from "vitest";
import type { Step } from "../src/engine/components.ts";
import type { Mail } from "../src/engine/mail.ts";
import type { Money } from "../src/engine/money.ts";
import { Random } from "../src/engine/random.ts";
import type { Tool } from "../src/engine/tools.ts";
import { type AttendeesMaterial, type Population, type PopulationWorld, populationComponent, populationTools } from "../src/scenarios/population.ts";

/** FR-POPULATION-01's Background material. */
const material = (changes: Partial<AttendeesMaterial> = {}): AttendeesMaterial => ({
  pool_factor: 1,
  base_per_day: 24,
  unannounced: 0,
  promotion_factor: 2,
  payment_fee_share: 0.03,
  cancel_share: 0,
  consent_share: 1,
  pay_share: 1,
  no_show_share: 0,
  diets: { none: 1 },
  access: { none: 1 },
  fixed: [],
  ...changes,
});

/** A world with a population from this material, the event on day 26, money and mail. */
function world(changes: Partial<Population> = {}, given: Partial<AttendeesMaterial> = {}): PopulationWorld {
  return {
    population: {
      material: material(given),
      eventDay: 26,
      referencePrice: 100,
      draws: { s1: 2 },
      people: [],
      page: { open: false, price: 0, required_fields: [], info: [], waiting_list: false },
      announced: false,
      promotions: [],
      programme: [],
      sponsorData: {},
      ...changes,
    },
    money: { balances: { organiser: 0, attendees: null }, invoices: [], commitments: [], ceilings: {}, overruns: [], events: [] } as Money,
    mail: { mailboxes: { organiser: [], s1: [], sp2: [] }, inTransit: [] } as Mail,
    rooms: ["main-hall", "room-b"],
    durations: { edit_ticket_page: 0, ticket_page: 0, publish_programme: 0, announce: 0 },
  };
}

const pop = (state: PopulationWorld) => state.population as Population;
const at = (day: number, clock = "09:00") => {
  const [hours, minutes] = clock.split(":").map(Number);
  return { day, weekday: "Monday" as const, seconds: hours * 3600 + minutes * 60 };
};
const minutesOf = ({ day, seconds }: { day: number; seconds: number }) => (day - 1) * 1440 + seconds / 60;

/** An effector's call, as it lands at a world time. */
function apply(state: PopulationWorld, name: string, args: Record<string, unknown>, when = at(1)) {
  const tool = populationTools({ organiser: "organiser" }).find((each) => each.name === name) as Tool<PopulationWorld> & { kind: "effector" };
  const call = { agent: "organiser", arguments: args, atMs: 0, world: when };
  const refusal = tool.refuses?.(state, call, when);
  if (refusal !== undefined) return { outcome: refusal.outcome, state };
  const check = tool.action?.precondition(state, call);
  if (check !== undefined && !check.holds) return { outcome: check.reason, state };
  return { outcome: "success", state: tool.action?.effect(state, call) as PopulationWorld };
}

/** A sensor's result. */
function sense(state: PopulationWorld, name: string, args: Record<string, unknown>) {
  const tool = populationTools({ organiser: "organiser" }).find((each) => each.name === name) as Tool<PopulationWorld> & { kind: "sensor" };
  return JSON.parse(tool.sense(state, "organiser", args, 0, at(1)));
}

describe("the organiser's ticket page, programme and announcements (FR-POPULATION-01)", () => {
  it("edit_ticket_page changes the page from then on, and refuses a value it cannot take as invalid_value", () => {
    const { state } = apply(world(), "edit_ticket_page", { open: true, price: 100, cap: 2, close_date: "day 20", required_fields: ["diet"], info: ["date"], waiting_list: true });
    expect(pop(state).page).toEqual({ open: true, price: 100, cap: 2, close_date: "day 20", required_fields: ["diet"], info: ["date"], waiting_list: true });
    for (const wrong of [{ price: -1 }, { cap: -2 }, { close_date: "Monday" }, { required_fields: ["shoe size"] }, { info: ["menu"] }]) expect(apply(world(), "edit_ticket_page", wrong).outcome).toBe("invalid_value");
  });

  it("ticket_page gives the page's settings, registrations by day and the diets and needs given; or each registrant and the waiting list", () => {
    const state = world({
      page: { open: true, price: 100, required_fields: ["diet"], info: [], waiting_list: true },
      people: [
        { id: "a-1", diet: "vegan", access: "none", pays: true, consents: true, no_show: false, registered: minutesOf(at(1, "10:00")), given: { diet: "vegan" } },
        { id: "a-2", diet: "none", access: "wheelchair", pays: true, consents: true, no_show: false, registered: minutesOf(at(2, "10:00")), given: { diet: "none" } },
        { id: "a-3", diet: "none", access: "none", pays: true, consents: true, no_show: false, waiting: true, given: {} },
      ],
    });
    expect(sense(state, "ticket_page", { detail: "summary" })).toMatchObject({ open: true, price: 100, registrations: 2, by_day: { "day 1": 1, "day 2": 1 }, diets: { vegan: 1, none: 1 }, access: {}, waiting_list: 1 });
    expect(sense(state, "ticket_page", { detail: "list" })).toEqual({ registrants: [{ id: "a-1", diet: "vegan" }, { id: "a-2", diet: "none" }], waiting_list: ["a-3"] });
  });

  it("publish_programme adds a version, refusing two sessions at once in one room or a room the chosen venues lack", () => {
    const session = (start: string, room: string, speaker = "s1") => ({ start, end: `${start.slice(0, 2)}:45`, title: "t", speakers: [speaker], room });
    const { state, outcome } = apply(world(), "publish_programme", { sessions: [session("10:00", "main-hall"), session("11:00", "room-b", "s4")], sponsor_slots: [{ sponsor: "sp1", start: "09:30" }], logos: ["sp2"] });
    expect(outcome).toBe("success");
    expect(pop(state).programme).toEqual([{ version: 1, sessions: [session("10:00", "main-hall"), session("11:00", "room-b", "s4")], breaks: [], sponsor_slots: [{ sponsor: "sp1", start: "09:30" }], logos: ["sp2"] }]);
    expect(apply(state, "publish_programme", { sessions: [session("10:00", "main-hall"), session("10:30", "main-hall", "s4")] }).outcome).toBe("invalid_value");
    expect(apply(state, "publish_programme", { sessions: [session("10:00", "ballroom")] }).outcome).toBe("invalid_value");
  });

  it("announce sets f, starts a promotion, makes registrants believe the latest version, and asks registrants for needs or to cancel if they cannot come", () => {
    const registered = { diet: "none", access: "none", pays: true, consents: true, no_show: false, registered: 0, given: {} };
    const base = world({ people: [{ id: "a-1", ...registered }], programme: [{ version: 1, sessions: [], breaks: [], sponsor_slots: [], logos: [] }, { version: 2, sessions: [], breaks: [], sponsor_slots: [], logos: [] }] });
    expect(pop(apply(base, "announce", { audience: "association_list", kind: "registration_open" }).state).announced).toBe(true);
    expect(pop(apply(base, "announce", { audience: "association_list", kind: "promotion" }, at(2)).state).promotions).toEqual([{ start: minutesOf(at(2)), factor: 2 }]);
    expect(pop(apply(base, "announce", { audience: "registrants", kind: "programme" }).state).people[0].believes).toBe(2);
    expect(pop(apply(base, "announce", { audience: "registrants", kind: "request_needs" }, at(3)).state).needsRequested).toBe(minutesOf(at(3)));
    expect(pop(apply(base, "announce", { audience: "registrants", kind: "request_cancel_if_not_coming" }, at(3)).state).cancelRequested).toBe(minutesOf(at(3)));
    expect(apply(base, "announce", { audience: "everyone", kind: "programme" }).outcome).toBe("invalid_value");
  });
});

/** Runs the population's cycle until a world time, applying its actions, with one world minute a millisecond of the run. */
function cycleUntil(state: PopulationWorld, until: number, random = new Random(1), from = minutesOf(at(1))) {
  const component = populationComponent({ organiser: "organiser", target: 4, msFor: (minutes) => minutes });
  const cycle = component.cycle(random);
  let now = from;
  let outcome: string | undefined;
  let current = state;
  const delivered: Step<PopulationWorld>[] = [];
  for (let guard = 0; guard < 10_000; guard += 1) {
    const world = { day: Math.floor(now / 1440) + 1, weekday: "Monday" as const, seconds: Math.round((now % 1440) * 60) };
    const step = cycle.next(current, outcome, 0, world);
    outcome = undefined;
    if (step.kind === "end") break;
    if (step.kind === "wait") {
      if (now + step.ms > until) break;
      now += step.ms;
    } else if (step.kind === "action") {
      current = step.action.effect(current, { component: "attendees", atMs: 0, world });
      outcome = "success";
    } else if (step.kind === "deliver") delivered.push(step);
  }
  return { state: current, delivered, component };
}

const opened = (changes: Partial<Population> = {}, given: Partial<AttendeesMaterial> = {}) => world({ page: { open: true, price: 100, required_fields: [], info: [], waiting_list: false }, announced: true, ...changes }, given);

describe("the population, a component with its own sequence (FR-POPULATION-01)", () => {
  it("draws its pool first, then each world hour registers each person by the probability, the attendees paying the price less the fee", () => {
    const { state } = cycleUntil(opened(), minutesOf(at(1, "11:00")));
    expect(pop(state).people.map(({ id, registered }) => [id, registered])).toEqual(["a-1", "a-2", "a-3", "a-4"].map((id) => [id, minutesOf(at(1, "10:00"))]));
    expect(state.money.events.filter(({ kind }) => kind === "transfer").map(({ from, to, amount }) => [from, to, amount])).toEqual(Array.from({ length: 4 }, () => ["attendees", "organiser", 97]));
    expect(pop(state).events?.filter(({ event }) => event === "registration")).toHaveLength(4);
  });

  it("registers nobody while the page is closed, before the announcement, past its closing date or its cap, and puts the rest on the waiting list", () => {
    expect(pop(cycleUntil(world(), minutesOf(at(2))).state).people.some(({ registered }) => registered !== undefined)).toBe(false);
    const closed = cycleUntil(opened({ page: { open: true, price: 100, close_date: "day 1", required_fields: [], info: [], waiting_list: false } }), minutesOf(at(2))).state;
    expect(pop(closed).people.some(({ registered }) => registered !== undefined)).toBe(false);
    const capped = cycleUntil(opened({ page: { open: true, price: 100, cap: 2, required_fields: [], info: [], waiting_list: true } }), minutesOf(at(1, "11:00"))).state;
    expect(pop(capped).people.filter(({ registered }) => registered !== undefined)).toHaveLength(2);
    expect(pop(capped).people.filter(({ waiting }) => waiting === true)).toHaveLength(2);
  });

  it("collects only the fields the page requires, and a person with a need it did not ask about mails the organiser within a day", () => {
    const { state } = cycleUntil(
      opened({ page: { open: true, price: 100, required_fields: ["diet"], info: [], waiting_list: false } }, { fixed: [{ id: "w1", access: "wheelchair", between: ["day 2 10:00", "day 2 11:00"] }] }),
      minutesOf(at(4)),
    );
    const w1 = pop(state).people.find(({ id }) => id === "w1");
    expect(w1?.given).toEqual({ diet: "none" });
    const [question] = state.mail.inTransit.filter(({ from }) => from === "w1");
    expect(question).toMatchObject({ to: "organiser", act: "question", fields: { about: "access" } });
    expect(minutesOf(question.sent) - (w1?.registered as number)).toBeLessThanOrEqual(1440);
  });

  it("cancels a registrant at the time drawn as they registered, before the event", () => {
    const { state } = cycleUntil(opened({}, { cancel_share: 1 }), minutesOf(at(26)));
    expect(pop(state).people.every(({ cancelled }) => cancelled !== undefined && cancelled < minutesOf(at(26, "00:00")))).toBe(true);
  });

  it("answers a request for needs within a day, and draws, for each registrant who would not come, a cancellation with probability 0.5", () => {
    // Registrants who gave no diet, asked once the page requires it.
    const registrant = (id: string) => ({ id, diet: "vegan", access: "none", pays: true, consents: true, no_show: false, registered: 0, given: {} });
    const asked = cycleUntil(opened({ people: ["a-1", "a-2", "a-3", "a-4"].map(registrant), page: { open: true, price: 100, required_fields: ["diet"], info: [], waiting_list: false }, needsRequested: minutesOf(at(1, "12:00")) }), minutesOf(at(3))).state;
    expect(pop(asked).people.map(({ given }) => given.diet)).toEqual(["vegan", "vegan", "vegan", "vegan"]);
    const told = cycleUntil(opened({ cancelRequested: minutesOf(at(1, "12:00")) }, { no_show_share: 1 }), minutesOf(at(2))).state;
    const draws = pop(told).events?.filter(({ event }) => event === "cancel_draw") ?? [];
    expect(draws).toHaveLength(4);
    for (const draw of draws) expect(pop(told).people.find(({ id }) => id === draw.person)?.cancelled !== undefined).toBe((draw.draw as number) < 0.5);
  });

  it("starts a speaker's promotion when its promoting mail is sent, scaled by its draw, and records a sponsor's attendee list", () => {
    const promoting = { id: "m-1", from: "s1", to: "organiser", act: "promoting", fields: {}, subject: "promoting", sent: at(1, "12:00") };
    const list = { id: "m-2", from: "organiser", to: "sp2", act: "send_attendee_list", fields: { list: "a-1, a-2, a-99" }, subject: "send_attendee_list", sent: at(1, "13:00") };
    const state = opened({}, { consent_share: 0.5 });
    state.mail = { ...state.mail, inTransit: [promoting, list] };
    const { state: after } = cycleUntil(state, minutesOf(at(1, "15:00")));
    expect(pop(after).promotions).toEqual([{ start: minutesOf(at(1, "12:00")), factor: 2 * (1 + 0.25 * 2) }]);
    const held = pop(after).sponsorData.sp2;
    expect(held.ids).toEqual(["a-1", "a-2"]);
    expect([...held.consented, ...held.without].sort()).toEqual(["a-1", "a-2"]);
  });

  it("tells each speaker of a new programme version its session's time and room", () => {
    const programme = { version: 1, sessions: [{ start: "10:00", end: "10:45", title: "t", speakers: ["s1"], room: "main-hall" }], breaks: [], sponsor_slots: [], logos: [] };
    const { delivered } = cycleUntil(world({ programme: [programme] }), minutesOf(at(1, "10:00")));
    expect(delivered).toEqual([{ kind: "deliver", agent: "s1", channel: "programme", held: false, values: { time: "10:00", room: "main-hall" } }]);
  });

  it("gives its outcome: registrations by day and diet, payments, cancellations, the waiting list, consents and the versions believed", () => {
    const { state, component } = cycleUntil(opened(), minutesOf(at(1, "11:00")));
    expect(component.outcome?.(state)).toEqual({
      registrations: 4,
      registrations_by_day: JSON.stringify({ "day 1": 4 }),
      registrations_by_diet: JSON.stringify({ none: 4 }),
      registrations_by_access: JSON.stringify({ none: 4 }),
      payments: 4,
      cancellations: 0,
      waiting_list: 0,
      consents: 0,
      believed_versions: JSON.stringify({}),
    });
  });
});
