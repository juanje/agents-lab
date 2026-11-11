import { CELL_FULL, type Grid, type Position, distance, emptyGrid, entitiesAt, inside, move as moveOnGrid, neighbours, place, position, randomEmptyCell, window } from "../engine/grid.ts";
import type { Configuration, Scenario } from "../engine/scenario.ts";
import { RHYTHM_CHANNEL } from "../engine/stimuli.ts";
import type { AgentCall, Effector, Sensor } from "../engine/tools.ts";

/** The two kinds a resident can be of. */
export const KINDS = ["teal", "amber"] as const;
export type Kind = (typeof KINDS)[number];

/**
 * The neighbourhood's state: its grid, where each resident is, and each resident's kind; and, as the configuration sets
 * them, how far a resident sees, how long a look takes and how long moving takes per cell of distance, which its tools
 * read; and how many moves the arbiter has applied.
 */
export interface Neighbourhood {
  grid: Grid;
  kinds: Readonly<Record<string, Kind>>;
  moves: number;
  lookRadius: number;
  msPerLook: number;
  msPerCell: number;
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

/** A resident's kind: kinds alternate in the order the residents are named, so half are of each. */
function kindOf(configuration: Configuration, resident: string): Kind {
  const index = residentsOf(configuration).indexOf(resident);
  if (index === -1) throw new Error(`The neighbourhood has no resident "${resident}"`);
  return KINDS[index % KINDS.length];
}

/** How a look marks a cell: the resident itself, a resident of its kind or of the other, empty, or outside the grid. */
export type Mark = "you" | "same" | "other" | "empty" | "outside";

/** Where the neighbourhood holds a resident; a resident it does not hold is a defect in the run, not a choice. */
function whereIs({ grid }: Neighbourhood, resident: string): Position {
  const at = position(grid, resident);
  if (at === undefined) throw new Error(`The neighbourhood holds no resident "${resident}"`);
  return at;
}

/** "look": the resident's window of the configured radius, each cell marked as the resident sees it. */
const look: Sensor<Neighbourhood> = {
  kind: "sensor",
  name: "look",
  description:
    'See the cells around you, as a JSON array of rows from the top, each row from the left, with you in the middle: "you" is your cell, "same" a resident of your kind, "other" a resident of the other kind, "empty" an empty cell and "outside" beyond the edge of the neighbourhood.',
  parameters: { type: "object", properties: {} },
  durationMs: (state) => state.msPerLook,
  sense: (state, resident) => {
    const at = whereIs(state, resident);
    const mark = (cell: { x: number; y: number; outside: boolean }): Mark => {
      if (cell.outside) return "outside";
      const held = entitiesAt(state.grid, cell)[0];
      if (held === undefined) return "empty";
      if (held === resident) return "you";
      return state.kinds[held] === state.kinds[resident] ? "same" : "other";
    };
    const side = 2 * state.lookRadius + 1;
    const cells = window(state.grid, at, state.lookRadius).map(mark);
    return JSON.stringify(Array.from({ length: side }, (_, row) => cells.slice(row * side, (row + 1) * side)));
  },
  // The window's middle is the resident's cell when it looks, which a later move needs to find its target in it.
  takenFrom: whereIs,
};

/** Why a move fails when its target is outside the grid: the resident's choice, not a defect (FR-SPACE-01). */
export const INVALID_TARGET = "invalid_target";

/** Why a move fails when its offset is 0, 0: the resident is already in that cell, so nothing is applied. */
export const ALREADY_THERE = "already_there";

/** A call of "move" as the grid's move reads it: the resident, from where it is, to the cell at the call's offset. */
function moveCall(state: Neighbourhood, { agent, arguments: args }: AgentCall): { entity: string; from: Position; to: Position } {
  const from = whereIs(state, agent);
  return { entity: agent, from, to: { x: from.x + (args.dx as number), y: from.y + (args.dy as number) } };
}

/**
 * "move dx dy": the resident moves to the cell at that offset, anywhere in the grid, taking the configured time per cell
 * for the distance; it stays in its cell until it arrives, and the cell is checked then (FR-SPACE-02).
 */
const move: Effector<Neighbourhood> = {
  kind: "effector",
  name: "move",
  description: "Move to the cell dx columns to the right (left if negative) and dy rows down (up if negative) of yours. The further it is, the longer it takes.",
  parameters: {
    type: "object",
    properties: { dx: { type: "integer" }, dy: { type: "integer" } },
    required: ["dx", "dy"],
  },
  durationMs: (state, call) => {
    const { from, to } = moveCall(state, call);
    return state.msPerCell * distance(from, to);
  },
  action: {
    precondition: (state, call) => {
      const onGrid = moveCall(state, call);
      if (distance(onGrid.from, onGrid.to) === 0) return { holds: false, reason: ALREADY_THERE };
      if (!inside(state.grid, onGrid.to)) return { holds: false, reason: INVALID_TARGET };
      return moveOnGrid.precondition(state.grid, onGrid);
    },
    effect: (state, call) => ({ ...state, grid: moveOnGrid.effect(state.grid, moveCall(state, call)), moves: state.moves + 1 }),
  },
  // What happened to the resident: that it moved, or why it did not, and that it has not (FR-NEIGHBOURHOOD-02).
  texts: {
    success: "You moved.",
    [CELL_FULL]: "Someone already lives in that cell; you have not moved.",
    [INVALID_TARGET]: "That cell is beyond the edge of the neighbourhood; you have not moved.",
    [ALREADY_THERE]: "You are already in that cell; you have not moved.",
  },
  // Its target is the cell at the call's offset from where the resident is now, as its last look showed it, wherever it
  // looked from.
  readTarget: (sensing, call, state) => {
    if (sensing.tool !== look.name || sensing.takenFrom === undefined) return "not_sensed";
    const { to } = moveCall(state, call);
    const rows = JSON.parse(sensing.result) as Mark[][];
    const middle = (rows.length - 1) / 2;
    const mark = rows[middle + to.y - sensing.takenFrom.y]?.[middle + to.x - sensing.takenFrom.x];
    if (mark === undefined) return "not_sensed";
    if (mark === "outside") return "outside";
    return mark === "empty" ? "free" : "held";
  },
};

/**
 * "shares": for each resident with at least one occupied neighbouring cell, the share of the residents on those cells
 * that are of its kind, by the resident's name. A resident with no neighbour has no share.
 */
function shares(state: Neighbourhood): Record<string, number> {
  const { grid, kinds } = state;
  const found: Record<string, number> = {};
  for (const [resident, kind] of Object.entries(kinds)) {
    const around = neighbours(grid, whereIs(state, resident)).flatMap((cell) => entitiesAt(grid, cell));
    if (around.length > 0) found[resident] = around.filter((neighbour) => kinds[neighbour] === kind).length / around.length;
  }
  return found;
}

/** "segregation": the mean of the residents' shares, with no value when no resident has a share. */
function segregation(state: Neighbourhood): number | null {
  const given = Object.values(shares(state));
  if (given.length === 0) return null;
  return given.reduce((sum, share) => sum + share, 0) / given.length;
}

/** The neighbourhood scenario. */
export const neighbourhoodScenario: Scenario<Neighbourhood> = {
  name: "neighbourhood",
  agents: residentsOf,
  // Each resident in turn takes an empty cell drawn from the replica's sequence.
  initialState: (configuration, random) => {
    const { width, height } = sizesOf(configuration);
    let grid = emptyGrid(width, height, 1);
    const kinds: Record<string, Kind> = {};
    for (const resident of residentsOf(configuration)) {
      const cell = randomEmptyCell(grid, random);
      if (cell === undefined) throw new Error(`the ${width} by ${height} grid has no empty cell left for ${resident}`);
      grid = place(grid, resident, cell);
      kinds[resident] = kindOf(configuration, resident);
    }
    const settings = configuration as { look_radius: number; ms_per_look: number; ms_per_cell: number };
    return { grid, kinds, moves: 0, lookRadius: settings.look_radius, msPerLook: settings.ms_per_look, msPerCell: settings.ms_per_cell };
  },
  tools: [look, move],
  channels: (configuration) => {
    const { source, text } = configuration.rhythm as { source: string; text: string };
    return [{ name: RHYTHM_CHANNEL, source, stimulus: text }];
  },
  metrics: { shares, segregation, moves: (state) => state.moves },
  // It describes the resident and its kind, then the world's rules; a preference or rule comes only from the
  // configuration, which a condition sets (FR-NEIGHBOURHOOD-01).
  systemPrompt: (configuration, resident) => {
    const description = `You are "${resident}", a resident of a neighbourhood. Your kind is "${kindOf(configuration, resident)}".`;
    const rule = configuration.rule as string;
    const parts = [description, configuration.world_rules as string, ...(rule === "" ? [] : [rule])];
    return parts.join("\n\n");
  },
  // Every resident waits an interval drawn uniformly between the configured bounds; a condition may change them.
  rhythm: (configuration) => {
    const { min_ms: minMs, max_ms: maxMs } = configuration.rhythm as { min_ms: number; max_ms: number };
    return (random) => minMs + random.next() * (maxMs - minMs);
  },
  describeRhythm: (configuration) => {
    const { min_ms: minMs, max_ms: maxMs } = configuration.rhythm as { min_ms: number; max_ms: number };
    return `An interval drawn uniformly between ${minMs} and ${maxMs} ms before each activation.`;
  },
  baseConfiguration: [
    "width = 6",
    "height = 6",
    "residents = 10",
    'world_rules = "Each cell holds one resident. Doing nothing leaves you where you are."',
    'rule = ""',
    "look_radius = 1",
    "ms_per_look = 100",
    "ms_per_cell = 100",
    "[rhythm]",
    'source = "rhythm"',
    'text = "You wake up."',
    "min_ms = 0",
    "max_ms = 1000",
    "",
  ].join("\n"),
};
