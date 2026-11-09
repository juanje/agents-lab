# agents-lab — Specification

**Status:** draft. The person owns this contract. FRs are built only after their scenarios are approved and committed as `spec(FR-…)`.

## Purpose

agents-lab runs reproducible experiments with AI agents as agents in complex systems. Each experiment places one or more agents in a world, lets them act without turns on what they perceive locally, and records everything needed to measure the outcome from the world's state. The core grows one milestone at a time, each driven by one experiment.

## Scope

**In (v0.1):** the core needed to run E13 (Schelling with LLM agents):
- a world with an arbiter and a version counter;
- agent loops with their own rhythm;
- local perception with information switches;
- declared actions;
- the Pi and Scripted adapters;
- the recorder, the environment inventory and the generic metrics;
- the runner;
- the Schelling scenario.

**Out:**
- everything listed under later milestones until its FRs are written;
- a user interface or live visualization;
- distributed execution;
- a general agent-based modelling library;
- human-like scaffolding (moods, needs named after human life, violence tools) unless a scenario declares it as the variable under study.

## Milestones

| Milestone | Experiment | FRs | State |
|:--|:--|:--|:--|
| v0.1 | E13 micro vs macro (Schelling) | below, in this build order | to build |
| v0.2 | E16 model monoculture and vote visibility | not written | later |
| v0.3 | A single-agent experiment with tools and memory (E15 or E7) | not written | later |
| v0.4 | World and agent forks | not written | later |

**v0.1 build order.** The first slice is the thinnest end-to-end run. Each later FR deepens one piece:
1. FR-WORLD-01
2. FR-ACTION-01
3. FR-ADAPTER-01
4. FR-CLOCK-01
5. FR-SCHELLING-01
6. FR-SCHELLING-02
7. FR-RECORD-01
8. FR-CLOCK-02
9. FR-PERCEPTION-01
10. FR-SCHELLING-03
11. FR-METRIC-01
12. FR-RECORD-02
13. FR-INVENTORY-01
14. FR-ADAPTER-02
15. FR-RUN-01
16. FR-RUN-02
17. FR-RUN-03

## Invariants

- An action changes the world only if its precondition holds at the moment it is applied.
- The world's version grows by exactly one for each applied action and never otherwise.
- In the Schelling world, a cell holds at most one resident, and the number of residents never changes during a run.
- A run never writes to an existing file.
- Every recorded decision has exactly one outcome, from the declared set.
- Every metric is computed from the world's state, never by a model.

## Requirements

### Functional

#### FR-WORLD-01: Actions are applied one at a time against the current state
The world applies one action at a time. When an action's precondition holds at that moment, its effect is applied and the world's version grows by one. When it does not hold, the state does not change and the result is a failure carrying the action's named reason.
*Why:* experiments measure what happens when agents act on a state that changed while they decided; an action checked against an older state would hide those collisions.

#### FR-ACTION-01: Actions are declared, and unknown answers apply nothing
A scenario declares each action with its name, the description the agent sees, its arguments and its failure reasons. An agent's answer that matches no declared action applies nothing and is recorded with the outcome `unparsed`.
*Why:* a guessed action would put the platform's reading in place of the agent's behaviour; unparsed answers must be counted, not repaired.

#### FR-ADAPTER-01: The Scripted adapter answers from a script
The Scripted adapter returns, for each agent, the answers listed in its script, in order, each after the delay the script gives. When the script runs out, the agent's decision is recorded with the outcome `script_exhausted` and nothing is applied.
*Why:* the core must be testable without calling a model, deterministically.

#### FR-CLOCK-01: Each agent runs its own loop
Each agent repeats its own cycle: wait an interval drawn from its rhythm, observe, decide, then act. No agent waits for another agent's decision. While one agent decides, the others go on observing and acting.
*Why:* real complex systems have no turns (NFR-01); a scheduler that orders agents removes stale decisions and collisions from every result.

#### FR-SCHELLING-01: A Schelling world from a seed
A Schelling scenario creates a grid of the configured width and height and places the configured number of residents of two kinds on distinct random cells. The same seed always gives the same placement.
*Why:* replicas differ only by their seed, and a condition must be compared against the same starting worlds.

#### FR-SCHELLING-02: Residents stay, move near or move far
A resident can do three things:
- **STAY** applies nothing and succeeds.
- **MOVE dx dy** moves it to the cell at that offset when the cell is inside the grid, inside the resident's view, and empty at the moment the action is applied. It fails with `taken_while_deciding` when the cell was empty when the resident observed but is occupied now. It fails with `invalid_target` otherwise.
- **FAR** moves it to a random cell that is empty at the moment the action is applied. It fails with `no_empty_cell` when there is none.

*Why:* separating a collision from a misread target is what lets E13 tell the effect of other agents' timing from the agent's own errors.

#### FR-RECORD-01: Every decision is recorded
Each run writes one new JSONL file, named with the run id. Each decision of each agent adds one line with:
- the agent and the time it observed;
- the prompt and the raw answer;
- the parsed action and the outcome;
- the time spent waiting for a model slot, and the model latency;
- the number of changes other agents applied between its observation and its action.

*Why:* every analysis of an experiment is done from this log, and a field not recorded cannot be recovered later.

#### FR-CLOCK-02: A run ends at its budget or its time limit
A run ends when every agent has used its decision budget or when its time limit passes, whichever comes first. A decision still pending at the time limit is recorded with the outcome `cut_off` and is not applied.
*Why:* a run must end in a known state, and an action applied after the end would change a world that was already measured.

#### FR-PERCEPTION-01: An agent observes only its window
An agent's observation contains only the cells within its view radius around it: its own kind, the other kind, empty and outside the grid each marked distinctly. Text gated by an information switch appears only when the condition turns the switch on.
*Why:* situated perception (NFR-02) is a requirement of every experiment, and information switches are how conditions change what the agent knows.

#### FR-SCHELLING-03: Segregation and dissatisfaction are measured from the grid
The Schelling scenario reports four metrics at the start of a run, at a configured interval and at the end:
- **segregation:** the mean, over residents with at least one neighbour, of the share of their eight neighbours that are of their kind;
- **dissatisfied:** the number of residents whose share is below the condition's threshold;
- **tried_to_move_while_satisfied:** the number of decisions to move taken while the resident's share was at or above the threshold;
- **stayed_while_dissatisfied:** the number of decisions to stay taken while it was below.

*Why:* E13 compares the system-level pattern with what each agent declared; the last two metrics measure how far behaviour departs from the stated rule.

#### FR-METRIC-01: Generic metrics for every run
At the end of every run the core reports:
- decisions per agent;
- outcome counts by outcome;
- mean and maximum model latency and wait for a slot;
- the number of decisions taken on a state that had changed.

*Why:* these show whether a run behaved as a run without turns before its scenario metrics are read.

#### FR-RECORD-02: A run records what it ran
The first line of each run's log holds:
- the resolved configuration and the condition's name;
- the seeds and the model;
- the commit of the code;
- the environment inventory.

*Why:* a result cannot be reproduced or checked without the exact setup that produced it.

#### FR-INVENTORY-01: The environment inventory is generated, not written by hand
For a scenario and a condition, the core writes `inventory.md`, listing:
- the system prompt;
- the actions with the descriptions the agent sees;
- the information switches and their values;
- the limits (view radius, decision budget, time limit, parallelism limit);
- what the agent is told about itself;
- the per-decision variations.

`lab inventory <experiment.toml>` prints it without running.
*Why:* the lab reviews what each environment pushes agents to do before running, and a hand-written list drifts from the code.

#### FR-ADAPTER-02: The Pi adapter calls one model per decision
The Pi adapter makes one `pi -p` call per decision, with the scenario's system prompt and the observation, using the model from the configuration. The prompt never names the model unless the condition says so.
- **Parallelism limit:** a decision waits for a free slot when the configured number of calls is already running.
- **Timeout:** a call longer than the timeout is stopped and recorded with the outcome `timeout`, and nothing is applied.

*Why:* agents are compared across models through one interface, and a hung call must not block a run.

#### FR-RUN-01: An experiment runs every condition, model and replica
`lab run <experiment.toml>` runs each condition with each model, for the configured number of replicas, one after another, each replica with its own seed. It fails before any model call when the file names an unknown scenario, condition or model, with an error that names it.
*Why:* an experiment is the full grid of conditions and models, and a typo found after an hour of model calls wastes the run.

#### FR-RUN-02: Summaries across replicas
`lab summarize <runs-dir>` prints one row per condition and model, with the mean and range of each metric across replicas and the number of replicas.
*Why:* hypotheses are judged on distributions across replicas, not on single runs.

#### FR-RUN-03: One experiment at a time
`lab run` refuses to start, with an error that says another run is active, while another `lab run` on the same machine holds the lock.
*Why:* concurrent runs sharing one Pi login stall every model call.

### Non-functional

#### NFR-01: No turns
No component orders agents or makes one wait for another's decision. Waiting may appear only through what agents do.
*Why:* real complex systems are concurrent; imposed turns produce laboratory results, not results about the system.

#### NFR-02: Situated perception
An agent receives only what its scenario's perception gives it from where it is. Global information appears only as an explicit information switch.
*Why:* in complex systems each agent perceives differently; global information erases the differences the experiments study.

#### NFR-03: Ground truth in code
World state, rules and metrics are code. No model decides what happens in the world or scores an outcome.
*Why:* a measure that depends on a model's reading cannot be checked or reproduced.

#### NFR-04: Everything the agent meets is declared
Every text, action, switch, limit and variation an agent meets comes from the scenario or the condition and appears in the inventory.
*Why:* undeclared pressures are the most common hidden cause of a result.

#### NFR-05: A condition is one named change
A condition is a named change over the scenario's base configuration, and its name and change are recorded in each run.
*Why:* a difference between conditions can be attributed only when each changes one thing.

#### NFR-06: Tests never call a model
The test suite and the gate run with the Scripted adapter only. A real model runs only in a smoke test, outside the gate.
*Why:* tests must be deterministic, free and runnable offline.

## Draft notes

- v0.2 will need, at least:
  - channels with topology and delay;
  - event masks with pending observations;
  - votes with a deadline.
- v0.3 will need the Pi adapter in RPC mode, with a workspace per agent and a Pi extension that exposes lab actions as tools. The transport between the extension and the core is open.
- Open: whether real time is enough for E16's vote deadlines to be repeatable, or simulated time is needed.
