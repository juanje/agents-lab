# Domain

What the words mean here, how the pieces fit together, and how the tools behave on the pinned versions. When a pinned version differs, check the behaviour before relying on it, and update this file.

## Terms

| Term | Means | Not to be confused with |
|:--|:--|:--|
| Agent | One participant in a world: a model, the harness that runs it and the memory it keeps. | The model alone. Two agents can use the same model. |
| Adapter | The code that turns an observation into a decision for an agent, through a Pi session. | The agent. The adapter is how the core talks to it. |
| World | The state of a scenario (cells, residents, quantities) plus its arbiter. | The scenario, which also declares perception, actions and metrics. |
| Arbiter | The part of the world that applies one action at a time against the current state. | A scheduler. The arbiter never decides who acts next. |
| Version | A counter of applied actions in a world. | A run id or a code version. |
| Scenario | A TypeScript module (world, perception, actions, metrics) plus its base configuration. | An experiment. |
| Condition | A named change over a scenario's base configuration. | A run or a replica. |
| Experiment | A TOML file listing conditions, models, replicas and seeds. | A hypothesis. An experiment tests one, but lives in the lab's documents. |
| Replica | One run of a condition with one model and one seed. | A fork, which continues a saved state. |
| Run | One execution of one replica; produces one log file. | An experiment, which is many runs. |
| Rhythm | The distribution an agent draws its waiting interval from between decisions. | A turn. Rhythms are independent per agent. |
| Observation | What an agent receives at one moment, from its scenario's perception. | The world's state, which the agent never sees whole. |
| Information switch | A condition setting that adds or removes a piece of an observation (for example a preference text). | A variation, which is drawn at random per decision. |
| Variation | A text or setting drawn at random for each decision from a declared set, and recorded. | A condition. |
| Decision | One observe–decide–act cycle of an agent, with its prompt, answer, action and outcome. | An action. A decision can apply no action. |
| Action | A declared operation on the world, with a precondition, an effect and failure reasons. | An answer, which is the model's raw text. |
| Outcome | The single recorded result of a decision: `success` or a failure reason (`taken_while_deciding`, `invalid_target`, `no_empty_cell`, `unparsed`, `timeout`, `cut_off`, `script_exhausted`). | A metric. |
| Changes while deciding | The number of actions other agents applied between a decision's observation and its action. | Latency. |
| Stale decision | A decision whose changes while deciding is above zero. | A failed decision. A stale decision can still succeed. |
| Latency | Time from a model call's start to its answer. | Wait for a slot, which comes before the call. |
| Wait for a slot | Time a decision waited because the parallelism limit was reached. | Latency. |
| Parallelism limit | The maximum number of model calls running at once. | The number of agents. |
| Inventory | The generated list of everything an agent meets in a scenario and condition. | The log. |
| Segregation (Schelling) | The mean share of same-kind neighbours, over residents with at least one neighbour. | Dissatisfaction, which counts residents below the threshold. |

## How the pieces fit

- **Each agent is an async loop** on Node's event loop: rhythm wait, observe, decide (through its Pi session) and act (through the arbiter).
- **The arbiter is the only writer** of the world's state; agents read through perception.
- **The recorder writes a line per event.** The inventory and the run's setup go first.
- **Metrics read the state** at the start, on an interval and at the end.
- **The runner** expands an experiment into runs and executes them one after another.

## How the tools behave

### Pi SDK (1.5.0: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`)
- **Opening a session:** `createAgentSession` opens one.
  - `SessionManager.inMemory()` keeps it out of the disk.
  - A `ResourceLoader` with `systemPromptOverride` replaces Pi's system prompt.
  - `tools: []` disables the built-in tools; `customTools` adds ours.
  - oid's `src/pi-executor.ts` uses this pattern.
- **Events:** `session.subscribe` streams messages, thinking, tool calls with their results, and the agent's lifecycle. Assistant messages carry `responseModel` (the model that actually answered) and usage, with `cost.totalFromProvider` telling billed totals from catalog estimates.
- **Tool arguments are coerced** by `@earendil-works/pi-schema` before a tool sees them (numeric strings become numbers, a single value becomes an array). Record the raw tool call from the events, not only the coerced arguments, or malformed answers disappear from the data.
- **Tests:** `fauxProvider()` from `@earendil-works/pi-ai` gives scripted answers (`fauxText`, `fauxToolCall`), with an optional tokens-per-second rate. oid's `features/support/scripted-model.ts` is an example.
- **Authentication:** the Pi login in `~/.pi/agent/auth.json` serves every session in the process. On this machine `ANTHROPIC_API_KEY` is set to an invalid key; remove it from the environment so Pi uses its login.
- **Concurrency:** two processes making model calls with the same login stalled every call (observed with the CLI on 1.4.0; 1.5.0 changed the auth lock). Run one experiment process at a time (FR-RUN-03).
- **Latency:** Haiku 5.5 answers a short prompt in about 2 s.
- **Not used yet:** `@earendil-works/pi-agent-core`, a lower-level stateful agent, if the coding agent's session adds behaviour we do not want; and `@earendil-works/pi-durable`, experimental persistence and resumption.

### Node
- An aborted session must also free its parallelism slot; otherwise later decisions wait for a call that will never end.

## Testing agents-lab itself

- **Unit and acceptance tests use Pi's faux provider** (FR-ADAPTER-01), with delays that make overlapping decisions happen deterministically.
- **A real model runs only in the smoke test, outside the gate.**
- **The E13 prototype** is in `~/git/mesa-sandbox/schelling_async.py`. It is a reference for behaviour, not code to copy.
