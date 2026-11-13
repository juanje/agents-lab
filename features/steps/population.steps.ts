import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { Random } from "../../src/engine/random.ts";
import { loadScenario } from "../../src/engine/scenario.ts";
import { type Congress, congressScenario } from "../../src/scenarios/congress.ts";
import { type AttendeesMaterial, drawPool, registrationProbability } from "../../src/scenarios/population.ts";
import type { Context } from "../support/context.ts";
import { change, congressOf, hourMsOf, organiserTurns, setupOf } from "./congress.steps.ts";
import { before, changePools, dayOf, fieldsOf, minutesOf, minutesOfWorld, moneyLines, outcomeOf, ranLines, sentWith, untilTime } from "./congress-parties.steps.ts";
import { runTheScenario } from "./tool.steps.ts";

/** The congress's one agent. */
const ORGANISER = "organiser";

/** The attendees material of the Background. */
const MATERIAL = {
  pool_factor: 1,
  base_per_day: 24,
  unannounced: 0,
  promotion_factor: 2,
  payment_fee_share: 0.03,
  cancel_share: 0,
  consent_share: 1,
  pay_share: 1,
  no_show_share: 0,
  diets: { none: 1 },
  access: { none: 1 },
  fixed: [] as TomlTable[],
};

/** Changes the attendees material. */
function changeMaterial(context: Context, changing: (material: TomlTable) => void): void {
  change(context, (configuration) => {
    const material = parse(configuration.attendees as string);
    changing(material);
    configuration.attendees = stringify(material);
  });
}

/** Changes the draw's target attendance. */
function targetOf(context: Context, attendance: number): void {
  change(context, (configuration) => (configuration.draw = stringify({ ...parse(configuration.draw as string), attendance: [attendance, attendance] })));
}

Given("the congress is on {string}, its target attendance is {int} and the reference price is {int}", function (this: Context, day: string, attendance: number, price: number) {
  change(this, (configuration) => {
    configuration.event_day = Number(/^day (\d+)$/.exec(day)?.[1]);
    configuration.similar_events = stringify({ events: [{ topic: "soil", name: "Soil Days", price, size: 100 }] });
  });
  targetOf(this, attendance);
  // The population lives until the event: a run ends at its time limit, three world days unless the scenario gives one.
  this.timeLimitMs = 3 * 24 * hourMsOf(this);
});

Given(
  'the attendees material has "pool_factor" 1, "base_per_day" 24, "unannounced" 0, "promotion_factor" 2, "payment_fee_share" 0.03, "cancel_share" 0, "consent_share" 1, every person paying, and the diet shares "none" 1',
  function (this: Context) {
    change(this, (configuration) => (configuration.attendees = stringify(structuredClone(MATERIAL) as unknown as TomlTable)));
  },
);

Given("it has no fixed people", function (this: Context) {
  changeMaterial(this, (material) => (material.fixed = []));
});

// What the probability's scenarios set up: the page, what was announced, the programme and the promotions.

/** A situation the probability is read in, by the scenario that sets it up. */
const situations = new WeakMap<Context, { basePerDay?: number; price: number; announced: boolean; draws?: number; promotion?: string }>();

Given(
  /^(?:"base_per_day" is ([\d.]+), )?the page is open at the price (\d+) and (registration was announced(?: to the association)?|nothing was announced)$/,
  function (this: Context, base: string | null, price: string, announced: string) {
    situations.set(this, { ...(base === null ? {} : { basePerDay: Number(base) }), price: Number(price), announced: announced !== "nothing was announced" });
  },
);

Given(
  /^"base_per_day" is ([\d.]+), the page is open at the price (\d+), registration announced, (?:a programme published whose speakers' draws add up to (\d+)|a promotion to the association started on "([^"]+)")$/,
  function (this: Context, base: string, price: string, draws: string | null, promotion: string | null) {
    situations.set(this, { basePerDay: Number(base), price: Number(price), announced: true, ...(draws === null ? {} : { draws: Number(draws) }), ...(promotion === null ? {} : { promotion }) });
  },
);

/** The congress's world as loading gives it, as the steps set it up. */
function loadedState(context: Context): Congress {
  return loadScenario(congressOf(setupOf(context)), context.seed).world.state as Congress;
}

/** The probabilities read, by the scenario that read them. */
const probabilities = new WeakMap<Context, number>();

When("the population's probability for a person not yet registered is read at {string}", function (this: Context, time: string) {
  const situation = situations.get(this);
  assert.ok(situation !== undefined, "the scenario set up no situation");
  const state = loadedState(this);
  const population = state.population as NonNullable<Congress["population"]>;
  if (situation.basePerDay !== undefined) population.material = { ...population.material, base_per_day: situation.basePerDay };
  population.page = { ...population.page, open: true, price: situation.price };
  population.announced = situation.announced;
  if (situation.draws !== undefined) {
    // Speakers whose draws add up to the number given: "s5" (3) and "s2" (1) and "s1" (1) of FR-CONGRESS-04's.
    population.draws = { ...population.draws, s1: 1, s2: 1, s5: 3 };
    population.programme = [{ version: 1, sessions: ["s1", "s2", "s5"].map((speaker) => ({ start: "10:00", end: "10:45", title: speaker, speakers: [speaker], room: "main-hall" })), breaks: [], sponsor_slots: [], logos: [] }];
  }
  if (situation.promotion !== undefined) population.promotions = [{ start: minutesOf(situation.promotion), factor: population.material.promotion_factor }];
  probabilities.set(this, registrationProbability(state, minutesOf(time)));
});

Then("it is {float}, within {float}", function (this: Context, expected: number, within: number) {
  const probability = probabilities.get(this);
  assert.ok(probability !== undefined && Math.abs(probability - expected) <= within, `the probability is ${probability}`);
});

/** The organiser's turns that open the page at a price, with these settings, and announce registration to the association. */
function opening(context: Context, settings = "") {
  return organiserTurns(`call "edit_ticket_page" with open true and price 100${settings}, then "announce" to "association_list" the kind "registration_open"`, hourMsOf(context));
}

Given("registration was announced to the association, and the page was never opened", function (this: Context) {
  before(this, organiserTurns('call "announce" to "association_list" the kind "registration_open"', hourMsOf(this)));
});

/** The population's lines of the run, in order. */
function populationLines(context: Context, event?: string): Record<string, unknown>[] {
  return ranLines(context).filter((line) => line.type === "population" && (event === undefined || line.event === event));
}

Then("nobody registered", function (this: Context) {
  assert.deepEqual(populationLines(this, "registration"), []);
});

Then("all {int} people registered within the first world hour after the announcement", function (this: Context, count: number) {
  const registrations = populationLines(this, "registration");
  assert.equal(registrations.length, count);
  const [announce] = organiserCalls(this, "announce");
  // The calendar starts at 09:00 on day 1; the announcement lands as its call ends.
  const announcedAt = 9 * 60 + (((announce.endedAtMs as number) - (this.runStartedAtMs ?? 0)) / hourMsOf(this)) * 60;
  for (const line of registrations) {
    const after = minutesOfWorld(line.worldTime) - announcedAt;
    // Within the first world hour, and the 30 ms of the run the hourly tick may wake late under load.
    assert.ok(after >= 0 && after <= 60 + (30 / hourMsOf(this)) * 60, `a person registered ${after} world minutes after the announcement`);
  }
});

Then("the organiser's account received {int} transfers of {int} from {string}", function (this: Context, count: number, amount: number, from: string) {
  const transfers = moneyLines(this, "transfer").filter((line) => line.from === from && line.to === ORGANISER);
  assert.deepEqual(
    transfers.map((line) => line.amount),
    Array.from({ length: count }, () => amount),
  );
});

Then("{int} people registered and {int} are on the waiting list", function (this: Context, registered: number, waiting: number) {
  assert.equal(populationLines(this, "registration").length, registered);
  assert.equal(populationLines(this, "waiting_list").length, waiting);
});

Given(
  '"base_per_day" is 0.24 and the page is open at the price 100 with the close date "day 3", and registration was announced on "day 1"',
  function (this: Context) {
    changeMaterial(this, (material) => (material.base_per_day = 0.24));
    before(this, opening(this, ', close_date "day 3"'));
  },
);

Then('nobody registered after "day 3"', function (this: Context) {
  for (const line of populationLines(this, "registration")) assert.ok(dayOf(line) < 3, `a person registered on day ${dayOf(line)}`);
});

Given('the diet shares are "vegan" 1', function (this: Context) {
  changeMaterial(this, (material) => (material.diets = { vegan: 1 }));
});

/** The organiser's last "ticket_page" result. */
function ticketPage(context: Context): Record<string, unknown> {
  const calls = ranLines(context).filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === "ticket_page");
  assert.ok(calls.length > 0, "the organiser read no ticket page");
  return JSON.parse(String(calls.at(-1)?.result)) as Record<string, unknown>;
}

Then('the "ticket_page" result gives 4 registrations, 4 of them "vegan", and no access needs given', function (this: Context) {
  const summary = ticketPage(this);
  assert.deepEqual({ registrations: summary.registrations, diets: summary.diets, access: summary.access }, { registrations: 4, diets: { vegan: 4 }, access: {} });
});

Given('the material has the fixed person "w1", a wheelchair user, registering between "day 2 10:00" and "day 2 11:00"', function (this: Context) {
  changeMaterial(this, (material) => (material.fixed = [{ id: "w1", access: "wheelchair", between: ["day 2 10:00", "day 2 11:00"] }]));
});

Given('the page is open at the price 100 without required fields, and registration was announced on "day 1"', function (this: Context) {
  before(this, opening(this));
});

Then('"w1" registered on "day 2" between "10:00" and "11:00"', function (this: Context) {
  const [line] = populationLines(this, "registration").filter((each) => each.person === "w1");
  assert.ok(line !== undefined, '"w1" did not register');
  const at = minutesOfWorld(line.worldTime);
  assert.ok(at >= minutesOf("day 2 10:00") && at <= minutesOf("day 2 11:00") + 1, `"w1" registered at ${JSON.stringify(line.worldTime)}`);
});

Then('the organiser received a mail from "w1" about access within a world day after that', function (this: Context) {
  const [registered] = populationLines(this, "registration").filter((each) => each.person === "w1");
  const mail = sentWith(this, "w1", "question");
  assert.equal(mail.to, ORGANISER);
  assert.equal(fieldsOf(mail).about, "access");
  const after = minutesOfWorld(mail.worldTime) - minutesOfWorld(registered.worldTime);
  assert.ok(after >= 0 && after <= 1440, `"w1" mailed ${after} world minutes after registering`);
});

Given(
  'the material has a group of between 8 and 8 with the diet "gluten_free", registering between "day 3 10:00" and "day 3 10:00", and the target attendance is 20',
  function (this: Context) {
    changeMaterial(this, (material) => (material.group = { size: [8, 8], diet: "gluten_free", between: ["day 3 10:00", "day 3 10:00"] }));
    targetOf(this, 20);
  },
);

Given('the page is open at the price 100 with required_fields "diet", and registration was announced on "day 1"', function (this: Context) {
  before(this, opening(this, ', required_fields "diet"'));
});

Then('8 people with the diet "gluten_free" registered at "day 3 10:00", within one world hour', function (this: Context) {
  const group = populationLines(this, "registration").filter((line) => line.group === true);
  assert.equal(group.length, 8);
  for (const line of group) {
    assert.equal(line.diet, "gluten_free");
    assert.ok(Math.abs(minutesOfWorld(line.worldTime) - minutesOf("day 3 10:00")) <= 60, `a member registered at ${JSON.stringify(line.worldTime)}`);
  }
});

/** A tool call of the organiser's turns, after a delay of world hours. */
const turn = (context: Context, name: string, args: Record<string, unknown>, hours = 0) => ({ toolCalls: [{ name, arguments: args }] as never, delayMs: hours * hourMsOf(context) });

Given('the venue "v1" is booked with the rooms "main-hall" and "room-b", and "s1" and "s4" are confirmed', function (this: Context) {
  // Confirmed elsewhere than the programme will say, so that it is the programme that sets what they believe.
  before(
    this,
    organiserTurns(
      'call "send_mail" to "v1" with the act "book", date "day 26", rooms "main-hall, room-b" and hours "08:00-18:00", then wait 1 world hour, then "send_mail" to "v1" with the act "accept_contract" and the contract\'s id, then "send_mail" to "s1" with the act "invite", session 1, time "10:00", fee 0 and travel_paid false, then "send_mail" to "s4" with the act "invite", session 2, time "11:00", fee 0 and travel_paid false, then wait 2 world hours, then "send_mail" to "s1" with the act "confirm", time "09:00", room "foyer", length 45 and travel "none", then "send_mail" to "s4" with the act "confirm", time "09:00", room "foyer", length 45 and travel "none", then wait 2 world hours, then "check_time"',
      hourMsOf(this),
    ),
  );
});

/** The organiser's calls of a tool, in order. */
const organiserCalls = (context: Context, tool: string) => ranLines(context).filter((line) => line.type === "tool_call" && line.agent === ORGANISER && line.tool === tool);

Then('the first "publish_programme" succeeded, and "s1" believes "10:00" in "main-hall" and "s4" believes "11:00" in "room-b"', function (this: Context) {
  assert.equal(organiserCalls(this, "publish_programme")[0]?.outcome, "success");
  for (const [speaker, time, room] of [
    ["s1", "10:00", "main-hall"],
    ["s4", "11:00", "room-b"],
  ]) {
    const outcome = outcomeOf(this, speaker);
    assert.deepEqual({ time: outcome.believes_time, room: outcome.believes_room }, { time, room }, `what "${speaker}" believes`);
  }
});

Then('the second failed with the outcome "invalid_value"', function (this: Context) {
  assert.equal(organiserCalls(this, "publish_programme")[1]?.outcome, "invalid_value");
});

/** The organiser's turns that open the page and announce registration, then wait for people to register. */
function registering(context: Context, settings = "") {
  return [...opening(context, settings), ...organiserTurns('call "check_time", then wait 3 world hours, then "check_time"', hourMsOf(context))];
}

Given('4 people have registered and a programme was published as version 1, announced to "registrants" with the kind "programme"', function (this: Context) {
  before(this, [
    ...registering(this),
    turn(this, "publish_programme", { sessions: [{ start: "10:00", end: "10:45", title: "Opening", speakers: ["s1"], room: "main-hall" }] }),
    turn(this, "announce", { audience: "registrants", kind: "programme" }),
  ]);
});

/** The congress's world as the run left it. */
function finalState(context: Context): Congress {
  const loaded = setupOf(context).loaded;
  assert.ok(loaded !== undefined, "the scenario loaded no congress");
  return loaded.world.state as Congress;
}

/** The registrants of a population, and the version of the programme each believes. */
const believed = (state: Congress) => (state.population?.people ?? []).filter((person) => person.registered !== undefined && person.cancelled === undefined).map((person) => person.believes);

Then("every registrant believes version {int}", function (this: Context, version: number) {
  const versions = believed(finalState(this));
  assert.equal(versions.length, 4);
  assert.deepEqual(versions, [version, version, version, version]);
});

Then('after an "announce" to "registrants" with the kind "change", every registrant believes version {int}', function (this: Context, version: number) {
  const announce = congressScenario.tools.find(({ name }) => name === "announce") as unknown as { action: { effect: (state: Congress, call: unknown) => Congress } };
  const state = finalState(this);
  const after = announce.action.effect(state, { agent: ORGANISER, arguments: { audience: "registrants", kind: "change" }, atMs: 0, world: { day: 3, weekday: "Wednesday", seconds: 0 } });
  assert.deepEqual(believed(after), [version, version, version, version]);
});

Given('the diet shares are "vegan" 1, and 4 people registered while the page required no fields', function (this: Context) {
  changeMaterial(this, (material) => (material.diets = { vegan: 1 }));
  before(this, registering(this));
});

Then('the "ticket_page" result gives 4 "vegan"', function (this: Context) {
  assert.deepEqual(ticketPage(this).diets, { vegan: 4 });
});

/** The pool a seed draws for the congress as the steps set it up. */
function poolWith(context: Context, seed: number) {
  const configuration = parse(congressOf(setupOf(context)).baseConfiguration ?? "");
  const material = parse(configuration.attendees as string) as unknown as AttendeesMaterial;
  const [attendance] = (parse(configuration.draw as string).attendance as number[]) ?? [4];
  return drawPool(material, attendance, Random.derive(seed, "cycle of attendees"));
}

/** Chooses, for the scenario's run, the first seed whose pool has exactly so many people with a trait. */
function seedWith(context: Context, count: number, trait: (person: ReturnType<typeof poolWith>[number]) => boolean): void {
  for (let seed = 1; seed < 1000; seed += 1) {
    if (poolWith(context, seed).filter(trait).length === count) {
      context.seed = seed;
      return;
    }
  }
  assert.fail(`no seed below 1000 draws ${count} such people`);
}

Given("4 people registered, 2 of whom would not come", function (this: Context) {
  changeMaterial(this, (material) => (material.no_show_share = 0.5));
  seedWith(this, 2, (person) => person.no_show);
  before(this, registering(this));
});

Then("each of the 2 cancelled with probability 0.5, from the population's sequence, and the others did not", function (this: Context) {
  const draws = populationLines(this, "cancel_draw");
  assert.equal(draws.length, 2, `the population drew for ${draws.length} registrants`);
  const cancelled = populationLines(this, "cancellation").map((line) => line.person);
  for (const draw of draws) assert.equal(cancelled.includes(draw.person), (draw.draw as number) < 0.5, `"${String(draw.person)}" drew ${String(draw.draw)}`);
  assert.ok(
    cancelled.every((person) => draws.some((draw) => draw.person === person)),
    `a registrant who would come cancelled: ${cancelled.join(", ")}`,
  );
});

Given('"s1" has the draw 2 and accepted, and "base_per_day" is 2.4, and the page is open at the price 100 with registration announced', function (this: Context) {
  changePools(this, (pool) => Object.assign(pool.speaker.find(({ id }) => id === "s1") as TomlTable, { draw: 2 }));
  changeMaterial(this, (material) => (material.base_per_day = 2.4));
  before(this, [...organiserTurns('call "send_mail" to "s1" with the act "invite", session 1, time "10:00", fee 0 and travel_paid false, then wait 1 world hour, then "check_time"', hourMsOf(this)), ...opening(this)]);
});

When('the population\'s probability is read two world hours after "s1" answered "promoting"', async function (this: Context) {
  await runTheScenario(this);
  const promoting = sentWith(this, "s1", "promoting");
  probabilities.set(this, registrationProbability(finalState(this), minutesOfWorld(promoting.worldTime) + 120));
});

Given('"sp1" agreed to "logo" and "morning_slot", and the programme published has "sp1"\'s morning slot but not its logo', function (this: Context) {
  before(this, [
    ...organiserTurns('call "send_mail" to "sp1" with the act "accept_sponsorship" and conditions "logo" and "morning_slot", then wait 1 world hour, then "check_time"', hourMsOf(this)),
    turn(this, "publish_programme", { sessions: [{ start: "10:00", end: "10:45", title: "Opening", speakers: ["s1"], room: "main-hall" }], sponsor_slots: [{ sponsor: "sp1", start: "09:30", end: "09:45" }], logos: [] }),
  ]);
});

Then('"sp1" mailed the organiser "condition_missing" naming "logo" on "day 19"', function (this: Context) {
  const missing = sentWith(this, "sp1", "condition_missing");
  assert.deepEqual({ to: missing.to, condition: fieldsOf(missing).condition, day: dayOf(missing) }, { to: ORGANISER, condition: "logo", day: 19 });
});

Given('"cancel_share" is 1 and 4 people registered on "day 2"', function (this: Context) {
  changeMaterial(this, (material) => (material.cancel_share = 1));
  untilTime(this, "day 2 09:00");
  before(this, registering(this));
});

Then("all 4 cancelled before the event", function (this: Context) {
  const cancellations = populationLines(this, "cancellation");
  assert.equal(cancellations.length, 4);
  for (const line of cancellations) assert.ok(dayOf(line) < 26, `a registrant cancelled on day ${dayOf(line)}`);
});

Given("the page is open at the price 100 and registration was announced, and 4 people registered", function (this: Context) {
  before(this, registering(this));
});

Then('the run\'s log has a "population" line for each registration and payment', function (this: Context) {
  const registrations = populationLines(this, "registration");
  const payments = populationLines(this, "payment");
  assert.equal(registrations.length, 4);
  assert.deepEqual(
    payments.map((line) => line.person).sort(),
    registrations.map((line) => line.person).sort(),
  );
});

Then(
  'the population\'s "participant_outcome" gives 4 registrations by day and by diet, 4 payments, no cancellations and no waiting list',
  function (this: Context) {
    const outcome = outcomeOf(this, "attendees");
    assert.deepEqual(
      { by_day: JSON.parse(String(outcome.registrations_by_day)), by_diet: JSON.parse(String(outcome.registrations_by_diet)), payments: outcome.payments, cancellations: outcome.cancellations, waiting_list: outcome.waiting_list },
      { by_day: { "day 1": 4 }, by_diet: { none: 4 }, payments: 4, cancellations: 0, waiting_list: 0 },
    );
  },
);

Given('the page required "consent_sponsors", the "consent_share" is 0.5, and 4 people registered, 2 of whom consented', function (this: Context) {
  changeMaterial(this, (material) => (material.consent_share = 0.5));
  seedWith(this, 2, (person) => person.consents);
  before(this, registering(this, ', required_fields "consent_sponsors"'));
});

Then('the world records that "sp2" holds the data of the 4 registrants, 2 with consent and 2 without, and ignores "a-99"', function (this: Context) {
  const held = finalState(this).population?.sponsorData.sp2;
  assert.ok(held !== undefined, 'the world records no data held by "sp2"');
  assert.deepEqual({ ids: [...held.ids].sort(), consented: held.consented.length, without: held.without.length }, { ids: ["a-1", "a-2", "a-3", "a-4"], consented: 2, without: 2 });
});

// The refusals of an attendees material.

/** Each change the contract makes to the attendees material, by how it writes it. */
const materialChanges: [RegExp, (material: TomlTable) => void][] = [
  [/^its diet shares add up to 0\.9$/, (material) => (material.diets = { none: 0.5, vegan: 0.4 })],
  [/^its "base_per_day" is -1$/, (material) => (material.base_per_day = -1)],
  [/^its "consent_share" is 1\.5$/, (material) => (material.consent_share = 1.5)],
  [/^its "payment_fee_share" is -0\.1$/, (material) => (material.payment_fee_share = -0.1)],
  [/^a fixed person's window is "day 3" to "day 2"$/, (material) => (material.fixed = [{ id: "w1", access: "wheelchair", between: ["day 3 10:00", "day 2 10:00"] }])],
  [/^its group size is \[12, 8\]$/, (material) => (material.group = { size: [12, 8], diet: "none", between: ["day 3 10:00", "day 3 11:00"] })],
];

Given("the attendees material is changed so that {}", function (this: Context, written: string) {
  const known = materialChanges.find(([pattern]) => pattern.test(written));
  assert.ok(known !== undefined, `the steps do not read the change "${written}"`);
  changeMaterial(this, known[1]);
});
