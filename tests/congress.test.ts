import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TomlTable, parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import type { RuleSet } from "../src/engine/participants.ts";
import { run } from "../src/engine/run.ts";
import { type Scenario, loadScenario } from "../src/engine/scenario.ts";
import { ScriptedModel } from "../src/engine/scripted-model.ts";
import { congressScenario } from "../src/scenarios/congress.ts";
import { scenarioLibrary } from "../src/scenarios/library.ts";

/** A city with an office, a station, and two venues whose entrances are 40 and 60 world minutes from the office. */
const CITY = {
  places: [{ id: "office" }, { id: "station" }],
  venues: [
    { id: "v1", entrance: "v1-entrance", hours: "office", rooms: [{ id: "foyer" }, { id: "main-hall", seats: 120, equipment: ["projector"] }] },
    { id: "v2", entrance: "v2-entrance", hours: "office" },
  ],
  passages: [
    { between: ["office", "v1-entrance"], length: 40, step_free: true },
    { between: ["office", "v2-entrance"], length: 60, step_free: true },
    { between: ["v1-entrance", "foyer"], length: 1, step_free: true },
    { between: ["foyer", "main-hall"], length: 1, step_free: "3 steps" },
  ],
};

const POOLS = { topics: ["soil", "rivers"], venue: [{ id: "v1" }, { id: "v2" }], speaker: [{ id: "s1", fee: 300 }, { id: "s2" }, { id: "s3" }] };

const DRAW = { attendance: [50, 80], venue: 2, speaker: 2 };

/** A rule set that does nothing. */
const silent: RuleSet = { start: () => ({ next: () => ({ kind: "end" }), outcome: () => ({}) }) };

/** The congress with this city, these pools and this draw, Monday at 10:00, one world minute 10 ms of the run, and any keys changed. */
function congress(changes: (configuration: TomlTable) => void = () => {}): Scenario<unknown> {
  const configuration = parse(congressScenario.baseConfiguration);
  Object.assign(configuration, {
    city: stringify(CITY),
    pools: stringify(POOLS),
    draw: stringify(DRAW),
    calendar: { start: "day 1 Monday 10:00", segments: [{ scale: 6000 }], hours: { office: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], from: "09:00", to: "18:00" } } },
    kinds: { speaker: { rules: "silent", tools: ["send_mail"], channels: ["mail_notice"], reply_minutes: [5, 10] } },
    mail: { mailboxes: ["organiser"], delivery_minutes: [1, 1], send_minutes: 3, check_minutes: 2, read_minutes: 1, notice_source: "mail client", notice: "New mail from {from}" },
    phone: { lines: ["organiser"], ring_minutes: 5, call_minutes: 4, ring: "{from} calls" },
    away_factor: 1.5,
    rhythm: { source: "rhythm", text: "You wake up.", min_ms: 0, max_ms: 0 },
  });
  changes(configuration);
  return { ...(congressScenario as Scenario<unknown>), ruleSets: { silent }, baseConfiguration: stringify(configuration) };
}

/** A TOML text of the configuration changed. */
function changingText(key: string, change: (table: TomlTable) => void): (configuration: TomlTable) => void {
  return (configuration) => {
    const table = parse(configuration[key] as string);
    change(table);
    configuration[key] = stringify(table);
  };
}

/** Runs the congress, the organiser making the calls given; gives its calls, their results and the log directory. */
async function runCongress(scenario: Scenario<unknown>, calls: { name: string; arguments: Record<string, unknown> }[], seed = 1) {
  const logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-logs-"));
  const organiser = new ScriptedModel([...calls.map((call) => ({ toolCalls: [call as never], delayMs: 0 })), { text: "Done.", delayMs: 0 }]);
  const loaded = loadScenario(scenario, seed);
  const ran = await run(loaded, [{ name: "organiser", model: organiser, activations: 1 }], seed, {
    logDirectory,
    modelTurnTimeoutMs: 10_000,
    thinkingLevel: "off",
    compaction: { enabled: false },
    parallelismLimit: 2,
    timeLimitMs: 10_000,
  });
  const made = ran.toolCalls.filter(({ agent }) => agent === "organiser");
  return { loaded, made, organiser, texts: made.map((call) => call.result ?? call.text) };
}

describe("the congress scenario (FR-CONGRESS-01)", () => {
  it("is in the library, with one agent, the organiser", () => {
    expect(scenarioLibrary.get("congress")).toBe(congressScenario);
    expect([...loadScenario(congress(), 1).systemPrompts.keys()]).toEqual(["organiser"]);
  });
});

describe("the congress's variant (FR-CONGRESS-01)", () => {
  it("draws a topic, a whole target attendance in its range and each kind's templates from the seed, the same under any condition", () => {
    const first = loadScenario(congress(), 7);
    const other = loadScenario(congress(), 7, { name: "guided", change: 'guidance = "Settle the venue first."' });

    expect(other.variant).toEqual(first.variant);
    const { topic, attendance, chosen } = first.variant as { topic: string; attendance: number; chosen: Record<string, string[]> };
    expect(POOLS.topics).toContain(topic);
    expect(Number.isInteger(attendance) && attendance >= 50 && attendance <= 80).toBe(true);
    expect([...chosen.venue].sort()).toEqual(["v1", "v2"]);
    expect(new Set(chosen.speaker).size).toBe(2);
  });

  it("makes each chosen template a participant named by its id with its kind's settings and its parameters, a mailbox and a line", () => {
    const loaded = loadScenario(congress(), 7);
    const { chosen } = loaded.variant as { chosen: Record<string, string[]> };

    const speakers = (loaded.participants ?? []).filter(({ name }) => chosen.speaker.includes(name));
    expect(speakers.map(({ name }) => name).sort()).toEqual([...chosen.speaker].sort());
    for (const speaker of speakers) {
      expect(speaker).toMatchObject({ decides: "rules", rules: "silent", tools: ["send_mail"], channels: ["mail_notice"], replyMinutes: [5, 10] });
      if (speaker.name === "s1" && speaker.decides === "rules") expect(speaker.params).toEqual({ id: "s1", fee: 300, call_back_minutes: [6, 16] }); // its id; a minute after ring_minutes 5, up to reply_minutes 10 later (FR-CONGRESS-07)
    }
    // A venue's kind gives no settings: a chosen venue is no participant.
    expect((loaded.participants ?? []).map(({ name }) => name)).not.toContain("v1");
    for (const id of chosen.speaker) {
      expect(loaded.mail?.settings.mailboxes).toContain(id);
      expect(loaded.phone?.settings.lines).toContain(id);
    }
  });

  it("lays out only the chosen venues' places", () => {
    let seed = 1;
    const onlyV1 = congress(changingText("draw", (draw) => (draw.venue = 1)));
    while ((loadScenario(onlyV1, seed).variant as { chosen: Record<string, string[]> }).chosen.venue[0] !== "v1") seed += 1;

    const { space } = loadScenario(onlyV1, seed).world.state as { space: { places: string[] } };

    expect(space.places).toEqual(["office", "station", "v1-entrance", "foyer", "main-hall"]);
  });
});

describe("the congress, refusing a world it cannot follow (FR-CONGRESS-01)", () => {
  const refusing = (changes: (configuration: TomlTable) => void) => () => loadScenario(congress(changes), 1);

  it("refuses, naming it, a text that is not TOML, a passage to an unknown place, a step_free that is neither true nor a text, and a venue's unknown hours or entrance", () => {
    expect(refusing((configuration) => (configuration.city = "[[places]\nid = "))).toThrow(/city/);
    expect(refusing(changingText("city", (city) => (city.passages = [...(city.passages as TomlTable[]), { between: ["office", "moon"], length: 5, step_free: true }])))).toThrow(/"moon"/);
    expect(refusing(changingText("city", (city) => ((city.passages as TomlTable[])[0].step_free = 3)))).toThrow(/step_free/);
    expect(refusing(changingText("city", (city) => ((city.venues as TomlTable[])[0].hours = "night")))).toThrow(/"v1".*"night"/);
    expect(refusing(changingText("city", (city) => ((city.venues as TomlTable[])[1].entrance = undefined as never)))).toThrow(/"v2".*entrance/);
  });

  it("refuses a draw it cannot make, a kind with no pool, a wait_max_minutes above 1440, an away_factor below 1, a negative duration, and two templates or places with one id", () => {
    expect(refusing(changingText("draw", (draw) => (draw.speaker = 4)))).toThrow(/draw\.speaker/);
    expect(refusing(changingText("draw", (draw) => (draw.caterer = 1)))).toThrow(/draw\.caterer/);
    expect(refusing(changingText("draw", (draw) => (draw.attendance = [80, 50])))).toThrow(/draw\.attendance/);
    expect(refusing((configuration) => ((configuration.kinds as TomlTable).sponsor = { rules: "silent", tools: [], channels: [] }))).toThrow(/kinds\.sponsor/);
    expect(refusing((configuration) => (configuration.wait_max_minutes = 2000))).toThrow(/wait_max_minutes/);
    expect(refusing((configuration) => (configuration.away_factor = 0.5))).toThrow(/away_factor/);
    expect(refusing((configuration) => ((configuration.durations as TomlTable).look = -1))).toThrow(/durations\.look/);
    expect(refusing(changingText("pools", (pools) => (pools.speaker = [...(pools.speaker as TomlTable[]), { id: "s1" }])))).toThrow(/"s1"/);
    expect(refusing(changingText("city", (city) => (city.places = [...(city.places as TomlTable[]), { id: "office" }])))).toThrow(/"office"/);
  });
});

describe("the organiser's tools (FR-CONGRESS-01)", () => {
  it("look gives, as JSON, the place, its exits with their length and step_free, and a room's seats and equipment", async () => {
    const { texts } = await runCongress(congress((configuration) => (configuration.organiser_place = "foyer")), [
      { name: "look", arguments: {} },
      { name: "go", arguments: { place: "main-hall" } },
      { name: "look", arguments: {} },
    ]);

    expect(JSON.parse(texts[0] as string)).toEqual({
      place: "foyer",
      exits: [
        { place: "v1-entrance", length: 1, step_free: true },
        { place: "main-hall", length: 1, step_free: "3 steps" },
      ],
      people: [],
    });
    expect(JSON.parse(texts[2] as string)).toMatchObject({ place: "main-hall", seats: 120, equipment: ["projector"] });
  });

  it("go takes its passage's length in world minutes; into a closed interior it fails as closed, taking no time, and look says it is closed", async () => {
    const open = await runCongress(congress(), [{ name: "go", arguments: { place: "v1-entrance" } }]);
    expect(open.made[0].outcome).toBe("success");
    expect(open.made[0].endedAtMs - open.made[0].startedAtMs).toBeGreaterThanOrEqual(400);
    expect(open.made[0].endedAtMs - open.made[0].startedAtMs).toBeLessThan(430);

    const closed = await runCongress(
      congress((configuration) => {
        configuration.organiser_place = "v1-entrance";
        (configuration.calendar as TomlTable).start = "day 6 Saturday 10:00";
      }),
      [
        { name: "look", arguments: {} },
        { name: "go", arguments: { place: "foyer" } },
      ],
    );
    expect(JSON.parse(closed.texts[0] as string)).toMatchObject({ place: "v1-entrance", closed: true, exits: [{ place: "office", length: 40, step_free: true }] });
    expect(closed.made[1].outcome).toBe("closed");
    expect(closed.made[1].endedAtMs - closed.made[1].startedAtMs).toBeLessThan(10);
  });

  it("check_time gives the world's time; write_note replaces a note of the same title; read_notes gives the titles, a note, or fails as no_such_note", async () => {
    const { made, texts } = await runCongress(congress(), [
      { name: "check_time", arguments: {} },
      { name: "write_note", arguments: { title: "venues", text: "ask both" } },
      { name: "write_note", arguments: { title: "venues", text: "v1 is best" } },
      { name: "write_note", arguments: { title: "money", text: "6000" } },
      { name: "read_notes", arguments: {} },
      { name: "read_notes", arguments: { title: "venues" } },
      { name: "read_notes", arguments: { title: "food" } },
    ]);

    expect(texts[0]).toBe("day 1 Monday 10:00");
    expect(texts[4]).toBe("venues\nmoney");
    expect(texts[5]).toBe("v1 is best");
    expect(made[6].outcome).toBe("no_such_note");
  });

  it("wait takes from 1 to wait_max_minutes world minutes, refusing others as invalid_arguments", async () => {
    const { made } = await runCongress(congress((configuration) => (configuration.wait_max_minutes = 1440)), [
      { name: "wait", arguments: { minutes: 1441 } },
      { name: "wait", arguments: { minutes: 3 } },
    ]);

    expect(made.map(({ outcome }) => outcome)).toEqual(["invalid_arguments", "success"]);
    expect(made[1].endedAtMs - made[1].startedAtMs).toBeGreaterThanOrEqual(30);
  });

  it("makes the mail tools take away_factor times their duration away from the office", async () => {
    const away = await runCongress(congress((configuration) => (configuration.organiser_place = "v1-entrance")), [{ name: "check_mail", arguments: {} }]);
    const home = await runCongress(congress(), [{ name: "check_mail", arguments: {} }]);

    const tookMs = ({ made }: { made: { startedAtMs: number; endedAtMs: number }[] }) => made[0].endedAtMs - made[0].startedAtMs;
    expect(tookMs(away)).toBeGreaterThanOrEqual(30);
    expect(tookMs(away)).toBeLessThan(45);
    expect(tookMs(home)).toBeLessThan(25);
  });
});

describe("the organiser's prompt (FR-CONGRESS-01)", () => {
  it("joins task, limits, restrictions, knowledge and guidance in that order, skipping empty ones, each where the placement puts it", () => {
    const loaded = loadScenario(
      congress((configuration) => Object.assign(configuration, { task: "Organise it.", limits: "Budget: 6000.", restrictions: "Ask the board.", knowledge: "", guidance: "Venue first." })),
      1,
    );

    expect(loaded.systemPrompts.get("organiser")).toBe("Budget: 6000.\n\nAsk the board.\n\nVenue first.");
    expect(loaded.channels.find(({ name }) => name === "person")?.stimulus).toBe("Organise it.");
    expect(loaded.firstStimuli.get("organiser")).toEqual(["person"]);
  });
});

describe("the congress's world in the inventory (FR-CONGRESS-01)", () => {
  it("gives the places and passages, each venue's rooms and hours, the draw, each kind's settings, the durations, away_factor and the prompt", () => {
    const scenario = congress();
    const world = scenario.worldInventory?.(parse(scenario.baseConfiguration)) as Record<string, unknown>;

    expect(world).toMatchObject({
      places: ["office", "station"],
      passages: expect.arrayContaining([{ between: ["foyer", "main-hall"], length: 1, step_free: "3 steps" }]),
      venues: expect.arrayContaining([{ id: "v1", entrance: "v1-entrance", hours: "office", rooms: [{ id: "foyer" }, { id: "main-hall", seats: 120, equipment: ["projector"] }] }]),
      draw: { attendance: [50, 80], venue: 2, speaker: 2 },
      kinds: { speaker: { rules: "silent", tools: ["send_mail"], channels: ["mail_notice"], reply_minutes: [5, 10] } },
      away_factor: 1.5,
      prompt: { task: "", limits: "", restrictions: "", knowledge: "You organise a congress.", guidance: "" },
    });
    expect(world.placement).toMatchObject({ task: "person", guidance: "system" });
  });
});
