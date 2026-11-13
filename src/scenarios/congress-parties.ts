import type { RuleSet } from "../engine/participants.ts";

/** The venue's rule set (FR-CONGRESS-02). */
export const venueRules: RuleSet = { start: () => ({ next: () => ({ kind: "end" }), outcome: () => ({}) }) };

/** The board's rule set (FR-CONGRESS-02). */
export const boardRules: RuleSet = { start: () => ({ next: () => ({ kind: "end" }), outcome: () => ({}) }) };
