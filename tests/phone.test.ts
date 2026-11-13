import { describe, expect, it } from "vitest";
import { readCalendar } from "../src/engine/calendar.ts";
import { type PhoneSettings, readPhone } from "../src/engine/phone.ts";

/** A calendar where one world minute is 100 ms of the run. */
const calendar = readCalendar({ start: "day 1 Friday 17:00", segments: [{ scale: 600 }] });

/** FR-PHONE-01's Background phone, with any of its keys replaced. */
function phone(changes: Record<string, unknown> = {}) {
  return { lines: ["ana", "ben", "desk"], ring_minutes: 5, call_minutes: 4, ring: "{from} calls ({call}): {act}. {fields}{text}", ...changes };
}

/** The names a phone's lines are checked against: the agents' and the participants'. */
const names = ["ana", "ben", "desk"];

describe("readPhone (FR-PHONE-01)", () => {
  it("reads the lines, ring_minutes, call_minutes, the time per word when given, and the ring's text", () => {
    const read: PhoneSettings = readPhone(phone({ call_words_per_minute: 10 }) as never, calendar, names);

    expect(read).toEqual({ lines: ["ana", "ben", "desk"], ringMinutes: 5, callMinutes: 4, callWordsPerMinute: 10, ring: "{from} calls ({call}): {act}. {fields}{text}" });
    expect(readPhone(phone() as never, calendar, names)).not.toHaveProperty("callWordsPerMinute");
  });

  it("refuses, naming the key, a phone without a calendar, a line for a name that is no agent or participant, and durations and a ring it cannot follow", () => {
    const refusing = (changes: Record<string, unknown>) => () => readPhone(phone(changes) as never, calendar, names);
    const withoutCalendar = () => readPhone(phone() as never, undefined, names);

    expect(withoutCalendar).toThrow(/phone.*\[calendar\]/);
    expect(refusing({ lines: ["ana", "zoe"] })).toThrow(/phone\.lines.*"zoe"/);
    for (const minutes of [0, -1, "five"]) expect(refusing({ ring_minutes: minutes })).toThrow(/phone\.ring_minutes/);
    for (const minutes of [0, -1, undefined]) expect(refusing({ call_minutes: minutes })).toThrow(/phone\.call_minutes/);
    expect(refusing({ call_words_per_minute: -1 })).toThrow(/phone\.call_words_per_minute/);
    expect(refusing({ ring: "{from} offers {price}" })).toThrow(/phone\.ring.*\{price\}/);
  });
});
