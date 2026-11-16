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

  it("fills each {name} of a channel's stimulus with the value a delivery gives for it, leaving the channel's text as declared", () => {
    const notice = { name: "mail_notice", source: "mail client", stimulus: "New mail from {from}: {subject}" };
    const stimuli = new Stimuli([notice, rhythmChannel]);

    stimuli.deliver("a", "mail_notice", { from: "ana", subject: "Friday" });
    stimuli.deliver("a", "mail_notice");

    expect(stimuli.take("a")).toEqual([
      { channel: "mail_notice", source: "mail client", content: "New mail from ana: Friday" },
      { channel: "mail_notice", source: "mail client", content: "New mail from {from}: {subject}" },
    ]);
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

  it("fills each {name} of a first stimulus with the name of the agent that receives it (FR-WORKSHOP-05)", () => {
    const order = { name: "order", source: "the order", stimulus: "You are {name}.\n\nBuild it, {name}; ask {team}." };
    const delivered: [string, unknown][] = [];
    const stimuli = new Stimuli([order, rhythmChannel], (agent, stimulus) => delivered.push([agent, stimulus]), new Map([["a", ["order"]], ["b", ["order"]]]));

    expect(stimuli.wake("a")[1]).toEqual({ channel: "order", source: "the order", content: "You are a.\n\nBuild it, a; ask {team}." });
    expect(stimuli.wake("b")[1]).toEqual({ channel: "order", source: "the order", content: "You are b.\n\nBuild it, b; ask {team}." });
    expect(delivered.map(([agent, stimulus]) => [agent, (stimulus as Stimulus).content])).toEqual([
      ["a", "You wake up."],
      ["a", "You are a.\n\nBuild it, a; ask {team}."],
      ["b", "You wake up."],
      ["b", "You are b.\n\nBuild it, b; ask {team}."],
    ]);
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

describe("Stimuli, holding a recipient's stimuli (FR-PARTICIPANT-01)", () => {
  it("delivers a held stimulus, recording it, queueing it and telling its watchers, only once its hold lets it reach", async () => {
    const delivered: string[] = [];
    const stimuli = new Stimuli([bell, rhythmChannel], (agent, stimulus) => delivered.push(`${agent}: ${stimulus.content}`));
    const seen: Stimulus[] = [];
    stimuli.watch("desk", (stimulus) => seen.push(stimulus));
    let reach: (reached: boolean) => void = () => {};
    stimuli.hold("desk", () => new Promise((resolve) => (reach = resolve)));

    stimuli.deliver("desk", "bell");

    expect([delivered, seen, stimuli.take("desk")]).toEqual([[], [], []]);
    reach(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(delivered).toEqual(["desk: The bell rings."]);
    expect(seen).toHaveLength(1);
    expect(stimuli.take("desk")).toEqual([{ channel: "bell", source: "town bell", content: "The bell rings." }]);
  });

  it("drops a held stimulus whose hold does not let it reach, as when the run ends first", async () => {
    const delivered: string[] = [];
    const stimuli = new Stimuli([bell, rhythmChannel], (agent) => delivered.push(agent));
    stimuli.hold("desk", async () => false);

    stimuli.deliver("desk", "bell");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(delivered).toEqual([]);
    expect(stimuli.take("desk")).toEqual([]);
  });

  it("holds no other recipient's stimuli", () => {
    const stimuli = new Stimuli([bell, rhythmChannel]);
    stimuli.hold("desk", async () => true);

    stimuli.deliver("a", "bell");

    expect(stimuli.take("a")).toHaveLength(1);
  });
});

describe("Stimuli, a recipient's declared channels (FR-PARTICIPANT-01)", () => {
  it("drops a stimulus on a channel its recipient does not declare, unrecorded and untold, before any hold", () => {
    const delivered: string[] = [];
    const notice = { name: "mail_notice", source: "mail client", stimulus: "New mail." };
    const stimuli = new Stimuli([bell, notice, rhythmChannel], (agent, stimulus) => delivered.push(`${agent}: ${stimulus.channel}`));
    const seen: Stimulus[] = [];
    stimuli.watch("desk", (stimulus) => seen.push(stimulus));
    let held = 0;
    stimuli.hold("desk", async () => {
      held += 1;
      return true;
    });
    stimuli.only("desk", ["bell"]);

    stimuli.deliver("desk", "mail_notice");

    expect([delivered, seen, held, stimuli.take("desk")]).toEqual([[], [], 0, []]);
  });

  it("lets through a stimulus on a channel its recipient declares, and every channel to a recipient that declares none", () => {
    const stimuli = new Stimuli([bell, rhythmChannel]);
    stimuli.only("desk", ["bell"]);

    stimuli.deliver("desk", "bell");
    stimuli.deliver("a", "bell");

    expect([stimuli.take("desk"), stimuli.take("a")].map((taken) => taken.length)).toEqual([1, 1]);
  });
});

describe("Stimuli, a channel that wakes a resting agent (FR-CONGRESS-08)", () => {
  const ring = { name: "phone", source: "the caller", stimulus: "A call.", wakes: true };

  it("ends an agent's rest when a stimulus on a waking channel reaches it, and not for another channel's", () => {
    const stimuli = new Stimuli([bell, ring, rhythmChannel]);
    const rest = stimuli.rest("a");

    stimuli.deliver("a", "bell");
    expect(rest.signal.aborted).toBe(false);
    stimuli.deliver("a", "phone");
    expect(rest.signal.aborted).toBe(true);
    rest.end();
  });

  it("ends a rest at once when a waking stimulus is already waiting for the agent", () => {
    const stimuli = new Stimuli([ring, rhythmChannel]);
    stimuli.deliver("a", "phone");

    expect(stimuli.rest("a").signal.aborted).toBe(true);
  });

  it("does not end a rest that has ended, nor another agent's", () => {
    const stimuli = new Stimuli([ring, rhythmChannel]);
    const rest = stimuli.rest("a");
    const other = stimuli.rest("b");
    rest.end();

    stimuli.deliver("a", "phone");

    expect([rest.signal.aborted, other.signal.aborted]).toEqual([false, false]);
  });

  it("wakes an agent woken by a stimulus with the stimuli waiting for it, without the rhythm's", () => {
    const stimuli = new Stimuli([ring, rhythmChannel]);
    stimuli.deliver("a", "phone");

    expect(stimuli.wake("a", false)).toEqual([{ channel: "phone", source: "the caller", content: "A call." }]);
  });
});
