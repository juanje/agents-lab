import type { Sensing } from "../../src/engine/sensings.ts";
import type { LastBy } from "../../src/engine/tools.ts";

/** The last sensing by each sensor of an agent whose only sensing is this one. */
export const onlySensing =
  (sensing: Sensing): LastBy =>
  (tool) =>
    tool === sensing.tool ? sensing : undefined;
