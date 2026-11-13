import { describe, expect, it } from "vitest";
import { ChangesSinceSensing } from "../src/engine/changes.ts";
import { readCalendar } from "../src/engine/calendar.ts";
import { RunClock } from "../src/engine/clock.ts";
import { type Component, type ComponentAction, type Step, runComponent } from "../src/engine/components.ts";
import { Random } from "../src/engine/random.ts";
import { Stimuli, type Stimulus } from "../src/engine/stimuli.ts";
import { loadScenario } from "../src/engine/scenario.ts";
import { World } from "../src/engine/world.ts";
import { type Post, postScenario } from "./fixtures/post.ts";
import { type Slots, emptySlots, filler, holder } from "./fixtures/slots.ts";

/** Runs a component in a world until its cycle ends or the signal aborts, giving the actions it recorded and the changes it applied. */
async function runIn(component: Component<Slots>, world: World<Slots>, runEnd = new AbortController().signal, stimuli = new Stimuli([])) {
  const actions: ComponentAction[] = [];
  const changes = new ChangesSinceSensing();
  changes.sensed("a");
  const clock = new RunClock();
  clock.start();
  await runComponent(component, { world, random: new Random(1), runEnd, changes, clock, stimuli, record: (action) => actions.push(action) });
  return { actions, changes };
}

/** A component whose cycle takes these steps in order, keeping the outcome it is given before each choice, then ends. */
function stepping(steps: readonly Step<Slots>[], given: (string | undefined)[]): Component<Slots> {
  return {
    name: "stepper",
    kind: "world",
    description: "Takes its steps.",
    cycle: () => {
      let index = 0;
      return {
        next: (_state, outcome) => {
          given.push(outcome);
          return steps[index++] ?? { kind: "end" };
        },
      };
    },
  };
}

describe("runComponent", () => {
  it("waits, then changes the world through the arbiter once its action's duration has passed, and records the action", async () => {
    const world = new World(emptySlots(3));
    const porter = filler("porter", { slot: 2, thing: "crate", waitMs: () => 20, actionMs: 30 });
    const startedAtMs = performance.now();

    const { actions } = await runIn(porter, world);

    expect(holder(world.state, 2)).toBe("crate");
    expect(world.version).toBe(1);
    expect(actions).toEqual([{ component: "porter", action: 'fill slot 2 with "crate"', startedAtMs: expect.any(Number), endedAtMs: expect.any(Number), outcome: "success" }]);
    expect(actions[0].startedAtMs - startedAtMs).toBeGreaterThanOrEqual(20);
    expect(actions[0].endedAtMs - actions[0].startedAtMs).toBeGreaterThanOrEqual(30);
  });

  it("checks its action when it lands, and gives its cycle the outcome before it chooses again", async () => {
    const world = new World(emptySlots(3));
    const given: (string | undefined)[] = [];
    const fill = (thing: string): Step<Slots> => ({
      kind: "action",
      name: `fill slot 1 with "${thing}"`,
      durationMs: 0,
      action: { precondition: (slots) => (slots[0] === null ? { holds: true } : { holds: false, reason: "slot_taken" }), effect: (slots) => [thing, ...slots.slice(1)] },
    });

    const { actions } = await runIn(stepping([fill("crate"), fill("box"), { kind: "wait", ms: 0 }], given), world);

    expect(actions.map((action) => action.outcome)).toEqual(["success", "slot_taken"]);
    expect(holder(world.state, 1)).toBe("crate");
    // Before its first step, nothing; after each action, its outcome; after a wait, nothing.
    expect(given).toEqual([undefined, "success", "slot_taken", undefined]);
  });

  it("counts each change it applies among the changes since sensing, by its name", async () => {
    const porter = filler("porter", { slot: 2, thing: "crate", waitMs: () => 0, actionMs: 0 });

    const { changes } = await runIn(porter, new World(emptySlots(3)));

    expect(changes.appliedBy("a")).toEqual(["porter"]);
  });

  it("records an action still running when the run ends as cut off, applies nothing and chooses no other step", async () => {
    const world = new World(emptySlots(3));
    const given: (string | undefined)[] = [];
    const runEnd = new AbortController();
    const fill: Step<Slots> = { kind: "action", name: "fill", durationMs: 200, action: { precondition: () => ({ holds: true }), effect: () => ["crate", null, null] } };
    setTimeout(() => runEnd.abort(), 20);

    const { actions } = await runIn(stepping([fill, fill], given), world, runEnd.signal);

    expect(actions.map((action) => action.outcome)).toEqual(["cut_off"]);
    expect(actions[0].endedAtMs - actions[0].startedAtMs).toBeLessThan(200);
    expect(world.version).toBe(0);
    expect(given).toEqual([undefined]);
  });

  it("gives its cycle the time since the run started each time it chooses a step", async () => {
    const given: number[] = [];
    const steps: Step<Slots>[] = [{ kind: "wait", ms: 30 }, { kind: "end" }];
    const timed: Component<Slots> = {
      name: "timed",
      kind: "world",
      description: "Waits, then ends.",
      cycle: () => ({
        next: (_state, _outcome, sinceStartMs) => {
          given.push(sinceStartMs);
          return steps[given.length - 1];
        },
      }),
    };

    await runIn(timed, new World(emptySlots(3)));

    expect(given).toHaveLength(2);
    expect(given[0]).toBeLessThan(5);
    expect(given[1]).toBeGreaterThanOrEqual(30);
  });

  it("applies its action's start through the arbiter as the action starts, counted by its name, before the action lands", async () => {
    const world = new World(emptySlots(3));
    const seen: (string | null)[] = [];
    const steps: Step<Slots>[] = [
      {
        kind: "action",
        name: "carry",
        durationMs: 30,
        start: { precondition: () => ({ holds: true }), effect: (slots) => ["carrying", ...slots.slice(1)] },
        action: { precondition: () => ({ holds: true }), effect: (slots) => [null, "crate", ...slots.slice(2)] },
      },
    ];
    let index = 0;
    const carrier: Component<Slots> = { name: "carrier", kind: "world", description: "Carries a crate.", cycle: () => ({ next: () => steps[index++] ?? { kind: "end" } }) };
    setTimeout(() => seen.push(holder(world.state, 1)), 15);

    const { actions, changes } = await runIn(carrier, world);

    expect(seen).toEqual(["carrying"]);
    expect(world.state).toEqual([null, "crate", null]);
    expect(world.version).toBe(2);
    expect(changes.appliedBy("a")).toEqual(["carrier", "carrier"]);
    expect(actions.map((action) => action.outcome)).toEqual(["success"]);
  });

  it("fails, naming itself and its action, when the world refuses its action's start", async () => {
    let index = 0;
    const refused: Step<Slots> = { kind: "action", name: "carry", durationMs: 0, start: { precondition: () => ({ holds: false, reason: "blocked" }), effect: (slots) => slots }, action: { precondition: () => ({ holds: true }), effect: (slots) => slots } };
    const carrier: Component<Slots> = { name: "carrier", kind: "world", description: "Carries.", cycle: () => ({ next: () => (index++ === 0 ? refused : { kind: "end" }) }) };

    await expect(runIn(carrier, new World(emptySlots(3)))).rejects.toThrow('component "carrier"\'s action "carry" was refused with "blocked"');
  });

  it("delivers a channel's stimulus to an agent as it takes the step, after the actions before it landed, taking no time and recording no action", async () => {
    const world = new World(emptySlots(3));
    const given: (string | undefined)[] = [];
    const delivered: { atSlot: string | null; stimulus: Stimulus }[] = [];
    const stimuli = new Stimuli([{ name: "call", source: "the porter", stimulus: "Deliveries are in." }], (agent, stimulus) => {
      expect(agent).toBe("a");
      delivered.push({ atSlot: holder(world.state, 1), stimulus });
    });
    const steps: Step<Slots>[] = [
      { kind: "action", name: "fill", durationMs: 10, action: { precondition: () => ({ holds: true }), effect: (slots) => ["crate", ...slots.slice(1)] } },
      { kind: "deliver", agent: "a", channel: "call" },
    ];

    const { actions } = await runIn(stepping(steps, given), world, undefined, stimuli);

    expect(delivered).toEqual([{ atSlot: "crate", stimulus: { channel: "call", source: "the porter", content: "Deliveries are in." } }]);
    expect(stimuli.take("a")).toEqual([delivered[0].stimulus]);
    expect(actions.map((action) => action.action)).toEqual(["fill"]);
    expect(given).toEqual([undefined, "success", undefined]);
  });

  it("gives its cycle the world's time, and takes an action's duration in world time as the run time it spans (FR-CLOCK-03)", async () => {
    const world = new World(emptySlots(1));
    const given: unknown[] = [];
    let acted = 0;
    const timer: Component<Slots> = {
      name: "timer",
      kind: "world",
      description: "Acts twice, a world minute each time.",
      cycle: () => ({
        next: (_state, _outcome, _sinceStartMs, worldTime) => {
          given.push(worldTime);
          if (acted++ === 2) return { kind: "end" };
          return { kind: "action", name: "act", durationMs: { worldSeconds: 60 }, action: { precondition: () => ({ holds: true }), effect: (state) => state } };
        },
      }),
    };
    // One world minute is 50 ms of the run.
    const clock = new RunClock(readCalendar({ start: "day 1 Monday 09:00", segments: [{ scale: 1200 }] }));
    clock.start();

    await runComponent(timer, { world, random: new Random(1), runEnd: new AbortController().signal, changes: new ChangesSinceSensing(), clock, stimuli: new Stimuli([]), record: () => {} });

    expect(given).toEqual([
      { day: 1, weekday: "Monday", seconds: 9 * 3600 },
      { day: 1, weekday: "Monday", seconds: 9 * 3600 + 60 },
      { day: 1, weekday: "Monday", seconds: 9 * 3600 + 120 },
    ].map((time, index) => ({ ...time, seconds: expect.toSatisfy((seconds: number) => seconds >= time.seconds && seconds < time.seconds + 6, `${index}`) })));
  });
});

describe("runComponent, with mail (FR-MESSAGE-01)", () => {
  /** The post test scenario as loaded: its Background's mail, with a message for "desk" at the start. */
  const loadPost = () =>
    loadScenario(
      {
        ...postScenario,
        baseConfiguration: `${postScenario.baseConfiguration}[[mail.initial]]\nto = "desk"\nfrom = "ana"\nact = "ask"\nreceived = "day 1 Monday 08:00"\n`,
      },
      1,
    );

  /** Runs a component of the post world whose cycle takes these steps, keeping each outcome and the unread messages it is given. */
  async function runPost(steps: readonly Step<Post>[]) {
    const loaded = loadPost();
    const given: { outcome: string | undefined; unread: string[] }[] = [];
    const desk: Component<Post> = {
      name: "desk",
      kind: "world",
      description: "Takes its steps.",
      cycle: () => {
        let index = 0;
        return {
          next: (_state, outcome, _sinceStartMs, _world, unread = []) => {
            given.push({ outcome, unread: unread.map(({ id }) => id) });
            return steps[index++] ?? { kind: "end" };
          },
        };
      },
    };
    const actions: ComponentAction[] = [];
    const clock = new RunClock(loaded.calendar);
    clock.start();
    await runComponent(desk, { world: loaded.world, random: new Random(1), runEnd: new AbortController().signal, changes: new ChangesSinceSensing(), clock, stimuli: new Stimuli([]), mail: loaded.mail, record: (action) => actions.push(action) });
    return { world: loaded.world, given, actions };
  }

  it("gives its cycle its mailbox's unread messages, and marks one read through the arbiter with a read step that lasts read_minutes", async () => {
    const { world, given, actions } = await runPost([{ kind: "read", id: "m-1" }, { kind: "read", id: "m-7" }]);

    expect(given).toEqual([
      { outcome: undefined, unread: ["m-1"] },
      { outcome: "success", unread: [] },
      { outcome: "no_such_mail", unread: [] },
    ]);
    expect(world.state.mail.mailboxes.desk[0].read).toBe(true);
    expect(actions.map(({ action, outcome }) => [action, outcome])).toEqual([
      ["read_mail", "success"],
      ["read_mail", "no_such_mail"],
    ]);
    // read_minutes is one world minute, 100 ms of the run.
    expect(actions[0].endedAtMs - actions[0].startedAtMs).toBeGreaterThanOrEqual(100);
  });

  it("sends a message with a send step that lasts send_minutes, from itself, with the world's time it was sent", async () => {
    const { world, actions } = await runPost([{ kind: "send", message: { to: "ana", act: "answer", fields: { free: "yes" } } }]);

    expect(world.state.mail.inTransit).toEqual([{ id: "m-2", from: "desk", to: "ana", act: "answer", fields: { free: "yes" }, subject: "answer", sent: expect.objectContaining({ day: 1, weekday: "Monday" }) }]);
    expect(actions).toMatchObject([{ component: "desk", action: "send_mail", outcome: "success" }]);
    expect(actions[0].endedAtMs - actions[0].startedAtMs).toBeGreaterThanOrEqual(300);
  });

  it("refuses, as it starts, a message its recipient cannot take: it takes no time, is not sent, and its cycle learns the outcome", async () => {
    const { world, given, actions } = await runPost([{ kind: "send", message: { to: "zoe", act: "ask" } }]);

    expect(given.map(({ outcome }) => outcome)).toEqual([undefined, "unknown_recipient"]);
    expect(actions).toMatchObject([{ component: "desk", action: "send_mail", outcome: "unknown_recipient" }]);
    expect(actions[0].endedAtMs - actions[0].startedAtMs).toBeLessThan(5);
    expect(world.state.mail.inTransit).toEqual([]);
  });
});
