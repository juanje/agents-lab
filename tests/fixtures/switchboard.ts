import type { Mail } from "../../src/engine/mail.ts";
import type { Phone } from "../../src/engine/phone.ts";
import type { Scenario } from "../../src/engine/scenario.ts";
import { postKeeper, postScenario } from "./post.ts";

/** A test world that keeps the mail and the phone and nothing else (FR-PHONE-01). */
export interface Switchboard {
  mail: Mail;
  phone: Phone;
}

/**
 * The post scenario with a phone: "ana", "ben" and "desk" have a line; a phone rings for 5 world minutes and a call
 * lasts 4, one world minute being 100 ms of the run, Friday at 17:00, with the hours "night", 00:00 to 06:00 every day. Its
 * configuration's participants come from the test.
 */
export function switchboardScenario(participants: string): Scenario<Switchboard> {
  const base = postScenario.baseConfiguration.replace("day 1 Monday 09:00", "day 1 Friday 17:00");
  return {
    ...(postScenario as unknown as Scenario<Switchboard>),
    initialState: () => ({ mail: { mailboxes: {}, inTransit: [] }, phone: { calls: [] } }),
    mail: { of: (state) => postKeeper.of(state), with: (state, mail) => ({ ...state, mail }) },
    phone: { of: (state: Switchboard) => state.phone, with: (state: Switchboard, phone: Phone) => ({ ...state, phone }) },
    baseConfiguration: [
      base,
      "[calendar.hours.night]",
      'days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]',
      'from = "00:00"',
      'to = "06:00"',
      "[phone]",
      'lines = ["ana", "ben", "desk"]',
      "ring_minutes = 5",
      "call_minutes = 4",
      'ring = "{from} calls ({call}): {act}. {fields}{text}"',
      participants,
      "",
    ].join("\n"),
  } as Scenario<Switchboard>;
}
