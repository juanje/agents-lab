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

## D-02: TypeScript on Node

**Decision.** The core, the scenarios and the tests are TypeScript on Node, as an ES module project. Analysis of the logs is Python, in `analysis/`, reading the JSONL files.

**Why.**
- The Pi SDK is TypeScript. Embedding it natively removes subprocesses, a protocol and a second language for tools.
- oid's TypeScript toolchain already works with this method.
- The analysis libraries are better in Python, and the analysis needs only the logs.

**Rules out:**
- a Python core;
- Python inside the core's run path.

**Follows.** The log format is the contract between the core and the analysis.

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
