import { CUT_OFF } from "./adapter.ts";
import type { WorldDuration, WorldTime } from "./calendar.ts";
import { type ChangesSinceSensing, applyCounted } from "./changes.ts";
import { type RunClock, waitAtLeast } from "./clock.ts";
import { type MailOf, type MailStep, type Received, mailAction, unreadOf } from "./mail.ts";
import type { Refusal } from "./tools.ts";
import type { Random } from "./random.ts";
import type { Stimuli } from "./stimuli.ts";
import type { Action, World } from "./world.ts";

/**
 * A component's action as it is checked and applied: the component that acts, the moment it lands, by
 * `performance.now()`, and the world's time then, for a run with a calendar (FR-CLOCK-03).
 */
export interface ComponentLanding {
  component: string;
  atMs: number;
  world?: WorldTime;
}

/**
 * A component's next step: a wait, an action that takes its duration and is then checked and applied through the
 * arbiter as an effector's is (FR-TOOL-04), or the end of its cycle.
 */
export type Step<State> =
  | { kind: "wait"; ms: number }
  | {
      kind: "action";
      name: string;
      /** In milliseconds of the run, or as a duration in world time (FR-CLOCK-03). */
      durationMs: number | WorldDuration;
      /**
       * For an action under way in the world, such as crossing a passage, the change it makes as it starts, through the
       * arbiter, as an effector's start (FR-TOOL-04, FR-SPACE-03). It cannot fail: a start the world refuses is a defect
       * of the scenario, and stops the run.
       */
      start?: Action<State, ComponentLanding>;
      action: Action<State, ComponentLanding>;
    }
  | {
      /**
       * Delivers a channel's stimulus to an agent as the component takes the step, taking no time (FR-STIMULUS-01); with
       * `held: false`, not held by its recipient's hours or reply delay, as an illness is not (FR-CONGRESS-04).
       */
      kind: "deliver";
      agent: string;
      channel: string;
      held?: false;
      /** The values that fill the channel's text, by name (FR-POPULATION-01). */
      values?: Readonly<Record<string, string>>;
    }
  /**
   * Sends a message, or reads one of its mailbox, as an agent's send_mail or read_mail does: an action, through the
   * arbiter, with the mail's duration; a message its recipient cannot take is refused as it starts (FR-MESSAGE-01).
   */
  | MailStep
  | { kind: "end" };

/**
 * A component's life cycle in one run: it chooses each next step from the world's state, the outcome of the step before,
 * when that was an action (undefined before its first step and after a wait or a delivery), the time since the run
 * started, the world's time then, for a run with a calendar (FR-CLOCK-03), and its mailbox's unread messages, oldest
 * first, for a run with mail (FR-MESSAGE-01).
 */
export interface Cycle<State> {
  next(state: State, outcome: string | undefined, sinceStartMs: number, world?: WorldTime, unread?: readonly Received[]): Step<State>;
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
  /** Its outcome record, read from the world's state as the run ends, for a component that keeps one (FR-POPULATION-01). */
  outcome?(state: State): Readonly<Record<string, string | number | boolean>>;
}

/** One action of a component, as the run's log records it (FR-PROCESS-01). */
export interface ComponentAction {
  component: string;
  action: string;
  startedAtMs: number;
  endedAtMs: number;
  outcome: string;
}

/**
 * What a component runs in: the world, its own random sequence, the run's time and its end, the changes since sensing and
 * the log.
 */
export interface ComponentRun<State> {
  world: World<State>;
  random: Random;
  clock: RunClock;
  /** Aborts when the run ends: its time limit passes (FR-CLOCK-02) or it stops on an error. */
  runEnd: AbortSignal;
  changes: ChangesSinceSensing;
  /** The run's stimuli, through whose channels a component delivers its own. */
  stimuli: Stimuli;
  /** The run's mail, for a run with one, which a component's cycle reads and its mail steps use (FR-MESSAGE-01). */
  mail?: MailOf<State>;
  record(action: ComponentAction): void;
}

/**
 * Runs a component's cycle until it ends or the run does. A delivery hands its stimulus to the run's stimuli at once,
 * which record it, and is no action. An action's start, if it has one, is applied as it starts and
 * counted by the component's name among the changes since sensing. Each action takes its duration, then is checked and applied
 * through the arbiter against the world as it is then, as an effector's is (FR-TOOL-04), counted by the component's name
 * among the changes since sensing, and recorded; its cycle learns its outcome before it chooses again. An action the
 * run's end cuts short applies nothing and is recorded `cut_off` (FR-CLOCK-02).
 */
export async function runComponent<State>(component: Component<State>, { world, random, clock, runEnd, changes, stimuli, mail, record }: ComponentRun<State>): Promise<void> {
  const cycle = component.cycle(random);
  let outcome: string | undefined;
  while (!runEnd.aborted) {
    const unread = mail === undefined ? undefined : unreadOf(mail, component.name, world.state);
    const chosen = cycle.next(world.state, outcome, clock.sinceStartMs(), clock.worldTime(), unread);
    outcome = undefined;
    const step = chosen.kind === "send" || chosen.kind === "read" ? mailStep(mail, component.name, chosen, world.state) : chosen;
    // A message its recipient cannot take is refused as it starts: it takes no time and is not sent (FR-MESSAGE-01).
    if (step.kind === "refused") {
      const atMs = performance.now();
      outcome = step.refusal.outcome;
      record({ component: component.name, action: step.name, startedAtMs: atMs, endedAtMs: atMs, outcome });
      continue;
    }
    if (step.kind === "end") return;
    if (step.kind === "wait") {
      await waitAtLeast(step.ms, runEnd);
      continue;
    }
    if (step.kind === "deliver") {
      stimuli.deliver(step.agent, step.channel, step.values ?? {}, step.held === false ? { held: false } : {});
      continue;
    }
    const startedAtMs = performance.now();
    if (step.start !== undefined) {
      const started = applyCounted(world, changes, component.name, step.start, { component: component.name, atMs: startedAtMs });
      if (started !== "success") throw new Error(`the start of component "${component.name}"'s action "${step.name}" was refused with "${started}"`);
    }
    await waitAtLeast(clock.runMsOf(step.durationMs), runEnd);
    const landing = { component: component.name, atMs: performance.now(), ...clock.worldTimeKey() };
    outcome = runEnd.aborted ? CUT_OFF : applyCounted(world, changes, component.name, step.action, landing);
    record({ component: component.name, action: step.name, startedAtMs, endedAtMs: performance.now(), outcome });
  }
}

/** A component's mail step as an action of its cycle, or its refusal as it starts; a run without mail cannot take one. */
function mailStep<State>(mail: MailOf<State> | undefined, component: string, step: MailStep, state: State): Extract<Step<State>, { kind: "action" }> | { kind: "refused"; name: string; refusal: Refusal } {
  if (mail === undefined) throw new Error(`component "${component}" took a "${step.kind}" step in a run with no mail`);
  const mailed = mailAction(mail, component, step, state);
  return "refusal" in mailed ? { kind: "refused", ...mailed } : { kind: "action", ...mailed };
}

