# Decisions

Only the decisions in force. A changed decision is rewritten in place; none supersedes another. An entry is added only for a decision that is expensive to reverse, and only once the person agrees.

## D-01: Pi is the only harness, used through its SDK

**Decision.** Every agent runs on Pi, embedded in-process through the SDK (`@earendil-works/pi-coding-agent`, `createAgentSession`, with `@earendil-works/pi-ai` models). The core sets the system prompt, the tools and the session of each agent. It never runs the Pi CLI.

**Why.**
- **One harness under full control.** The experiments vary the agents and their environment, not the harness, so they use one harness and keep it under full control: its system prompt, its tools, its context and its events.
- **What the SDK gives that the CLI does not:**
  - lab actions as custom tools in the same process;
  - every event the harness produces, for the log;
  - messages injected while an agent works (`steer`, `follow_up`);
  - abort;
  - sessions, in memory or persisted, with branches.
- **Several models** behind one interface, without depending on one provider's account.
- **Experience.** The SDK is already used this way in oid and Buddy.

**Rules out:**
- other agent harnesses;
- the Pi CLI or RPC mode as the gateway;
- direct provider SDKs or HTTP clients;
- one adapter per provider.

**Follows.**
- Model ids use Pi's `provider/id` form.
- How Pi behaves on the pinned version lives in DOMAIN.md.
- Tests use Pi's faux provider (D-04).

## D-02: TypeScript on Node, analysis included

**Decision.** The engine, the scenarios, the tests and the analysis are TypeScript on Node, as an ES module project. For an analysis that needs heavier statistics, `lab export` writes the data as CSV for an outside tool; no other language enters the repository.

**Why.**
- The Pi SDK is TypeScript. Embedding it natively removes subprocesses, a protocol and a second language for tools.
- oid's TypeScript toolchain already works with this method.
- The lab's analyses (means and ranges across replicas, counts by outcome, bootstrap intervals, comparisons between conditions) do not need Python's libraries.
- One language keeps the repository readable by one agent and one toolchain.

**Rules out:**
- Python or another language in the repository;
- an analysis that reads anything but the logs.

**Follows.** The log format is the contract between the engine and the analysis.

## D-03: Real-time loops on Node's event loop first

**Decision.** Agents run as concurrent async loops in one Node process, in wall-clock time. Each agent has its own rhythm, and its perception–action lag is its real model latency plus any wait for a slot. Simulated time is added only when an experiment needs runs that real time cannot repeat.

**Why.** Real time gives concurrency without turns, and a real lag, with the least machinery. The E13 prototype showed it produces stale decisions and collisions as required.

**Rules out:**
- worker threads or child processes for agent loops;
- a global step or round loop;
- discrete-event simulation in v0.1.

**Follows.** Latency and wait for a slot are recorded separately in every decision.

## D-04: Acceptance scenarios with cucumber-js, unit tests with vitest, models faked with Pi's faux provider

**Decision.**
- **Acceptance:** each FR has one Gherkin feature file in `features/`, tagged `@FR-…`, run with cucumber-js.
- **Units:** vitest, in `tests/`.
- **Models in tests:** Pi's faux provider (`fauxProvider` in `@earendil-works/pi-ai`) returns scripted answers, so tests run the real harness path without calling a model.

**Why.**
- **Gherkin:** the person reads and approves the contract as Gherkin without reading code. It worked with behave in a previous Python project and with cucumber-js in oid.
- **The faux provider:** it keeps tests deterministic and offline without bypassing Pi.

**Rules out:**
- acceptance criteria written only as unit tests;
- scenarios inside SPEC.md;
- calling a real model from any test.

**Follows.**
- A scenario asserts outcomes visible in the world or the log, never internal names.
- A real model runs only in a smoke test, outside the gate.

## D-05: Our own thin core, not an agent-based modelling framework

**Decision.** The core is written here, from SPEC.md. It takes ideas from TextWorld (declared actions, information switches, ground truth), Concordia (per-agent asynchronous loops, event masks) and Mesa (event lists, spaces), but uses none of them.

**Why.** The requirements every experiment shares (no turns, situated perception, the recorder, the inventory, the agent adapter) would have to be written on top of any of them anyway, and their assumptions conflict with ours:
- TextWorld has one player and steps;
- Concordia's world is decided by a model;
- Mesa's time is simulated.

**Rules out:**
- adding Mesa, Concordia or TextWorld;
- porting the prototype's code.

**Follows.** A dependency beyond Pi and the toolchain needs the person's agreement and an entry here when it is expensive to remove.

## D-06: The experiment language is a TOML schema, parsed with smol-toml

**Decision.** The experiment language (FR-EXPERIMENT-01 to 04) and scenarios' base configurations are TOML, parsed with `smol-toml` and validated by the engine against its schema.

**Why.** People read and write these files to design experiments, and TOML is easier to read and edit by hand than JSON. `smol-toml` is small, has no dependencies and implements TOML 1.0.

**Rules out:**
- JSON or YAML for files people write;
- configuration in TypeScript code.

**Follows.** The run log records the resolved configuration as JSON, since the analysis reads the logs, not the TOML.

## D-07: Code here, experiments elsewhere

**Decision.** This repository holds all the code, in three parts:
- **the engine** (`src/engine/`);
- **a library of reusable scenarios** (`src/scenarios/`), such as a neighbourhood or a committee;
- **the analysis** (`src/analysis/`).

The experiments repository (`~/git/agents-lab-experiments`) holds only what defines and documents each experiment:
- its experiment file in the experiment language;
- its materials;
- its design;
- its results.

**Why.** Scenarios and analysis are code shared by several experiments, so they belong with the engine. Experiments change often and must not change the code they run on, or results stop being comparable. Inside this repository, the engine must not lean towards any scenario (NFR-07).

**Rules out:**
- code in the experiments repository;
- experiment files, materials or results in this repository;
- engine features named after one scenario or experiment.

**Follows.**
- A feature a new experiment needs is written as a generic engine FR, or as a new scenario.
- The engine's own tests use test scenarios, not the library's.

## D-08: The lab has its own Pi directory and login

**Decision.** The lab's Pi directory is `~/.agents-lab/pi/`, outside the repository. It holds the lab's own credentials (`auth.json`, from a separate login) and model definitions (`models.json`), and nothing else. Every session gets:
- that directory as its agent directory, and its credentials and model definitions through Pi's model runtime;
- settings held in memory;
- a resource loader that loads no extensions, skills, prompt templates, themes or context files.

**Why.**
- The experiments must declare everything their agents meet (NFR-04).
- The person's coding agent must not be changed by the lab.
- Two processes making calls with one Pi login stalled each other, so the lab must not share the person's login.

**Rules out:**
- reading or writing `~/.pi/agent/`;
- passing credentials through the repository or environment variables in the code.

**Follows.**
- Setup happens once, by the person: `PI_CODING_AGENT_DIR=~/.agents-lab/pi pi`, then `/login`.
- oid's `resourcesFor` and `SettingsManager.inMemory` are the pattern to follow.
