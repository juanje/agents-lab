import { readdirSync } from "node:fs";

const common = {
  import: ["features/support/**/*.ts", "features/steps/**/*.ts"],
  plugin: ["./features/plugins/scenarios-ran.ts"],
  // Most scenarios wait on world clocks: four workers run them side by side.
  parallel: 4,
};

// A real model costs money and answers differently each time: the smoke scenario runs by hand, outside the gate.
const gate = { ...common, tags: "not @smoke" };

// Each world's feature files, by the FR families that belong to it. A family named in no world is the engine's.
const WORLDS = {
  congress: ["CONGRESS", "POPULATION", "MONEY"],
  workshop: ["WORKSHOP"],
  workplace: ["WORKPLACE"],
  neighbourhood: ["NEIGHBOURHOOD"],
};

const features = readdirSync("features").filter((file) => file.endsWith(".feature"));
const worldOf = (file) => Object.keys(WORLDS).find((world) => WORLDS[world].includes(/^FR-([A-Z]+)-/.exec(file)?.[1]));
const pathsOf = (world) => features.filter((file) => worldOf(file) === world).map((file) => `features/${file}`);

export default gate;

// One world's scenarios, or the engine's, while developing: `npx cucumber-js -p workshop`. Profiles add up
// (`-p workshop -p engine`). The gate still runs them all.
export const congress = { ...gate, paths: pathsOf("congress") };
export const workshop = { ...gate, paths: pathsOf("workshop") };
export const workplace = { ...gate, paths: pathsOf("workplace") };
export const neighbourhood = { ...gate, paths: pathsOf("neighbourhood") };
export const engine = { ...gate, paths: pathsOf(undefined) };

/** The real-model smoke scenario: `NODE_OPTIONS="--import tsx" npx cucumber-js -p smoke`. */
export const smoke = { ...common, import: [...common.import, "features/smoke/**/*.ts"], tags: "@smoke" };
