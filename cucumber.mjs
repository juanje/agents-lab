const common = {
  import: ["features/support/**/*.ts", "features/steps/**/*.ts"],
  plugin: ["./features/plugins/scenarios-ran.ts"],
  // Most scenarios wait on world clocks: four workers run them side by side.
  parallel: 4,
};

export default {
  ...common,
  // A real model costs money and answers differently each time: the smoke scenario runs by hand, outside the gate.
  tags: "not @smoke",
};

/** The real-model smoke scenario: `NODE_OPTIONS="--import tsx" npx cucumber-js -p smoke`. */
export const smoke = { ...common, import: [...common.import, "features/smoke/**/*.ts"], tags: "@smoke" };
