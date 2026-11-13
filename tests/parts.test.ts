import { describe, expect, it } from "vitest";
import type { WorldTime } from "../src/engine/calendar.ts";
import { type PartsProvided, PartsBook, readParts } from "../src/engine/parts.ts";

/** A world of flags, each raise recorded with its time, and the money's events. */
interface Flags {
  flags: Record<string, boolean>;
  raised: { flag: string; at: WorldTime }[];
  money: { events: Record<string, unknown>[] };
}

const provided: PartsProvided<Flags> = {
  predicates: { flag_set: (state, params) => state.flags[String(params.flag)] === true },
  events: { flag_raised: (state, params) => state.raised.find(({ flag }) => flag === params.flag)?.at },
  misapplications: { act_named: (act, params) => act.tool === params.tool },
};

const at = (day: number, clock: string): WorldTime => {
  const [hours, minutes] = clock.split(":").map(Number);
  return { day, weekday: "Monday", seconds: hours * 3600 + minutes * 60 };
};

const P1 = { id: "p1", predicate: "flag_set", params: { flag: "door" }, activation: "always", evaluate_at: "day 1 18:00", kinds: { none: "new", rules: "covered" }, actors: ["shop"] };
const read = (parts: Record<string, unknown>[], changes: Partial<Parameters<typeof readParts>[2]> = {}) =>
  readParts(parts, provided, { participants: ["shop"], kindFactor: { name: "guidance", levels: ["none", "rules"] }, ...changes });

describe("readParts (FR-PARTS-01)", () => {
  it("reads each part: its predicate and params, activation, evaluation time, kinds, actors and misapplications", () => {
    expect(read([P1])).toEqual([{ id: "p1", predicate: "flag_set", params: { flag: "door" }, activation: "always", evaluateAt: { at: 18 * 60 }, kinds: { none: "new", rules: "covered" }, actors: ["shop"], misapplications: [] }]);
    const evented = read([{ ...P1, activation: { event: "flag_raised", params: { flag: "alarm" } }, evaluate_at: { event: "flag_raised", params: { flag: "alarm" }, after_minutes: 60 } }])[0];
    expect(evented).toMatchObject({ activation: { event: "flag_raised", params: { flag: "alarm" } }, evaluateAt: { event: "flag_raised", params: { flag: "alarm" }, afterMinutes: 60 } });
    expect(read([{ ...P1, evaluate_at: "end" }])[0].evaluateAt).toEqual("end");
  });

  it("refuses, naming the part and the key, what it cannot follow", () => {
    const refusing = (part: Record<string, unknown>, changes = {}) => () => read([{ ...P1, ...part }], changes);
    expect(refusing({ predicate: "moon_full" })).toThrow(/p1\.predicate/);
    expect(refusing({ activation: { event: "eclipse" } })).toThrow(/p1\.activation/);
    expect(refusing({ misapplications: [{ pattern: "dance" }] })).toThrow(/p1\.misapplications/);
    expect(refusing({ misapplications: [{ pattern: "act_named", before: { event: "eclipse" } }] })).toThrow(/p1\.misapplications/);
    expect(refusing({ kinds: { none: "new", rules: "easy" } })).toThrow(/p1\.kinds/);
    expect(refusing({ kinds: { rules: "covered" } })).toThrow(/p1\.kinds/);
    expect(refusing({ kinds: { none: "new", rules: "covered", chaos: "new" } })).toThrow(/p1\.kinds/);
    expect(refusing({}, { kindFactor: { name: "colour" } })).toThrow(/kind_factor/);
    expect(refusing({ evaluate_at: "Monday" })).toThrow(/p1\.evaluate_at/);
    expect(refusing({ actors: ["zoe"] })).toThrow(/p1\.actors/);
    expect(() => read([P1, P1])).toThrow(/"p1"/);
    // An outcome has no kinds, so a kind factor that is no factor does not matter to it.
    expect(() => read([{ ...P1, kinds: undefined }], { kindFactor: { name: "colour" } })).not.toThrow();
  });
});

/** A book of the parts given, at the level "rules", for the agent "ana". */
function book(parts: Record<string, unknown>[], lines: Record<string, unknown>[]) {
  return new PartsBook<Flags>({ parts: read(parts), provided, level: "rules", agents: ["ana"], moneyOf: (state) => state.money, record: (line) => lines.push(line) });
}

const state = (flags: Record<string, boolean> = {}, raised: Flags["raised"] = [], events: Record<string, unknown>[] = []): Flags => ({ flags, raised, money: { events } });

describe("PartsBook (FR-PARTS-01)", () => {
  it("evaluates a part at its time: held, reached_at the start of the last interval in which it held, its kind, effort and misapplications", () => {
    const lines: Record<string, unknown>[] = [];
    const parts = book([P1], lines);
    parts.start(state(), at(1, "09:00"));
    parts.acted({ agent: "ana", tool: "send_mail", arguments: { to: "shop", act: "ask" }, world: at(1, "09:00") });
    parts.changed(state({ door: true }), at(1, "10:00"));
    parts.changed(state({ door: false }), at(1, "11:00"));
    parts.changed(state({ door: true }), at(1, "12:00"));
    parts.acted({ agent: "ana", tool: "send_mail", arguments: { to: "shop", act: "ask" }, world: at(1, "13:00") });
    expect(parts.nextAt()).toEqual(at(1, "18:00"));
    parts.due(state({ door: true }), at(1, "18:00"));
    expect(lines).toEqual([{ type: "part", part: "p1", evaluated_at: "day 1 18:00", active: true, held: true, reached_at: "day 1 12:00", effort: { calls: 1, money: 0 }, misapplications: [], kind: "covered" }]);
  });

  it("gives no reached_at for a part that does not hold at its evaluation, and counts effort until then", () => {
    const lines: Record<string, unknown>[] = [];
    const parts = book([P1], lines);
    parts.start(state(), at(1, "09:00"));
    parts.changed(state({ door: true }), at(1, "10:00"));
    parts.changed(state({ door: false }, [], [{ kind: "payment", from: "ana", to: "shop", amount: 50 }, { kind: "commitment", from: "ana", to: "shop", amount: 30 }, { kind: "payment", from: "ana", to: "zoe", amount: 9 }]), at(1, "11:00"));
    parts.due(state(), at(1, "18:00"));
    expect(lines[0]).toEqual({ type: "part", part: "p1", evaluated_at: "day 1 18:00", active: true, held: false, effort: { calls: 0, money: 80 }, misapplications: [], kind: "covered" });
  });

  it("activates a part at its event's first record, and records one not active at its evaluation as not active", () => {
    const lines: Record<string, unknown>[] = [];
    const p2 = { ...P1, id: "p2", params: { flag: "gate" }, activation: { event: "flag_raised", params: { flag: "alarm" } }, evaluate_at: "end" };
    const parts = book([p2], lines);
    parts.start(state(), at(1, "09:00"));
    parts.changed(state({ gate: true }, [{ flag: "gate", at: at(1, "10:00") }]), at(1, "10:00"));
    parts.finish(state({ gate: true }), at(1, "19:00"));
    expect(lines).toEqual([{ type: "part", part: "p2", evaluated_at: "day 1 19:00", active: false }]);
  });

  it("finds misapplications among the agent's acts, before or after a named event", () => {
    const lines: Record<string, unknown>[] = [];
    const parts = book([{ ...P1, misapplications: [{ pattern: "act_named", params: { tool: "clear_flag" }, before: { event: "flag_raised", params: { flag: "alarm" } } }] }], lines);
    parts.start(state(), at(1, "09:00"));
    parts.acted({ agent: "ana", tool: "clear_flag", arguments: { flag: "door" }, world: at(1, "10:00") });
    parts.changed(state({}, [{ flag: "alarm", at: at(1, "15:00") }]), at(1, "15:00"));
    parts.acted({ agent: "ana", tool: "clear_flag", arguments: { flag: "door" }, world: at(1, "18:00") });
    parts.acted({ agent: "shop", tool: "clear_flag", arguments: { flag: "door" }, world: at(1, "12:00") });
    parts.finish(state({}, [{ flag: "alarm", at: at(1, "15:00") }]), at(1, "19:00"));
    // Not yet evaluated, at day 1 18:00 it was due: finish evaluates what is due, then lists what is not.
    expect(lines[0]).toMatchObject({ part: "p1", misapplications: [{ tool: "clear_flag", arguments: { flag: "door" }, at: "day 1 10:00" }] });
  });

  it("evaluates a part at an event's time and the minutes after it, and an outcome with no kind", () => {
    const lines: Record<string, unknown>[] = [];
    const parts = book([{ ...P1, kinds: undefined, evaluate_at: { event: "flag_raised", params: { flag: "alarm" }, after_minutes: 60 } }], lines);
    parts.start(state(), at(1, "09:00"));
    expect(parts.nextAt()).toBeUndefined();
    parts.changed(state({ door: true }, [{ flag: "alarm", at: at(1, "15:00") }]), at(1, "15:00"));
    expect(parts.nextAt()).toEqual(at(1, "16:00"));
    parts.due(state({ door: true }), at(1, "16:00"));
    expect(lines[0]).not.toHaveProperty("kind");
    expect(lines[0]).toMatchObject({ evaluated_at: "day 1 16:00", held: true });
  });

  it("lists, as the run ends, the parts not yet evaluated", () => {
    const lines: Record<string, unknown>[] = [];
    const parts = book([{ ...P1, id: "p3", evaluate_at: "day 3 09:00" }, { ...P1, id: "w1", kinds: undefined, evaluate_at: "end" }], lines);
    parts.start(state(), at(1, "09:00"));
    expect(parts.busy).toBe(true);
    parts.finish(state(), at(1, "19:00"));
    expect(lines.map(({ type, part }) => [type, part])).toEqual([
      ["part", "w1"],
      ["parts_not_evaluated", undefined],
    ]);
    expect(lines[1]).toEqual({ type: "parts_not_evaluated", parts: ["p3"] });
  });
});
