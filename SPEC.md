# agents-lab — Specification

A small platform for running reproducible experiments with AI agents as strong agents in complex systems. The hypotheses, experiment designs and protocol live in the lab's own documents (`my-ab/user/projects/laboratorio-agentes/`: `index.md`, `hipotesis.md`, `experimentos.md`). This spec defines the core that runs those experiments.

The core starts small: it implements what the first experiments need (Milestones) and grows only when an experiment needs more.

## 1. Principles

These hold for every scenario. A feature that breaks one of them is a bug.

1. **No turns.** Every agent runs its own loop at its own pace on a shared state that keeps changing while it decides. An action is validated against the state at the moment it executes and can fail because what the agent saw is no longer there. Turn-taking or waiting may emerge from the agents; the core never imposes them.
2. **Situated perception.** Each agent perceives from where it is and through its connections: local, partial, possibly delayed information. Global visibility exists only as an explicit condition of a scenario.
3. **The environment has its own dynamics** where the system being modelled has them: processes that run whether or not any agent acts (decay, regeneration, events, deadlines).
4. **Ground truth in code.** World state, quantities and rules are code, not narrated by an LLM. Every measure can be computed from the state, without a judge.
5. **Everything the agent meets is declared.** Actions, their names and descriptions, the information each agent receives, pressures, per-decision messages and randomized variations are declared in the scenario and exported as an environment inventory.
6. **Everything is recorded.** Every observation, prompt, raw response, parsed action, outcome, timing and state change goes to the log, with enough to replay the analysis.
7. **An agent is LLM + harness + memory.** The adapter names which of the three each condition changes. The core never assumes the agent is only a model call.
8. **One change per condition.** A condition is a named diff over a base configuration. Seeds, models and parallelism limits are part of the configuration.

## 2. Non-goals

- A general agent-based modelling library.
- A user interface or live visualization.
- Human-like scaffolding (moods, needs named after human life, violence tools) unless a scenario declares it as the variable under study.
- Distributed execution.

## 3. Core concepts

### 3.1 World

- Holds the full state: entities, positions, quantities, relations, scenario-specific fields.
- Exposes the actions of the scenario and applies them atomically, one at a time, against the current state (the arbiter).
- Counts applied changes (`version`), so each decision records how many changes happened between observing and acting.
- Serializes to a snapshot and restores from it (fork). *(v0.4)*

### 3.2 Clock and scheduler

- **Real-time mode** *(v0.1)*: agents run as asyncio tasks; timestamps are wall-clock seconds since start. The perception–action lag is the agent's real latency plus any wait for the parallelism limit, and both are recorded separately.
- **Simulated-time mode** *(later)*: a discrete-event queue. An agent observes at t, its action is scheduled at t + d (d measured or modelled) and validated then. Use it for long or exactly repeatable runs.
- Each agent has its own rhythm: an interval distribution between decisions, declared per scenario or per agent.
- Environment processes are scheduled events, recurring or one-off, declared by the scenario.
- A run ends at a time limit, a decision budget per agent, or a scenario condition.

### 3.3 Perception

- `perceive(world, agent) -> Observation` is defined by the scenario: what the agent can see from its location and connections.
- **Information switches** (declared booleans or levels per condition): which fields an observation includes, for example a neighbourhood map, others' votes, the score, the list of admissible actions or the objective.
- **Event masks and pending observations** *(v0.2)*: events carry tags; an agent receives the events its mask matches, and undelivered ones wait until it next observes.
- **Delays** *(v0.2)*: information can arrive after a declared delay, by distance or by channel.

### 3.4 Actions

- Each action is declared with:
  - a name;
  - the description the agent sees;
  - its arguments;
  - a precondition, checked at execution;
  - an effect on the state;
  - its failure outcomes.
- An action can succeed or fail with a named reason. Failure reasons that depend on what changed while the agent decided (for example `taken_while_deciding`) are distinct from invalid choices (`invalid_target`).
- Actions are presented to the agent as tools, or as a reply format, whichever the scenario declares. The presentation is part of the environment inventory.

### 3.5 Channels *(v0.2)*

- Messages between agents go through declared channels:
  - local speech, reaching agents within a radius;
  - direct messages, reaching only declared contacts;
  - broadcast, only if the scenario declares it.
- Each channel has a reach (topology) and a delay.
- Topologies are networkx graphs: complete, ring, small-world, modular, centre–periphery, or loaded from a file.

### 3.6 Agent adapter

Interface: `async decide(observation, actions) -> Decision`, where a decision holds the raw response, the parsed action and the timings.

| Adapter | What it is | Memory | Milestone |
|:--|:--|:--|:--|
| `PiPrint` | One `pi -p --no-tools` call per decision, with the scenario's system prompt | None between decisions, apart from what the scenario puts in the observation | v0.1 |
| `PiRpc` | A long-lived Pi process (`--mode rpc`) per agent, whose working directory is the agent's own workspace (memory files) and whose session can be forked (`--fork`). Lab actions reach it as custom tools from a Pi extension that calls back to the core | Files in its workspace plus the session | v0.3 |

- **Model selection** goes through Pi (`provider/model`), which gives several providers and local models behind one interface. Every scenario runs with two or more models unless a condition says otherwise.
- **The model's identity is never placed in the agent's prompt** unless a condition declares it.
- **Parallelism limit:** a global cap on concurrent model calls, declared in the configuration and recorded.
- **Call timeout:** each model call has a timeout. A timed-out call is recorded as `timeout` and counts as no action.
- **One experiment process at a time** per Pi authentication. Concurrent processes sharing a Pi login stalled every call in testing.

### 3.7 Variations

- A scenario can declare per-decision variations: a set of texts or settings, one of which is drawn at random for each decision and recorded in that decision's log entry. This turns a run into a randomized experiment on the variation.

### 3.8 Recorder

- Writes one JSONL file per run. Each line is one event:
  - `run_start`, with the full resolved configuration, the seeds, the git commit of the code and the environment inventory;
  - `observation`;
  - `decision`, with the prompt, the raw response, the parsed action, the variation drawn, the latency, the queue wait and the changes while deciding;
  - `action_result`;
  - `env_event`;
  - `message` *(v0.2)*;
  - `metric_snapshot`;
  - `run_end`.
- **Never overwrites:** each run writes to a new file named with the run id.
- **Snapshots** *(v0.4)*: the full state at declared moments, to enable forking.

### 3.9 Metrics

- Each scenario declares metrics computed from the state, at the individual and system levels, sampled on a schedule and at the end.
- Generic metrics, provided by the core for every run:
  - decisions per agent;
  - outcome counts by reason;
  - latency and queue wait;
  - decisions taken on a stale state;
  - say-vs-do divergence, where a scenario defines both.

### 3.10 Environment inventory

- Generated automatically for every run from the scenario: actions as the agent sees them, information switches, pressures and limits, channels and topology, per-decision variations, the system prompt, and what the agent knows about itself.
- Written as `inventory.md` next to the run log, for the blind review required by the lab's control 11.

### 3.11 Scenarios and conditions

- **A scenario** is a Python module (world, perception, actions, processes, metrics) plus a base configuration in TOML.
- **A condition** is a named TOML diff over the base configuration.
- **An experiment** is a TOML file listing the conditions, the models, the number of replicas and the seeds.
- **The runner** executes the replicas sequentially, one process at a time.

### 3.12 Runner (CLI)

- `lab run <experiment.toml>`: run every condition × model × replica.
- `lab inventory <experiment.toml>`: print the environment inventory without running.
- `lab summarize <run-dir>`: aggregate the metrics across runs into a table.
- `lab fork <snapshot> --condition <name>` *(v0.4)*: continue a saved state under a condition.

## 4. Stack

| Part | Choice | Why |
|:--|:--|:--|
| Language | Python 3.12 | asyncio for concurrent agent loops; the ecosystem for analysis and graphs |
| Environment and dependencies | uv, `pyproject.toml`, locked | Fast, reproducible installs |
| Concurrency | asyncio (agent loops, subprocess model calls, environment processes) | One process and one event loop give real concurrency of agents without threads |
| State and configuration types | Standard-library dataclasses; TOML through `tomllib` | No extra dependencies in the core |
| Graphs and topologies | networkx *(from v0.2)* | Standard generators and metrics for networks |
| Model access | Pi CLI (`pi -p`, later `pi --mode rpc`) as the single gateway | One interface for several providers and local models, with the agent's harness and memory when needed |
| Pi bridge for lab tools | A small TypeScript Pi extension *(v0.3)* | Pi extensions are TypeScript; it only forwards tool calls to the core |
| Logs | JSONL per run, plus `inventory.md` | Append-only, easy to read and analyse |
| Analysis | pandas in `analysis/` scripts and notebooks, outside the core | Keeps the core free of heavy dependencies |
| Tests | pytest, including scenario tests with a scripted fake adapter (no model calls) | The world, actions and timing can be tested deterministically |
| Lint and format | ruff | One tool |

## 5. Repository layout

```
agents-lab/
  SPEC.md
  pyproject.toml
  src/agents_lab/
    world.py        # state, arbiter, version counter, snapshots
    clock.py        # agent loops, rhythms, environment processes, run limits
    perception.py   # observation helpers, information switches, masks, delays
    actions.py      # action declarations, validation, failure reasons
    channels.py     # (v0.2) channels and topologies
    adapters/       # PiPrint, PiRpc, Scripted (tests)
    variations.py
    recorder.py
    inventory.py
    metrics.py
    runner.py       # CLI
  scenarios/
    schelling/      # E13
    committee/      # E16
  experiments/      # experiment TOML files
  runs/             # outputs (git-ignored)
  analysis/
  tests/
```

## 6. Milestones

Each milestone is driven by one experiment of the lab and implements only what it needs.

**v0.1: E13, micro vs macro (Schelling).**
- World on a grid with capacity 1.
- Real-time agent loops with per-agent rhythm, and validation at execution with named failure reasons.
- Local perception (a window around the agent), with switches for the preference text and the view radius.
- Actions as a reply format: STAY, MOVE dx dy, FAR.
- The `PiPrint` adapter, with a parallelism limit and a timeout per call.
- Recorder, inventory, generic metrics, and the segregation and dissatisfaction metrics.
- Conditions (a) preference, (b) no preference, and two models. Condition (c), with memory, waits for v0.3.
- Runner with replicas and seeds.
- Reference: the prototype in `~/git/mesa-sandbox/schelling_async.py`.

**v0.2: E16, model monoculture and vote visibility.**
- Committee scenario: proposals, some with a planted flaw known only to the evaluator.
- Votes with a deadline and no imposed order.
- Information switch for others' votes: visible as cast, or hidden until close.
- Private notes, to measure say vs do.
- Channels (local speech or direct contacts), with networkx topologies and delays.
- Event masks and pending observations.
- Model composition as a condition: one model, or mixed.

**v0.3: a single-agent experiment with tools and memory (E15 tools with intention, or E7 information vs experience).**
- Workspace scenario: files as state, file actions as tools.
- Tools with declared names and descriptions as the condition.
- The `PiRpc` adapter: per-agent workspace and session, and the TypeScript extension that exposes lab tools.
- Session sequences for agents with memory.

**v0.4: forks and persistence.**
- World snapshots and agent workspace or session forks (`pi --fork`) at declared moments.
- `lab fork` to continue under a condition.
- Identical forks as the noise baseline for agents with memory.

**Later, when an experiment needs them:**
- simulated-time mode;
- quantities and an economy (markets, fisheries);
- generated families of puzzles with a hidden rule and a changeable surface (A3–A7), possibly reusing TextWorld's generator;
- environments whose rules change during a run (A6, A16).

## 7. Open questions

- The transport between the Pi extension and the core for lab tools: a local socket, HTTP or stdin. To decide in v0.3.
- Whether real-time mode is enough for E16, or whether vote deadlines need simulated time to be repeatable.
- How to record what reaches the agent through the harness itself (Pi's own system prompt, context compaction) so that it appears in the inventory.
