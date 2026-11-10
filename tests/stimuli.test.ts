import { describe, expect, it } from "vitest";
import { Stimuli } from "../src/engine/stimuli.ts";
import { rhythmChannel } from "./fixtures/slots.ts";

const bell = { name: "bell", source: "town bell", stimulus: "The bell rings." };

describe("Stimuli", () => {
  it("wakes an agent with the stimulus of the rhythm channel, from its source", () => {
    const stimuli = new Stimuli([bell, rhythmChannel]);

    expect(stimuli.wake("a")).toEqual([{ channel: "rhythm", source: "rhythm", content: "You wake up." }]);
  });

  it("wakes an agent with the rhythm's stimulus first, then the stimuli that arrived while it rested, once", () => {
    const stimuli = new Stimuli([bell, rhythmChannel]);

    stimuli.deliver("a", "bell");

    expect(stimuli.wake("a")).toEqual([
      { channel: "rhythm", source: "rhythm", content: "You wake up." },
      { channel: "bell", source: "town bell", content: "The bell rings." },
    ]);
    expect(stimuli.take("a")).toEqual([]);
  });

  it("keeps a delivered stimulus for its agent until the agent's session takes it, once", () => {
    const stimuli = new Stimuli([bell, rhythmChannel]);

    stimuli.deliver("a", "bell");

    expect(stimuli.take("b")).toEqual([]);
    expect(stimuli.take("a")).toEqual([{ channel: "bell", source: "town bell", content: "The bell rings." }]);
    expect(stimuli.take("a")).toEqual([]);
  });

  it("refuses a stimulus from a channel the scenario does not declare, naming it", () => {
    const stimuli = new Stimuli([rhythmChannel]);

    expect(() => stimuli.deliver("a", "bell")).toThrow('no channel named "bell" is declared');
  });
});
