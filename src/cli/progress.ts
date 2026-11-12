import type { LogLine } from "../engine/recorder.ts";
import type { ExperimentObserver, IndexLine, StartingRun } from "../engine/runner.ts";

/** What a run has done so far, as its log records it. */
interface Tally {
  run: StartingRun;
  startedAtMs: number;
  activations: number;
  turns: number;
  cost: number;
}

/**
 * What `lab run` prints while it runs (FR-RUN-04): when it resumes, the runs already completed and left (FR-RUN-07);
 * each run's start, its progress at an interval, its end, and the experiment's totals. While several runs are in
 * progress, each progress line gives each of them by its number (FR-RUN-06). What it counts it reads from the lines each run's log records; it writes nothing to the log.
 */
export class Progress implements ExperimentObserver {
  readonly #print: (text: string) => void;
  readonly #now: () => number;
  readonly #intervalMs: number;
  readonly #startedAtMs: number;
  /** Each run in progress, by its number. */
  readonly #tallies = new Map<number, Tally>();
  /** Prints the progress of the runs in progress at the interval, while there is any. */
  #timer: ReturnType<typeof setInterval> | undefined;
  #completed = 0;
  #stopped = 0;
  #cost = 0;

  /** Prints with `print`, a run's progress every `intervalMs`, timing by `now`, in milliseconds, from now on. */
  constructor(print: (text: string) => void, { intervalMs, now = () => performance.now() }: { intervalMs: number; now?: () => number }) {
    this.#print = print;
    this.#now = now;
    this.#intervalMs = intervalMs;
    this.#startedAtMs = now();
  }

  resumed({ completed, left }: { completed: number; left: number }): void {
    this.#print(`${counted(completed, "run")} already completed, ${left} left\n`);
  }

  runStarted(run: StartingRun): void {
    this.#timer ??= setInterval(() => this.#printProgress(), this.#intervalMs);
    this.#tallies.set(run.number, { run, startedAtMs: this.#now(), activations: 0, turns: 0, cost: 0 });
    this.#print(`${runName(run)} started: condition "${run.condition}", model "${run.model}", replica ${run.replica}, seed ${run.seed}\n`);
  }

  /** Prints one line with the progress of each run in progress, in the order of their numbers. */
  #printProgress(): void {
    const runs = [...this.#tallies.values()].sort((one, other) => one.run.number - other.run.number).map((tally) => {
      const done = `${tally.activations} of ${tally.run.activations} activations`;
      return `${runName(tally.run)} running: ${duration(this.#now() - tally.startedAtMs)}, ${done}, ${counted(tally.turns, "model turn")}, ${cost(tally.cost)}`;
    });
    this.#print(`${runs.join("; ")}\n`);
  }

  recorded(number: number, line: LogLine): void {
    const tally = this.#tallyOf(number);
    if (line.type === "activation") tally.activations += 1;
    if (line.type === "model_turn") {
      tally.turns += 1;
      tally.cost += line.cost.total;
    }
  }

  runEnded(number: number, status: IndexLine["status"]): void {
    const tally = this.#tallyOf(number);
    this.#tallies.delete(number);
    if (this.#tallies.size === 0) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    if (status === "completed") this.#completed += 1;
    else this.#stopped += 1;
    this.#cost += tally.cost;
    const counts = `${counted(tally.activations, "activation")}, ${counted(tally.turns, "model turn")}, ${cost(tally.cost)}`;
    this.#print(`${runName(tally.run)} ${status} in ${duration(this.#now() - tally.startedAtMs)}: ${counts}\n`);
  }

  /** Prints how many runs completed and how many stopped, how long the experiment took and what it cost. */
  experimentEnded(): void {
    this.#print(`${counted(this.#completed, "run")} completed and ${this.#stopped} stopped in ${duration(this.#now() - this.#startedAtMs)}, ${cost(this.#cost)}\n`);
  }

  #tallyOf(number: number): Tally {
    const tally = this.#tallies.get(number);
    if (tally === undefined) throw new Error(`Run ${number} is not in progress`);
    return tally;
  }
}

/** A run by its number out of the experiment's runs. */
const runName = ({ number, total }: StartingRun) => `Run ${number} of ${total}`;

/** A count with its noun, plural unless it is one. */
const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Milliseconds as a duration: seconds to a tenth under a minute; from a minute on, whole seconds after the minutes,
 * and the hours before them from an hour on.
 */
function duration(ms: number): string {
  const tenths = Math.round(ms / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)} s`;
  const whole = Math.round(ms / 1000);
  const [hours, minutes, rest] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];
  return `${hours > 0 ? `${hours} h ` : ""}${minutes} min ${rest} s`;
}

/** A cost in dollars, to a hundredth of a cent. */
const cost = (dollars: number) => `cost $${dollars.toFixed(4)}`;
