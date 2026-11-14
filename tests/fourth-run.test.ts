import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import type { Act } from "../src/engine/parts.ts";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { sponsorRules, venueRules } from "../src/scenarios/congress-parties.ts";
import { congressParts } from "../src/scenarios/congress-parts.ts";
import { type Congress, congressScenario } from "../src/scenarios/congress.ts";
import { calls, conversation, drive, notice, tools, venueChange } from "./fixtures/rules.ts";

// FR-CONGRESS-15: the corrections from E1's fourth technical run.

/** A congress with one venue, two speakers, the partner "p1", one caterer and one sponsor, the draw given, and any keys changed. */
function congress(draw: TomlTable = {}, changes: (configuration: TomlTable, pools: Record<string, TomlTable[]>) => void = () => {}): Scenario<unknown> {
  const configuration = parse(congressScenario.baseConfiguration);
  const pools: Record<string, TomlTable[]> = {
    venue: [{ id: "v1", rooms: [{ id: "hall-a", seats: 80 }], access_claim: "step-free", price: 1881, extras: {}, hold_days: 2, deposit_share: 0.3, deposit_due_days: 3, cancellation: [{ share: 0.5 }] }],
    board: [],
    speaker: ["s1", "s2"].map((id, index) => ({ id, title: `Soil ${index + 1}`, fee: 0, home: "local", available: true, acceptance: 1 })),
    partner: [{ id: "p1", title: "Partner's soil", session: 3, fee: 0, home: "north", available: true }],
    caterer: [{ id: "c1", price_per_head: 38, final_days: 7, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.3 }] }],
    sponsor: [{ id: "sp1", amount: 1000, conditions: ["logo"], pay_days: [2, 2] }],
    agency: [],
  };
  Object.assign(configuration, {
    city: stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "hall-a", seats: 80 }] }], passages: [{ between: ["office", "v1-entrance"], length: 5, step_free: true }, { between: ["v1-entrance", "hall-a"], length: 1, step_free: true }] }),
    draw: stringify({ attendance: [40, 40], venue: 1, speaker: 2, partner: 1, caterer: 1, sponsor: 1, budget: [4000, 4000], advance: [1500, 1500], ...draw }),
    attendees: stringify({ pool_factor: 1, base_per_day: 0, unannounced: 0, promotion_factor: 1, payment_fee_share: 0, diets: { none: 1 }, access: { none: 1 } }),
    travel: stringify({ stations: ["north"], trains: [{ id: "t1", from: "north", arrives: "08:30", price: 0 }], hotels: [], sold_out_probability: 0 }),
  });
  (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
  changes(configuration, pools);
  configuration.pools = stringify({ topics: ["soil"], ...pools });
  return { ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) };
}

describe("the reference price's floor (FR-CONGRESS-15)", () => {
  it("is the plan caterer's price per head when the break-even price is below it, and the break-even price otherwise", () => {
    // Break-even at 30 paying: (1881 + 35 × 38 − 1500 − 1000) / 30 = 23.7, below 38 a head.
    expect((loadScenario(congress({ break_even_share: [0.75, 0.75] }), 1).variant as { reference_price: number }).reference_price).toBe(38);
    const above = loadScenario(congress({ break_even_share: [0.75, 0.75] }, (_configuration, pools) => (pools.caterer[0].price_per_head = 20)), 1).variant as { reference_price: number };
    // (1881 + 35 × 20 − 2500) / 30 = 2.7: below 20 a head too.
    expect(above.reference_price).toBe(20);
    const high = loadScenario(congress({ break_even_share: [0.75, 0.75] }, (_configuration, pools) => (pools.venue[0].price = 4000)), 1).variant as { reference_price: number };
    // (4000 + 1330 − 2500) / 30 = 94.33, above 38.
    expect(high.reference_price).toBeCloseTo(2830 / 30, 10);
  });
});

describe("the partner as a contact, with a written mail (FR-CONGRESS-15)", () => {
  it("lists the partner in the directory as its own kind, after the speakers and before the caterers, with its title, home and acts", () => {
    const loaded = loadScenario(congress({}, (configuration) => (configuration.knowledge = "{directory}")), 1);
    const lines = (loaded.systemPrompts.get("organiser") ?? "").split("\n");
    expect(lines).toContain("A partner takes confirm (time, room, length, travel), change, ask_slides (by).");
    expect(lines).toContain('- p1: partner, with a mailbox and a line; "Partner\'s soil", from north');
    const kinds = lines.filter((line) => line.startsWith("- ")).map((line) => (/^- [\w-]+: (\w+)/.exec(line) as RegExpExecArray)[1]);
    expect(kinds).toEqual(["venue", "speaker", "speaker", "partner", "caterer", "sponsor"]);
  });

  it("gives the partner's session mail its template's mail as text, {speaker} and {session} filled in", () => {
    const loaded = loadScenario(congress({}, (_configuration, pools) => (pools.partner[0].mail = "Speaker {speaker} gives session {session}.")), 1);
    expect(loaded.mail?.settings.initial[0]).toMatchObject({ from: "association", act: "partner_session", text: "Speaker p1 gives session 3." });
  });

  it("refuses a partner mail that names another brace, naming the template and mail", () => {
    expect(() => loadScenario(congress({}, (_configuration, pools) => (pools.partner[0].mail = "Speaker {speaker} at {room}.")), 1)).toThrow(/p1.*mail|mail.*p1/);
  });
});

describe("venues' cancelled contracts and offered options (FR-CONGRESS-15)", () => {
  const venue = (rooms = [{ id: "hall-a", seats: 80 }]) => ({ id: "v1", rooms, access_claim: "step-free", price: 2000, extras: {}, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0 }], pick_up: 1, organiser: "organiser", event_day: 26, floor_plan: [], perturbations: [] });
  const book = (rooms: string): [string, string] => ["day 1 Monday 09:01", `From: organiser. Act: book. date: day 26. rooms: ${rooms}. hours: 08:00-18:00.`];
  const accept: [string, string] = ["day 1 Monday 09:02", "From: organiser. Act: accept_contract. contract: v1-contract-1."];
  const mailed = (steps: ReturnType<typeof drive>) => calls(steps, "send_mail").map(({ act }) => act);

  it("answers not_available to accept_contract for a contract it cancelled", () => {
    const { steps } = conversation(venueRules.start(venue(), new Random(1)), [book("hall-a"), accept, ["day 1 Monday 10:00", "From: organiser. Act: cancel_booking."], ["day 1 Monday 11:00", "From: organiser. Act: accept_contract. contract: v1-contract-1."]]);
    expect(mailed(steps)).toEqual(["contract", "confirmed", "cancelled", "not_available"]);
    expect(calls(steps, "commit")).toHaveLength(1);
  });

  /** A venue that announced a change of a kind on a booking of these rooms, and its answer to accept_change with the option given. */
  const answered = (kind: string, rooms: { id: string; seats: number }[], booked: string, option?: string) => {
    const rules = venueRules.start(venue(rooms), new Random(1));
    conversation(rules, [book(booked), accept]);
    const changed = drive(rules, tools(() => "", () => "day 1 Monday 12:00"), [[venueChange(kind)]], true);
    const message = `From: organiser. Act: accept_change.${option === undefined ? "" : ` option: ${option}.`}`;
    const steps = drive(rules, tools(() => message, () => "day 1 Monday 13:00"), [[notice]], true);
    const again = drive(rules, tools(() => "From: organiser. Act: accept_change.", () => "day 1 Monday 14:00"), [[notice]], true);
    return { changed: mailed(changed), answer: mailed(steps), again: mailed(again) };
  };
  const two = [{ id: "hall-a", seats: 80 }, { id: "hall-b", seats: 40 }];

  it("answers not_available to an option the change did not offer, and keeps the change pending", () => {
    expect(answered("price_change", [{ id: "hall-a", seats: 80 }], "hall-a", "smaller_room")).toEqual({ changed: ["price_change"], answer: ["not_available"], again: ["confirmed"] });
    expect(answered("price_change", [{ id: "hall-a", seats: 80 }], "hall-a").answer).toEqual(["confirmed"]);
    expect(answered("room_lost", two, "hall-a, hall-b", "smaller_room")).toEqual({ changed: ["room_lost"], answer: ["not_available"], again: ["confirmed"] });
    expect(answered("room_lost", two, "hall-a, hall-b", "price_cut").answer).toEqual(["confirmed"]);
    expect(answered("room_lost", two, "hall-a, hall-b", "discount").answer).toEqual(["not_available"]);
  });
});

describe("a withdrawn sponsor rests (FR-CONGRESS-15)", () => {
  it("drops the payments it had pending, pays nothing more, and waits for nothing", () => {
    const sponsor = { id: "sp1", amount: 1000, conditions: ["logo"], insists: [], pay_days: [4, 4], pick_up: 1, organiser: "organiser" };
    const rules = sponsorRules.start(sponsor, new Random(1));
    conversation(rules, [["day 1 Monday 10:00", "From: organiser. Act: accept_sponsorship. conditions: logo."]]);
    const ledger = () => ({ invoices_to_pay: [{ id: "i-1", from: "organiser", amount: 1000, due: "day 5", for: "sponsorship", paid: false, issued: "day 1 11:00" }] });
    const invoiced = drive(rules, tools(() => "", () => "day 1 Monday 11:00", ledger), [[{ channel: "invoice_notice", source: "organiser", content: "New invoice" }]], true);
    expect(invoiced.at(-1)).toMatchObject({ kind: "wait" });
    const withdrawn = drive(rules, tools(() => "", () => "day 4 Thursday 09:00", ledger), [[{ channel: "sponsor_withdraws", source: "the sponsor's board", content: "Withdraw." }]], true);
    expect(calls(withdrawn, "send_mail").map(({ act }) => act)).toEqual(["withdraw"]);
    expect(calls(withdrawn, "pay")).toEqual([]);
    // It rests until something reaches it: no wait to wake it.
    expect(withdrawn.some((step) => step.kind === "wait")).toBe(false);
  });
});

describe("P21 lists one act per late allocation (FR-CONGRESS-15)", () => {
  const minutes = (day: number, clock = "00:00") => (day - 1) * 1440 + Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  const worldOf = (at: number) => ({ day: Math.floor(at / 1440) + 1, weekday: "Monday" as const, seconds: Math.round((at % 1440) * 60) });
  const acted = (tool: string, args: Record<string, unknown>, at: number): Act => ({ agent: "organiser", tool, arguments: args, world: worldOf(at) });
  const message = (from: string, to: string, act: string, fields: Record<string, unknown>, at: number) => ({ id: `m-${at}`, from, to, act, fields, subject: act, sent: worldOf(at), received: worldOf(at), read: true });
  const sessions = [{ start: "10:30", end: "11:15", title: "t", speakers: ["s2"], room: "room-b" }];
  const latest = {
    rooms: { foyer: { venue: "v1" }, "main-hall": { venue: "v1", seats: 120 }, "room-b": { venue: "v1", seats: 30 }, "room-d": { venue: "v1", seats: 120 } },
    venues: { v1: { entrance: "v1-entrance", hours: "always" } },
    passages: [],
    mail: {
      mailboxes: {
        organiser: [
          message("v1", "organiser", "contract", { contract: "v1-contract-1", date: "day 26", rooms: "main-hall, room-b", terms: "Rooms are indicative until allocated." }, minutes(4)),
          message("v1", "organiser", "confirmed", { contract: "v1-contract-1" }, minutes(4, "01:00")),
          message("v1", "organiser", "rooms_allocated", { contract: "v1-contract-1", allocation: "main-hall -> main-hall; room-b -> room-d" }, minutes(15, "10:00")),
        ],
        s2: [message("organiser", "s2", "confirm", { time: "10:30", room: "room-b" }, minutes(6))],
      },
      inTransit: [],
    },
    phone: { calls: [] },
    money: { balances: {}, invoices: [], commitments: [], ceilings: {}, overruns: [], events: [] },
    population: { people: [], programme: [{ version: 1, sessions, breaks: [], sponsor_slots: [], logos: [], published: minutes(12) }], events: [], announcements: [{ audience: "registrants", kind: "request_needs", at: minutes(13) }, { audience: "registrants", kind: "programme", at: minutes(14) }], page: { open: true, price: 50, required_fields: [], info: [], waiting_list: false }, referencePrice: 40, edits: [] },
    perturbations: [],
    visits: [],
    travel: { material: { stations: [], trains: [], hotels: [], sold_out_probability: 0 }, booked: [], soldOutDraws: {} },
    context: { eventDay: 26, helpers: 2, target: 50, endOfPreparation: minutes(26, "06:30"), roles: {}, noShowCut: 0.05, discretionaryLimit: 300, catering: {} },
  } as unknown as Congress;

  it("lists the organiser's last act before the allocation that told a moved room, and never an announcement", () => {
    const acts = [
      acted("send_mail", { to: "s2", act: "confirm", fields: { time: "10:30", room: "room-b" } }, minutes(6)),
      acted("publish_programme", { sessions }, minutes(12)),
      acted("announce", { audience: "registrants", kind: "request_needs" }, minutes(13)),
      acted("announce", { audience: "registrants", kind: "programme" }, minutes(14)),
    ];
    const listed = acts.filter((act) => congressParts.misapplications.P21(act, {}, latest, latest));
    expect(listed.map(({ tool, world }) => [tool, world.day])).toEqual([["publish_programme", 12]]);
  });
});
