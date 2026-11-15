import { describe, expect, it } from "vitest";
import { Random } from "../src/engine/random.ts";
import { venueRules } from "../src/scenarios/congress-parties.ts";
import { calls, conversation } from "./fixtures/rules.ts";

// FR-CONGRESS-23: the corrections from the E1 baseline's second check run.

/** "v1"'s parameters: hall-a (90 seats), free outside catering, the extra "ramp" at 100, the day price 2000. */
const venue = (changes: Record<string, unknown> = {}) => ({
  id: "v1",
  rooms: [{ id: "hall-a", seats: 90, equipment: [] }],
  access_claim: "step-free",
  catering: "outside_free",
  extras: { ramp: 100 },
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
const message = (act: string, fields = ""): [string, string] => [DAY, `From: organiser. Act: ${act}.${fields}`];
const book = message("book", " date: day 26. rooms: hall-a. hours: 08:00-18:00.");
const accept = message("accept_contract", " contract: v1-contract-1.");
/** What the venue did for the messages: its mail, each act and fields, and its commitments. */
const run = (messages: [string, string][], changes: Record<string, unknown> = {}) => {
  const { steps } = conversation(venueRules.start(venue(changes), new Random(1)), messages);
  return { mailed: calls(steps, "send_mail").map(({ act, fields }) => ({ act, fields })), commitments: calls(steps, "commit").map(({ amount, for: what }) => ({ amount, for: what })) };
};

describe("a venue with free outside catering says so (FR-CONGRESS-23)", () => {
  it("answers request_extra for outside_catering not_needed with the item, and commits nothing", () => {
    const { mailed, commitments } = run([book, accept, message("request_extra", " item: outside_catering. attendance: 60.")]);
    expect(mailed.at(-1)).toEqual({ act: "not_needed", fields: { item: "outside_catering" } });
    expect(commitments).toEqual([{ amount: 2000, for: "v1-contract-1" }]);
  });
});
