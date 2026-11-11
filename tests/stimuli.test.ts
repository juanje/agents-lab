import { describe, expect, it } from "vitest";
import { Stimuli, type Stimulus } from "../src/engine/stimuli.ts";
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

  it("reports each stimulus as it is delivered to an agent: one delivered while it works or rests, and the rhythm's as it wakes", () => {
    const delivered: [string, unknown][] = [];
    const stimuli = new Stimuli([bell, rhythmChannel], (agent, stimulus) => delivered.push([agent, stimulus]));

    stimuli.deliver("a", "bell");
    expect(delivered).toEqual([["a", { channel: "bell", source: "town bell", content: "The bell rings." }]]);
    stimuli.wake("b");
    expect(delivered).toEqual([
      ["a", { channel: "bell", source: "town bell", content: "The bell rings." }],
      ["b", { channel: "rhythm", source: "rhythm", content: "You wake up." }],
    ]);
    // Taking a stimulus already delivered delivers nothing again.
    stimuli.wake("a");
    expect(delivered.filter(([agent]) => agent === "a")).toHaveLength(2);
  });

  it("wakes an agent the first time with the rhythm's stimulus, then its first stimuli, then those that arrived; never again", () => {
    const person = { name: "person", source: "Ada", stimulus: "Sort the post." };
    const delivered: [string, unknown][] = [];
    const stimuli = new Stimuli([bell, person, rhythmChannel], (agent, stimulus) => delivered.push([agent, stimulus]), new Map([["a", ["person"]]]));
    const rhythm = { channel: "rhythm", source: "rhythm", content: "You wake up." };
    const first = { channel: "person", source: "Ada", content: "Sort the post." };
    const ring = { channel: "bell", source: "town bell", content: "The bell rings." };

    stimuli.deliver("a", "bell");

    expect(stimuli.wake("a")).toEqual([rhythm, first, ring]);
    expect(stimuli.wake("a")).toEqual([rhythm]);
    expect(stimuli.wake("b")).toEqual([rhythm]);
    // Each is reported as it is delivered: the first stimuli as the agent first wakes, right after the rhythm's.
    expect(delivered).toEqual([["a", ring], ["a", rhythm], ["a", first], ["a", rhythm], ["b", rhythm]]);
  });

  it("refuses a stimulus from a channel the scenario does not declare, naming it", () => {
    const stimuli = new Stimuli([rhythmChannel]);

    expect(() => stimuli.deliver("a", "bell")).toThrow('no channel named "bell" is declared');
  });

  it("tells a watcher of an agent each stimulus delivered to that agent, as it is delivered, and nothing once it stops watching", () => {
    const stimuli = new Stimuli([bell, rhythmChannel]);
    const seen: Stimulus[] = [];
    const unwatch = stimuli.watch("a", (stimulus) => seen.push(stimulus));

    stimuli.deliver("b", "bell");
    stimuli.deliver("a", "bell");
    unwatch();
    stimuli.deliver("a", "bell");

    expect(seen).toEqual([{ channel: "bell", source: "town bell", content: "The bell rings." }]);
    // Watching takes nothing: the stimuli still wait for the agent's session.
    expect(stimuli.take("a")).toHaveLength(2);
  });
});
