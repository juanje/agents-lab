# Decisions

Only the decisions in force. A changed decision is rewritten in place; none supersedes another. An entry is added only for a decision that is expensive to reverse, and only once the person agrees.

## D-01: Pi is the only gateway to models

**Decision.** Every model call goes through the Pi CLI: `pi -p` in v0.1, Pi in RPC mode from v0.3.

**Why.** Pi gives several providers and local models behind one interface, with the user's existing logins. From v0.3 it also gives the harness and session that an agent with memory needs.

**Rules out:**
- direct provider SDKs or HTTP clients in the core;
- `claude -p` as a gateway;
- one adapter per provider.

**Follows.**
- Model ids use Pi's `provider/id` form.
- Tool behaviour of Pi lives in DOMAIN.md.

## D-02: Real-time asyncio loops first

**Decision.** Agents run as asyncio tasks in one process, in wall-clock time. Each agent has its own rhythm, and its perception–action lag is its real model latency plus any wait for a slot. Simulated time is added only when an experiment needs runs that real time cannot repeat.

**Why.** Real time gives concurrency without turns, and a real lag, with the least machinery. The E13 prototype showed it produces stale decisions and collisions as required.

**Rules out:**
- threads or multiprocessing for agent loops;
- a global step or round loop;
- discrete-event simulation in v0.1.

**Follows.** Latency and wait for a slot are recorded separately in every decision.

## D-03: Our own thin core, not an agent-based modelling framework

**Decision.** The core is written here, from SPEC.md. It takes ideas from TextWorld (declared actions, information switches, ground truth), Concordia (per-agent asynchronous loops, event masks) and Mesa (event lists, spaces), but uses none of them as a dependency.

**Why.** The requirements every experiment shares (no turns, situated perception, the recorder, the inventory, the agent adapter) would have to be written on top of any of them anyway, and their assumptions conflict with ours:
- TextWorld has one player and steps;
- Concordia's world is decided by a model;
- Mesa's time is simulated.

**Rules out:**
- adding Mesa, Concordia or TextWorld to the core;
- porting the prototype's Mesa grid.

**Follows.**
- Graph topologies may use networkx when channels arrive (v0.2).
- TextWorld's world generator may be used later as a scenario tool, outside the core.

## D-04: Acceptance scenarios in behave, unit tests in pytest

**Decision.** Each FR has one Gherkin feature file in `features/`, tagged `@FR-…`, run with behave. Unit tests are pytest, in `tests/`.

**Why.** The person reads and approves the contract as Gherkin without reading Python. behave worked well in the person's previous Python project built this way.

**Rules out:**
- `pytest-bdd`;
- acceptance criteria written only as pytest tests;
- scenarios inside SPEC.md.

**Follows.** A scenario asserts outcomes visible in the world or the log, never internal names.

## D-05: Python 3.12 with uv; the core uses the standard library

**Decision.**
- **Language and environment:** Python 3.12, uv with a locked `pyproject.toml`.
- **Quality checks:** ruff for lint and format, mypy in strict mode for types.
- **Core dependencies:** the standard library only (dataclasses, asyncio, tomllib, json).
- **Analysis:** pandas, in `analysis/` only.

**Why.** It keeps the core small and its behaviour readable. Strict typing catches in the gate what Python has no compile step for.

**Rules out:**
- pydantic or other modelling libraries in the core;
- dependencies added for one convenience.

**Follows.** A new dependency needs the person's agreement and an entry here when it is expensive to remove.
