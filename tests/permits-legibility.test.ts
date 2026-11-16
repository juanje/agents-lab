import { describe, expect, it } from "vitest";
import { Random } from "../src/engine/random.ts";
import { venueRules } from "../src/scenarios/congress-parties.ts";
import { calls, conversation } from "./fixtures/rules.ts";

// FR-CONGRESS-25: venues and caterers say what a permit is and where it comes from.

/** A venue's parameters with a catering rule: hall-a (90 seats), the day price 2000. */
const venue = (catering: Record<string, unknown>) => ({
  id: "v1",
  rooms: [{ id: "hall-a", seats: 90, equipment: [] }],
  access_claim: "step-free",
  price: 2000,
  hold_days: 2,
  deposit_share: 0.25,
  deposit_due_days: 3,
  cancellation: [{ share: 0.5 }],
  pick_up: 1,
  organiser: "organiser",
  event_day: 26,
  floor_plan: [],
  perturbations: [],
  ...catering,
});

const DAY = "day 1 Monday 09:01";
const message = (act: string, fields = ""): [string, string] => [DAY, `From: organiser. Act: ${act}.${fields}`];
/** What the venue mailed for the messages, each act and fields. */
const mailed = (catering: Record<string, unknown>, messages: [string, string][]) =>
  calls(conversation(venueRules.start(venue(catering), new Random(1)), messages).steps, "send_mail").map(({ act, fields }) => ({ act, fields }) as { act: string; fields: Record<string, unknown> });

describe("a venue says its catering rule in words (FR-CONGRESS-25)", () => {
  const RULES: [Record<string, unknown>, string][] = [
    [{ catering: "outside_free" }, "outside_free: any caterer may serve here; no permit is needed."],
    [
      { catering: "outside_fee", outside_fee_per_head: 7 },
      "outside_fee: outside caterers may serve here for a fee of 7 per head. Ask for the extra outside_catering; when you accept it, we give a permit number your caterer needs on its order.",
    ],
    [
      { catering: "in_house", in_house_diets: { gluten_free: { limit: 5 } } },
      "in_house: our own caterer serves all meals. For a diet it cannot serve in full, ask for the extra outside_catering naming the diet; when you accept it, we give a permit number for an outside caterer, for that diet only.",
    ],
  ];

  it.each(RULES)("gives %j's rule as a sentence in its quote and its terms' Catering sentence", (catering, sentence) => {
    const [quote, terms] = mailed(catering, [message("ask_quote", " date: day 26."), message("request_document", " kind: terms.")]);
    expect(quote).toMatchObject({ act: "quote", fields: { catering: sentence } });
    expect(terms.fields.content).toContain(`Catering: ${sentence} `);
    expect(terms.fields.content).not.toContain(`${sentence}.`);
  });

  it("says nothing of catering when it has no rule", () => {
    const [quote, terms] = mailed({}, [message("ask_quote", " date: day 26."), message("request_document", " kind: terms.")]);
    expect(quote.fields).not.toHaveProperty("catering");
    expect(terms.fields.content).not.toContain("Catering");
  });
});

describe("an in-house venue asked for outside catering without a diet says why (FR-CONGRESS-25)", () => {
  const IN_HOUSE = { catering: "in_house", in_house_diets: { gluten_free: { limit: 5 }, vegetarian: {} } };

  it("answers not_available for outside_catering with the reason", () => {
    expect(mailed(IN_HOUSE, [message("request_extra", " item: outside_catering. attendance: 40.")])).toEqual([
      { act: "not_available", fields: { what: "outside_catering", reason: "name a diet our caterer cannot serve in full" } },
    ]);
  });

  it("gives no reason for a diet its caterer serves in full", () => {
    expect(mailed(IN_HOUSE, [message("request_extra", " item: outside_catering. attendance: 40. diet: vegetarian.")])).toEqual([{ act: "not_available", fields: { what: "outside_catering" } }]);
  });
});
