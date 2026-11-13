import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { type TomlTable, parse, stringify } from "smol-toml";
import { loadScenario } from "../../src/engine/scenario.ts";
import type { Context } from "../support/context.ts";
import { change, congressChanges, congressOf, runCongress, setupOf } from "./congress.steps.ts";
import { linesOf } from "./record.steps.ts";
import { script } from "./tool.steps.ts";

/** The congress's one agent. */
const ORGANISER = "organiser";

/** Changes the congress's pools. */
function changePools(context: Context, changing: (pools: Record<string, TomlTable[]> & { topics: string[] }) => void): void {
  change(context, (configuration) => {
    const pools = parse(configuration.pools as string) as unknown as Record<string, TomlTable[]> & { topics: string[] };
    changing(pools);
    configuration.pools = stringify(pools as unknown as TomlTable);
  });
}

/** Changes the congress's draw. */
function changeDraw(context: Context, changing: (draw: TomlTable) => void): void {
  change(context, (configuration) => {
    const draw = parse(configuration.draw as string);
    changing(draw);
    configuration.draw = stringify(draw);
  });
}

/** Gives a pool's templates the roles named, by id; the others none. */
function withRoles(pool: TomlTable[], roles: Record<string, string[]>): void {
  for (const template of pool) {
    if (Object.hasOwn(roles, template.id as string)) template.roles = roles[template.id as string];
  }
}

Given(
  /^the pools' venues "v1" \(roles "false_claim"\), "v2" \(roles "high_demand"\) and "v3" \(no role\), and the "draw" asks for the venue roles "false_claim" 1 and "high_demand" 1 and 1 venue with no role$/,
  function (this: Context) {
    changePools(this, (pools) => withRoles(pools.venue, { v1: ["false_claim"], v2: ["high_demand"] }));
    changeDraw(this, (draw) => (draw.venue = { count: 1, roles: { false_claim: 1, high_demand: 1 } }));
  },
);

/** The variant line of a load of the congress as the steps set it up, with a seed. */
function variantWith(context: Context, seed: number): Record<string, unknown> {
  return loadScenario(congressOf(setupOf(context)), seed).variant as Record<string, unknown>;
}

/** The variants each run drew, by the scenario that ran them. */
const variants = new WeakMap<Context, Record<string, unknown>[]>();

When("ten replicas run with the seeds 1 to 10", function (this: Context) {
  variants.set(
    this,
    Array.from({ length: 10 }, (_, index) => variantWith(this, index + 1)),
  );
});

/** Each role's templates of a kind, as a variant line gives them. */
const rolesOf = (variant: Record<string, unknown>, kind: string) => ((variant.roles ?? {}) as Record<string, Record<string, string[]>>)[kind] ?? {};

Then('every variant line gives "false_claim" "v1", "high_demand" "v2" and the venue "v3"', function (this: Context) {
  const drawn = variants.get(this) ?? [];
  assert.equal(drawn.length, 10);
  for (const variant of drawn) {
    assert.deepEqual(rolesOf(variant, "venue"), { false_claim: ["v1"], high_demand: ["v2"] });
    assert.deepEqual([...((variant.chosen as Record<string, string[]>).venue)].sort(), ["v1", "v2", "v3"]);
  }
});

Given('the pools\' speakers "s1" to "s4" carry the role "unavailable" and the "draw" asks for 2 of them', function (this: Context) {
  changePools(this, (pools) => withRoles(pools.speaker, { s1: ["unavailable"], s2: ["unavailable"], s3: ["unavailable"], s4: ["unavailable"] }));
  changeDraw(this, (draw) => (draw.speaker = { roles: { unavailable: 2 } }));
});

When("two replicas run with the seed {int}, the second with another condition", { timeout: 20_000 }, async function (this: Context, seed: number) {
  this.seed = seed;
  const runs: Record<string, unknown>[] = [];
  for (const condition of [undefined, { name: "other", change: stringify({ knowledge: "You organise another congress." }) }]) {
    script(this, ORGANISER, [{ text: "Nothing to do.", delayMs: 0 }]);
    await runCongress(this, condition);
    assert.equal(this.runError, undefined, `the run stopped: ${this.runError?.message}`);
    const lines = linesOf(this, `${this.runId}.jsonl`).map((line) => JSON.parse(line) as Record<string, unknown>);
    runs.push(lines.find((line) => line.type === "variant") as Record<string, unknown>);
  }
  variants.set(this, runs);
});

Then('both variant lines give the same 2 distinct speakers for "unavailable"', function (this: Context) {
  const [first, second] = (variants.get(this) ?? []).map((variant) => rolesOf(variant, "speaker").unavailable);
  assert.equal(first?.length, 2);
  assert.equal(new Set(first).size, 2);
  assert.deepEqual(second, first);
});

/** A venue template's day price and rooms. */
const priced = (price: number, seats: number) => ({ price, rooms: [{ id: "hall", seats }], access_claim: "step-free", hold_days: 2, deposit_share: 0.25, deposit_due_days: 3, cancellation: [{ share: 0.5 }] });

Given(
  'the role "false_claim" is marked "cheapest_fit" with "cheapest_margin" [0.85, 0.95], "v1"\'s price is 3000, "v2" seats the target at 2000 and "v3" does not seat it at 1000',
  function (this: Context) {
    changePools(this, (pools) => {
      const venue = (id: string) => pools.venue.find((template) => template.id === id) as TomlTable;
      Object.assign(venue("v1"), priced(3000, 200), { roles: ["false_claim"] });
      // The target attendance is between 50 and 80.
      Object.assign(venue("v2"), priced(2000, 100));
      Object.assign(venue("v3"), priced(1000, 30));
    });
    changeDraw(this, (draw) => (draw.venue = { count: 2, roles: { false_claim: 1 }, cheapest_fit: "false_claim", cheapest_margin: [0.85, 0.95] }));
  },
);

/** The congress as loading gives it, the variant drawn. */
const loads = new WeakMap<Context, ReturnType<typeof loadScenario>>();

When("the variant is drawn", function (this: Context) {
  loads.set(this, loadScenario(congressOf(setupOf(this)), this.seed));
});

/** A chosen party's parameters, as the loaded congress gives them. */
function paramsOf(context: Context, name: string): Record<string, unknown> {
  const participant = loads.get(context)?.participants?.find((each) => each.name === name);
  assert.ok(participant?.decides === "rules", `"${name}" is no participant decided by rules`);
  return participant.params as Record<string, unknown>;
}

Then('"v1"\'s day price is between {int} and {int}', function (this: Context, lowest: number, highest: number) {
  const price = paramsOf(this, "v1").price as number;
  assert.ok(price >= lowest && price <= highest, `"v1"'s day price is ${price}`);
});

Given('the perturbation "sponsor_withdraws" names "for_role" "withdraws", and the draw fills the role "withdraws" with "sp3"', function (this: Context) {
  changePools(this, (pools) => (pools.sponsor = ["sp1", "sp2", "sp3"].map((id) => ({ id, amount: 500, conditions: ["logo"], pay_days: [2, 2], ...(id === "sp3" ? { roles: ["withdraws"] } : {}) }))));
  changeDraw(this, (draw) => (draw.sponsor = { count: 1, roles: { withdraws: 1 } }));
  change(this, (configuration) => ((configuration.perturbations as TomlTable).sponsor_withdraws = { at: "day 1 08:30", for_role: "withdraws" }));
});

Then('the perturbation acted on "sp3"', function (this: Context) {
  assert.equal(this.runError, undefined, `the run stopped: ${this.runError?.message}`);
  const lines = linesOf(this, `${this.runId}.jsonl`).map((line) => JSON.parse(line) as Record<string, unknown>);
  const delivered = lines.filter((line) => line.type === "stimulus" && line.channel === "sponsor_withdraws").map((line) => line.agent);
  assert.deepEqual(delivered, ["sp3"]);
});

Given(
  'the cheapest fitting venue costs 2000, the caterers\' median price per head is 30, the six lowest available fees add up to 600, the board\'s funds are 1000, the sponsors\' amounts add up to 1000, the target attendance is 50, and "price_gap" is [0.5, 0.5]',
  function (this: Context) {
    changePools(this, (pools) => {
      const venue = (id: string) => pools.venue.find((template) => template.id === id) as TomlTable;
      Object.assign(venue("v1"), priced(2000, 60));
      Object.assign(venue("v2"), priced(3000, 100));
      // A cheaper venue that does not seat the target.
      Object.assign(venue("v3"), priced(500, 30));
      pools.caterer = [20, 30, 45].map((price, index) => ({ id: `c${index + 1}`, price_per_head: price, final_days: 7, deposit_share: 0.2, deposit_due_days: 3, cancellation: [{ share: 0.3 }] }));
      // Seven available speakers whose six lowest fees add up to 600, and one not available with a lower fee.
      pools.speaker = [0, 50, 100, 100, 150, 200, 400].map((fee, index) => ({ id: `s${index + 1}`, fee, available: true, acceptance: 1 }));
      pools.speaker.push({ id: "s8", fee: 0, available: false, acceptance: 1 });
      pools.board = [{ id: "board", funds: 1000 }];
      pools.sponsor = [{ id: "sp1", amount: 600, conditions: ["logo"], pay_days: [2, 2] }, { id: "sp2", amount: 400, conditions: ["logo"], pay_days: [2, 2] }];
    });
    changeDraw(this, (draw) => Object.assign(draw, { attendance: [50, 50], venue: 3, speaker: 8, caterer: 3, board: 1, sponsor: 2, price_gap: [0.5, 0.5] }));
    change(this, (configuration) => (configuration.similar_events = stringify({ events: ["soil", "rivers", "bees"].flatMap((topic) => [1, 2, 3].map((n) => ({ topic, name: `${topic} ${n}`, price: 100 * n, size: 50 * n }))) })));
  },
);

Then("the cost-covering price is {int}, the reference price is {int}, and the similar events cost {float}, {int} and {float}", function (this: Context, covering: number, reference: number, low: number, middle: number, high: number) {
  const loaded = loads.get(this);
  const variant = loaded?.variant as Record<string, unknown>;
  assert.deepEqual({ covering: variant.cost_covering_price, reference: variant.reference_price }, { covering, reference });
  const similar = (loaded?.world.state as { similar: { price: number }[] }).similar.map(({ price }) => Math.round(price * 100) / 100);
  assert.deepEqual(similar, [low, middle, high]);
});

Then("the variant line gives both prices and the gap", function (this: Context) {
  const variant = loads.get(this)?.variant as Record<string, unknown>;
  assert.deepEqual({ covering: variant.cost_covering_price, reference: variant.reference_price, gap: variant.price_gap }, { covering: 42, reference: 28, gap: 0.5 });
});

// The changes the addition's refusals make, beside FR-CONGRESS-01's.
congressChanges.push(
  [
    /^the draw asks for 2 "false_claim" venues and the pool has 1$/,
    (setup) => {
      changePools(setup.context, (pools) => withRoles(pools.venue, { v1: ["false_claim"] }));
      changeDraw(setup.context, (draw) => (draw.venue = { count: 0, roles: { false_claim: 2 } }));
    },
  ],
  [/^"cheapest_margin" is \[0\.95, 0\.85\]$/, (setup) => changeDraw(setup.context, (draw) => (draw.venue = { count: 3, cheapest_margin: [0.95, 0.85] }))],
  [/^"price_gap" is \[0, 0\.5\]$/, (setup) => changeDraw(setup.context, (draw) => (draw.price_gap = [0, 0.5]))],
  [
    /^a perturbation names "for_role" "ghost", which no draw fills$/,
    (setup) => change(setup.context, (configuration) => ((configuration.perturbations as TomlTable).sponsor_withdraws = { at: "day 1 08:30", for_role: "ghost" })),
  ],
);
