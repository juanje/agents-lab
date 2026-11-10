# agents-lab — Specification

**Status:** draft. The person owns this contract. FRs are built only after their scenarios are approved and committed as `spec(FR-…)`.

## Purpose

agents-lab is the code that runs reproducible experiments with AI agents as agents in complex systems. It evaluates agents, not models: each agent is a model in a harness, with memory, that perceives and acts in a world only through its tools. It has three parts:
- **the engine**, which places agents in a scenario's world, lets each one perceive, reflect and act at its own pace through its tools, makes doing things cost time and effort, and records everything needed to measure the outcome from the world's state;
- **a library of reusable scenarios**;
- **the analysis of the logs.**

Experiments are written outside this repository, in the experiment language (FR-EXPERIMENT-01 to 04). The code grows one milestone at a time; each milestone adds what the next experiment needs.

## Scope

**In (v0.1):** what the E13 experiment (Schelling with LLM agents) needs:
- a world with an arbiter and a version counter;
- tools as the agent's only interface: sensors and effectors, each with a duration and an effort;
- stimuli that reach an agent through a declared channel, with their source;
- activations: each agent's own rhythm wakes it, and it works through its tools in a session that lasts the whole run;
- energy that tools spend and that recovers over time, and environment processes;
- a scenario interface and its loading;
- seeded randomness;
- a grid space where moving takes time in proportion to distance;
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
| v0.1 | E13 micro vs macro (Schelling) | below, in this build order | building |
| v0.2 | E16 model monoculture and vote visibility | not written | later |
| v0.3 | A single-agent experiment with tools and memory across runs (E15 or E7) | not written | later |
| v0.4 | World and agent forks | not written | later |

**v0.1 build order.** The first slice is the thinnest end-to-end run. Each later FR deepens one piece. FRs marked *built* are done; FRs marked *rebuild* were built against an earlier version of this SPEC and must be rebuilt against their new contract.
1. FR-WORLD-01 (built)
2. FR-TOOL-01 (built)
3. FR-ADAPTER-02 (built)
4. FR-STIMULUS-01 (built)
5. FR-TOOL-02 (built)
6. FR-ADAPTER-01 (built)
7. FR-CLOCK-01 (rebuild)
8. FR-SCENARIO-01 (rebuild: its parts change)
9. FR-SEED-01 (built)
10. FR-SPACE-01 (built)
11. FR-SMOKE-01 — the basic pieces run with a real model
12. FR-TOOL-03
13. FR-TOOL-04 (was FR-ACTION-02)
14. FR-SPACE-02
15. FR-CLOCK-02
16. FR-RECORD-01
17. FR-NEIGHBOURHOOD-01
18. FR-NEIGHBOURHOOD-02
19. FR-NEIGHBOURHOOD-03
20. FR-EXPERIMENT-01
21. FR-RUN-01 — a first pilot of E13 can run here; what follows makes it a valid experiment
22. FR-PROCESS-01
23. FR-EFFORT-01
24. FR-METRIC-01
25. FR-METRIC-02
26. FR-RECORD-02
27. FR-INVENTORY-01
28. FR-EXPERIMENT-02
29. FR-EXPERIMENT-03
30. FR-EXPERIMENT-04
31. FR-RUN-02
32. FR-RUN-03
33. FR-ANALYSIS-01

## Invariants

- An effector changes the world only if its precondition holds at the moment its effect is applied.
- The world's version grows by exactly one for each applied effect and never otherwise.
- A sensor never changes the world.
- A grid cell never holds more entities than its capacity.
- An agent's energy never goes below zero.
- Nothing reaches an agent except a tool's result or a stimulus from a declared channel.
- A run never writes to an existing file.
- Every recorded tool call has exactly one outcome, from the declared set.
- Every metric is computed from the world's state, never by a model.

## Requirements

### Functional

#### FR-WORLD-01: Actions are applied one at a time against the current state
The world applies one action at a time. When an action's precondition holds at that moment, its effect is applied and the world's version grows by one. When it does not hold, the state does not change and the result is a failure carrying the action's named reason.
*Why:* experiments measure what happens when agents act on a state that changed while they decided; an action checked against an older state would hide those collisions.

#### FR-TOOL-01: Tools are the agent's only interface with the world
A scenario declares each tool an agent can call, as one of two kinds:
- **sensor:** returns part of the world, as seen from where the agent is, and changes nothing;
- **effector:** changes the world through the arbiter.

Each tool is declared with its name, the description the agent sees, its arguments, its duration, its effort and its failure reasons. The agent's session offers exactly these tools and no others.
*Why:* an agent knows and changes its world only through its interfaces with it, as a living being does through its senses and its body; an agent that is handed the world's state is a model answering a prompt, not an agent.

#### FR-TOOL-02: Only tool calls act
Text an agent writes changes nothing and reaches no one; it is recorded as the agent's reflection.
- A tool call whose arguments the tool does not take applies nothing and is recorded with the outcome `invalid_arguments`, together with the call exactly as the model made it, before any coercion. A tool takes only the arguments it declares: the engine rejects any other, whatever the tool's schema allows, without changing the schema the agent sees.
- A call to a tool the agent's session does not offer applies nothing and is recorded with the outcome `unknown_tool`.
- A tool always acts as the agent that called it; no argument can make it act as another agent.
- A failed call tells the agent it failed, and why: its result is marked as an error and gives the outcome. When the harness itself rejects a call (`invalid_arguments` it detects, `unknown_tool`), the agent receives the harness's explanation, marked as an error, and the outcome is in the log.

*Why:* a guessed action would put the platform's reading in place of the agent's behaviour, and Pi coerces arguments before a tool sees them; a malformed call must be counted as made. A call to a missing tool is the agent's behaviour, not a defect of the scenario, and must not stop the run. An agent that could act in another's name would make every record of who did what unreliable. An agent told that a failure succeeded would act on a world it misreads.

#### FR-ADAPTER-01: A scripted model answers in tests
In tests, each agent's model is Pi's faux provider. For each model turn it returns, in order, what the agent's script lists for that turn (text, tool calls, or both), each after the delay the script gives. When the script runs out, the agent's activation ends and the run records `script_exhausted`.
*Why:* the core must be testable deterministically and offline, through the same harness path real runs use.

#### FR-STIMULUS-01: Stimuli reach an agent through a declared channel
Information an agent does not ask for reaches it only as a stimulus: a message delivered into its session, through a channel the scenario declares, with the source the channel names (another agent, or a mechanism of the world, such as the agent's own rhythm). A stimulus that arrives while the agent is working is delivered at its next model turn; one that arrives while it is resting is delivered when it next wakes.
- **What the agent reads:** the source, a colon and the content, the same for every channel (for example `town bell: The bell rings.`). The channel and the source are also kept with the message for the log.
- **The rhythm channel:** every scenario declares a channel named `rhythm`, with its source and its text; it is the stimulus each activation starts with. The engine writes no text of its own.
*Why:* information does not come from nowhere; who or what sends it, and through what channel, is part of the system and must be declared like everything else the agent meets (NFR-04).

#### FR-CLOCK-01: Each agent has its own activations
Each agent's rhythm wakes it with a stimulus from its rhythm channel. Awake, the agent works through its tools in its session; its activation ends when a model turn makes no tool call. It then waits an interval drawn from its rhythm and wakes again. Before each activation, the first included, the agent waits an interval drawn from its rhythm, so agents do not all wake at the same moment. Its session lasts the whole run, so the agent keeps what it perceived and did. No agent waits for another, and agents' paces differ through their rhythms, their models' latency, their tools' durations, their energy and what they wait for.
*Why:* real complex systems have no turns (NFR-01), and their agents do not move in step; a strong agent keeps its history while it acts.

#### FR-SCENARIO-01: A scenario plugs into the engine
A scenario provides:
- its world's initial state;
- its tools (sensors and effectors);
- its stimulus channels;
- its metrics;
- its system prompt;
- a base configuration in TOML.

A system prompt that holds nothing besides whitespace, or a base configuration that sets no key, counts as missing. The system prompt describes the agent, never the state of the world.

A condition is a TOML change over that base configuration:
- a value the condition gives replaces the base configuration's value under the same key;
- a table the condition gives is applied the same way inside the base configuration's table, so the keys it does not name keep their base values;
- an array is a value, and is replaced whole.

The engine refuses, before any model call:
- a scenario that lacks one of these parts, with an error that names the missing part;
- a condition that sets a key the base configuration does not have, with an error that names the key by its full path (for example `slots.cuont`);
- a condition that gives a key a value of another kind than the base configuration's (string, number, boolean, date and time, array or table), with an error that names the key and both kinds.

A run takes the scenario as loaded: its world, tools, stimulus channels and system prompt all come from it, never passed separately.

*Why:* experiments live outside the engine, and a scenario that loads with a missing part fails only after model calls have been spent. A condition with a misspelled key, or a value of the wrong kind, would otherwise run as the baseline under another name, and the difference between conditions would be attributed to a change that never happened (NFR-05). A run assembled from separate parts could use one scenario's tools with another's world, and its log would name a scenario it did not run.

#### FR-SEED-01: One seed gives the same start
Each replica has one seed. From it, the engine derives one random sequence per purpose:
- one for the scenario's initial state;
- one for each agent's rhythm, derived from the seed and the agent's name.

The same seed therefore gives the same initial world and, for each agent, the same sequence of waiting intervals. How many values one purpose draws never changes another purpose's sequence: a condition that places more agents leaves the other agents' intervals as they were.
*Why:* replicas differ only by their seed and the model's answers, and conditions are compared against the same starting worlds. If purposes shared one sequence, a condition that changed the initial state would also change every agent's timing, and the difference between conditions would mix two changes (NFR-05).

#### FR-SPACE-01: A grid space
The engine provides a grid of a given width and height, with a capacity per cell. It answers four questions:
- **neighbours:** the eight neighbouring cells of a position;
- **window:** the cells within a radius of a position, with the cells outside the grid marked as outside;
- **random empty cell:** a random empty cell, drawn from the replica's random source, or none when there is none;
- **move:** moves an entity from its cell to another. It fails with `cell_full` when the destination is at capacity. A move of an entity the grid does not hold, or to a cell outside the grid, is refused with an error that names the entity or the cell, and applies nothing.

*Why:* several of the lab's scenarios are spatial, and a shared grid keeps neighbourhoods and views the same across them. An agent's bad choice is the scenario's to name (for example `invalid_target`); a move that reaches the grid with an unknown entity or a cell outside it is a defect in the scenario, and recording it as a change would put an entity or a position in the log that never existed.

#### FR-SMOKE-01: The basic pieces run with a real model
A smoke run, started by hand and outside the gate, runs two agents in the slots test scenario on a real model, through the lab's Pi login. The model is the one the environment variable `AGENTS_LAB_SMOKE_MODEL` names, in Pi's `provider/id` form. The run passes when:
- it ends without stopping;
- each agent's activations begin with its rhythm stimulus;
- each agent makes at least one model turn with the outcome `success` and at least one tool call;
- every tool call has an outcome from the declared set;
- the person's Pi directory is unchanged.

It prints, for each agent, its model turns with their latencies and its tool calls with their outcomes.
*Why:* the tests run on a scripted model; only a real model shows whether the harness, the lab's login and the tools work together, and what latencies to expect, before an experiment spends calls.

#### FR-TOOL-03: Sensing takes time and reads the world when it ends
A sensor call takes its declared duration. Its result is the world as it is when the duration ends, as seen from where the agent is then. The engine keeps, for each agent, what each of its sensor calls returned and when.
*Why:* perceiving is an act that takes time, and what an agent knows is what it last perceived, not the world's current state.

#### FR-TOOL-04: Acting takes time, and its effect is checked when it lands
An effector call takes its declared duration, which may depend on its arguments and the state (for example, distance). The agent is busy until it ends; its effect is checked and applied then, against the world as it is at that moment. An effector can fail with a reason saying its target changed after the agent last sensed it, as distinct from a reason saying the target was not valid when the agent last sensed it.
*Why:* doing things takes time, and the world goes on changing meanwhile; telling a collision from a misjudgement is what separates the effect of other agents' timing from the agent's own errors.

#### FR-SPACE-02: Moving across the grid takes time in proportion to distance
A move on the grid takes the scenario's time per cell multiplied by the distance, counted in steps between neighbouring cells. The entity stays in its cell until the move ends; the destination is checked when it arrives.
*Why:* if moving costs nothing, space and distance stop shaping who meets whom and who arrives first, and the grid becomes decoration.

#### FR-PROCESS-01: The environment changes on its own
A scenario can declare processes: changes the world applies at a given interval, through the arbiter, whether or not any agent acts (for example, energy recovering or a resource growing back).
*Why:* real environments have their own dynamics; a world that changes only when agents act is a laboratory artefact.

#### FR-EFFORT-01: Doing things spends energy
Each agent has energy, up to a maximum the scenario sets. Each tool call spends its declared effort when it starts. A call the agent cannot afford fails with `no_energy`, takes no time and spends nothing. Energy recovers through a process the scenario declares. An agent learns its energy only through a sensor or a tool result the scenario declares.
*Why:* real agents pay for what they do, and the cost shapes what they choose; an agent for which every action is free has no reason to choose between them.

#### FR-RECORD-01: Everything an agent does is recorded
Each run writes one new JSONL file, named with the run id. It adds one line for each:
- **activation:** the agent, when it woke and when it ended;
- **stimulus:** the agent, the channel, the source, the content, and when it was delivered;
- **model turn:** the agent, its text, the model that answered, the wait for a model slot, the latency, and the tokens and cost Pi reports;
- **tool call:**
  - the agent, the tool and the call exactly as the model made it;
  - when it started and ended, and its outcome;
  - its result, for a sensor;
  - for an effector, the number of changes other agents applied between the agent's last sensor call and the moment its effect was applied.

When a run stops on an error, its log ends with a line that says the run stopped and gives the error.
*Why:* every analysis of an experiment is done from this log, and a field not recorded cannot be recovered later. A run that stops on an error must say so, or its log reads as a run that simply ended.

#### FR-CLOCK-02: A run ends at its budget or its time limit
A run ends when every agent has used its activation budget or when its time limit passes, whichever comes first. A tool call still running at the time limit is recorded with the outcome `cut_off` and applies nothing.
*Why:* a run must end in a known state, and an effect applied after the end would change a world that was already measured.

#### FR-METRIC-01: Generic metrics for every run
At the end of every run the core reports, per agent and in total:
- activations and model turns;
- tool calls by tool and by outcome;
- mean and maximum model latency and wait for a model slot;
- energy spent;
- the number of effector calls applied on a world that had changed since the agent last sensed it.

*Why:* these show whether a run behaved as a run without turns, and how agents spent their time and effort, before its scenario metrics are read.

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
- the tools, with their kind, the descriptions the agent sees, their durations and efforts;
- the stimulus channels, with their sources and what they deliver;
- the energy model and the environment processes;
- the limits (activation budget, time limit, parallelism limit, timeout);
- what the agent is told about itself.

`lab inventory <experiment.toml>` prints it without running.
*Why:* the lab reviews what each environment pushes agents to do before running, and a hand-written list drifts from the code.

#### FR-ADAPTER-02: Each agent is one Pi session for the whole run
Each agent runs in one Pi session that lasts the whole run, using the model from the configuration. The session has:
- the scenario's system prompt in place of Pi's own;
- no built-in tools, and exactly the scenario's tools;
- the agent's stimuli as its messages.

The prompt never names the model unless the condition says so. The scripted model of FR-ADAPTER-01 runs through this same session, registered with Pi's model runtime like any other model.
- **Outcomes:** a model turn ends with `success`, `model_error`, `timeout` or, in tests, `script_exhausted`.
- **Model errors:** when the provider answers with an error, the model turn is recorded with the outcome `model_error` and the provider's message, and the activation ends.
- **Parallelism limit:** a model turn waits for a free slot when the configured number of calls is already running.
- **Timeout:** a model turn that runs longer than the timeout is aborted and recorded with the outcome `timeout`, and the activation ends.

*Why:* agents are compared across models through one harness the core controls; a hung call must not block a run; and a provider's failure is not the agent's behaviour.

#### FR-EXPERIMENT-01: An experiment file names its scenario, conditions, models and replicas
An experiment file (TOML) gives:
- its id;
- the scenario it runs;
- the models;
- the number of replicas and the base seed, a whole number from 0 to 4294967295;
- the run limits (time, activations per agent, parallelism, timeout);
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
- texts for the system prompt or for stimuli;
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
*Why:* two experiments on one machine would share its parallelism limit and its Pi login without recording it.

### Scenario library

#### FR-NEIGHBOURHOOD-01: A neighbourhood from a seed
The neighbourhood scenario creates a grid of the configured width and height and places the configured number of residents of two kinds on distinct random cells, from the replica's seed. Its system prompt describes the resident; any preference or rule a resident is given comes from the condition.
*Why:* the same neighbourhood serves several experiments (micro vs macro, diversity of thresholds or models, local vs global view), each of which brings its own rule as a condition.

#### FR-NEIGHBOURHOOD-02: Residents look, and move near or far
A resident has three tools:
- **look** (sensor): returns its window of the configured radius, with its own kind, the other kind, empty and outside the grid marked distinctly.
- **move dx dy** (effector): moves it to the cell at that offset, taking the grid's time for the distance. It fails with `taken_while_deciding` when the cell was empty when the resident last looked but is occupied when it arrives, and with `invalid_target` when the cell is outside the grid, outside its view, or was not empty when it last looked.
- **move_far** (effector): moves it to a random cell that is empty when the move ends, taking the scenario's time for a far move. It fails with `no_empty_cell` when there is none.

Staying is not acting: a resident that does not want to move ends its activation.
*Why:* separating a collision from a misjudgement is what lets experiments tell the effect of other agents' timing from the agent's own errors.

#### FR-NEIGHBOURHOOD-03: Same-kind shares
The neighbourhood scenario's metrics are:
- **shares:** for each resident with at least one neighbour, the share of its eight neighbours that are of its kind;
- **segregation:** the mean of those shares;
- **moves:** the number of applied moves.

*Why:* experiments read the system-level pattern from the shares. A measure that depends on a rule given to the residents, such as how many fall below a threshold, is computed by that experiment's analysis from the shares and the tool calls.

### Analysis

#### FR-ANALYSIS-01: Logs export as CSV
`lab export <runs-dir>` writes CSV files for activations, model turns, tool calls and metric samples, each row with the run's condition, model, replica and seed. The export reads only the logs.
*Why:* an analysis that needs heavier statistics than the built-in summaries can use an outside tool without a second language in the repository (D-02).

### Non-functional

#### NFR-01: No turns, and no imposed pace
No component orders agents, makes one wait for another, or makes them move in step. Waiting may appear only through what agents do, and differences of pace only through their rhythms, models, tools, energy and interactions.
*Why:* real complex systems are concurrent, and their agents do not act at the same speed; imposed turns or an imposed common pace produce laboratory results, not results about the system.

#### NFR-02: Situated perception
An agent's sensors return only what can be perceived from where the agent is. Global information exists only as a sensor or channel the scenario declares for it.
*Why:* in complex systems each agent perceives differently; global information erases the differences the experiments study.

#### NFR-03: Ground truth in code
World state, rules and metrics are code. No model decides what happens in the world or scores an outcome.
*Why:* a measure that depends on a model's reading cannot be checked or reproduced.

#### NFR-04: Everything the agent meets is declared
Every text, tool, channel, source, limit, duration and effort an agent meets comes from the scenario or the condition and appears in the inventory.
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

#### NFR-09: Agents, not models
The engine never hands an agent the world's state. An agent perceives only through its sensors and the stimuli of its declared channels, acts only through its effectors, and keeps its session for the whole run.
*Why:* the lab studies strong agents perceiving, reflecting and acting in their environment; a model answering a prompt that describes the world is a different object of study.

#### NFR-10: Doing things costs time and effort
Every tool call takes time and every effector spends energy, as the scenario declares. No tool is instantaneous and free unless the scenario declares it so, and the inventory shows it.
*Why:* in real systems, perceiving, moving and acting cost time and energy, and those costs are what make space, distance and choice matter.

## Draft notes

- v0.2 will need, at least:
  - channels between agents with topology and delay;
  - event masks with pending stimuli;
  - votes with a deadline.
- v0.3 will need memory across runs: a workspace for each agent's memory files. `@earendil-works/pi-durable` (experimental in Pi 1.5.0) may help with long runs.
- Open: whether real time is enough for E16's vote deadlines to be repeatable, or simulated time is needed.
- Open: whether an agent can make several tool calls at once in one model turn, or they run one after another. Until decided, they run one after another.
- FR-RECORD-01: `invalid_arguments` must be recognised from the harness's validation failure, not inferred because a call did not run; a call that did not run for another reason (a message cut at the token limit, an abort in the middle of a batch) needs its own outcome.
