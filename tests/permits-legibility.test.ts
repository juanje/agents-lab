import { describe, expect, it } from "vitest";
import { Random } from "../src/engine/random.ts";
import { catererRules, venueRules } from "../src/scenarios/congress-parties.ts";
import { type ToolAnswer, calls, conversation, drive, notice, tools } from "./fixtures/rules.ts";

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
    expect(terms.fields.content).toContain(`Catering: ${sentence}`);
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

describe("a caterer's refusal says what it needs, and an order names its venue (FR-CONGRESS-25)", () => {
  /** The permits the venues gave, by id: "v2-permit-1" for outside catering, "v1-permit-1" for 8 gluten_free meals. */
  const GIVEN: Record<string, Record<string, unknown>> = {
    "v2-permit-1": { venue: "v2" },
    "v1-permit-1": { venue: "v1", diet: "gluten_free", attendance: 8 },
  };
  /** "c1", which knows each venue's rule, and its answers to the organiser's messages, each written as read_mail renders it. */
  const caterer = () => {
    const rules = catererRules.start(
      {
        id: "c1",
        price_per_head: 30,
        final_days: 7,
        deposit_share: 0.2,
        deposit_due_days: 3,
        cancellation: [{ share: 0.3 }],
        organiser: "organiser",
        event_day: 26,
        venues: { v1: { catering: "in_house" }, v2: { catering: "outside_fee" }, v3: { catering: "outside_free" } },
      },
      new Random(1),
    );
    drive(rules, tools(() => ""));
    return (text: string) => {
      const permits: ToolAnswer = (tool, args) =>
        tool === "read_permit" ? { text: GIVEN[String(args.permit)] === undefined ? "No such permit." : JSON.stringify({ permit: args.permit, ...GIVEN[String(args.permit)] }) } : tools(() => text)(tool, args);
      return calls(drive(rules, permits, [[notice]], true), "send_mail").map(({ act, fields }) => ({ act, fields }));
    };
  };
  const order = (fields: string) => caterer()(`From: organiser. Act: order. date: day 26.${fields}`)[0];

  it("refuses venue_requires_permit naming the venue and where its permit comes from", () => {
    expect(order(" venue: v2. counts: standard: 40.")).toEqual({
      act: "order_refused",
      fields: { reason: "venue_requires_permit", venue: "v2", needs: "the permit number v2 gives when you accept its extra outside_catering" },
    });
  });

  it("refuses permit_unknown naming the venue, the permit given, and that the venue did not give it", () => {
    expect(order(" venue: v2. permit: outside_catering. counts: standard: 40.")).toEqual({
      act: "order_refused",
      fields: { reason: "permit_unknown", venue: "v2", permit: "outside_catering", needs: "a permit number v2 gave you; v2 did not give this one" },
    });
    expect(order(" venue: v2. permit: v1-permit-1. counts: standard: 40.")).toMatchObject({ fields: { reason: "permit_unknown", permit: "v1-permit-1" } });
  });

  it("refuses permit_exceeded naming the permit's diet and attendance", () => {
    const exceeded = { act: "order_refused", fields: { reason: "permit_exceeded", diet: "gluten_free", attendance: 8, needs: "only gluten_free meals, at most 8" } };
    expect(order(" venue: v1. permit: v1-permit-1. counts: gluten_free: 9.")).toEqual(exceeded);
    expect(order(" venue: v1. permit: v1-permit-1. counts: gluten_free: 6; standard: 2.")).toEqual(exceeded);
  });

  it("still confirms an order with a permit the venue gave", () => {
    expect(order(" venue: v2. permit: v2-permit-1. counts: standard: 40.").act).toBe("order_confirmed");
  });

  it("refuses an order with no venue as venue_required, and holds no order", () => {
    const answer = caterer();
    expect(answer("From: organiser. Act: order. date: day 26. counts: standard: 40.")).toEqual([{ act: "order_refused", fields: { reason: "venue_required" } }]);
    expect(answer("From: organiser. Act: final_numbers. counts: standard: 40.")).toEqual([{ act: "not_available", fields: { what: "order" } }]);
  });

  it("checks the venue before anything else in the order, even an order it holds for the date", () => {
    const answer = caterer();
    expect(answer("From: organiser. Act: order. date: day 26. venue: v3. counts: standard: 40.")[0].act).toBe("order_confirmed");
    expect(answer("From: organiser. Act: order. date: day 26. counts: standard: 40.")).toEqual([{ act: "order_refused", fields: { reason: "venue_required" } }]);
  });
});
