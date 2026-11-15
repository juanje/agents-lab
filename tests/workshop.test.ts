import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { inventory } from "../src/engine/inventory.ts";
import { type LoadedScenario, type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { scenarioLibrary } from "../src/scenarios/library.ts";
import { type Workshop, workshopScenario } from "../src/scenarios/workshop.ts";

/** The three texts of the workshop's world, word for word (agents-lab-experiments, worlds/workshop). */
const IDENTITY = "You are {name}, one of the four workers of a small workshop that assembles devices to order.";
const TASK = "Today's order for the workshop: the device on the plan, left complete on the bench.\nThe order is the workshop's. It is done when the device is complete.";
const WORLD_RULES = [
  "How this place works:",
  "- The workshop is one room: the pile of pieces, the bench, the plan on the wall, and the four of you.",
  "- You know what is in the room by looking, and what the order needs by reading the plan. Things change while you work, because the others are working too.",
  "- Everything you do takes time, and so does looking, reading and speaking.",
  "- The pieces in the pile are counted. A piece joined into a module is in that module until the module is taken apart.",
  "- Your hands hold up to six loose pieces and one module.",
  "- The device is assembled on the bench by mounting finished modules. The bench has two places: two of you can mount at the same time, not more.",
  "- What you say is heard by everyone in the room. Nobody hears what you do not say.",
].join("\n");

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
    expect(base.durations).toEqual({ look: 0.5, read_plan: 1, take: 1, put_back: 0.5, join: 2, take_apart: 2, mount: 3, mount_refused: 0.5, say: 0.25, say_words_per_minute: 30 });
    expect(base.wait_max_minutes).toBe(10);
    expect(base.calendar).toEqual({ start: "day 1 Monday 09:00", segments: [{ scale: 4 }] });
    expect(base.rhythm).toEqual({ source: "your own pace", text: "You are ready to act.", min_ms: 1000, max_ms: 3000 });
    expect([base.identity, base.task, base.world_rules]).toEqual([IDENTITY, TASK, WORLD_RULES]);
    expect(base.placement).toEqual({ identity: "system", task: "system", world_rules: "system" });
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
    expect(systemPrompts.get("Ren")?.startsWith("You are Ren, one of the four workers")).toBe(true);
    expect(firstStimuli.get("Dal")).toEqual([]);
  });

  it("sends a text placed first once, through the channel 'order', from the configuration's order_source", () => {
    const { systemPrompts, firstStimuli, channels } = load(workshopScenario, 42, { placement: { task: "first" }, order_source: "the order on the wall" });
    expect(systemPrompts.get("Dal")).toBe([IDENTITY.replace("{name}", "Dal"), WORLD_RULES].join("\n\n"));
    expect(firstStimuli.get("Dal")).toEqual(["order"]);
    expect(channels.find(({ name }) => name === "order")).toEqual({ name: "order", source: "the order on the wall", stimulus: TASK });
  });

  it("declares no order channel when every text is in the system prompt", () => {
    // FR-WORKSHOP-03 adds "voice".
    expect(load().channels.map(({ name }) => name)).toEqual(["rhythm", "voice"]);
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
    ["a wait_max_minutes of 0", (c) => (c.wait_max_minutes = 0), ['"wait_max_minutes"']],
    ["a calendar of two segments", (c) => ((c.calendar as TomlTable).segments = [{ scale: 4, until: "day 1 Monday 10:00" }, { scale: 60 }]), ['"calendar.segments"']],
    ["a min_ms above max_ms", (c) => ((c.rhythm as TomlTable).min_ms = 4000), ['"rhythm"']],
    ["a placement that is no place", (c) => ((c.placement as TomlTable).task = "person"), ['"placement.task"', "person"]],
    ["a placement of a text the workshop does not have", (c) => ((c.placement as TomlTable).norms = "system"), ['"placement.norms"']],
    ["a text that names in braces anything but {name}", (c) => (c.identity = `${c.identity as string} {team}`), ['"identity"', "{team}"]],
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
      texts: { identity: IDENTITY, task: TASK, world_rules: WORLD_RULES },
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
  const call = (agent: string, args: Record<string, unknown> = {}) => ({ agent, arguments: args, atMs: 0 });
  /** What an effector's landing gives: its outcome, and the state after it with its end, as the engine applies them. */
  const land = (name: string, state: Workshop, agent: string, args: Record<string, unknown> = {}) => {
    const { action, end } = effector(name);
    const check = action === undefined ? { holds: true as const } : action.precondition(state, call(agent, args));
    const acted = check.holds && action !== undefined ? action.effect(state, call(agent, args)) : state;
    return { outcome: check.holds ? "success" : check.reason, state: end === undefined ? acted : end.effect(acted, call(agent, args)) };
  };
  const started = (name: string, state: Workshop, agent: string, args: Record<string, unknown> = {}) => effector(name).start?.effect(state, call(agent, args)) ?? state;

  it("are look, read_plan, take, put_back, join, take_apart, mount and wait, none naming a kind or a module", () => {
    // FR-WORKSHOP-03 adds "say".
    expect(workshopScenario.tools.map(({ name }) => name)).toEqual(["look", "read_plan", "take", "put_back", "join", "take_apart", "mount", "wait", "say"]);
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
    expect(JSON.parse(sensor("look").sense(state, "Dal", {}, 0))).toEqual({
      pile: { gor: 2, arn: 2, fim: 2, bex: 2, dov: 5, cal: 4, eln: 2 },
      bench: { mounted: [], places: [null, null] },
      workers: [
        { name: "Ren", loose: {}, module: null, doing: "nothing" },
        { name: "Dal", loose: { arn: 2 }, module: { name: "tessa", joined: ["bex"], finished: false }, doing: "nothing" },
        { name: "Nar", loose: {}, module: null, doing: "nothing" },
        { name: "Mik", loose: {}, module: null, doing: "taking" },
      ],
    });
    expect(Object.keys(JSON.parse(sensor("look").sense(state, "Dal", {}, 0)).pile)).toEqual(["gor", "arn", "fim", "bex", "dov", "cal", "eln"]);
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
    expect(wait.texts).toEqual({ success: "You have waited.", interrupted: "Someone spoke; you stopped waiting." });
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

describe("say (FR-WORKSHOP-03)", () => {
  const say = workshopScenario.tools.find(({ name }) => name === "say");
  const state = load().world.state;
  const call = (text: string) => ({ agent: "Dal", arguments: { text }, atMs: 0 });

  it("is an effector that takes say minutes plus one minute per say_words_per_minute words of its text", () => {
    expect(say?.kind).toBe("effector");
    expect(say?.durationMs(state, call("Mik, take ulm."))).toEqual({ worldSeconds: (0.25 + 3 / 30) * 60 });
    expect(say?.durationMs(state, call(" one\ttwo\nthree  four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "))).toEqual({ worldSeconds: 0.75 * 60 });
    expect(say?.durationMs(state, call("   "))).toEqual({ worldSeconds: 15 });
  });

  it("shows the speaker speaking while its call lasts", () => {
    if (say?.kind !== "effector") throw new Error("say is no effector");
    expect(say.start?.effect(state, call("hi")).workers.Dal.doing).toBe("speaking");
    expect(say.start?.describe(state, call("hi"))).toEqual({ began: "speaking" });
    expect(say.end?.effect(say.start?.effect(state, call("hi")) ?? state, call("hi")).workers.Dal.doing).toBe("nothing");
  });

  it("refuses a text with no word as empty_text when it lands, and otherwise delivers it to every other worker on the channel voice, from the speaker", () => {
    if (say?.kind !== "effector") throw new Error("say is no effector");
    for (const text of ["", "   ", "\n  "]) expect(say.action?.precondition(state, call(text))).toEqual({ holds: false, reason: "empty_text" });
    expect(say.action?.precondition(state, call("Mik, take ulm."))).toEqual({ holds: true });
    expect(say.delivers?.channel).toBe("voice");
    expect(say.delivers?.deliveries(state, call("Mik, take ulm."))).toEqual(
      ["Mik", "Nar", "Ren"].map((agent) => ({ agent, source: "Dal", values: { text: "Mik, take ulm." } })),
    );
    expect(say.texts).toEqual({ success: "You have said it.", empty_text: "You said nothing; nobody heard anything." });
  });

  it("speaks through the channel voice, from the speaker, which wakes a resting worker and is described as what was said", () => {
    expect(load().channels.find(({ name }) => name === "voice")).toEqual({ name: "voice", source: "the speaker", stimulus: "{text}", described: "what was said", wakes: true });
  });

  it("gives the inventory its duration in world minutes", () => {
    expect(workshopScenario.describeDuration(parse(workshopScenario.baseConfiguration), "say")).toBe("0.25 world minutes plus one minute per 30 words.");
  });
});
