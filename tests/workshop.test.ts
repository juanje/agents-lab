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
    expect(load().channels.map(({ name }) => name)).toEqual(["rhythm"]);
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
