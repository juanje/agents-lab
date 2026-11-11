# agents-lab

A TypeScript platform for reproducible experiments with AI agents in complex systems.

It evaluates agents, not models. Each agent is a model in a harness ([Pi](https://github.com/earendil-works/pi)), with memory, that perceives and acts in a world only through its tools. The platform holds every experiment to properties that real complex systems have:

- **No turns.** Each agent wakes at its own rhythm and acts while the others act.
- **Situated perception.** An agent knows only what its sensors return.
- **Doing costs time and effort.** Every tool call takes time, so agents keep different paces.
- **The world decides outcomes.** An action succeeds or fails by the state of the world when it lands, whatever the agent perceived. What the agent perceived is recorded beside the outcome.

Everything an agent does is written to a log, and every analysis is computed from those logs.

## What is in this repository

- `src/engine/`: the world, tools, stimuli, activations, the Pi adapter and the recorder.
- `src/scenarios/`: reusable scenarios, such as the neighbourhood (Schelling with LLM agents).
- `src/analysis/`: analysis of run logs.
- `src/cli/`: the `lab` command.

Experiments (their designs, experiment files, materials and results) live in a separate repository, so the code they run on stays the same across them.

## Status

Early development, toward v0.1: what a first pilot of a Schelling experiment needs. `SPEC.md` lists the requirements and the order they are built in. The `lab` command is not built yet.

## Setup

Requires Node 22.19 or later.

```bash
npm install
```

The lab uses its own Pi directory and login, separate from any personal Pi setup. Log in once:

```bash
PI_CODING_AGENT_DIR=~/.agents-lab/pi pi
```

Then run `/login` inside Pi.

## Usage

Run every check (type check, unit tests, acceptance scenarios). It uses scripted models only, so it runs offline:

```bash
npm run gate
```

Run the smoke test, two agents on a real model (it makes real model calls):

```bash
AGENTS_LAB_SMOKE_MODEL=openai/gpt-6-luna NODE_OPTIONS="--import tsx" npx cucumber-js -p smoke
```

Once the runner is built, an experiment will run with:

```bash
lab run <experiment.toml>
```

## Documentation

- `SPEC.md`: purpose, scope, invariants and requirements.
- `DOMAIN.md`: terms, and how the Pi SDK and Node behave on the pinned versions.
- `DECISIONS.md`: the decisions in force and what each rules out.
- `features/`: the acceptance scenarios, one file per requirement.

## License

[MIT](LICENSE)
