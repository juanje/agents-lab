import type { LogLine } from "../engine/recorder.ts";
import type { ExperimentObserver, IndexLine, StartingRun } from "../engine/runner.ts";

/** What a run has done so far, as its log records it. */
interface Tally {
  run: StartingRun;
  startedAtMs: number;
  activations: number;
  turns: number;
  cost: number;
  /** Prints the run's progress at the interval, until it ends. */
  timer: ReturnType<typeof setInterval>;
}

/**
 * What `lab run` prints while it runs (FR-RUN-04): each run's start, its progress at an interval, its end, and the
 * experiment's totals. What it
 * counts it reads from the lines each run's log records; it writes nothing to the log.
 */
export class Progress implements ExperimentObserver {
  readonly #print: (text: string) => void;
  readonly #now: () => number;
  readonly #intervalMs: number;
  readonly #startedAtMs: number;
  #tally: Tally | undefined;
  #completed = 0;
  #cost = 0;

  /** Prints with `print`, a run's progress every `intervalMs`, timing by `now`, in milliseconds, from now on. */
  constructor(print: (text: string) => void, { intervalMs, now = () => performance.now() }: { intervalMs: number; now?: () => number }) {
    this.#print = print;
    this.#now = now;
    this.#intervalMs = intervalMs;
    this.#startedAtMs = now();
  }

  runStarted(run: StartingRun): void {
    const timer = setInterval(() => this.#printProgress(), this.#intervalMs);
    this.#tally = { run, startedAtMs: this.#now(), activations: 0, turns: 0, cost: 0, timer };
    this.#print(`${runName(run)} started: condition "${run.condition}", model "${run.model}", replica ${run.replica}, seed ${run.seed}\n`);
  }

  #printProgress(): void {
    const tally = this.#current();
    const done = `${tally.activations} of ${tally.run.activations} activations`;
    this.#print(`${runName(tally.run)} running: ${seconds(this.#now() - tally.startedAtMs)}, ${done}, ${counted(tally.turns, "model turn")}, ${cost(tally.cost)}\n`);
  }

  recorded(line: LogLine): void {
    const tally = this.#current();
    if (line.type === "activation") tally.activations += 1;
    if (line.type === "model_turn") {
      tally.turns += 1;
      tally.cost += line.cost.total;
    }
  }

  runEnded(status: IndexLine["status"]): void {
    const tally = this.#current();
    clearInterval(tally.timer);
    this.#tally = undefined;
    if (status === "completed") this.#completed += 1;
    this.#cost += tally.cost;
    const counts = `${counted(tally.activations, "activation")}, ${counted(tally.turns, "model turn")}, ${cost(tally.cost)}`;
    this.#print(`${runName(tally.run)} ${status} in ${seconds(this.#now() - tally.startedAtMs)}: ${counts}\n`);
  }

  /** Prints how many runs completed, how long the experiment took and what it cost. */
  experimentEnded(): void {
    this.#print(`${counted(this.#completed, "run")} completed in ${seconds(this.#now() - this.#startedAtMs)}, ${cost(this.#cost)}\n`);
  }

  #current(): Tally {
    if (this.#tally === undefined) throw new Error("No run has started");
    return this.#tally;
  }
}

/** A run by its number out of the experiment's runs. */
const runName = ({ number, total }: StartingRun) => `Run ${number} of ${total}`;

/** A count with its noun, plural unless it is one. */
const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Milliseconds as seconds, to a tenth. */
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** A cost in dollars, to a hundredth of a cent. */
const cost = (dollars: number) => `cost $${dollars.toFixed(4)}`;
