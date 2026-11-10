# agents-lab — Specification

**Status:** draft. The person owns this contract. FRs are built only after their scenarios are approved and committed as `spec(FR-…)`.

## Purpose

agents-lab is the code that runs reproducible experiments with AI agents as agents in complex systems. It has three parts:
- **the engine**, which places agents in a scenario's world, lets them act without turns on what they perceive locally, and records everything needed to measure the outcome from the world's state;
- **a library of reusable scenarios**;
- **the analysis of the logs.**

Experiments are written outside this repository, in the experiment language (FR-EXPERIMENT-01 to 04). The code grows one milestone at a time; each milestone adds what the next experiment needs.

## Scope

**In (v0.1):** what the E13 experiment (Schelling with LLM agents) needs:
- a world with an arbiter and a version counter;
- a scenario interface and its loading;
- a grid space;
- agent loops with their own rhythm;
- local perception with information switches;
- declared actions, with failures that tell a collision from an invalid choice;
- seeded randomness;
- the Pi adapter, with a scripted model for tests;
- the recorder, the environment inventory, and the generic and scenario metrics;
- the experiment language and the runner;
- the neighbourhood scenario, in the scenario library;
- summaries across replicas and CSV export.

**Out:**
- **Experiments:** experiment files, materials, designs and results live in the experiments repository (D-07). The engine's tests use small test scenarios of their own.
- **Later milestones:** everything listed under them until its FRs are written.
- **Other uses:**
  - a user interface or live visualization;
  - distributed execution;
  - a general agent-based modelling library.
- **Human-like scaffolding** (moods, needs named after human life, violence tools) is never provided by the engine.

## Milestones

| Milestone | Needed by | FRs | State |
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
5. FR-SCENARIO-01
6. FR-SEED-01
7. FR-SPACE-01
8. FR-ACTION-02
9. FR-RECORD-01
10. FR-CLOCK-02
11. FR-PERCEPTION-01
12. FR-METRIC-01
13. FR-METRIC-02
14. FR-RECORD-02
15. FR-INVENTORY-01
16. FR-ADAPTER-02
17. FR-EXPERIMENT-01
18. FR-EXPERIMENT-02
19. FR-EXPERIMENT-03
20. FR-EXPERIMENT-04
21. FR-RUN-01
22. FR-RUN-02
23. FR-RUN-03
24. FR-NEIGHBOURHOOD-01
25. FR-NEIGHBOURHOOD-02
26. FR-NEIGHBOURHOOD-03
27. FR-ANALYSIS-01

## Invariants

- An action changes the world only if its precondition holds at the moment it is applied.
- The world's version grows by exactly one for each applied action and never otherwise.
- A grid cell never holds more entities than its capacity.
- A run never writes to an existing file.
- Every recorded decision has exactly one outcome, from the declared set.
- Every metric is computed from the world's state, never by a model.

## Requirements

### Functional

#### FR-WORLD-01: Actions are applied one at a time against the current state
The world applies one action at a time. When an action's precondition holds at that moment, its effect is applied and the world's version grows by one. When it does not hold, the state does not change and the result is a failure carrying the action's named reason.
*Why:* experiments measure what happens when agents act on a state that changed while they decided; an action checked against an older state would hide those collisions.

#### FR-ACTION-01: Actions are declared, and unknown answers apply nothing
A scenario declares each action with its name, the description the agent sees, its arguments and its failure reasons. An agent's answer that matches no declared action applies nothing and is recorded with the outcome `unparsed`. An answer that names a declared action with arguments that action does not take applies nothing and is recorded with the outcome `invalid_arguments`.

An answer is read by one rule, the same for every scenario:
- lines end in `\n` or `\r\n`;
- the action is the answer's last line that holds anything besides whitespace;
- whitespace at the start and end of that line is dropped, and any run of whitespace inside it counts as one space;
- the action's name is matched without regard to case.

Nothing else is repaired. The raw answer is always recorded.
*Why:* a guessed action would put the platform's reading in place of the agent's behaviour; malformed answers must be counted, not repaired, and an answer that picks a real action badly is a different behaviour from one that picks none. The reading rule ignores only layout (reasoning before the action, spacing, case), so `unparsed` measures behaviour in the world rather than formatting.

#### FR-ADAPTER-01: A scripted model answers in tests
In tests, each agent's model is Pi's faux provider. It returns, in order, the answers listed in the agent's script, each after the delay the script gives. When the script runs out, the agent's decision is recorded with the outcome `script_exhausted` and nothing is applied.
*Why:* the core must be testable deterministically and offline, through the same harness path real runs use.

#### FR-CLOCK-01: Each agent runs its own loop
Each agent repeats its own cycle: wait an interval drawn from its rhythm, observe, decide, then act. No agent waits for another agent's decision. While one agent decides, the others go on observing and acting.
*Why:* real complex systems have no turns (NFR-01); a scheduler that orders agents removes stale decisions and collisions from every result.

#### FR-SCENARIO-01: A scenario plugs into the engine
A scenario provides:
- its world's initial state;
- its perception;
- its actions;
- its metrics;
- its system prompt;
- a base configuration in TOML.

A condition is a TOML change over that base configuration. The engine refuses to run a scenario that lacks one of these parts, with an error that names the missing part.
*Why:* experiments live outside the engine, and a scenario that loads with a missing part fails only after model calls have been spent.

#### FR-SEED-01: One seed gives the same start
Each replica gets one seeded random source. The scenario's initial state and every agent's rhythm draw from it, so the same seed gives the same initial world and the same sequence of waiting intervals.
*Why:* replicas differ only by their seed and the model's answers, and conditions are compared against the same starting worlds.

#### FR-SPACE-01: A grid space
The engine provides a grid of a given width and height, with a capacity per cell. It answers four questions:
- **neighbours:** the eight neighbouring cells of a position;
- **window:** the cells within a radius of a position, with the cells outside the grid marked as outside;
- **random empty cell:** a random empty cell, drawn from the replica's random source, or none when there is none;
- **move:** moves an entity from one cell to another. It fails with `cell_full` when the destination is at capacity.

*Why:* several of the lab's scenarios are spatial, and a shared grid keeps neighbourhoods and views the same across them.

#### FR-ACTION-02: An action can tell a collision from an invalid choice
When an action is applied, it receives the current state and the state the agent observed. It can therefore fail with a reason saying the target changed after the agent observed it, as distinct from a reason saying the target was never valid.
*Why:* separating the effect of other agents' timing from the agent's own errors is what experiments without turns measure.

#### FR-RECORD-01: Every decision is recorded
Each run writes one new JSONL file, named with the run id. Each decision of each agent adds one line with:
- the agent and the time it observed;
- the prompt and the raw answer;
- the parsed action and the outcome;
- the time spent waiting for a model slot, and the model latency;
- the model that answered, and the tokens and cost Pi reports;
- the number of changes other agents applied between its observation and its action.

*Why:* every analysis of an experiment is done from this log, and a field not recorded cannot be recovered later.

#### FR-CLOCK-02: A run ends at its budget or its time limit
A run ends when every agent has used its decision budget or when its time limit passes, whichever comes first. A decision still pending at the time limit is recorded with the outcome `cut_off` and is not applied.
*Why:* a run must end in a known state, and an action applied after the end would change a world that was already measured.

#### FR-PERCEPTION-01: An agent observes only what its perception gives it
An agent's observation is what the scenario's perception returns for that agent at that moment, and nothing else. Text gated by an information switch appears only when the condition turns the switch on.
*Why:* situated perception (NFR-02) is a requirement of every experiment, and information switches are how conditions change what the agent knows.

#### FR-METRIC-01: Generic metrics for every run
At the end of every run the core reports:
- decisions per agent;
- outcome counts by outcome;
- mean and maximum model latency and wait for a slot;
- the number of decisions taken on a state that had changed.

*Why:* these show whether a run behaved as a run without turns before its scenario metrics are read.

#### FR-METRIC-02: Scenario metrics are sampled on a schedule
The engine computes the scenario's metrics from the world's state at the start of a run, at the interval the configuration gives, and at the end, and writes each sample to the log.
*Why:* experiments compare how a system-level pattern develops, not only where it ends.

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
- the actions with the descriptions the agent sees, and the rule that reads an answer;
- the information switches and their values;
- the limits (view radius, decision budget, time limit, parallelism limit);
- what the agent is told about itself;
- the per-decision variations.

`lab inventory <experiment.toml>` prints it without running.
*Why:* the lab reviews what each environment pushes agents to do before running, and a hand-written list drifts from the code.

#### FR-ADAPTER-02: Each decision is one stateless Pi session
For each decision, the core opens a Pi session in memory, using the model from the configuration. The session has:
- the scenario's system prompt in place of Pi's own;
- no built-in tools;
- the observation as the prompt.

The session's answer is the decision's answer. The prompt never names the model unless the condition says so. The scripted model of FR-ADAPTER-01 runs through this same session, registered with Pi's model runtime like any other model.
- **Model errors:** when the provider answers with an error instead of an answer, the decision is recorded with the outcome `model_error` and the provider's message, and nothing is applied.
- **Parallelism limit:** a decision waits for a free slot when the configured number of calls is already running.
- **Timeout:** a session that runs longer than the timeout is aborted and recorded with the outcome `timeout`, and nothing is applied.

*Why:* agents are compared across models through one harness the core controls; a hung call must not block a run; and a provider's failure is not the agent's behaviour, so it must not be counted as an `unparsed` answer.

#### FR-EXPERIMENT-01: An experiment file names its scenario, conditions, models and replicas
An experiment file (TOML) gives:
- its id;
- the scenario it runs;
- the models;
- the number of replicas and the base seed;
- the run limits (time, decisions per agent, parallelism, timeout);
- its conditions, each a named change over the scenario's base configuration.

The engine validates the file against the experiment schema before anything runs. An invalid file fails with an error that names the field and what was expected.
*Why:* people write these files to design experiments, and an error found after model calls wastes the run.

#### FR-EXPERIMENT-02: Factors expand into conditions
An experiment file can declare factors, each a name with levels. Each level is a named change. The engine runs every combination of levels as one condition, named after its levels (for example `composition=mixed,votes=hidden`). A condition named `baseline`, with no change, is added unless the file turns it off.
*Why:* the lab's designs are factorial, and every experiment needs a condition without changes, repeated, as its noise baseline.

#### FR-EXPERIMENT-03: An experiment states its prediction before it runs
An experiment file gives:
- the hypothesis it tests;
- its prediction;
- what would refute it.

`lab run` refuses to start when any of the three is missing, with an error that names it. The three go into every run's log.
*Why:* the lab's protocol requires the prediction and its refutation to be written before running. The commit of the file, together with the logs, shows that they came first.

#### FR-EXPERIMENT-04: Materials are files, referenced and fingerprinted
An experiment or a condition can reference materials by path, relative to the experiment file:
- texts for the system prompt or the observations;
- variation sets;
- seeded memory;
- held-out keys.

The engine reads them at run time, writes each path with a content hash to the run's log, and lists them in the inventory, except files marked as held out, which are listed by name only. A referenced file that does not exist fails the run before it starts.
*Why:* texts are reviewed and changed as files, and a result must say exactly which version of each text produced it.

#### FR-RUN-01: An experiment runs every condition, model and replica
`lab run <experiment.toml>` runs each condition with each model, for the configured number of replicas, one after another, each replica with its own seed. It fails before any model call when the file names an unknown scenario, condition or model, with an error that names it.
*Why:* an experiment is the full grid of conditions and models, and a typo found after an hour of model calls wastes the run.

#### FR-RUN-02: Summaries across replicas
`lab summarize <runs-dir>` prints one row per condition and model, with the mean and range of each metric across replicas and the number of replicas.
*Why:* hypotheses are judged on distributions across replicas, not on single runs.

#### FR-RUN-03: One experiment at a time
`lab run` refuses to start, with an error that says another run is active, while another `lab run` on the same machine holds the lock.
*Why:* two processes making model calls with the same Pi login at the same time stalled every call, and two experiments on one machine would share its parallelism limit without recording it.

### Scenario library

#### FR-NEIGHBOURHOOD-01: A neighbourhood from a seed
The neighbourhood scenario creates a grid of the configured width and height and places the configured number of residents of two kinds on distinct random cells, from the replica's seed. Its system prompt only describes the place and the actions; any preference or rule a resident is given comes from the condition.
*Why:* the same neighbourhood serves several experiments (micro vs macro, diversity of thresholds or models, local vs global view), each of which brings its own rule as a condition.

#### FR-NEIGHBOURHOOD-02: Residents stay, move near or move far
A resident can do three things:
- **STAY** applies nothing and succeeds.
- **MOVE dx dy** moves it to the cell at that offset when the cell is inside the grid, inside its view, and empty when the action is applied. It fails with `taken_while_deciding` when the cell was empty when the resident observed but is occupied now, and with `invalid_target` otherwise.
- **FAR** moves it to a random cell that is empty when the action is applied. It fails with `no_empty_cell` when there is none.

Its observation is its window of the configured radius, with its own kind, the other kind, empty and outside the grid marked distinctly.
*Why:* separating a collision from a misread target is what lets experiments tell the effect of other agents' timing from the agent's own errors.

#### FR-NEIGHBOURHOOD-03: Same-kind shares
The neighbourhood scenario's metrics are:
- **shares:** for each resident with at least one neighbour, the share of its eight neighbours that are of its kind;
- **segregation:** the mean of those shares;
- **moves:** the number of applied moves.

*Why:* experiments read the system-level pattern from the shares. A measure that depends on a rule given to the residents, such as how many fall below a threshold, is computed by that experiment's analysis from the shares and the decisions.

### Analysis

#### FR-ANALYSIS-01: Logs export as CSV
`lab export <runs-dir>` writes two CSV files:
- **decisions:** one row per decision, with the run's condition, model, replica and seed;
- **metric samples:** one row per metric sample.

The export reads only the logs.
*Why:* an analysis that needs heavier statistics than the built-in summaries can use an outside tool without a second language in the repository (D-02).

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
The test suite and the gate use Pi's faux provider only. A real model runs only in a smoke test, outside the gate.
*Why:* tests must be deterministic, free and runnable offline.

#### NFR-07: The engine never depends on a scenario
Code in `src/engine/` never imports from `src/scenarios/` or `src/analysis/`. Scenarios use only the engine's public interface.
*Why:* an engine shaped by one scenario stops being the same engine for the next experiment, and results across experiments stop being comparable.

#### NFR-08: The lab's Pi is isolated from the person's
Every Pi session the engine opens uses the lab's own Pi directory (`~/.agents-lab/pi/`): its credentials, its model definitions and nothing else. The engine never reads or writes the person's Pi setup (`~/.pi/agent/`): no settings, extensions, skills, prompt templates, themes, context files such as `AGENTS.md`, model definitions or credentials. Session settings come from the experiment's configuration, held in memory.
*Why:* an agent's environment must contain only what the experiment declares (NFR-04); the person's own Pi setup would change the agents without anyone seeing it, and the lab would change the person's coding agent and compete with it for one login.

## Draft notes

- v0.2 will need, at least:
  - channels with topology and delay;
  - event masks with pending observations;
  - votes with a deadline.
- v0.3 will need persistent Pi sessions per agent, a workspace for its memory files, and lab actions as custom tools. `@earendil-works/pi-durable` (experimental in Pi 1.5.0) may help with long runs.
- Open: whether real time is enough for E16's vote deadlines to be repeatable, or simulated time is needed.
