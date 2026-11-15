import { describe, expect, it } from "vitest";
import { Random } from "../src/engine/random.ts";
import { catererRules, venueRules } from "../src/scenarios/congress-parties.ts";
import { type ToolAnswer, calls, conversation, drive, notice, tools } from "./fixtures/rules.ts";

// FR-CONGRESS-22: the corrections from the E1 baseline's first check run.

/** "v1"'s parameters: main-hall (120 seats) and room-b (40), the day price 2000, holds of 2 days. */
const venue = (changes: Record<string, unknown> = {}) => ({
  id: "v1",
  rooms: [
    { id: "main-hall", seats: 120, equipment: [] },
    { id: "room-b", seats: 40, equipment: [] },
  ],
  access_claim: "step-free",
  catering: "outside_fee",
  outside_fee_per_head: 5,
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
  ...changes,
});

const DAY = "day 1 Monday 09:01";
const message = (act: string, fields = "", from = "organiser"): [string, string] => [DAY, `From: ${from}. Act: ${act}. date: day 26.${fields}`];
const book = message("book", " rooms: main-hall. hours: 08:00-18:00.");
const accept: [string, string] = [DAY, "From: organiser. Act: accept_contract. contract: v1-contract-1."];
const mailed = (steps: ReturnType<typeof conversation>["steps"]) => calls(steps, "send_mail").map(({ act, fields }) => ({ act, fields }));
const answers = (messages: [string, string][], changes: Record<string, unknown> = {}) => mailed(conversation(venueRules.start(venue(changes), new Random(1)), messages).steps);

describe("a venue answers the asker's own booking (FR-CONGRESS-22)", () => {
  it("answers an ask_quote or a hold for a date the asker has under a live contract with contract_held and the contract", () => {
    const held = { act: "contract_held", fields: { contract: "v1-contract-1", date: "day 26" } };
    expect(answers([book, accept, message("ask_quote", " attendance: 50.")]).at(-1)).toEqual(held);
    expect(answers([book, accept, message("hold")]).at(-1)).toEqual(held);
    // A contract not yet accepted is live too.
    expect(answers([book, message("ask_quote", " attendance: 50.")]).at(-1)).toEqual(held);
  });

  it("answers an ask_quote or a hold for a date the asker holds with held and the hold's end", () => {
    const held = { act: "held", fields: { date: "day 26", until: "day 3 Wednesday 09:01" } };
    expect(answers([message("hold"), message("ask_quote", " attendance: 50.")]).at(-1)).toEqual(held);
    expect(answers([message("hold"), message("hold", " attendance: 50.")]).at(-1)).toEqual(held);
  });
});

describe("a caterer takes only a permit the venue gave (FR-CONGRESS-22)", () => {
  /** "c1", for venues of each catering rule; read_permit gives the permits given here, by their ids, as the world's mail gives them. */
  const answer = (permit: string, venueId = "v2", given: Record<string, string> = { "v2-permit-1": "v2", "v1-permit-1": "v1" }) => {
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
    const order = `From: organiser. Act: order. counts: standard: 40. date: day 26. venue: ${venueId}. permit: ${permit}.`;
    const permits: ToolAnswer = (tool, args) => (tool === "read_permit" ? { text: given[String(args.permit)] === undefined ? "No such permit." : JSON.stringify({ permit: args.permit, venue: given[String(args.permit)] }) } : tools(() => order)(tool, args));
    drive(rules, tools(() => ""));
    return mailed(drive(rules, permits, [[notice]], true))[0];
  };
  const unknown = { act: "order_refused", fields: { reason: "permit_unknown" } };

  it("confirms an order with a permit the named venue gave", () => {
    expect(answer("v2-permit-1").act).toBe("order_confirmed");
  });

  it("refuses permit_unknown an order whose permit no venue gave, or another venue gave, whatever the venue's rule", () => {
    expect(answer("outside_catering")).toEqual(unknown);
    expect(answer("v1-permit-1")).toEqual(unknown);
    expect(answer("v2-permit-1", "v3")).toEqual(unknown);
  });
});
