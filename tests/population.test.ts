import { describe, expect, it } from "vitest";
import { Random } from "../src/engine/random.ts";
import { type AttendeesMaterial, type Population, drawPool, registrationProbability } from "../src/scenarios/population.ts";

/** FR-POPULATION-01's Background material. */
const material = (changes: Partial<AttendeesMaterial> = {}): AttendeesMaterial => ({
  pool_factor: 1,
  base_per_day: 2.4,
  unannounced: 0.25,
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

/** A population whose page is open at the price given, the event on day 26 and the reference price 100. */
const population = (changes: Partial<Population> = {}): { population: Population } => ({
  population: {
    material: material(),
    eventDay: 26,
    referencePrice: 100,
    draws: { s1: 1, s2: 3 },
    people: [],
    page: { open: true, price: 100, required_fields: [], info: [], waiting_list: false },
    announced: true,
    promotions: [],
    programme: [],
    sponsorData: {},
    ...changes,
  },
});

/** World minutes since day 1's midnight of "day <n> HH:MM". */
const at = (day: number, clock = "10:00") => (day - 1) * 1440 + Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

describe("a person's probability of registering in a world hour (FR-POPULATION-01)", () => {
  it("is base_per_day / 24 × f × g × h × r × m", () => {
    expect(registrationProbability(population(), at(2))).toBeCloseTo(0.1);
    // f: unannounced until registration_open was announced to the association.
    expect(registrationProbability(population({ announced: false }), at(2))).toBeCloseTo(0.025);
    // g: above the reference price, exp(−2.5 × (price / reference − 1)).
    expect(registrationProbability(population({ page: { open: true, price: 140, required_fields: [], info: [], waiting_list: false } }), at(2))).toBeCloseTo(0.1 * Math.exp(-1));
    expect(registrationProbability(population({ page: { open: true, price: 0, required_fields: [], info: [], waiting_list: false } }), at(2))).toBeCloseTo(0.1);
    // h: 1 + 0.1 × the draws of the latest programme's speakers.
    const programme = (speakers: string[], version: number) => ({ version, sessions: speakers.map((speaker) => ({ start: "10:00", end: "10:45", title: "t", speakers: [speaker], room: "main-hall" })), breaks: [], sponsor_slots: [], logos: [] });
    expect(registrationProbability(population({ programme: [programme(["s1"], 1), programme(["s1", "s2"], 2)] }), at(2))).toBeCloseTo(0.14);
    // r: by days left before the event.
    expect([at(11), at(12), at(16), at(19), at(22)].map((minutes) => registrationProbability(population(), minutes))).toEqual([0.1, 0.1, expect.closeTo(0.1 * (1 + (2 * 4) / 7), 6), expect.closeTo(0.3, 6), expect.closeTo(0.3, 6)]);
    // m: each promotion running, for 2 world days after it starts.
    expect(registrationProbability(population({ promotions: [{ start: at(2, "09:00"), factor: 2 }, { start: at(1, "09:00"), factor: 3 }] }), at(2))).toBeCloseTo(0.6);
    expect(registrationProbability(population({ promotions: [{ start: at(2, "09:00"), factor: 2 }] }), at(4, "09:00"))).toBeCloseTo(0.1);
  });

  it("is 0 while the page is closed, and at most 1", () => {
    expect(registrationProbability(population({ page: { open: false, price: 100, required_fields: [], info: [], waiting_list: false } }), at(2))).toBe(0);
    expect(registrationProbability(population({ material: material({ base_per_day: 240 }) }), at(2))).toBe(1);
  });
});

describe("the pool (FR-POPULATION-01)", () => {
  it("draws pool_factor × the target attendance people, a-1 onwards, each with a diet, an access need, payment, consent and whether they would come, from the population's sequence", () => {
    const pool = drawPool(material({ pool_factor: 1.5, diets: { none: 0.5, vegan: 0.5 }, consent_share: 0.5, no_show_share: 0.5 }), 4, new Random(1));
    expect(pool.map(({ id }) => id)).toEqual(["a-1", "a-2", "a-3", "a-4", "a-5", "a-6"]);
    const draws = new Random(1);
    const [first] = pool;
    const [diet, access, pays, consents, noShow] = [draws.next(), draws.next(), draws.next(), draws.next(), draws.next()];
    expect(first).toMatchObject({ diet: diet < 0.5 ? "none" : "vegan", access: "none", pays: pays < 1, consents: consents < 0.5, no_show: noShow < 0.5 });
    void access;
    expect(drawPool(material(), 4, new Random(7))).toEqual(drawPool(material(), 4, new Random(7)));
  });

  it("adds the material's fixed people with their windows, and a group of a drawn size with its shared diet", () => {
    const pool = drawPool(
      material({ fixed: [{ id: "w1", access: "wheelchair", between: ["day 2 10:00", "day 2 11:00"] }], group: { size: [8, 8], diet: "gluten_free", between: ["day 3 10:00", "day 3 10:00"] } }),
      2,
      new Random(1),
    );
    const w1 = pool.find(({ id }) => id === "w1");
    expect(w1).toMatchObject({ access: "wheelchair", diet: "none" });
    expect(w1?.registersAt).toBeGreaterThanOrEqual(at(2, "10:00"));
    expect(w1?.registersAt).toBeLessThanOrEqual(at(2, "11:00"));
    const group = pool.filter(({ group: member }) => member === true);
    expect(group).toHaveLength(8);
    for (const member of group) expect(member).toMatchObject({ diet: "gluten_free", registersAt: at(3, "10:00") });
  });
});
