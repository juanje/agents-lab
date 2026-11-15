import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type TomlTable, parse } from "smol-toml";
import { type Part, type PartsProvided, minutesOf, minutesOfText, minutesText, readParts } from "../engine/parts.ts";
import type { Configuration, Scenario } from "../engine/scenario.ts";
import { indexOf, linesOf } from "./runs.ts";

/** What a re-evaluation wrote: each run's parts file, and each part it could not evaluate, by run, with the time it needed. */
export interface Reevaluation {
  written: string[];
  notEvaluated: { run: string; part: string; at: string }[];
}

/** A line of a run's log, as a re-evaluation reads it. */
type Line = Record<string, unknown>;

/** A state the run kept (FR-CONGRESS-24): the evaluation time, as part lines give it, and the world's state then. */
interface Kept<State> {
  at: string;
  state: State;
}

/**
 * When a part is evaluated in a run: its time; the run's end, which is the last time the run kept a state; or its
 * event's first time in the last state kept, and the minutes after it. Also how a report names that time when the run
 * gives none.
 */
function timeOf<State>(part: Part, kept: readonly Kept<State>[], provided: PartsProvided<State>): { at?: string; named: string } {
  const { evaluateAt } = part;
  const last = kept.at(-1);
  if (evaluateAt === "end") return { ...(last === undefined ? {} : { at: last.at }), named: "the run's end" };
  if ("at" in evaluateAt) return { at: minutesText(evaluateAt.at), named: minutesText(evaluateAt.at) };
  const named = `its event "${evaluateAt.event}"`;
  const found = last === undefined ? undefined : provided.events[evaluateAt.event](last.state, evaluateAt.params);
  return found === undefined ? { named } : { at: minutesText(minutesOf(found) + evaluateAt.afterMinutes), named };
}

/**
 * A part's line, evaluated on the state the run kept at its time: whether it was active, by its activation's event in
 * that state; whether it held, the moment the predicate gives it was reached, its values and the traps that hold. What the
 * agents did is the run's own, so its effort and misapplications are those of the run's line for the part, or none. The
 * line says it was re-evaluated, since a reached_at the predicate does not give cannot be read from one state.
 */
function lineOf<State>(part: Part, { at, state }: Kept<State>, provided: PartsProvided<State>, own: Line | undefined): Line {
  const minutes = minutesOfText(at) ?? Number.NaN;
  const grouped = part.group === undefined ? {} : { group: part.group };
  const line = { type: "part", part: part.id, evaluated_at: at };
  const activeAt = part.activation === "always" ? undefined : provided.events[part.activation.event](state, part.activation.params);
  if (part.activation !== "always" && (activeAt === undefined || minutesOf(activeAt) > minutes)) return { ...line, active: false, ...grouped, reevaluated: true };
  const reading = provided.predicates[part.predicate](state, part.params);
  const held = typeof reading === "boolean" ? reading : reading.holds;
  const reachedAt = held && typeof reading !== "boolean" && reading.reachedAt !== undefined ? { reached_at: minutesText(reading.reachedAt) } : {};
  const traps = part.traps.length === 0 ? {} : { traps: part.traps.filter(({ trap, params }) => provided.traps?.[trap](state, params, minutes) === true).map(({ trap }) => trap) };
  const values = typeof reading === "boolean" || reading.values === undefined ? {} : { values: reading.values };
  return {
    ...line,
    active: true,
    held,
    ...reachedAt,
    effort: own?.effort ?? { calls: 0, money: 0 },
    misapplications: own?.misapplications ?? [],
    ...traps,
    ...values,
    ...grouped,
    reevaluated: true,
  };
}

/**
 * Re-evaluates parts on the runs of a directory (FR-CONGRESS-24): for each run of its index, the parts file is read
 * against the run's scenario, by its name in the library, and the participants of its configuration, with no kind
 * factor; each part is evaluated on the `parts_state` line the run kept at its time. It writes `<run id>.parts.jsonl`
 * beside each run's log, with a part line for each part evaluated and, when some were not, a `parts_not_evaluated`
 * line; the log is never changed. A part whose time has no `parts_state` line is not evaluated, and is given back with
 * its run. It refuses a directory without an index, naming it as given, and a run whose scenario is not in the library,
 * provides no parts or cannot follow the parts file, naming the run.
 */
export function reevaluateRuns(directory: string, partsFile: string, scenarios: ReadonlyMap<string, Partial<Scenario<unknown>>>, name: string = directory): Reevaluation {
  let written: Line[];
  try {
    written = ((parse(readFileSync(partsFile, "utf8")) as TomlTable).parts ?? []) as Line[];
  } catch (error) {
    throw new Error(`The parts file "${partsFile}" cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result: Reevaluation = { written: [], notEvaluated: [] };
  for (const { runId } of indexOf(directory, name)) {
    const log = linesOf<Line>(join(directory, `${runId}.jsonl`));
    const setup = log.find((line) => line.type === "run_setup");
    if (setup === undefined) throw new Error(`Run "${runId}"'s log has no setup line`);
    const scenario = scenarios.get(String(setup.scenario));
    const provided = scenario?.parts;
    if (provided === undefined) throw new Error(`Run "${runId}"'s scenario "${String(setup.scenario)}" is not in the library or provides no parts`);
    const configuration = (setup.configuration ?? {}) as Configuration;
    const groups = scenario?.partyGroups?.(configuration);
    let parts: Part[];
    try {
      parts = readParts(written, provided, { participants: Object.keys((configuration.participants ?? {}) as object), ...(groups === undefined ? {} : { groups }) });
    } catch (error) {
      throw new Error(`Run "${runId}": ${error instanceof Error ? error.message : String(error)}`);
    }
    const kept: Kept<unknown>[] = log.filter((line) => line.type === "parts_state").map((line) => ({ at: String(line.evaluated_at), state: line.state }));
    const own = new Map(log.filter((line) => line.type === "part").map((line) => [String(line.part), line]));
    const lines: Line[] = [];
    const left: string[] = [];
    for (const part of parts) {
      const { at, named } = timeOf(part, kept, provided);
      const found = kept.find((each) => each.at === at);
      if (found === undefined) {
        left.push(part.id);
        result.notEvaluated.push({ run: runId, part: part.id, at: named });
        continue;
      }
      lines.push(lineOf(part, found, provided, own.get(part.id)));
    }
    if (left.length > 0) lines.push({ type: "parts_not_evaluated", parts: left });
    const path = join(directory, `${runId}.parts.jsonl`);
    writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    result.written.push(path);
  }
  return result;
}
