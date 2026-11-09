const common = {
  import: ["features/support/**/*.ts", "features/steps/**/*.ts"],
  plugin: ["./features/plugins/scenarios-ran.ts"],
};

export default {
  ...common,
  // A real model costs money and answers differently each time: the smoke scenario runs by hand, outside the gate.
  tags: "not @smoke",
};

/** The real-model smoke scenario: `NODE_OPTIONS="--import tsx" npx cucumber-js -p smoke`. */
export const smoke = { ...common, tags: "@smoke" };
