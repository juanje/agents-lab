import { type Grid, emptyGrid } from "../engine/grid.ts";
import type { Scenario } from "../engine/scenario.ts";

/** The two kinds a resident can be of. */
export const KINDS = ["teal", "amber"] as const;
export type Kind = (typeof KINDS)[number];

/** The neighbourhood's state: its grid, where each resident is, and each resident's kind. */
export interface Neighbourhood {
  grid: Grid;
  kinds: Readonly<Record<string, Kind>>;
}

/** The neighbourhood scenario. */
export const neighbourhoodScenario: Scenario<Neighbourhood> = {
  name: "neighbourhood",
  agents: () => [],
  initialState: () => ({ grid: emptyGrid(0, 0, 1), kinds: {} }),
  tools: [],
  channels: () => [{ name: "rhythm", source: "rhythm", stimulus: "You wake up." }],
  metrics: {},
  systemPrompt: () => "You are a resident.",
  baseConfiguration: "width = 1\n",
};
