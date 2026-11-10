import { describe, expect, it } from "vitest";
import { Stimuli } from "../src/engine/stimuli.ts";
import { rhythmChannel } from "./fixtures/slots.ts";

const bell = { name: "bell", source: "town bell", stimulus: "The bell rings." };

describe("Stimuli", () => {
  it("wakes an agent with the stimulus of the rhythm channel, from its source", () => {
    const stimuli = new Stimuli([bell, rhythmChannel]);

    expect(stimuli.wake("a")).toEqual([{ channel: "rhythm", source: "rhythm", content: "You wake up." }]);
  });
});
