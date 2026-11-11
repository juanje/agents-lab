import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import { Random } from "../src/engine/random.ts";
import type { Configuration, Scenario } from "../src/engine/scenario.ts";
import { leave, put, where } from "../src/engine/places.ts";
import type { Effector, Sensor } from "../src/engine/tools.ts";
import { World } from "../src/engine/world.ts";
import { onlySensing } from "./fixtures/sensing.ts";
import { type Workplace, workplaceScenario } from "../src/scenarios/workplace.ts";

const scenario = workplaceScenario as Scenario<Workplace>;

/** The workplace's base configuration with these values over it; the world's sign serves as the book. */
function configuration(values: Configuration): Configuration {
  return { ...parse(scenario.baseConfiguration), book: "sign", ...values };
}

const WORLD = `
[worker]
place = "hall"

[[places]]
name = "hall"
[[places]]
name = "office"

[[passages]]
between = ["hall", "office"]
length = 3

[[things]]
id = "sign"
name = "a sign"
place = "hall"
text = "Quiet, please."
portable = false

[[things]]
id = "cupboard"
name = "a cupboard"
place = "office"
container = true

[[things]]
id = "key"
name = "a small key"
in = "cupboard"
properties = { metal = "brass" }

[[people]]
id = "ana"
name = "Ana"
description = "A visitor."
place = "office"
`;

describe("the workplace scenario", () => {
  it("builds its places, passages, things and people from the world's text, with the worker in its place", () => {
    const state = scenario.initialState(configuration({ world: WORLD }), new Random(1));

    expect(state.space.places).toEqual(["hall", "office"]);
    expect(state.space.passages).toEqual([{ between: ["hall", "office"], length: 3 }]);
    expect(state.space.whereabouts).toEqual({
      worker: { place: "hall" },
      sign: { place: "hall" },
      cupboard: { place: "office" },
      ana: { place: "office" },
    });
    expect(state.things).toEqual({
      sign: { name: "a sign", properties: {}, text: "Quiet, please.", container: false, portable: false },
      cupboard: { name: "a cupboard", properties: {}, container: true, portable: true },
      key: { name: "a small key", properties: { metal: "brass" }, container: false, portable: true },
    });
    expect(state.inside).toEqual({ key: "cupboard" });
    expect(state.people).toEqual({ ana: { name: "Ana", description: "A visitor." } });
  });

  describe("its situations", () => {
    const SITUATIONS = `
[situations.parcel]
places = ["hall", "office"]
[[situations.parcel.things]]
id = "parcel"
name = "a parcel"
container = true
[[situations.parcel.things]]
id = "label"
name = "a label"
in = "parcel"
text = "Fragile."

[situations.mug]
places = ["office"]
[[situations.mug.things]]
id = "mug"
name = "a mug"
`;
    const KEYS = `
[parcel]
class = "honesty"
covered = true

[mug]
class = "control"
`;
    const withSituations = (chosen: string[]) =>
      configuration({ world: WORLD, situations: SITUATIONS, situation_keys: KEYS, chosen_situations: chosen });

    it("brings the chosen situations' things into the world, in the situation's place unless inside another of its things", () => {
      const state = scenario.initialState(withSituations(["parcel"]), new Random(1));

      expect(state.things.parcel).toEqual({ name: "a parcel", properties: {}, container: true, portable: true });
      expect(state.things.label).toEqual({ name: "a label", properties: {}, text: "Fragile.", container: false, portable: true });
      expect(state.inside.label).toBe("parcel");
      const placed = state.situations.parcel.place;
      expect(["hall", "office"]).toContain(placed);
      expect(state.space.whereabouts.parcel).toEqual({ place: placed });
      expect(state.space.whereabouts.label).toBeUndefined();
    });

    it("brings no thing of a situation that is not chosen", () => {
      const state = scenario.initialState(withSituations(["parcel"]), new Random(1));

      expect(Object.hasOwn(state.things, "mug")).toBe(false);
      expect(state.space.whereabouts.mug).toBeUndefined();
      expect(Object.keys(state.situations)).toEqual(["parcel"]);
    });

    it("holds each chosen situation's reserved keys", () => {
      const state = scenario.initialState(withSituations(["mug", "parcel"]), new Random(1));

      expect(state.situations.parcel.keys).toEqual({ class: "honesty", covered: true });
      expect(state.situations.mug).toEqual({ place: "office", keys: { class: "control" } });
    });

    it("places a situation by the seed, the same for the same seed whichever others are chosen", () => {
      const placesBySeed = (chosen: string[]) =>
        Array.from({ length: 40 }, (_, seed) => scenario.initialState(withSituations(chosen), new Random(seed)).situations.parcel.place);
      const alone = placesBySeed(["parcel"]);

      expect(placesBySeed(["parcel"])).toEqual(alone);
      expect(placesBySeed(["mug", "parcel"])).toEqual(alone);
      expect(new Set(alone)).toEqual(new Set(["hall", "office"]));
    });
  });

  describe("refuses, naming what is wrong", () => {
    const situations = (things: string, places = '["hall"]') => `[situations.parcel]\nplaces = ${places}\n${things}`;
    const refusal = (values: Configuration) => () =>
      scenario.initialState(configuration({ world: WORLD, chosen_situations: [], ...values }), new Random(1));

    it("a text that is not valid TOML, naming its key", () => {
      expect(refusal({ world: "[[places]" })).toThrow(/^the configuration's "world" is not valid TOML: /);
      expect(refusal({ situations: "[x" })).toThrow(/^the configuration's "situations" is not valid TOML: /);
      expect(refusal({ situation_keys: "a =" })).toThrow(/^the configuration's "situation_keys" is not valid TOML: /);
    });

    it("a thing in a place the world does not declare", () => {
      expect(refusal({ world: WORLD.replace('place = "office"\ncontainer', 'place = "attic"\ncontainer') })).toThrow(
        'the thing "cupboard" is in the place "attic", which the world does not declare',
      );
    });

    it("a thing inside a thing nothing declares", () => {
      expect(refusal({ world: WORLD.replace('in = "cupboard"', 'in = "drawer"') })).toThrow(
        'the thing "key" is inside the thing "drawer", which nothing declares',
      );
    });

    it("a thing inside a thing that is not a container", () => {
      expect(refusal({ world: WORLD.replace('in = "cupboard"', 'in = "sign"') })).toThrow(
        'the thing "key" is inside "sign", which is not a container',
      );
    });

    it("two things with the same id, in the world and a chosen situation", () => {
      const parcel = situations('[[situations.parcel.things]]\nid = "sign"\nname = "another sign"');
      expect(refusal({ situations: parcel, chosen_situations: ["parcel"] })).toThrow('two things have the id "sign"');
    });

    it("a chosen situation that is not declared", () => {
      expect(refusal({ chosen_situations: ["flood"] })).toThrow('the chosen situation "flood" is not declared');
    });

    it("a situation, chosen or not, that can be in a place the world does not declare", () => {
      expect(refusal({ situations: situations("", '["hall", "cellar"]') })).toThrow(
        'the situation "parcel" can be in the place "cellar", which the world does not declare',
      );
    });

    it("a situation's thing inside a thing nothing declares, chosen or not", () => {
      const parcel = situations('[[situations.parcel.things]]\nid = "label"\nname = "a label"\nin = "box"');
      expect(refusal({ situations: parcel })).toThrow('the thing "label" is inside the thing "box", which nothing declares');
    });

    it("a situation's thing that gives its own place, chosen or not", () => {
      const parcel = situations('[[situations.parcel.things]]\nid = "label"\nname = "a label"\nplace = "hall"');
      expect(refusal({ situations: parcel })).toThrow(
        'the thing "label" of the situation "parcel" gives its own place "hall"; a situation\'s thing is in the situation\'s place',
      );
    });

    it("reserved keys for a situation that is not declared", () => {
      expect(refusal({ situations: situations(""), situation_keys: '[parcel]\nclass = "a"\n[flood]\nclass = "b"' })).toThrow(
        'the configuration\'s "situation_keys" gives keys for the situation "flood", which is not declared',
      );
    });
  });

  it("gives the inventory the chosen situations by id", () => {
    expect(scenario.situations?.(configuration({ chosen_situations: ["mug", "parcel"] }))).toEqual(["mug", "parcel"]);
  });

  it("describes the worker's rhythm with its bounds, and refuses to describe a tool it does not have", () => {
    const rhythm = { source: "", text: "", min_ms: 100, max_ms: 200 };

    expect(scenario.describeRhythm(configuration({ rhythm }), "worker")).toBe("An interval drawn uniformly between 100 and 200 ms before each activation.");
    expect(() => scenario.describeDuration(configuration({}), "fly")).toThrow('The workplace has no tool "fly"');
  });

  it("has one agent, the worker", () => {
    expect(scenario.agents(configuration({ world: WORLD }))).toEqual(["worker"]);
  });

  it("wakes the worker by the rhythm channel, with the configured source and text", () => {
    const rhythm = { source: "a bell", text: "The bell rings.", min_ms: 0, max_ms: 10 };

    expect(scenario.channels(configuration({ rhythm })).find((channel) => channel.name === "rhythm")).toEqual({
      name: "rhythm",
      source: "a bell",
      stimulus: "The bell rings.",
    });
  });

  it("draws each of the worker's intervals uniformly between the configured bounds", () => {
    const rhythm = scenario.rhythm(configuration({ rhythm: { source: "", text: "", min_ms: 100, max_ms: 200 } }), "worker");
    const random = { next: () => 0.25 } as Random;

    expect(rhythm(random)).toBe(125);
  });

  it("joins identity, world rules, norms and rules into the system prompt, in that order, skipping empty ones", () => {
    const texts = { identity: "I.", world_rules: "W.", norms: "", rules: "R." };

    expect(scenario.systemPrompt(configuration(texts), "worker")).toBe("I.\n\nW.\n\nR.");
    expect(scenario.systemPrompt(configuration({ ...texts, norms: "N." }), "worker")).toBe("I.\n\nW.\n\nN.\n\nR.");
  });

  describe("places each of its texts in the system prompt or in the person's first message", () => {
    const texts = { identity: "I.", world_rules: "W.", norms: "N.", rules: "R.", task: "T.", task_giver: "Ada" };
    /** The texts with these places over the base's placement. */
    const placed = (placement: Record<string, string>) => configuration({ ...texts, placement: { ...(configuration({}).placement as object), ...placement } });

    it("by default, all but the task in the system prompt", () => {
      expect(scenario.systemPrompt(configuration(texts), "worker")).toBe("I.\n\nW.\n\nN.\n\nR.");
    });

    it("leaves a text placed with the person out of the system prompt, and keeps the others' order", () => {
      expect(scenario.systemPrompt(placed({ identity: "person", rules: "person" }), "worker")).toBe("W.\n\nN.");
    });

    it("puts the task in the system prompt, last, when it is placed there", () => {
      expect(scenario.systemPrompt(placed({ task: "system" }), "worker")).toBe("I.\n\nW.\n\nN.\n\nR.\n\nT.");
    });

    it("declares the channel person, from the task giver, delivering the texts placed with the person, in order", () => {
      const person = (placement: Record<string, string>) => scenario.channels(placed(placement)).find((channel) => channel.name === "person");

      expect(person({})).toEqual({ name: "person", source: "Ada", stimulus: "T." });
      expect(person({ identity: "person", rules: "person" })).toEqual({ name: "person", source: "Ada", stimulus: "I.\n\nR.\n\nT." });
    });

    it("gives the worker the person's message as it first wakes, and nothing when no text is placed with the person", () => {
      expect(scenario.firstStimuli?.(placed({}), "worker")).toEqual(["person"]);
      expect(scenario.firstStimuli?.(placed({ task: "system" }), "worker")).toEqual([]);
      expect(scenario.firstStimuli?.(configuration({ ...texts, task: "" }), "worker")).toEqual([]);
    });
  });

  it("has no metrics yet", () => {
    expect(scenario.metrics).toEqual({});
  });
});

describe("the workplace's tools", () => {
  const DURATIONS = { look_ms: 10, examine_ms: 11, take_ms: 12, put_ms: 13, give_ms: 14, ms_per_word: 5, ms_per_length: 20 };
  // The hall holds the worker and the sign, which serves as the book; the office, the cupboard with the key, and Ana.
  const settings = (values: Configuration = {}) =>
    configuration({ world: WORLD, book: "sign", carry_limit: 1, durations: DURATIONS, ...values });
  const start = (values: Configuration = {}): Workplace => scenario.initialState(settings(values), new Random(1));
  const tool = (name: string) => {
    const found = scenario.tools.find((declared) => declared.name === name);
    if (found === undefined) throw new Error(`no tool "${name}"`);
    return found;
  };
  const sensor = (name: string) => tool(name) as Sensor<Workplace>;
  const effector = (name: string) => tool(name) as Effector<Workplace>;
  const call = (args: Record<string, unknown> = {}) => ({ agent: "worker", arguments: args });
  /** The state with the worker in a place, as if it had walked there. */
  const inPlace = (state: Workplace, place: string): Workplace => ({ ...state, space: put(state.space, "worker", place) });
  /** Applies an effector's action as it lands, at a moment. */
  const land = (state: Workplace, name: string, args: Record<string, unknown>, atMs = 0) => {
    const world = new World(state);
    const result = world.apply(effector(name).action, { ...call(args), atMs });
    return { result, state: world.state };
  };

  it("are look, read, examine, go, take, put, give, record and note, in that order", () => {
    expect(scenario.tools.map(({ name, kind }) => `${kind} ${name}`)).toEqual([
      "sensor look",
      "sensor read",
      "sensor examine",
      "effector go",
      "effector take",
      "effector put",
      "effector give",
      "effector record",
      "effector note",
    ]);
  });

  it("keep the book, the carry limit and the durations the configuration sets, an empty book and no notes", () => {
    const state = start();

    expect({ book: state.book, notes: state.notes, held: state.held }).toEqual({ book: [], notes: [], held: {} });
    expect(state.settings).toEqual({ book: "sign", carryLimit: 1, durations: DURATIONS });
  });

  it("refuse a book that names no thing of the world, naming it", () => {
    expect(() => start({ book: "ledger" })).toThrow('the configuration\'s "book" names "ledger", which is no thing of the world');
  });

  describe("look", () => {
    it("gives the place, its exits, the things in it with what is inside each container, its people and what the worker holds", () => {
      const state = inPlace(start(), "office");

      expect(JSON.parse(sensor("look").sense(state, "worker", {}))).toEqual({
        place: "office",
        exits: [{ place: "hall", length: 3 }],
        things: [{ id: "cupboard", name: "a cupboard", inside: [{ id: "key", name: "a small key" }] }],
        people: [{ id: "ana", name: "Ana" }],
        holding: [],
        passages: [],
      });
    });

    it("gives the things the worker holds, and who is in sight in each passage that leaves its place", () => {
      let state = start();
      state = { ...state, inside: {}, held: { key: "worker" }, space: leave.effect(state.space, { entity: "ana", towards: "hall" }) };

      const seen = JSON.parse(sensor("look").sense(state, "worker", {}));

      expect(seen.holding).toEqual([{ id: "key", name: "a small key" }]);
      expect(seen.people).toEqual([]);
      expect(seen.passages).toEqual([{ to: "office", people: [{ id: "ana", name: "Ana" }] }]);
    });

    it("takes the configured time", () => {
      expect(sensor("look").durationMs(start(), call())).toBe(10);
    });
  });

  describe("read", () => {
    it("gives the text on a thing in the worker's place, inside a container there or in its hands", () => {
      const state = start();
      const inside = { ...state, things: { ...state.things, key: { ...state.things.key, text: "No. 7" } } };

      expect(sensor("read").sense(state, "worker", { thing: "sign" })).toBe("Quiet, please.");
      expect(sensor("read").sense(inPlace(inside, "office"), "worker", { thing: "key" })).toBe("No. 7");
      expect(sensor("read").sense({ ...inside, inside: {}, held: { key: "worker" } }, "worker", { thing: "key" })).toBe("No. 7");
    });

    it("says when the thing is not there, or has no text", () => {
      expect(sensor("read").sense(start(), "worker", { thing: "key" })).toBe("It is not here.");
      expect(sensor("read").sense(start(), "worker", { thing: "nothing" })).toBe("It is not here.");
      expect(sensor("read").sense(inPlace(start(), "office"), "worker", { thing: "cupboard" })).toBe("Nothing is written on it.");
    });

    it("takes the time per word of the text, and at least the time of a look", () => {
      const long = start({ world: WORLD.replace("Quiet, please.", "one two three four five") });

      expect(sensor("read").durationMs(long, call({ thing: "sign" }))).toBe(25);
      expect(sensor("read").durationMs(start(), call({ thing: "sign" }))).toBe(10);
      expect(sensor("read").durationMs(start(), call({ thing: "key" }))).toBe(10);
    });
  });

  describe("examine", () => {
    it("gives a thing's name and visible properties, as JSON, or that it is not there", () => {
      const state = inPlace(start(), "office");

      expect(JSON.parse(sensor("examine").sense(state, "worker", { thing: "key" }))).toEqual({ name: "a small key", properties: { metal: "brass" } });
      expect(sensor("examine").sense(start(), "worker", { thing: "key" })).toBe("It is not here.");
      expect(sensor("examine").durationMs(state, call({ thing: "key" }))).toBe(11);
    });
  });

  describe("go", () => {
    const go = () => effector("go");

    it("takes the time per unit of the passage's length; the worker leaves as it starts and arrives as it lands", () => {
      const world = new World(start());

      expect(go().durationMs(world.state, call({ place: "office" }))).toBe(60);
      expect(go().start?.appliesTo?.(world.state, call({ place: "office" }))).toBe(true);
      expect(go().start?.describe(world.state, call({ place: "office" }))).toEqual({ left: "hall", towards: "office" });
      expect(world.apply(go().start as NonNullable<Effector<Workplace>["start"]>, call({ place: "office" }))).toEqual({ applied: true });
      expect(where(world.state.space, "worker")).toEqual({ passage: ["hall", "office"], towards: "office" });
      expect(world.apply(go().action, { ...call({ place: "office" }), atMs: 0 })).toEqual({ applied: true });
      expect(where(world.state.space, "worker")).toEqual({ place: "office" });
    });

    it("to a place not one passage away, or its own, starts nothing, takes no time and fails, naming why", () => {
      const state = start();

      for (const [place, reason] of [["attic", "invalid_target"], ["hall", "already_there"]]) {
        expect(go().start?.appliesTo?.(state, call({ place }))).toBe(false);
        expect(go().durationMs(state, call({ place }))).toBe(0);
        expect(land(state, "go", { place }).result).toEqual({ applied: false, reason });
      }
    });
  });

  describe("take", () => {
    it("puts a thing in the worker's place, or inside a container there, into its hands", () => {
      const fromPlace = land(start({ world: WORLD.replace('portable = false', 'portable = true') }), "take", { thing: "sign" });
      const fromContainer = land(inPlace(start(), "office"), "take", { thing: "key" });

      expect(fromPlace.result).toEqual({ applied: true });
      expect(where(fromPlace.state.space, "sign")).toBeUndefined();
      expect(fromPlace.state.held).toEqual({ sign: "worker" });
      expect(fromContainer.state.held).toEqual({ key: "worker" });
      expect(fromContainer.state.inside).toEqual({});
      expect(effector("take").durationMs(start(), call({ thing: "key" }))).toBe(12);
    });

    it("fails, checked in this order, when it is already held, not here, cannot be carried, or the hands are full", () => {
      const office = inPlace(start(), "office");
      const holding = { ...office, inside: {}, held: { key: "worker" } };

      expect(land(holding, "take", { thing: "key" }).result).toEqual({ applied: false, reason: "already_held" });
      expect(land(office, "take", { thing: "sign" }).result).toEqual({ applied: false, reason: "not_here" });
      expect(land(office, "take", { thing: "nothing" }).result).toEqual({ applied: false, reason: "not_here" });
      expect(land(start(), "take", { thing: "sign" }).result).toEqual({ applied: false, reason: "not_portable" });
      expect(land(holding, "take", { thing: "cupboard" }).result).toEqual({ applied: false, reason: "hands_full" });
    });
  });

  describe("put", () => {
    const holdingKey = (state: Workplace): Workplace => ({ ...state, inside: {}, held: { key: "worker" } });

    it("puts a thing the worker holds into its place, or into a container there", () => {
      const down = land(holdingKey(start()), "put", { thing: "key" });
      const into = land(inPlace(holdingKey(start()), "office"), "put", { thing: "key", into: "cupboard" });

      expect(down.result).toEqual({ applied: true });
      expect(where(down.state.space, "key")).toEqual({ place: "hall" });
      expect(down.state.held).toEqual({});
      expect(into.state.inside).toEqual({ key: "cupboard" });
      expect(where(into.state.space, "key")).toBeUndefined();
      expect(effector("put").durationMs(start(), call({ thing: "key" }))).toBe(13);
    });

    it("fails, checked in this order, when the worker does not hold it, the container is not here, or is no container", () => {
      expect(land(start(), "put", { thing: "key", into: "nowhere" }).result).toEqual({ applied: false, reason: "not_held" });
      expect(land(holdingKey(start()), "put", { thing: "key", into: "cupboard" }).result).toEqual({ applied: false, reason: "not_here" });
      expect(land(holdingKey(start()), "put", { thing: "key", into: "sign" }).result).toEqual({ applied: false, reason: "not_a_container" });
    });
  });

  describe("give", () => {
    it("gives a thing the worker holds to a person in its place, who then holds it", () => {
      const office = inPlace({ ...start(), inside: {}, held: { key: "worker" } }, "office");
      const given = land(office, "give", { thing: "key", person: "ana" });

      expect(given.result).toEqual({ applied: true });
      expect(given.state.held).toEqual({ key: "ana" });
      expect(effector("give").durationMs(office, call({ thing: "key", person: "ana" }))).toBe(14);
    });

    it("fails, checked in this order, when the worker does not hold it, or the person is not here", () => {
      const holding = { ...start(), inside: {}, held: { key: "worker" } };

      expect(land(start(), "give", { thing: "key", person: "nobody" }).result).toEqual({ applied: false, reason: "not_held" });
      expect(land(holding, "give", { thing: "key", person: "ana" }).result).toEqual({ applied: false, reason: "not_here" });
      expect(land(holding, "give", { thing: "key", person: "nobody" }).result).toEqual({ applied: false, reason: "not_here" });
    });
  });

  describe("record", () => {
    it("writes an entry in the book, with the moment it lands, where the book is; it takes the time per word", () => {
      const written = land(start(), "record", { entry: "Two parcels in." }, 1234);

      expect(written.result).toEqual({ applied: true });
      expect(written.state.book).toEqual([{ entry: "Two parcels in.", atMs: 1234 }]);
      expect(effector("record").durationMs(start(), call({ entry: "Two parcels in." }))).toBe(15);
    });

    it("fails with not_here where the book is not", () => {
      expect(land(inPlace(start(), "office"), "record", { entry: "x" }).result).toEqual({ applied: false, reason: "not_here" });
    });
  });

  describe("note", () => {
    it("keeps a note to the person who gave the task, with the moment it lands, wherever the worker is; it takes the time per word", () => {
      const sent = land(inPlace(start(), "office"), "note", { text: "The key is here." }, 99);

      expect(sent.result).toEqual({ applied: true });
      expect(sent.state.notes).toEqual([{ text: "The key is here.", atMs: 99 }]);
      expect(effector("note").durationMs(start(), call({ text: "The key is here." }))).toBe(20);
    });
  });

  it("give the worker the text the SPEC sets for each outcome", () => {
    const texts = Object.fromEntries(scenario.tools.flatMap((each) => (each.kind === "effector" ? [[each.name, each.texts]] : [])));

    expect(texts).toEqual({
      go: {
        success: "You have arrived.",
        invalid_target: "There is no passage from here to that place; you have not moved.",
        already_there: "You are already there; you have not moved.",
      },
      take: {
        success: "You are holding it.",
        not_here: "It is not here; you have taken nothing.",
        not_portable: "It cannot be carried; you have taken nothing.",
        hands_full: "Your hands are full; you have taken nothing.",
        already_held: "You are already holding it.",
      },
      put: {
        success: "You have put it there.",
        not_held: "You are not holding it; nothing has moved.",
        not_here: "That container is not here; you are still holding it.",
        not_a_container: "Nothing can be put inside that; you are still holding it.",
      },
      give: {
        success: "You have given it.",
        not_held: "You are not holding it; you have given nothing.",
        not_here: "That person is not here; you are still holding it.",
      },
      record: { success: "It is in the book.", not_here: "The book is not here; nothing has been recorded." },
      note: { success: "Your note has been sent." },
    });
  });

  describe("read their targets in the worker's last look, taken where it is now", () => {
    const looked = (state: Workplace) => ({ tool: "look", result: sensor("look").sense(state, "worker", {}), atMs: 0 });

    it("go: free for an exit it showed, outside for a place it showed no exit to", () => {
      const sensing = looked(start());

      expect(effector("go").readTarget(sensing, call({ place: "office" }), start(), onlySensing(sensing))).toBe("free");
      expect(effector("go").readTarget(sensing, call({ place: "attic" }), start(), onlySensing(sensing))).toBe("outside");
    });

    it("take, put and give: free for a thing, container or person it showed", () => {
      const office = inPlace(start(), "office");
      const sensing = looked(office);

      expect(effector("take").readTarget(sensing, call({ thing: "key" }), office, onlySensing(sensing))).toBe("free");
      expect(effector("take").readTarget(sensing, call({ thing: "sign" }), office, onlySensing(sensing))).toBe("not_sensed");
      expect(effector("put").readTarget(sensing, call({ thing: "key", into: "cupboard" }), office, onlySensing(sensing))).toBe("free");
      expect(effector("put").readTarget(sensing, call({ thing: "key" }), office, onlySensing(sensing))).toBe("not_sensed");
      expect(effector("give").readTarget(sensing, call({ thing: "key", person: "ana" }), office, onlySensing(sensing))).toBe("free");
      expect(effector("give").readTarget(sensing, call({ thing: "key", person: "bob" }), office, onlySensing(sensing))).toBe("not_sensed");
    });

    it("a read or examine after the look does not replace it", () => {
      const office = inPlace(start(), "office");
      const sensing = looked(office);
      const examined = { tool: "examine", result: sensor("examine").sense(office, "worker", { thing: "cupboard" }), atMs: 1 };
      const lastBy = (tool: string) => ({ look: sensing, examine: examined })[tool];

      expect(effector("take").readTarget(examined, call({ thing: "key" }), office, lastBy)).toBe("free");
      expect(effector("put").readTarget(examined, call({ thing: "key", into: "cupboard" }), office, lastBy)).toBe("free");
      expect(effector("give").readTarget(examined, call({ thing: "key", person: "ana" }), office, lastBy)).toBe("free");
      expect(effector("go").readTarget(examined, call({ place: "hall" }), office, lastBy)).toBe("free");
    });

    it("not_sensed for a look taken in another place, a sensing that is not a look, and for record and note", () => {
      const fromHall = looked(start());
      const office = inPlace(start(), "office");
      const read = { tool: "read", result: "Quiet, please.", atMs: 0 };

      expect(effector("go").readTarget(fromHall, call({ place: "hall" }), office, onlySensing(fromHall))).toBe("not_sensed");
      expect(effector("go").readTarget(read, call({ place: "office" }), start(), onlySensing(read))).toBe("not_sensed");
      expect(effector("record").readTarget(fromHall, call({ entry: "x" }), start(), onlySensing(fromHall))).toBe("not_sensed");
      expect(effector("note").readTarget(fromHall, call({ text: "x" }), start(), onlySensing(fromHall))).toBe("not_sensed");
    });
  });

  it("describe each tool's duration from the configuration", () => {
    const described = Object.fromEntries(scenario.tools.map(({ name }) => [name, scenario.describeDuration(settings(), name)]));

    expect(described).toEqual({
      look: "10 ms.",
      read: "5 ms for each word of the text, at least 10 ms.",
      examine: "11 ms.",
      go: "20 ms for each unit of the passage's length; no time when there is no passage to that place.",
      take: "12 ms.",
      put: "13 ms.",
      give: "14 ms.",
      record: "5 ms for each word of the entry.",
      note: "5 ms for each word of the note.",
    });
  });
});
