import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { readCalendar } from "../src/engine/calendar.ts";
import { readMoney, startingMoney } from "../src/engine/money.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { congressScenario } from "../src/scenarios/congress.ts";

// FR-CONGRESS-11: the world's corrections from E1's second technical run.

const calendar = readCalendar({ start: "day 1 Monday 09:00", segments: [{ scale: 6000 }] });

/** A congress with one venue and one speaker, the draw given, and any keys changed. */
function congress(draw: TomlTable = {}, changes: (configuration: TomlTable) => void = () => {}): Scenario<unknown> {
  const configuration = parse(congressScenario.baseConfiguration);
  const venue = { id: "v1", rooms: [{ id: "hall-a", seats: 80 }], access_claim: "step-free", price: 2000, extras: { ramp: 200 }, hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }] };
  Object.assign(configuration, {
    city: stringify({ places: [{ id: "office" }], venues: [{ id: "v1", entrance: "v1-entrance", hours: "always", rooms: [{ id: "hall-a", seats: 80 }] }], passages: [{ between: ["office", "v1-entrance"], length: 5, step_free: true }, { between: ["v1-entrance", "hall-a"], length: 1, step_free: true }] }),
    pools: stringify({ topics: ["soil"], venue: [venue], board: [], speaker: [{ id: "s1", fee: 0, available: true, acceptance: 1 }], partner: [], caterer: [], sponsor: [], agency: [] }),
    draw: stringify({ attendance: [50, 50], venue: 1, speaker: 1, ...draw }),
  });
  (configuration.calendar as TomlTable).hours = { always: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], from: "00:00", to: "23:59" } };
  changes(configuration);
  return { ...(congressScenario as Scenario<unknown>), baseConfiguration: stringify(configuration) };
}

describe("a money account's ceiling from the configuration (FR-CONGRESS-11, FR-MONEY-01)", () => {
  it("is in force from the start, and a negative one is refused, naming it", () => {
    const settings = readMoney({ discretionary_limit: 300, accounts: { ana: { opening: 1500, ceiling: 4000 } } } as never, calendar, ["ana"]);
    expect(startingMoney(settings).ceilings).toEqual({ ana: 4000 });
    expect(() => readMoney({ discretionary_limit: 300, accounts: { ana: { opening: 0, ceiling: -1 } } } as never, calendar, ["ana"])).toThrow(/money\.accounts\.ana\.ceiling/);
  });
});

describe("a fixed budget and an advance (FR-CONGRESS-11)", () => {
  it("draws each as a whole number between its two numbers, gives both in the variant, and opens the organiser's account with the advance and the budget as its ceiling", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const loaded = loadScenario(congress({ budget: [3000, 5000], advance: [1000, 2000] }), seed);
      const { budget, advance } = loaded.variant as { budget: number; advance: number };
      expect(Number.isInteger(budget) && budget >= 3000 && budget <= 5000).toBe(true);
      expect(Number.isInteger(advance) && advance >= 1000 && advance <= 2000).toBe(true);
      const money = (loaded.world.state as { money: { balances: Record<string, number>; ceilings: Record<string, number> } }).money;
      expect([money.balances.organiser, money.ceilings.organiser]).toEqual([advance, budget]);
    }
  });

  it("fills {budget} and {advance} in the texts, and refuses either, naming it and its text, when the draw gives none, and a range whose first number is above its second", () => {
    const loaded = loadScenario(congress({ budget: [4000, 4000], advance: [1500, 1500] }, (configuration) => (configuration.task = "Spend {budget}; you have {advance}.")), 1);
    expect(loaded.channels.find(({ name }) => name === "person")?.stimulus).toBe("Spend 4000; you have 1500.");
    expect(() => loadScenario(congress({}, (configuration) => (configuration.task = "Spend {budget}.")), 1)).toThrow(/task.*\{budget\}/);
    expect(() => loadScenario(congress({ budget: [4000, 4000] }, (configuration) => (configuration.limits = "You have {advance}.")), 1)).toThrow(/limits.*\{advance\}/);
    expect(() => loadScenario(congress({ budget: [5000, 3000] }), 1)).toThrow(/draw\.budget/);
    expect(() => loadScenario(congress({ advance: [2000, 1000] }), 1)).toThrow(/draw\.advance/);
  });
});

describe("no board drawn (FR-CONGRESS-11)", () => {
  it("has the partner's session mail come from the association, which has no mailbox and no line, at the calendar's start", () => {
    const loaded = loadScenario(
      congress({ partner: 1 }, (configuration) => {
        const pools = parse(configuration.pools as string);
        pools.partner = [{ id: "p1", session: 3, fee: 0, available: true }];
        configuration.pools = stringify(pools);
      }),
      1,
    );
    const mail = loaded.mail?.settings;
    expect(mail?.initial.map(({ from, to, act }) => ({ from, to, act }))).toEqual([{ from: "association", to: "organiser", act: "partner_session" }]);
    expect(mail?.mailboxes).not.toContain("association");
    expect(loaded.phone?.settings.lines).not.toContain("association");
  });
});
