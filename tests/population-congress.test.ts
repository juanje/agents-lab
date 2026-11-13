import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { Random } from "../src/engine/random.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import type { Stimulus } from "../src/engine/stimuli.ts";
import { speakerRules, sponsorRules } from "../src/scenarios/congress-parties.ts";
import { type Congress, congressScenario } from "../src/scenarios/congress.ts";
import { calls, drive, tools } from "./fixtures/rules.ts";

/** FR-POPULATION-01's Background material. */
const MATERIAL = { pool_factor: 1, base_per_day: 24, unannounced: 0, promotion_factor: 2, payment_fee_share: 0.03, cancel_share: 0, consent_share: 1, pay_share: 1, diets: { none: 1 }, access: { none: 1 }, fixed: [] };

/** The congress with the speaker "s1" (draw 2), a target attendance of 4, the reference price 100 and the attendees material, changed as given. */
function congress(changes: (configuration: TomlTable, material: TomlTable) => void = () => {}): Scenario<unknown> {
  const configuration = parse(congressScenario.baseConfiguration);
  const material = structuredClone(MATERIAL) as unknown as TomlTable;
  configuration.city = stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "main-hall", seats: 100 }] }], passages: [{ between: ["office", "v1-entrance"], length: 10, step_free: true }] });
  (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
  configuration.pools = stringify({ topics: ["soil"], venue: [{ id: "v1", rooms: [{ id: "main-hall", seats: 100 }], access_claim: "step-free", price: 2000, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }] }], board: [], speaker: [{ id: "s1", draw: 2, fee: 0, available: true, acceptance: 1 }], partner: [], caterer: [], sponsor: [], agency: [] });
  configuration.draw = stringify({ attendance: [4, 4], venue: 1, speaker: 1 });
  configuration.similar_events = stringify({ events: [{ topic: "soil", name: "Soil Days", price: 100, size: 100 }] });
  changes(configuration, material);
  configuration.attendees = stringify(material);
  return { ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) };
}

describe("the congress's population (FR-POPULATION-01)", () => {
  it("keeps a population with its material, the event's day, the reference price and the speakers' draws, and runs the attendees component", () => {
    const loaded = loadScenario(congress(), 1);
    const { population } = loaded.world.state as Congress;
    expect(population).toMatchObject({ eventDay: 26, referencePrice: 100, draws: { s1: 2 }, people: [], page: { open: false, price: 0, required_fields: [], info: [], waiting_list: false }, announced: false });
    expect(loaded.components.map(({ name }) => name)).toEqual(["attendees"]);
    expect(loaded.money?.settings.accounts).toEqual(expect.arrayContaining([{ name: "attendees", unlimited: true }]));
  });

  it("keeps no population, and runs no component, without an attendees material", () => {
    const loaded = loadScenario(congress((configuration) => delete configuration.attendees), 1);
    expect((loaded.world.state as Congress).population).toBeUndefined();
    expect(loaded.components).toEqual([]);
  });

  it("offers the organiser the ticket page, the programme and announcements, and logs each change of the population as a population line", () => {
    const names = congressScenario.tools.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining(["edit_ticket_page", "ticket_page", "publish_programme", "announce"]));
    const state = loadScenario(congress(), 1).world.state as Congress;
    const after = { ...state, population: { ...(state.population as NonNullable<Congress["population"]>), events: [{ event: "registration" as const, person: "a-1" }] } };
    expect(congressScenario.logLines?.(state, after)).toEqual([{ type: "population", event: "registration", person: "a-1" }]);
  });

  it("refuses, naming it, an attendees material it cannot follow", () => {
    const refusing = (changing: (material: TomlTable) => void) => () => loadScenario(congress((_configuration, material) => changing(material)), 1);
    expect(refusing((material) => (material.diets = { none: 0.5, vegan: 0.4 }))).toThrow(/attendees\.diets/);
    expect(refusing((material) => (material.base_per_day = -1))).toThrow(/attendees\.base_per_day/);
    expect(refusing((material) => (material.consent_share = 1.5))).toThrow(/attendees\.consent_share/);
    expect(refusing((material) => (material.payment_fee_share = -0.1))).toThrow(/attendees\.payment_fee_share/);
    expect(refusing((material) => (material.fixed = [{ id: "w1", between: ["day 3 10:00", "day 2 10:00"] }]))).toThrow(/"w1"/);
    expect(refusing((material) => (material.group = { size: [12, 8], diet: "none", between: ["day 3 10:00", "day 3 11:00"] }))).toThrow(/group_size/);
  });
});

describe("speakers and sponsors and the programme (FR-POPULATION-01)", () => {
  it("a speaker believes the session a published programme gives it", () => {
    const programme: Stimulus = { channel: "programme", source: "the programme", content: "Your session in the programme: 10:00 in main-hall." };
    const rules = speakerRules.start({ id: "s1", fee: 0, available: true, acceptance: 1, organiser: "organiser", event_day: 26 }, new Random(1));
    drive(rules, tools(() => ""));
    drive(rules, tools(() => ""), [[programme]], true);
    expect(rules.outcome()).toMatchObject({ believes_time: "10:00", believes_room: "main-hall" });
  });

  it("a sponsor with an agreement reads the programme on day 19 and day 25, and mails condition_missing for a logo or slot it agreed to that is not there", () => {
    const rules = sponsorRules.start({ id: "sp1", amount: 1200, conditions: ["logo", "morning_slot"], insists: [], pay_days: [2, 2], organiser: "organiser" }, new Random(1));
    const clock = { time: "day 2 Tuesday 10:00" };
    const programme = JSON.stringify({ version: 1, sessions: [], breaks: [], sponsor_slots: [{ sponsor: "sp1", start: "09:30" }], logos: [] });
    const answer = (message: string) => (tool: string, args: Record<string, unknown>) => (tool === "read_programme" ? { text: programme } : tools(() => message, () => clock.time)(tool, args));
    drive(rules, answer(""));
    const waiting = drive(rules, answer("From: organiser. Act: accept_sponsorship. conditions: logo, morning_slot."), [[{ channel: "mail_notice", source: "mail client", content: "x" }]], true);
    expect(waiting.at(-1)).toEqual({ kind: "wait", minutes: 18 * 1440 - (1440 + 600) });
    clock.time = "day 19 Saturday 00:00";
    const checked = drive(rules, answer(""), [[]], true);
    expect(calls(checked, "read_programme")).toHaveLength(1);
    expect(calls(checked, "send_mail")).toEqual([{ to: "organiser", act: "condition_missing", fields: { condition: "logo" } }]);
    expect(checked.at(-1)).toEqual({ kind: "wait", minutes: 6 * 1440 });
  });
});
