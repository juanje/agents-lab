import { CUT_OFF } from "./adapter.ts";
import type { ChangesSinceSensing } from "./changes.ts";
import { waitAtLeast } from "./clock.ts";
import type { Random } from "./random.ts";
import type { Action, World } from "./world.ts";

/** A component's action as it is checked and applied: the component that acts, and the moment it lands, by `performance.now()`. */
export interface ComponentLanding {
  component: string;
  atMs: number;
}

/**
 * A component's next step: a wait, an action that takes its duration and is then checked and applied through the
 * arbiter as an effector's is (FR-TOOL-04), or the end of its cycle.
 */
export type Step<State> =
  | { kind: "wait"; ms: number }
  | { kind: "action"; name: string; durationMs: number; action: Action<State, ComponentLanding> }
  | { kind: "end" };

/**
 * A component's life cycle in one run: it chooses each next step from the world's state and the outcome of its last
 * action, undefined before its first.
 */
export interface Cycle<State> {
  next(state: State, outcome: string | undefined): Step<State>;
}

/**
 * A part of the world besides the agents that follows its own life cycle and calls no model (FR-PROCESS-01): part of the
 * world, or an external perturbation, as the configuration declares it.
 */
export interface Component<State> {
  name: string;
  kind: "world" | "perturbation";
  /** Its cycle, as the inventory describes it. */
  description: string;
  /** Its cycle for one run, drawing any chance from the component's own random sequence. */
  cycle(random: Random): Cycle<State>;
}

/** One action of a component, as the run's log records it (FR-PROCESS-01). */
export interface ComponentAction {
  component: string;
  action: string;
  startedAtMs: number;
  endedAtMs: number;
  outcome: string;
}

/** What a component runs in: the world, its own random sequence, the run's end, the changes since sensing and the log. */
export interface ComponentRun<State> {
  world: World<State>;
  random: Random;
  /** Aborts when the run ends: its time limit passes (FR-CLOCK-02) or it stops on an error. */
  runEnd: AbortSignal;
  changes: ChangesSinceSensing;
  record(action: ComponentAction): void;
}

/**
 * Runs a component's cycle until it ends or the run does. Each action takes its duration, then is checked and applied
 * through the arbiter against the world as it is then, as an effector's is (FR-TOOL-04), counted by the component's name
 * among the changes since sensing, and recorded; its cycle learns its outcome before it chooses again. An action the
 * run's end cuts short applies nothing and is recorded `cut_off` (FR-CLOCK-02).
 */
export async function runComponent<State>(component: Component<State>, { world, random, runEnd, changes, record }: ComponentRun<State>): Promise<void> {
  const cycle = component.cycle(random);
  let outcome: string | undefined;
  while (!runEnd.aborted) {
    const step = cycle.next(world.state, outcome);
    outcome = undefined;
    if (step.kind === "end") return;
    if (step.kind === "wait") {
      await waitAtLeast(step.ms, runEnd);
      continue;
    }
    const startedAtMs = performance.now();
    await waitAtLeast(step.durationMs, runEnd);
    if (runEnd.aborted) {
      outcome = CUT_OFF;
    } else {
      const result = world.apply(step.action, { component: component.name, atMs: performance.now() });
      if (result.applied) changes.applied(component.name);
      outcome = result.applied ? "success" : result.reason;
    }
    record({ component: component.name, action: step.name, startedAtMs, endedAtMs: performance.now(), outcome });
  }
}
