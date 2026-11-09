# Domain

What the words mean here, how the pieces fit together, and how the tools behave on the pinned versions. When a pinned version differs, check the behaviour before relying on it, and update this file.

## Terms

| Term | Means | Not to be confused with |
|:--|:--|:--|
| Agent | One participant in a world: a model, the harness that runs it and the memory it keeps. | The model alone. Two agents can use the same model. |
| Adapter | The code that turns an observation into a decision for an agent: Scripted, Pi. | The agent. The adapter is how the core talks to it. |
| World | The state of a scenario (cells, residents, quantities) plus its arbiter. | The scenario, which also declares perception, actions and metrics. |
| Arbiter | The part of the world that applies one action at a time against the current state. | A scheduler. The arbiter never decides who acts next. |
| Version | A counter of applied actions in a world. | A run id or a code version. |
| Scenario | A Python module (world, perception, actions, metrics) plus its base configuration. | An experiment. |
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

- **Each agent is an asyncio task** looping through rhythm wait, observe, decide (through its adapter) and act (through the arbiter).
- **The arbiter is the only writer** of the world's state; agents read through perception.
- **The recorder writes a line per event.** The inventory and the run's setup go first.
- **Metrics read the state** at the start, on an interval and at the end.
- **The runner** expands an experiment into runs and executes them one after another.

## How the tools behave

### Pi CLI (1.4.0)
- One stateless call: `pi -p --no-tools --no-session --model <provider/id> --thinking off --system-prompt "<text>" "<prompt>"`. The answer is on stdout; the last line holds the final answer.
- On this machine `ANTHROPIC_API_KEY` is set to an invalid key. Remove it from the subprocess environment so Pi uses its own login.
- Two processes making Pi calls at the same time with the same login stalled every call until timeout. Run one experiment process at a time (FR-RUN-03).
- Haiku 5.5 answers a short prompt in about 2 s.
- `--mode rpc`, `--session-dir` and `--fork` exist for long-lived agents with sessions (v0.3).

### asyncio subprocesses
- A model call that exceeds its timeout must be killed (`proc.kill()`), not only abandoned. Otherwise the process keeps its slot and its Pi login.

## Testing agents-lab itself

- **Unit and acceptance tests use the Scripted adapter** (FR-ADAPTER-01), with delays that make overlapping decisions happen deterministically.
- **A real model runs only in the smoke test, outside the gate.**
- **The E13 prototype** is in `~/git/mesa-sandbox/schelling_async.py`. It is a reference for behaviour, not code to copy.
