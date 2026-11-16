import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import type { ToolCall } from "../src/engine/adapter.ts";
import { inventory } from "../src/engine/inventory.ts";
import { type LoadedScenario, type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { scenarioLibrary } from "../src/scenarios/library.ts";
import { type Workshop, workshopScenario } from "../src/scenarios/workshop.ts";

/**
 * The three texts of the workshop's world, word for word as copied from agents-lab-experiments' worlds/workshop/
 * identity.md, task.md and world-rules.md (commit 2d494ea), each without its final newline.
 */
const IDENTITY = `# Identity

You are {name}. You work in a small workshop that assembles devices to order. There are four workers: you and three others. You build modules from pieces and mount them on the bench. You do everything with your tools. You are a worker, not the owner or the customer.`;
const TASK = `# Today's order

One device, built as the plan on the wall shows.

The device has six modules. Each module is built by joining pieces from the pile, and then it is mounted on the bench.

The order is done when the six modules are mounted on the bench.

The order is for the four of you. The workshop closes 90 minutes after you start: the order must be done by then.`;
const WORLD_RULES = `How this place works:
- The workshop is one room: the pile of pieces, the bench, the plan on the wall, and the four of you.
- You know what is in the room, and the time, by looking, and what the order needs by reading the plan. Things change while you work, because the others are working too.
- Everything you do takes time, and so does looking, reading and speaking.
- The pieces in the pile are counted. A piece joined into a module is in that module until the module is taken apart.
- Your hands hold up to six loose pieces and one module.
- You can hand a loose piece or your module to another worker.
- The device is assembled on the bench by mounting finished modules. The bench has two places: two of you can mount at the same time, not more.
- When you speak, you speak to one or more of the others by name: you ask, you answer or you tell. Everyone in the room hears it.
- Nobody knows what you do not say.`;

/** The workshop with its base configuration changed. */
export function workshopWith(changing: (configuration: TomlTable) => void): Scenario<Workshop> {
  const configuration = parse(workshopScenario.baseConfiguration);
  changing(configuration);
  return { ...workshopScenario, baseConfiguration: stringify(configuration) };
}

function load(scenario: Scenario<Workshop> = workshopScenario, seed = 42, change?: TomlTable): LoadedScenario<Workshop> {
  return loadScenario(scenario, seed, change === undefined ? undefined : { name: "changed", change: stringify(change) });
}

describe("the workshop's base configuration (FR-WORKSHOP-01)", () => {
  const base = parse(workshopScenario.baseConfiguration);

  it("is in the scenario library", () => {
    expect(scenarioLibrary.get("workshop")).toBe(workshopScenario);
  });

  it("gives the four workers, the plan, the pile, the bench and the hands", () => {
    expect(base.workers).toEqual(["Dal", "Mik", "Nar", "Ren"]);
    expect(base.plan).toEqual({
      tessa: { recipe: ["arn", "arn", "bex", "cal", "dov"], after: [] },
      ulm: { recipe: ["bex", "eln"], after: ["tessa"] },
      vorn: { recipe: ["cal", "cal", "fim"], after: ["tessa"] },
      wick: { recipe: ["arn", "dov", "eln", "gor"], after: ["ulm", "vorn"] },
      yarl: { recipe: ["fim", "gor"], after: ["wick"] },
      zeth: { recipe: ["bex", "dov", "dov"], after: ["tessa"] },
    });
    expect(base.pile).toEqual({ arn: 4, bex: 3, cal: 4, dov: 5, eln: 2, fim: 2, gor: 2 });
    expect(base.bench_places).toBe(2);
    expect(base.hand_pieces).toBe(6);
  });

  it("gives the durations in world minutes, the calendar, the rhythm and the texts word for word, all in the system prompt", () => {
    expect(base.durations).toEqual({ look: 0.5, read_plan: 1, take: 1, put_back: 0.5, join: 2, take_apart: 2, mount: 3, mount_refused: 0.5, speech: 0.25, speech_words_per_minute: 30, hand: 0.5 });
    expect(base.wait_max_minutes).toBe(10);
    expect(base.calendar).toEqual({ start: "day 1 Monday 09:00", segments: [{ scale: 4 }] });
    expect(base.rhythm).toEqual({ source: "your own pace", text: "You are ready to act.", min_ms: 1000, max_ms: 3000 });
    expect([base.identity, base.task, base.world_rules]).toEqual([IDENTITY, TASK, WORLD_RULES]);
    // FR-WORKSHOP-05's character and limits, empty in the base.
    expect([base.character, base.limits]).toEqual(["", ""]);
    expect(base.placement).toEqual({ identity: "system", character: "system", task: "system", limits: "system", world_rules: "system" });
  });

  it("pins the base texts to the world's identity.md, task.md and world-rules.md as copied, each without its final newline", () => {
    expect(base.identity).toBe(IDENTITY);
    expect(base.task).toBe(TASK);
    expect(base.world_rules).toBe(WORLD_RULES);
    expect(IDENTITY.startsWith("# Identity\n\nYou are {name}. You work in a small workshop that assembles devices to order.")).toBe(true);
    expect(TASK.startsWith("# Today's order\n\n")).toBe(true);
    expect(WORLD_RULES.endsWith("\n- Nobody knows what you do not say.")).toBe(true);
  });
});

describe("the workshop at the start (FR-WORKSHOP-01)", () => {
  it("holds every piece in the pile, an empty bench and empty hands", () => {
    const { pile, bench, workers } = load().world.state;
    expect(pile).toEqual({ arn: 4, bex: 3, cal: 4, dov: 5, eln: 2, fim: 2, gor: 2 });
    expect(bench).toEqual({ mounted: [], places: [null, null] });
    expect(Object.keys(workers).sort()).toEqual(["Dal", "Mik", "Nar", "Ren"]);
    for (const hands of Object.values(workers)) expect(hands).toMatchObject({ loose: {}, module: null });
  });

  it("gives each worker the texts placed in the system prompt, in order, with its name", () => {
    const { systemPrompts, firstStimuli } = load();
    expect(systemPrompts.get("Dal")).toBe([IDENTITY.replace("{name}", "Dal"), TASK, WORLD_RULES].join("\n\n"));
    expect(systemPrompts.get("Ren")).toContain("You are Ren. You work in a small workshop");
    expect(firstStimuli.get("Dal")).toEqual([]);
  });

  it("sends a text placed first once, through the channel 'order', from the configuration's order_source", () => {
    const { systemPrompts, firstStimuli, channels } = load(workshopScenario, 42, { placement: { task: "first" }, order_source: "the order on the wall" });
    expect(systemPrompts.get("Dal")).toBe([IDENTITY.replace("{name}", "Dal"), WORLD_RULES].join("\n\n"));
    expect(firstStimuli.get("Dal")).toEqual(["order"]);
    expect(channels.find(({ name }) => name === "order")).toEqual({ name: "order", source: "the order on the wall", stimulus: TASK });
  });

  it("joins identity, character, task, limits and world rules in each place, skipping empty ones, each {name} the worker's (FR-WORKSHOP-05)", () => {
    const character = "You are {name}, practical and hands-on.";
    const limits = "Only {name} and three others work here.";
    const both = load(workshopScenario, 42, { character, limits });
    expect(both.systemPrompts.get("Dal")).toBe([IDENTITY.replace("{name}", "Dal"), "You are Dal, practical and hands-on.", TASK, "Only Dal and three others work here.", WORLD_RULES].join("\n\n"));
    expect(load(workshopScenario, 42, { limits: "It closes at five." }).systemPrompts.get("Dal")).toBe([IDENTITY.replace("{name}", "Dal"), TASK, "It closes at five.", WORLD_RULES].join("\n\n"));
    const first = load(workshopScenario, 42, { character, limits, placement: { character: "first", task: "first" }, order_source: "the order on the wall" });
    expect(first.systemPrompts.get("Ren")).toBe([IDENTITY.replace("{name}", "Ren"), "Only Ren and three others work here.", WORLD_RULES].join("\n\n"));
    // The order's {name} is the receiving worker's, filled as it first wakes.
    expect(first.channels.find(({ name }) => name === "order")).toEqual({ name: "order", source: "the order on the wall", stimulus: [character, TASK].join("\n\n") });
  });

  it("declares no order channel when every text is in the system prompt", () => {
    // FR-WORKSHOP-03 adds "voice", FR-WORKSHOP-05 "hands".
    expect(load().channels.map(({ name }) => name)).toEqual(["rhythm", "voice", "hands"]);
  });

  it("names nothing of the world in its system prompts", () => {
    const { systemPrompts } = load();
    for (const prompt of systemPrompts.values()) {
      for (const word of ["arn", "bex", "cal", "dov", "eln", "fim", "gor", "tessa", "ulm", "vorn", "wick", "yarl", "zeth"]) expect(prompt).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});

describe("the workshop's listing orders (FR-WORKSHOP-01)", () => {
  const orders = (loaded: LoadedScenario<Workshop>) => loaded.world.state.orders;

  it("draws them from the seed: the same seed gives the same orders, of every kind, worker and module", () => {
    const first = orders(load());
    expect(orders(load())).toEqual(first);
    expect([...first.kinds].sort()).toEqual(["arn", "bex", "cal", "dov", "eln", "fim", "gor"]);
    expect([...first.workers].sort()).toEqual(["Dal", "Mik", "Nar", "Ren"]);
    expect([...first.modules].sort()).toEqual(["tessa", "ulm", "vorn", "wick", "yarl", "zeth"]);
  });

  it("varies them across seeds", () => {
    const drawn = Array.from({ length: 20 }, (_, index) => orders(load(workshopScenario, index + 1)));
    for (const list of ["kinds", "workers", "modules"] as const) expect(new Set(drawn.map((each) => each[list].join())).size).toBeGreaterThan(1);
  });

  it("keeps the kinds' and the modules' orders when a condition changes the workers", () => {
    const base = orders(load());
    const three = orders(load(workshopScenario, 42, { workers: ["Dal", "Mik", "Nar"] }));
    expect(three.kinds).toEqual(base.kinds);
    expect(three.modules).toEqual(base.modules);
    expect([...three.workers].sort()).toEqual(["Dal", "Mik", "Nar"]);
  });
});

describe("the workshop's refusals (FR-WORKSHOP-01)", () => {
  const refusals: [string, (configuration: TomlTable) => void, string[]][] = [
    ["a plan with no module", (c) => (c.plan = {}), ['"plan"']],
    ["an empty recipe", (c) => (((c.plan as TomlTable).ulm as TomlTable).recipe = []), ['"plan.ulm.recipe"']],
    ["a recipe naming a kind the pile lacks", (c) => (((c.plan as TomlTable).ulm as TomlTable).recipe = ["bex", "hox"]), ['"plan.ulm.recipe"', "hox"]],
    ["an after that names no module", (c) => (((c.plan as TomlTable).ulm as TomlTable).after = ["quill"]), ['"plan.ulm.after"', "quill"]],
    ["an order in which a module can never be mounted", (c) => (((c.plan as TomlTable).tessa as TomlTable).after = ["zeth"]), ['"plan.tessa.after"']],
    ["a negative stock", (c) => ((c.pile as TomlTable).arn = -1), ['"pile.arn"']],
    ["a stock that is no whole number", (c) => ((c.pile as TomlTable).arn = 2.5), ['"pile.arn"']],
    ["no bench place", (c) => (c.bench_places = 0), ['"bench_places"']],
    ["no loose piece in the hands", (c) => (c.hand_pieces = 0), ['"hand_pieces"']],
    ["no worker", (c) => (c.workers = []), ['"workers"']],
    ["a worker named twice", (c) => (c.workers = ["Dal", "Dal", "Nar", "Ren"]), ['"workers"', "Dal"]],
    ["a negative duration", (c) => ((c.durations as TomlTable).join = -1), ['"durations.join"']],
    ["a negative hand duration (FR-WORKSHOP-05)", (c) => ((c.durations as TomlTable).hand = -1), ['"durations.hand"']],
    ["no hand duration (FR-WORKSHOP-05)", (c) => delete (c.durations as TomlTable).hand, ['"durations.hand"']],
    ["a negative speech duration (FR-WORKSHOP-06)", (c) => ((c.durations as TomlTable).speech = -1), ['"durations.speech"']],
    ["a speech_words_per_minute of 0 (FR-WORKSHOP-06)", (c) => ((c.durations as TomlTable).speech_words_per_minute = 0), ['"durations.speech_words_per_minute"']],
    ["a duration say, which the workshop no longer has (FR-WORKSHOP-06)", (c) => ((c.durations as TomlTable).say = 0.25), ['"durations.say"']],
    ["a duration say_words_per_minute, which the workshop no longer has (FR-WORKSHOP-06)", (c) => ((c.durations as TomlTable).say_words_per_minute = 30), ['"durations.say_words_per_minute"']],
    ["a wait_max_minutes of 0", (c) => (c.wait_max_minutes = 0), ['"wait_max_minutes"']],
    ["a calendar of two segments", (c) => ((c.calendar as TomlTable).segments = [{ scale: 4, until: "day 1 Monday 10:00" }, { scale: 60 }]), ['"calendar.segments"']],
    ["a min_ms above max_ms", (c) => ((c.rhythm as TomlTable).min_ms = 4000), ['"rhythm"']],
    ["a placement that is no place", (c) => ((c.placement as TomlTable).task = "person"), ['"placement.task"', "person"]],
    ["a placement of a text the workshop does not have", (c) => ((c.placement as TomlTable).norms = "system"), ['"placement.norms"']],
    ["a text that names in braces anything but {name}", (c) => (c.identity = `${c.identity as string} {team}`), ['"identity"', "{team}"]],
    ["a character that names in braces anything but {name} (FR-WORKSHOP-05)", (c) => (c.character = "You are {name}, of {team}."), ['"character"', "{team}"]],
    ["limits that name in braces anything but {name} (FR-WORKSHOP-05)", (c) => (c.limits = "It closes at {closing}."), ['"limits"', "{closing}"]],
    ["a character placed in no place (FR-WORKSHOP-05)", (c) => ((c.placement as TomlTable).character = "person"), ['"placement.character"', "person"]],
    ["limits placed in no place (FR-WORKSHOP-05)", (c) => ((c.placement as TomlTable).limits = "wall"), ['"placement.limits"', "wall"]],
  ];

  for (const [what, changing, named] of refusals) {
    it(`refuses ${what}, naming the key`, () => {
      let error: Error | undefined;
      try {
        load(workshopWith(changing));
      } catch (thrown) {
        error = thrown as Error;
      }
      expect(error?.message).toBeDefined();
      for (const name of named) expect(error?.message).toContain(name);
    });
  }
});

describe("the workshop's inventory (FR-WORKSHOP-01)", () => {
  const experiment = {
    id: "e",
    scenario: "workshop",
    models: ["faux/scripted"],
    thinkingLevel: "off" as const,
    replicas: 1,
    seed: 42,
    limits: { timeLimitMs: 1000, activationsPerAgent: 1, parallelismLimit: 1, modelTurnTimeoutMs: 1000 },
    compaction: { enabled: false },
    conditions: [{ name: "base", change: "" }],
  };

  it("gives the plan, the pile, the bench places, the hands, the workers, the durations, the texts with their placement and the order's source", () => {
    const [condition] = inventory(experiment as never, workshopScenario).conditions;
    const base = parse(workshopScenario.baseConfiguration);
    expect(condition.world).toEqual({
      plan: base.plan,
      pile: base.pile,
      bench_places: 2,
      hands: { loose_pieces: 6, modules: 1 },
      workers: ["Dal", "Mik", "Nar", "Ren"],
      durations: base.durations,
      wait_max_minutes: 10,
      texts: { identity: IDENTITY, character: "", task: TASK, limits: "", world_rules: WORLD_RULES },
      placement: base.placement,
      order_source: base.order_source,
    });
    expect(condition.calendar?.segments).toEqual([{ scale: 4, runTime: "until the run ends" }]);
    expect(condition.agents.map(({ name, rhythm }) => [name, rhythm])).toEqual(
      ["Dal", "Mik", "Nar", "Ren"].map((name) => [name, "An interval drawn uniformly between 1000 and 3000 ms before each activation."]),
    );
  });
});

describe("the workers' tools (FR-WORKSHOP-02)", () => {
  type Tool = (typeof workshopScenario.tools)[number];
  const toolNamed = (name: string): Tool => {
    const tool = workshopScenario.tools.find((each) => each.name === name);
    if (tool === undefined) throw new Error(`the workshop has no tool "${name}"`);
    return tool;
  };
  const effector = (name: string) => {
    const tool = toolNamed(name);
    if (tool.kind !== "effector") throw new Error(`"${name}" is no effector`);
    return tool;
  };
  const sensor = (name: string) => {
    const tool = toolNamed(name);
    if (tool.kind !== "sensor") throw new Error(`"${name}" is no sensor`);
    return tool;
  };
  /** The base workshop with the draw of FR-WORKSHOP-02's Background, changed. */
  const start = (changing: (state: Workshop) => Workshop = (state) => state): Workshop =>
    changing({ ...load().world.state, orders: { kinds: ["gor", "arn", "fim", "bex", "dov", "cal", "eln"], workers: ["Ren", "Dal", "Nar", "Mik"], modules: ["zeth", "ulm", "wick", "tessa", "yarl", "vorn"] } });
  const holding = (state: Workshop, worker: string, hands: Partial<Workshop["workers"][string]>): Workshop => ({ ...state, workers: { ...state.workers, [worker]: { ...state.workers[worker], ...hands } } });
  // A landing is given the world's time (FR-WORKSHOP-04 keeps it).
  const call = (agent: string, args: Record<string, unknown> = {}) => ({ agent, arguments: args, atMs: 0, world: { day: 1, weekday: "Monday" as const, seconds: 9 * 3600 } });
  /** What an effector's landing gives: its outcome, and the state after it with its end, as the engine applies them. */
  const land = (name: string, state: Workshop, agent: string, args: Record<string, unknown> = {}) => {
    const { action, end } = effector(name);
    const check = action === undefined ? { holds: true as const } : action.precondition(state, call(agent, args));
    const acted = check.holds && action !== undefined ? action.effect(state, call(agent, args)) : state;
    return { outcome: check.holds ? "success" : check.reason, state: end === undefined ? acted : end.effect(acted, call(agent, args)) };
  };
  const started = (name: string, state: Workshop, agent: string, args: Record<string, unknown> = {}) => effector(name).start?.effect(state, call(agent, args)) ?? state;

  it("are look, read_plan, take, put_back, join, take_apart, mount and wait, none naming a kind or a module", () => {
    // FR-WORKSHOP-06 adds "ask", "answer" and "tell", FR-WORKSHOP-05 "hand".
    expect(workshopScenario.tools.map(({ name }) => name)).toEqual(["look", "read_plan", "take", "put_back", "join", "take_apart", "mount", "wait", "ask", "answer", "tell", "hand"]);
    const written = JSON.stringify(workshopScenario.tools.map(({ description, parameters }) => ({ description, parameters })));
    for (const word of ["arn", "bex", "cal", "dov", "eln", "fim", "gor", "tessa", "ulm", "vorn", "wick", "yarl", "zeth"]) expect(written).not.toMatch(new RegExp(`\\b${word}\\b`));
  });

  it("take each its duration in world minutes from the configuration", () => {
    const state = start();
    const minutes = (name: string, args: Record<string, unknown> = {}) => toolNamed(name).durationMs(state, { agent: "Dal", arguments: args });
    expect(["look", "read_plan", "take", "put_back", "join", "take_apart", "mount"].map((name) => minutes(name))).toEqual(
      [0.5, 1, 1, 0.5, 2, 2, 3].map((each) => ({ worldSeconds: each * 60 })),
    );
    expect(minutes("wait", { minutes: 2.5 })).toEqual({ worldSeconds: 150 });
    // A mount that finds every bench place taken as it starts takes mount_refused.
    const full = { ...state, bench: { ...state.bench, places: ["Mik", "Nar"] } };
    expect(toolNamed("mount").durationMs(full, { agent: "Dal", arguments: {} })).toEqual({ worldSeconds: 30 });
  });

  it("look gives the room as JSON, in the drawn orders, each worker with what it holds and is doing", () => {
    let state = holding(start(), "Dal", { loose: { arn: 2 }, module: { name: "tessa", joined: ["bex"] } });
    state = { ...state, pile: { ...state.pile, arn: 2, bex: 2 } };
    state = started("take", state, "Mik", { kind: "dov" });
    expect(JSON.parse(sensor("look").sense(state, "Dal", {}, 0, call("Dal").world))).toEqual({
      clock: 0,
      pile: { gor: 2, arn: 2, fim: 2, bex: 2, dov: 5, cal: 4, eln: 2 },
      bench: { mounted: [], places: [null, null] },
      workers: [
        { name: "Ren", loose: {}, module: null, doing: "nothing" },
        { name: "Dal", loose: { arn: 2 }, module: { name: "tessa", joined: ["bex"], finished: false }, doing: "nothing" },
        { name: "Nar", loose: {}, module: null, doing: "nothing" },
        { name: "Mik", loose: {}, module: null, doing: "taking" },
      ],
    });
    expect(Object.keys(JSON.parse(sensor("look").sense(state, "Dal", {}, 0, call("Dal").world)))).toEqual(["clock", "pile", "bench", "workers"]);
    expect(Object.keys(JSON.parse(sensor("look").sense(state, "Dal", {}, 0, call("Dal").world)).pile)).toEqual(["gor", "arn", "fim", "bex", "dov", "cal", "eln"]);
  });

  it("look gives first the clock: the whole world minutes since the calendar's start when it ends, rounded down (FR-WORKSHOP-05)", () => {
    const clockAt = (seconds: number) => JSON.parse(sensor("look").sense(start(), "Dal", {}, 0, { day: 1, weekday: "Monday", seconds: 9 * 3600 + seconds })).clock;
    expect([0, 30, 59.9, 60, 150, 156, 210, 3600].map(clockAt)).toEqual([0, 0, 0, 1, 2, 2, 3, 60]);
    expect(sensor("look").description).toMatch(/the clock, in whole minutes since the start/);
  });

  it("read_plan gives the modules in the drawn order", () => {
    const { modules } = JSON.parse(sensor("read_plan").sense(start(), "Dal", {}, 0)) as { modules: { name: string }[] };
    expect(modules.map(({ name }) => name)).toEqual(["zeth", "ulm", "wick", "tessa", "yarl", "vorn"]);
    expect(modules[0]).toEqual({ name: "zeth", recipe: ["bex", "dov", "dov"], after: ["tessa"] });
  });

  it("take, put_back, join and take_apart move pieces between the pile, the hands and the module", () => {
    let state = start();
    state = land("take", state, "Mik", { kind: "bex" }).state;
    state = land("take", state, "Mik", { kind: "eln" }).state;
    expect(state.workers.Mik.loose).toEqual({ bex: 1, eln: 1 });
    state = land("join", state, "Mik", { module: "ulm", kind: "bex" }).state;
    expect(state.workers.Mik).toMatchObject({ loose: { eln: 1 }, module: { name: "ulm", joined: ["bex"] } });
    state = land("put_back", state, "Mik", { kind: "eln" }).state;
    state = land("take_apart", state, "Mik").state;
    expect(state.workers.Mik).toMatchObject({ loose: {}, module: null });
    expect(state.pile).toEqual(start().pile);
  });

  it("refuses each effector's call when it lands, in the order of the table, changing nothing", () => {
    const base = start();
    const cases: [string, Workshop, Record<string, unknown>, string][] = [
      ["take", { ...base, pile: { ...base.pile, gor: 0 } }, { kind: "gor" }, "none_left"],
      ["take", base, { kind: "hox" }, "none_left"],
      ["take", holding({ ...base, pile: { ...base.pile, gor: 0 } }, "Dal", { loose: { arn: 6 } }), { kind: "gor" }, "none_left"],
      ["take", holding(base, "Dal", { loose: { arn: 2, bex: 1, cal: 1, dov: 2 } }), { kind: "eln" }, "hands_full"],
      ["put_back", holding(base, "Dal", { loose: { arn: 1 } }), { kind: "cal" }, "not_held"],
      ["join", holding(base, "Dal", { loose: { bex: 1 } }), { module: "ulm", kind: "eln" }, "not_held"],
      ["join", holding(base, "Dal", { loose: { arn: 1 }, module: { name: "tessa", joined: ["arn", "arn"] } }), { module: "tessa", kind: "arn" }, "not_needed"],
      ["join", holding(base, "Dal", { loose: { bex: 1 } }), { module: "quill", kind: "bex" }, "not_needed"],
      ["join", holding(base, "Dal", { loose: { cal: 1 }, module: { name: "ulm", joined: ["bex"] } }), { module: "vorn", kind: "cal" }, "other_module"],
      ["take_apart", base, {}, "no_module"],
    ];
    for (const [name, state, args, outcome] of cases) {
      const landed = land(name, state, "Dal", args);
      expect([name, landed.outcome]).toEqual([name, outcome]);
      expect(landed.state).toEqual(state);
    }
  });

  it("refuses a mount as bench_full when the worker occupies no bench place, and otherwise as the table says", () => {
    const base = start();
    const finishedTessa = { name: "tessa", joined: ["arn", "arn", "bex", "cal", "dov"] };
    const mounting = (state: Workshop) => started("mount", state, "Dal");
    const cases: [Workshop, string][] = [
      [holding({ ...base, bench: { ...base.bench, places: ["Mik", "Nar"] } }, "Dal", { module: finishedTessa }), "bench_full"],
      [mounting(base), "no_module"],
      [mounting(holding(base, "Dal", { module: { name: "tessa", joined: ["arn"] } })), "not_finished"],
      [mounting(holding(base, "Dal", { module: { name: "ulm", joined: ["bex", "eln"] } })), "out_of_order"],
      [mounting(holding({ ...base, bench: { ...base.bench, mounted: ["tessa"] } }, "Dal", { module: finishedTessa })), "already_mounted"],
    ];
    for (const [state, outcome] of cases) expect(land("mount", state, "Dal").outcome).toBe(outcome);
  });

  it("mount occupies a free bench place as it starts, mounts the finished module when it lands, and frees the place as it ends", () => {
    const state = holding(start(), "Dal", { module: { name: "tessa", joined: ["arn", "arn", "bex", "cal", "dov"] } });
    const under = started("mount", state, "Dal");
    expect(under.bench.places).toEqual(["Dal", null]);
    expect(under.workers.Dal.doing).toBe("mounting");
    expect(effector("mount").start?.describe(state, call("Dal"))).toEqual({ began: "mounting", place: 1 });
    const { outcome, state: after } = land("mount", under, "Dal");
    expect(outcome).toBe("success");
    expect(after.bench).toEqual({ mounted: ["tessa"], places: [null, null] });
    expect(after.workers.Dal).toMatchObject({ module: null, doing: "nothing" });
  });

  it("a mount that finds the bench full still shows the worker mounting, and occupies no place", () => {
    const full = holding({ ...start(), bench: { mounted: [], places: ["Mik", "Nar"] } }, "Dal", { module: { name: "tessa", joined: ["arn", "arn", "bex", "cal", "dov"] } });
    const under = started("mount", full, "Dal");
    expect(under.bench.places).toEqual(["Mik", "Nar"]);
    expect(under.workers.Dal.doing).toBe("mounting");
    expect(effector("mount").start?.describe(full, call("Dal"))).toEqual({ began: "mounting", place: null });
  });

  it("shows a worker doing what its effector's call does, from its start until its end", () => {
    for (const [name, doing] of [["take", "taking"], ["put_back", "putting back"], ["join", "joining"], ["take_apart", "taking apart"], ["wait", "waiting"]]) {
      const under = started(name, start(), "Dal", { kind: "arn", module: "tessa", minutes: 1 });
      expect([name, under.workers.Dal.doing]).toEqual([name, doing]);
      expect(effector(name).start?.describe(start(), call("Dal"))).toEqual({ began: doing });
      expect(effector(name).end?.effect(under, call("Dal")).workers.Dal.doing).toBe("nothing");
    }
  });

  it("wait takes minutes above 0 and at most wait_max_minutes, refusing any other at once, and ends early at a stimulus", () => {
    const wait = effector("wait");
    for (const minutes of [0, -1, 10.5]) expect(wait.refuses?.(start(), { agent: "Dal", arguments: { minutes } })?.outcome).toBe("invalid_arguments");
    for (const minutes of [0.5, 2, 10]) expect(wait.refuses?.(start(), { agent: "Dal", arguments: { minutes } })).toBeUndefined();
    expect(wait.action).toBeUndefined();
    expect(wait.endsEarly?.outcome).toBe("interrupted");
    expect(wait.endsEarly?.byStimulus({ channel: "voice", source: "Mik", content: "hello" }, { agent: "Dal", arguments: {} })).toBe(true);
    expect(wait.texts).toEqual({ success: "You have waited.", interrupted: "Something reached you; you stopped waiting." });
    // Its description says it ends as soon as something reaches the worker: someone speaks or hands it something.
    expect(wait.description).toMatch(/as soon as something reaches you \(someone speaks or hands you something\)/);
  });

  it("reads take's and mount's targets in the worker's last look", () => {
    const state = start();
    const lookAt = (pile: Record<string, number>, places: (string | null)[]) => ({ tool: "look", result: JSON.stringify({ pile, bench: { mounted: [], places }, workers: [] }), atMs: 0 });
    const target = (name: string, args: Record<string, unknown>, look: ReturnType<typeof lookAt> | undefined) =>
      effector(name).readTarget(look, { agent: "Mik", arguments: args }, state, (tool) => (tool === "look" ? look : undefined));
    expect(target("take", { kind: "gor" }, lookAt({ gor: 1 }, [null, null]))).toBe("free");
    expect(target("take", { kind: "gor" }, lookAt({ gor: 0 }, [null, null]))).toBe("held");
    expect(target("take", { kind: "gor" }, undefined)).toBe("not_sensed");
    expect(target("mount", {}, lookAt({}, ["Dal", null]))).toBe("free");
    expect(target("mount", {}, lookAt({}, ["Dal", "Nar"]))).toBe("held");
    expect(target("join", { module: "ulm", kind: "bex" }, lookAt({}, [null, null]))).toBe("not_sensed");
  });

  it("gives the inventory each tool's duration in world minutes", () => {
    const configuration = parse(workshopScenario.baseConfiguration);
    expect(["look", "read_plan", "take", "put_back", "join", "take_apart"].map((tool) => workshopScenario.describeDuration(configuration, tool))).toEqual(
      ["0.5 world minutes.", "1 world minutes.", "1 world minutes.", "0.5 world minutes.", "2 world minutes.", "2 world minutes."],
    );
    expect(workshopScenario.describeDuration(configuration, "mount")).toBe("3 world minutes; 0.5 world minutes when every bench place is taken as it starts.");
    expect(workshopScenario.describeDuration(configuration, "wait")).toBe("The minutes it is given, above 0 and at most 10 world minutes; it ends early when a stimulus reaches the worker.");
  });
});

describe("ask, answer and tell (FR-WORKSHOP-03, FR-WORKSHOP-06)", () => {
  const speech = (name: string) => {
    const tool = workshopScenario.tools.find((each) => each.name === name);
    if (tool?.kind !== "effector") throw new Error(`"${name}" is no effector`);
    return tool;
  };
  const state = load().world.state;
  const call = (to: unknown, text: string, agent = "Dal") => ({ agent, arguments: { to, text }, atMs: 0, world: { day: 1, weekday: "Monday" as const, seconds: 9 * 3600 + 60 } });
  const kinds = [
    ["ask", "asks", "You have asked them.", "Ask one or more of the other workers a question. Put their names in `to`. Everyone in the room hears it."],
    ["answer", "answers", "You have answered them.", "Answer one or more of the other workers. Put their names in `to`. Everyone in the room hears it."],
    ["tell", "tells", "You have told them.", "Tell one or more of the other workers something that is not a question or an answer. Put their names in `to`. Everyone in the room hears it."],
  ] as const;
  const refusals = {
    no_one: "You named nobody. Nothing was said.",
    no_such_worker: 'There is no worker named "<name>". Nothing was said.',
    to_self: "You cannot speak to yourself. Nothing was said.",
    empty_text: "Your text is empty. Nothing was said.",
  };

  it("are effectors of a to, a list of names, and a text, with the descriptions and parameters of the table, naming no worker, kind or module", () => {
    for (const [name, , success, description] of kinds) {
      const tool = speech(name);
      expect(tool.description).toBe(description);
      expect(tool.parameters).toEqual({
        type: "object",
        properties: {
          to: { type: "array", items: { type: "string" }, description: "The names of the workers you speak to, one or more." },
          text: { type: "string", description: "What you say." },
        },
        required: ["to", "text"],
      });
      expect(tool.texts).toEqual({ success, ...refusals });
      expect(tool.readTarget(undefined, call(["Mik"], "hi"), state, () => undefined)).toBe("not_sensed");
      const written = JSON.stringify({ description: tool.description, parameters: tool.parameters });
      for (const word of ["Dal", "Mik", "Nar", "Ren", "arn", "tessa"]) expect(written).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });

  it("take speech minutes plus one minute per speech_words_per_minute words of the text, the names in to counting none", () => {
    for (const [name] of kinds) {
      expect(speech(name).durationMs(state, call(["Mik"], "Who builds tessa?"))).toEqual({ worldSeconds: (0.25 + 3 / 30) * 60 });
      expect(speech(name).durationMs(state, call(["Mik", "Nar", "Ren"], " one\ttwo\nthree  four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "))).toEqual({ worldSeconds: 0.75 * 60 });
      expect(speech(name).durationMs(state, call([], "   "))).toEqual({ worldSeconds: 15 });
      expect(workshopScenario.describeDuration(parse(workshopScenario.baseConfiguration), name)).toBe("0.25 world minutes plus one minute per 30 words.");
    }
  });

  it("show the speaker speaking while the call lasts", () => {
    for (const [name] of kinds) {
      const tool = speech(name);
      expect(tool.start?.effect(state, call(["Mik"], "hi")).workers.Dal.doing).toBe("speaking");
      expect(tool.start?.describe(state, call(["Mik"], "hi"))).toEqual({ began: "speaking" });
      expect(tool.end?.effect(tool.start?.effect(state, call(["Mik"], "hi")) ?? state, call(["Mik"], "hi")).workers.Dal.doing).toBe("nothing");
    }
  });

  it("refuse when they land, in the order nobody, no such worker, oneself, no word", () => {
    const cases: [unknown, string, string][] = [
      [[], "Who builds tessa?", "no_one"],
      [["Kel"], "Who builds tessa?", "no_such_worker"],
      [["Mik", "Kel"], "I build tessa.", "no_such_worker"],
      [["mik"], "Please take ulm.", "no_such_worker"],
      [["Dal"], "Who builds tessa?", "to_self"],
      [["Mik", "Dal"], "I build tessa.", "to_self"],
      [["Mik"], "", "empty_text"],
      [["Mik"], "   ", "empty_text"],
      [["Mik", "Nar"], "\n  ", "empty_text"],
      [[], "", "no_one"],
      [["Kel", "Dal"], "", "no_such_worker"],
      [["Dal", "Kel"], "Please take ulm.", "no_such_worker"],
      [["Dal"], "", "to_self"],
    ];
    for (const [name] of kinds) {
      for (const [to, text, outcome] of cases) expect([name, to, text, speech(name).action?.precondition(state, call(to, text))]).toEqual([name, to, text, { holds: false, reason: outcome }]);
      expect(speech(name).action?.precondition(state, call(["Mik", "Mik", "Nar"], "Who builds tessa?"))).toEqual({ holds: true });
    }
  });

  it("name in no_such_worker's text each name that is no worker's, in quotes, in the order first named, joined with or", () => {
    const text = (to: string[]) => speech("tell").refusalText?.(state, call(to, "Please take ulm."), "no_such_worker");
    expect(text(["Kel"])).toBe('There is no worker named "Kel". Nothing was said.');
    expect(text(["Mik", "Kel"])).toBe('There is no worker named "Kel". Nothing was said.');
    expect(text(["Kel", "Mik", "Tam"])).toBe('There is no worker named "Kel" or "Tam". Nothing was said.');
    expect(text(["Kel", "Tam", "Kel", "Bo"])).toBe('There is no worker named "Kel", "Tam" or "Bo". Nothing was said.');
    for (const outcome of ["success", "no_one", "to_self", "empty_text"]) expect(speech("ask").refusalText?.(state, call(["Mik"], "hi"), outcome)).toBeUndefined();
  });

  it("deliver to every other worker on the channel voice, from the speaker, its kind, the workers addressed with you for the listener, and the text", () => {
    for (const [name, verb] of kinds) {
      expect(speech(name).delivers?.channel).toBe("voice");
      expect(speech(name).delivers?.deliveries(state, call(["Mik", "Nar", "Mik"], " Who builds tessa?"))).toEqual([
        { agent: "Mik", source: "Dal", values: { verb, names: "you and Nar", text: " Who builds tessa?" } },
        { agent: "Nar", source: "Dal", values: { verb, names: "Mik and you", text: " Who builds tessa?" } },
        { agent: "Ren", source: "Dal", values: { verb, names: "Mik and Nar", text: " Who builds tessa?" } },
      ]);
    }
    expect(speech("tell").delivers?.deliveries(state, call(["Mik", "Nar", "Ren"], "We start now.")).map(({ values }) => values.names)).toEqual(["you, Nar and Ren", "Mik, you and Ren", "Mik, Nar and you"]);
    expect(speech("ask").delivers?.deliveries(state, call(["Dal"], "Who builds tessa?", "Nar")).map(({ agent, values }) => [agent, values.names])).toEqual([["Dal", "you"], ["Mik", "Dal"], ["Ren", "Dal"]]);
  });

  it("speak through the channel voice, from the speaker, which wakes a resting worker and is described by its kind, names and text", () => {
    expect(load().channels.find(({ name }) => name === "voice")).toEqual({
      name: "voice",
      source: "the speaker",
      stimulus: '{verb} {names}, "{text}"',
      described: 'asks, answers or tells <names>, "<text>"',
      wakes: true,
    });
  });
});

describe("hand (FR-WORKSHOP-05)", () => {
  const handTool = () => {
    const tool = workshopScenario.tools.find(({ name }) => name === "hand");
    if (tool?.kind !== "effector") throw new Error("hand is no effector");
    return tool;
  };
  const call = (worker: string, what: string, agent = "Dal") => ({ agent, arguments: { worker, what }, atMs: 0, world: { day: 1, weekday: "Monday" as const, seconds: 9 * 3600 + 30 } });
  const holding = (state: Workshop, worker: string, hands: Partial<Workshop["workers"][string]>): Workshop => ({ ...state, workers: { ...state.workers, [worker]: { ...state.workers[worker], ...hands } } });
  const base = () => load().world.state;
  /** A hand's landing: its outcome, and the state after it with its end. */
  const land = (state: Workshop, worker: string, what: string) => {
    const check = handTool().action?.precondition(state, call(worker, what)) ?? { holds: true as const };
    const acted = check.holds ? (handTool().action?.effect(state, call(worker, what)) ?? state) : state;
    return { outcome: check.holds ? "success" : check.reason, state: handTool().end?.effect(acted, call(worker, what)) ?? acted };
  };

  it("is an effector of a worker and a what, which takes hand minutes and names no worker, kind or module", () => {
    expect(handTool().durationMs(base(), call("Mik", "arn"))).toEqual({ worldSeconds: 30 });
    expect(Object.keys((handTool().parameters as { properties: object }).properties)).toEqual(["worker", "what"]);
    const written = JSON.stringify({ description: handTool().description, parameters: handTool().parameters });
    for (const word of ["Dal", "Mik", "Nar", "Ren", "arn", "bex", "cal", "dov", "eln", "fim", "gor", "tessa", "ulm", "vorn", "wick", "yarl", "zeth"]) expect(written).not.toMatch(new RegExp(`\\b${word}\\b`));
    expect(workshopScenario.describeDuration(parse(workshopScenario.baseConfiguration), "hand")).toBe("0.5 world minutes.");
    expect(handTool().readTarget(undefined, call("Mik", "arn"), base(), () => undefined)).toBe("not_sensed");
  });

  it("shows the giver handing while its call lasts", () => {
    const under = handTool().start?.effect(base(), call("Mik", "arn")) ?? base();
    expect(under.workers.Dal.doing).toBe("handing");
    expect(handTool().start?.describe(base(), call("Mik", "arn"))).toEqual({ began: "handing" });
    expect(handTool().end?.effect(under, call("Mik", "arn")).workers.Dal.doing).toBe("nothing");
  });

  it("moves a loose piece of a kind from the giver's hands to the receiver's, the pile untouched", () => {
    const state = holding(base(), "Dal", { loose: { arn: 2 } });
    const { outcome, state: after } = land(state, "Mik", "arn");
    expect(outcome).toBe("success");
    expect([after.workers.Dal.loose, after.workers.Mik.loose]).toEqual([{ arn: 1 }, { arn: 1 }]);
    expect(after.pile).toEqual(state.pile);
  });

  it("moves the giver's module, its joined pieces in order, apart from the loose pieces, to a receiver with full hands", () => {
    let state = holding(base(), "Dal", { loose: { bex: 1 }, module: { name: "tessa", joined: ["dov", "arn"] } });
    state = holding(state, "Mik", { loose: { arn: 2, cal: 2, dov: 2 } });
    const { outcome, state: after } = land(state, "Mik", "tessa");
    expect(outcome).toBe("success");
    expect(after.workers.Dal).toMatchObject({ loose: { bex: 1 }, module: null });
    expect(after.workers.Mik).toMatchObject({ loose: { arn: 2, cal: 2, dov: 2 }, module: { name: "tessa", joined: ["dov", "arn"] } });
  });

  it("hands a piece to a receiver that holds a module", () => {
    const state = holding(holding(base(), "Dal", { loose: { arn: 1 } }), "Mik", { module: { name: "ulm", joined: ["bex"] } });
    const { outcome, state: after } = land(state, "Mik", "arn");
    expect(outcome).toBe("success");
    expect(after.workers.Mik).toMatchObject({ loose: { arn: 1 }, module: { name: "ulm", joined: ["bex"] } });
  });

  it("refuses when it lands, in the order of the table, moving nothing", () => {
    const full = { arn: 2, bex: 1, cal: 1, dov: 2 };
    const cases: [Workshop, string, string, string][] = [
      [holding(base(), "Dal", { loose: { arn: 1 } }), "Kel", "arn", "no_such_worker"],
      [holding(base(), "Dal", { loose: { arn: 1 } }), "Dal", "arn", "to_self"],
      // The receiver's name is checked before what is handed.
      [base(), "Kel", "arn", "no_such_worker"],
      [base(), "Dal", "arn", "to_self"],
      [holding(base(), "Dal", { loose: { bex: 1 } }), "Mik", "arn", "not_held"],
      [base(), "Mik", "arn", "not_held"],
      [holding(base(), "Dal", { module: { name: "ulm", joined: ["bex"] } }), "Mik", "tessa", "not_held"],
      [holding(holding(base(), "Dal", { loose: { eln: 1 } }), "Mik", { loose: full }), "Mik", "eln", "hands_full"],
      [holding(holding(base(), "Dal", { module: { name: "tessa", joined: ["arn", "arn", "bex", "cal", "dov"] } }), "Mik", { module: { name: "ulm", joined: ["bex"] } }), "Mik", "tessa", "holds_module"],
    ];
    for (const [state, worker, what, refused] of cases) {
      const { outcome, state: after } = land(state, worker, what);
      expect([worker, what, outcome]).toEqual([worker, what, refused]);
      expect(after).toEqual({ ...state, workers: { ...state.workers, Dal: { ...state.workers.Dal, doing: "nothing" } } });
    }
    expect(handTool().texts).toEqual({
      success: "You have handed it over.",
      no_such_worker: "There is no worker of that name; nothing has been handed.",
      to_self: "That is you; nothing has been handed.",
      not_held: "You are not holding that; nothing has been handed.",
      hands_full: "Their hands are full; nothing has been handed.",
      holds_module: "They are already holding a module; nothing has been handed.",
    });
  });

  it("names the giver's module when what is that module's name, and a kind of piece otherwise", () => {
    // A worker holding a module "arn" and a loose arn hands the module.
    const state = holding(base(), "Dal", { loose: { arn: 1 }, module: { name: "arn", joined: [] } });
    const { state: after } = land(state, "Mik", "arn");
    expect(after.workers.Mik).toMatchObject({ loose: {}, module: { name: "arn", joined: [] } });
    expect(after.workers.Dal.loose).toEqual({ arn: 1 });
  });

  it("delivers what was handed to the receiver alone, from the giver, on the channel hands", () => {
    expect(handTool().delivers?.channel).toBe("hands");
    const piece = handTool().action?.effect(holding(base(), "Dal", { loose: { arn: 1 } }), call("Mik", "arn")) as Workshop;
    expect(handTool().delivers?.deliveries(piece, call("Mik", "arn"))).toEqual([{ agent: "Mik", source: "Dal", values: { what: "a piece of arn" } }]);
    const module = handTool().action?.effect(holding(base(), "Dal", { module: { name: "tessa", joined: ["arn"] } }), call("Ren", "tessa")) as Workshop;
    expect(handTool().delivers?.deliveries(module, call("Ren", "tessa"))).toEqual([{ agent: "Ren", source: "Dal", values: { what: "the module tessa" } }]);
  });

  it("declares the channel hands, from the giver, which wakes a resting worker and is described as handed you <what>.", () => {
    expect(load().channels.find(({ name }) => name === "hands")).toEqual({ name: "hands", source: "the giver", stimulus: "handed you {what}.", described: "handed you <what>.", wakes: true });
  });
});

describe("done and the workshop's measures (FR-WORKSHOP-04)", () => {
  const effectorNamed = (name: string) => {
    const tool = workshopScenario.tools.find((each) => each.name === name);
    if (tool?.kind !== "effector") throw new Error(`"${name}" is no effector`);
    return tool;
  };
  /** A call landing at a world minute since the calendar's start (day 1 Monday 09:00). */
  const at = (agent: string, minute: number, args: Record<string, unknown> = {}) => ({
    agent,
    arguments: args,
    atMs: minute * 15_000,
    world: { day: 1, weekday: "Monday" as const, seconds: 9 * 3600 + minute * 60 },
  });
  /** An effector's start and landing applied to a state, its action when it holds, and its end. */
  const apply = (state: Workshop, name: string, agent: string, from: number, to: number, args: Record<string, unknown> = {}) => {
    const tool = effectorNamed(name);
    let next = tool.start?.effect(state, at(agent, from, args)) ?? state;
    const landing = at(agent, to, args);
    if (tool.action !== undefined && tool.action.precondition(next, landing).holds) next = tool.action.effect(next, landing);
    return tool.end?.effect(next, landing) ?? next;
  };
  /** A recorded call, its times in world minutes at the base scale (one world minute is 15 s of the run). */
  const recorded = (agent: string, tool: string, from: number, to: number, outcome = "success", args: Record<string, unknown> = {}): ToolCall => ({
    agent,
    tool,
    arguments: args,
    outcome,
    startedAtMs: from * 15_000,
    endedAtMs: to * 15_000,
  });
  const metric = (name: string, state: Workshop, calls: ToolCall[] = []) => workshopScenario.metrics[name](state, calls);
  const base = () => load().world.state;

  it("says the world is finished once one module of each name is mounted", () => {
    const state = base();
    expect(workshopScenario.finished?.(state)).toBe(false);
    expect(workshopScenario.finished?.({ ...state, bench: { ...state.bench, mounted: ["tessa", "ulm", "vorn", "wick", "yarl"] } })).toBe(false);
    expect(workshopScenario.finished?.({ ...state, bench: { ...state.bench, mounted: ["tessa", "ulm", "vorn", "wick", "yarl", "zeth"] } })).toBe(true);
  });

  it("keeps each applied take, join, mount and speech at the world minute it landed", () => {
    let state = base();
    state = apply(state, "take", "Dal", 0, 1, { kind: "bex" });
    state = apply(state, "take", "Dal", 1, 2, { kind: "eln" });
    state = apply(state, "join", "Dal", 2, 4, { module: "ulm", kind: "bex" });
    state = apply(state, "join", "Dal", 4, 6, { module: "ulm", kind: "eln" });
    state = apply(state, "tell", "Mik", 6, 6.75, { to: ["Nar", "Dal", "Nar"], text: "I will build tessa now and Mik could build vorn while Nar builds zeth please" });
    expect(state.landed.takes).toEqual([
      { worker: "Dal", at: 1 },
      { worker: "Dal", at: 2 },
    ]);
    expect(state.landed.joins).toEqual([
      { worker: "Dal", module: "ulm", at: 4, started: true, finished: false },
      { worker: "Dal", module: "ulm", at: 6, started: false, finished: true },
    ]);
    expect(state.landed.speeches).toEqual([{ speaker: "Mik", kind: "tell", to: ["Nar", "Dal"], start: 6, end: 6.75, words: 15 }]);
  });

  it("gives every measure its value at the start", () => {
    const state = base();
    expect(Object.fromEntries(Object.keys(workshopScenario.metrics).map((name) => [name, metric(name, state)]))).toEqual({
      done: 0,
      modules_mounted: 0,
      time_to_done: null,
      effort_total: 0,
      effort_by_worker: { Dal: 0, Mik: 0, Nar: 0, Ren: 0 },
      pieces_wasted: 0,
      modules_taken_apart: 0,
      first_take_time: null,
      speech_before_first_take: { "ask.calls": 0, "ask.words": 0, "answer.calls": 0, "answer.words": 0, "tell.calls": 0, "tell.words": 0 },
      own_first_take_time: {},
      builders_by_module: {},
      joins_share_by_worker: null,
      modules_by_worker: { "Dal.finished": 0, "Dal.mounted": 0, "Mik.finished": 0, "Mik.mounted": 0, "Nar.finished": 0, "Nar.mounted": 0, "Ren.finished": 0, "Ren.mounted": 0 },
      module_switches: { Dal: 0, Mik: 0, Nar: 0, Ren: 0 },
      duplicated_modules: 0,
      refused_by_cause: {},
      bench_refusals: 0,
      finish_to_mount: {},
      speech_by_worker: Object.fromEntries(["Dal", "Mik", "Nar", "Ren"].flatMap((worker) => ["ask", "answer", "tell"].flatMap((kind) => [[`${worker}.${kind}.calls`, 0], [`${worker}.${kind}.words`, 0]]))),
      time_by_activity: {},
      handovers: {},
      addressed: {},
      questions_unanswered: {},
    });
  });

  it("gives done, the modules mounted and the time the completing mount landed", () => {
    let state = base();
    state = { ...state, bench: { ...state.bench, mounted: ["tessa", "ulm", "vorn", "wick", "zeth"] }, workers: { ...state.workers, Dal: { ...state.workers.Dal, module: { name: "yarl", joined: ["fim", "gor"] } } } };
    state = apply(state, "mount", "Dal", 2, 5);
    expect([metric("done", state), metric("modules_mounted", state), metric("time_to_done", state)]).toEqual([1, 6, 5]);
    expect(metric("finish_to_mount", state)).toEqual({});
  });

  it("counts effort in world minutes, refused calls' full time included and none for a call never run", () => {
    const calls = [recorded("Dal", "mount", 3, 3.5, "bench_full"), recorded("Dal", "wait", 4, 4, "invalid_arguments"), recorded("Mik", "look", 0, 0.5), recorded("Mik", "ask", 1, 1.4, "cut_off")];
    // The recorded milliseconds of a call never run are not counted.
    calls[1] = { ...calls[1], endedAtMs: calls[1].startedAtMs + 3 };
    expect(metric("effort_total", base(), calls)).toBeCloseTo(1.4);
    expect(metric("effort_by_worker", base(), calls)).toEqual({ Dal: 0.5, Mik: expect.closeTo(0.9) as unknown as number, Nar: 0, Ren: 0 });
    expect(metric("refused_by_cause", base(), calls)).toEqual({ "mount.bench_full": 1, "wait.invalid_arguments": 1 });
    expect(metric("bench_refusals", base(), calls)).toBe(1);
    expect(metric("time_by_activity", base(), calls)).toEqual({ "Dal.mount": 0.5, "Dal.wait": 0, "Mik.look": 0.5, "Mik.ask": expect.closeTo(0.4) as unknown as number });
  });

  it("counts the pieces neither in the pile nor in a mounted module", () => {
    const state = base();
    expect(metric("pieces_wasted", { ...state, workers: { ...state.workers, Nar: { ...state.workers.Nar, loose: { arn: 1 }, module: { name: "zeth", joined: ["bex", "dov"] } } } })).toBe(3);
  });

  it("reads the split and the stumbles from the applied joins and mounts", () => {
    let state = base();
    state = { ...state, workers: { ...state.workers, Dal: { ...state.workers.Dal, loose: { arn: 2 } }, Mik: { ...state.workers.Mik, loose: { arn: 1, bex: 1 } } } };
    state = apply(state, "join", "Dal", 0, 2, { module: "tessa", kind: "arn" });
    state = apply(state, "join", "Mik", 0, 2, { module: "tessa", kind: "arn" });
    state = apply(state, "take_apart", "Mik", 2, 4);
    state = apply(state, "join", "Mik", 4, 6, { module: "ulm", kind: "bex" });
    expect(metric("builders_by_module", state)).toEqual({ "tessa.joined_by.Dal": 1, "tessa.joined_by.Mik": 1, "ulm.joined_by.Mik": 1 });
    expect(metric("joins_share_by_worker", state)).toEqual({ Dal: 1 / 3, Mik: 2 / 3, Nar: 0, Ren: 0 });
    expect(metric("module_switches", state)).toEqual({ Dal: 0, Mik: 1, Nar: 0, Ren: 0 });
    expect(metric("duplicated_modules", state)).toBe(1);
  });

  it("gives each mounted module the time from its last join's landing to its mount's start, and who mounted it", () => {
    let state = base();
    state = { ...state, workers: { ...state.workers, Nar: { ...state.workers.Nar, loose: { dov: 1 }, module: { name: "zeth", joined: ["bex", "dov"] } } }, bench: { ...state.bench, mounted: ["tessa"] } };
    state = apply(state, "join", "Nar", 0, 2, { module: "zeth", kind: "dov" });
    state = apply(state, "mount", "Nar", 5.5, 8.5);
    expect(metric("finish_to_mount", state)).toEqual({ zeth: 3.5 });
    expect(metric("builders_by_module", state)).toEqual({ "zeth.joined_by.Nar": 1, "zeth.mounted_by.Nar": 1 });
    expect(metric("modules_by_worker", state)).toMatchObject({ "Nar.finished": 1, "Nar.mounted": 1 });
  });

  it("gives the first take's time, each worker's own, and the speech that landed before it", () => {
    let state = base();
    state = apply(state, "tell", "Dal", 0.5, 1.25, { to: ["Mik", "Nar"], text: "I will build tessa now and Mik could build vorn while Nar builds zeth please" });
    state = apply(state, "take", "Dal", 1.25, 2.25, { kind: "arn" });
    state = apply(state, "take", "Mik", 1.35, 2.35, { kind: "cal" });
    state = apply(state, "tell", "Nar", 2, 2.45, { to: ["Dal"], text: "I will take the zeth pieces" });
    expect(metric("first_take_time", state)).toBe(2.25);
    expect(metric("own_first_take_time", state)).toEqual({ Dal: 2.25, Mik: 2.35 });
    expect(metric("speech_before_first_take", state)).toEqual({ "ask.calls": 0, "ask.words": 0, "answer.calls": 0, "answer.words": 0, "tell.calls": 1, "tell.words": 15 });
    expect(metric("speech_by_worker", state)).toMatchObject({ "Dal.tell.calls": 1, "Dal.tell.words": 15, "Dal.ask.calls": 0, "Nar.tell.calls": 1, "Nar.tell.words": 6, "Ren.tell.calls": 0 });
  });

  it("counts each speaker's applied calls of each kind by worker addressed, and the questions no later answer from that worker to the asker answered (FR-WORKSHOP-06)", () => {
    let state = base();
    state = apply(state, "answer", "Mik", 0, 0.35, { to: ["Dal"], text: "Yes, tessa first." });
    state = apply(state, "answer", "Ren", 0, 0.35, { to: ["Dal"], text: "Not yet, sorry." });
    state = apply(state, "ask", "Dal", 0.5, 0.85, { to: ["Mik"], text: "Who has bex?" });
    state = apply(state, "ask", "Dal", 1, 1.35, { to: ["Mik", "Ren"], text: "Is ulm next?" });
    state = apply(state, "answer", "Nar", 1.5, 1.85, { to: ["Dal"], text: "Ren has it." });
    state = apply(state, "answer", "Mik", 2, 2.35, { to: ["Dal", "Nar"], text: "I have bex." });
    state = apply(state, "tell", "Ren", 2, 2.35, { to: ["Dal"], text: "Busy right now." });
    state = apply(state, "ask", "Dal", 3, 3.35, { to: ["Nar", "Nar"], text: "Need any help?" });
    // Refused as to_self: it counts nowhere.
    state = apply(state, "answer", "Ren", 3, 3.35, { to: ["Dal", "Ren"], text: "Yes it is." });
    expect(metric("addressed", state)).toEqual({ "Mik.answer.Dal": 2, "Mik.answer.Nar": 1, "Ren.answer.Dal": 1, "Dal.ask.Mik": 2, "Dal.ask.Ren": 1, "Dal.ask.Nar": 1, "Nar.answer.Dal": 1, "Ren.tell.Dal": 1 });
    expect(metric("questions_unanswered", state)).toEqual({ "Dal.Ren": 1, "Dal.Nar": 1 });
    // An answer landing at the same time as the question does not answer it.
    let same = base();
    same = apply(same, "ask", "Dal", 0, 0.35, { to: ["Mik"], text: "Who has bex?" });
    same = apply(same, "answer", "Mik", 0, 0.35, { to: ["Dal"], text: "I have bex." });
    expect(metric("questions_unanswered", same)).toEqual({ "Dal.Mik": 1 });
  });

  it("counts the applied hands of pieces and of modules by giver and receiver, and keeps each as it lands (FR-WORKSHOP-05)", () => {
    let state = base();
    state = { ...state, workers: { ...state.workers, Dal: { ...state.workers.Dal, loose: { arn: 2, bex: 1 } }, Mik: { ...state.workers.Mik, module: { name: "ulm", joined: ["bex"] } } } };
    state = apply(state, "hand", "Dal", 0, 0.5, { worker: "Nar", what: "arn" });
    state = apply(state, "hand", "Dal", 0.5, 1, { worker: "Nar", what: "arn" });
    state = apply(state, "hand", "Dal", 1, 1.5, { worker: "Ren", what: "bex" });
    state = apply(state, "hand", "Mik", 1, 1.5, { worker: "Ren", what: "ulm" });
    // Refused: Dal holds no arn any more.
    state = apply(state, "hand", "Dal", 1.5, 2, { worker: "Mik", what: "arn" });
    expect(state.landed.handovers).toEqual([
      { giver: "Dal", receiver: "Nar", sort: "piece", name: "arn", at: 0.5 },
      { giver: "Dal", receiver: "Nar", sort: "piece", name: "arn", at: 1 },
      { giver: "Dal", receiver: "Ren", sort: "piece", name: "bex", at: 1.5 },
      { giver: "Mik", receiver: "Ren", sort: "module", name: "ulm", at: 1.5 },
    ]);
    expect(metric("handovers", state)).toEqual({ "Dal.pieces_to.Nar": 2, "Dal.pieces_to.Ren": 1, "Mik.modules_to.Ren": 1 });
    // A handed piece or module is wasted while it is in someone's hands.
    expect(metric("pieces_wasted", state)).toBe(4);
  });

  it("reads a handed module's last join whoever made it, and its mounter as the worker whose mount mounted it (FR-WORKSHOP-05)", () => {
    let state = base();
    state = { ...state, workers: { ...state.workers, Mik: { ...state.workers.Mik, loose: { arn: 2, bex: 1, cal: 1, dov: 1 } } } };
    for (const [from, kind] of [[0, "arn"], [2, "arn"], [4, "bex"], [6, "cal"], [8, "dov"]] as const) state = apply(state, "join", "Mik", from, from + 2, { module: "tessa", kind });
    state = apply(state, "hand", "Mik", 10, 10.5, { worker: "Ren", what: "tessa" });
    // Mik starts another tessa after handing its own, its join landing before Ren's mount starts; Ren's mount reads the
    // handed one's last join, at 10.
    state = { ...state, workers: { ...state.workers, Mik: { ...state.workers.Mik, loose: { arn: 1 } } } };
    state = apply(state, "join", "Mik", 10.5, 10.75, { module: "tessa", kind: "arn" });
    state = apply(state, "mount", "Ren", 11, 14);
    expect(state.bench.mounted).toEqual(["tessa"]);
    expect(metric("finish_to_mount", state)).toEqual({ tessa: 1 });
    expect(metric("builders_by_module", state)).toEqual({ "tessa.joined_by.Mik": 1, "tessa.mounted_by.Ren": 1 });
    expect(metric("modules_by_worker", state)).toMatchObject({ "Mik.finished": 1, "Mik.mounted": 0, "Ren.finished": 0, "Ren.mounted": 1 });
    // Mik's join after handing, holding none, starts a second tessa.
    expect(metric("duplicated_modules", state)).toBe(1);
  });

  it("follows a module handed on twice back to its last join, and a receiver's own joins into it (FR-WORKSHOP-05)", () => {
    let state = base();
    state = { ...state, workers: { ...state.workers, Dal: { ...state.workers.Dal, loose: { arn: 2, bex: 1, cal: 1 } }, Nar: { ...state.workers.Nar, loose: { dov: 1 } } } };
    for (const [from, kind] of [[0, "arn"], [2, "arn"], [4, "bex"], [6, "cal"]] as const) state = apply(state, "join", "Dal", from, from + 2, { module: "tessa", kind });
    state = apply(state, "hand", "Dal", 8, 8.5, { worker: "Mik", what: "tessa" });
    state = apply(state, "hand", "Mik", 9, 9.5, { worker: "Nar", what: "tessa" });
    state = apply(state, "join", "Nar", 9.5, 11.5, { module: "tessa", kind: "dov" });
    state = apply(state, "hand", "Nar", 12, 12.5, { worker: "Ren", what: "tessa" });
    state = apply(state, "mount", "Ren", 13, 16);
    expect(metric("finish_to_mount", state)).toEqual({ tessa: 1.5 });
    expect(metric("module_switches", state)).toEqual({ Dal: 0, Mik: 0, Nar: 0, Ren: 0 });
    expect(metric("duplicated_modules", state)).toBe(0);
    expect(metric("modules_by_worker", state)).toMatchObject({ "Dal.finished": 0, "Nar.finished": 1, "Ren.mounted": 1 });
  });

  it("gives a speech line for each applied speech, as it lands", () => {
    const before = base();
    const after = apply(before, "ask", "Dal", 0, 0.75, { to: ["Nar", "Mik", "Nar"], text: "I will build tessa now and Mik could build vorn while Nar builds zeth please" });
    expect(workshopScenario.logLines?.(before, after)).toEqual([{ type: "speech", speaker: "Dal", kind: "ask", to: ["Nar", "Mik"], start: 0, end: 0.75, words: 15 }]);
    expect(workshopScenario.logLines?.(after, after)).toEqual([]);
  });
});
