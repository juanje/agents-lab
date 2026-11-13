import type { Mail, MailKeeper } from "../../src/engine/mail.ts";
import type { Scenario } from "../../src/engine/scenario.ts";
import { rhythmChannel } from "./slots.ts";

/** A test world that keeps the mail and nothing else (FR-MESSAGE-01). */
export interface Post {
  mail: Mail;
}

/** Where the test world keeps the mail. */
export const postKeeper: MailKeeper<Post> = { of: (state) => state.mail, with: (state, mail) => ({ ...state, mail }) };

/**
 * A test scenario of agents who only send and read mail: its agents are named by its configuration, wake at once and
 * are told nothing of the world; its base configuration declares a calendar where one world minute is 100 ms of the run,
 * and the mail of FR-MESSAGE-01's Background.
 */
export const postScenario: Scenario<Post> = {
  name: "post",
  agents: (configuration) => configuration.agents as string[],
  // The engine puts the mail in the world as it loads the scenario; the scenario starts it with none.
  initialState: () => ({ mail: { mailboxes: {}, inTransit: [] } }),
  tools: [],
  channels: () => [rhythmChannel],
  metrics: {},
  systemPrompt: (_configuration, agent) => `You are "${agent}".`,
  rhythm: () => () => 0,
  describeDuration: () => "As the mail gives it.",
  describeRhythm: () => "No wait before any activation.",
  mail: postKeeper,
  baseConfiguration: [
    'agents = ["ana", "ben"]',
    "[calendar]",
    'start = "day 1 Monday 09:00"',
    "[[calendar.segments]]",
    "scale = 600",
    "[mail]",
    'mailboxes = ["ana", "ben", "desk"]',
    "delivery_minutes = [1, 1]",
    "send_minutes = 3",
    "check_minutes = 2",
    "read_minutes = 1",
    'notice_source = "mail client"',
    'notice = "New mail from {from}: {subject}"',
    "[mail.acts.desk]",
    'book = ["date", "rooms"]',
    "ask = []",
    "",
  ].join("\n"),
};
