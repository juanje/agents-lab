import { type Grid, emptyGrid, place, randomEmptyCell } from "../engine/grid.ts";
import type { Configuration, Scenario } from "../engine/scenario.ts";

/** The two kinds a resident can be of. */
export const KINDS = ["teal", "amber"] as const;
export type Kind = (typeof KINDS)[number];

/** The neighbourhood's state: its grid, where each resident is, and each resident's kind. */
export interface Neighbourhood {
  grid: Grid;
  kinds: Readonly<Record<string, Kind>>;
}

/** The size of the grid and the number of residents, as the configuration gives them. */
function sizesOf(configuration: Configuration): { width: number; height: number; residents: number } {
  const { width, height, residents } = configuration as { width: number; height: number; residents: number };
  return { width, height, residents };
}

/** The residents' names, from "resident 1", as many as the configuration gives. */
function residentsOf(configuration: Configuration): string[] {
  return Array.from({ length: sizesOf(configuration).residents }, (_, index) => `resident ${index + 1}`);
}

/** The neighbourhood scenario. */
export const neighbourhoodScenario: Scenario<Neighbourhood> = {
  name: "neighbourhood",
  agents: residentsOf,
  // Each resident in turn takes an empty cell drawn from the replica's sequence; kinds alternate, so half are of each.
  initialState: (configuration, random) => {
    const { width, height } = sizesOf(configuration);
    let grid = emptyGrid(width, height, 1);
    const kinds: Record<string, Kind> = {};
    for (const [index, resident] of residentsOf(configuration).entries()) {
      const cell = randomEmptyCell(grid, random);
      if (cell === undefined) throw new Error(`the ${width} by ${height} grid has no empty cell left for ${resident}`);
      grid = place(grid, resident, cell);
      kinds[resident] = KINDS[index % KINDS.length];
    }
    return { grid, kinds };
  },
  tools: [],
  channels: () => [{ name: "rhythm", source: "rhythm", stimulus: "You wake up." }],
  metrics: {},
  systemPrompt: () => "You are a resident.",
  baseConfiguration: ["width = 6", "height = 6", "residents = 10", ""].join("\n"),
};
