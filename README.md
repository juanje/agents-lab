# agents-lab

A TypeScript platform for reproducible experiments with AI agents in complex systems.

It evaluates agents, not models. Each agent is a model in a harness ([Pi](https://github.com/earendil-works/pi)), with memory, that perceives and acts in a world only through its tools. The platform holds every experiment to properties that real complex systems have:

- **No turns.** Each agent wakes at its own rhythm and acts while the others act.
- **Situated perception.** An agent knows only what its sensors return.
- **Doing costs time and effort.** Every tool call takes time, so agents keep different paces.
- **The world decides outcomes.** An action succeeds or fails by the state of the world when it lands, whatever the agent perceived. What the agent perceived is recorded beside the outcome.

Everything an agent does is written to a log, and every analysis is computed from those logs.

## What is in this repository

- `src/engine/`: the world, tools, stimuli, activations, places and passages, the calendar, mail, the phone, money, participants, parts, the Pi adapter and the recorder.
- `src/scenarios/`: reusable scenarios: the neighbourhood (Schelling with LLM agents), the workplace (a worker in an invented place of rooms and passages) and the congress (an organiser preparing a congress among venues, speakers, caterers, sponsors, a board and attendees, whose answers rules decide).
- `src/analysis/`: analysis of run logs: summaries across replicas, the reserved judge and the parts report.
- `src/cli/`: the `lab` command.

Experiments (their designs, experiment files, materials and results) live in a separate repository, so the code they run on stays the same across them.

## Status

Early development. v0.1, what E13 (Schelling with LLM agents) needs, is built and ran three technical pilots; E13 is parked. v0.2, the invented workplace, where a worker meets seeded situations and what it did is read from the world, is built for E1's pilots; E2–E4 come next. v0.3 is under way: E1 in a congress. The calendar, mail, phone calls, money, participants decided by rules, the congress's parties and attendees, parts as held-out keys and the corrections from E1's first, second and third technical runs are built. A congress can run with a fixed budget and an advance from the association, drawn from its cheapest feasible plan, and no board; acts by phone are read as acts by mail. `SPEC.md` lists the requirements and the order they are built in.

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

Install the `lab` command once, from this repository:

```bash
npm link
```

Then run an experiment from the directory its results go under. It writes each run's log, and an `index.jsonl` that lists every run, into `runs/<experiment id>/` there, and prints each run's progress every 30 seconds, or every `--progress-interval-ms <ms>`:

```bash
lab run <experiment.toml>
```

When an experiment was interrupted, run it again with `--resume`: it runs only the runs its index does not list as completed, and refuses, before any model call, when a completed run's setup differs from what the file makes now:

```bash
lab run <experiment.toml> --resume
```

To review what each condition's agents meet before running it (their system prompts, rhythms, tools, channels, the models and the limits), print its environment inventory as Markdown. It runs nothing and calls no model:

```bash
lab inventory <experiment.toml>
```

To summarize an experiment's runs across replicas, print, for each condition, model and metric, the completed and stopped runs, each completed run's last value and their minimum, quartiles and maximum. It reads only the runs directory's index and logs, and prints Markdown, or JSON with `--json`:

```bash
lab summarize <runs-dir> [--json]
```

To report an experiment's parts, print them by part, kind, outcome and condition, from the index, the logs and the guidance materials the setup lines name, found from the directory `lab` runs in. It prints Markdown, or JSON with `--json`:

```bash
lab parts <runs-dir> [--json]
```

To judge what the agents of the completed runs wrote, run the reserved judge with a judge file, which gives its model, instructions and limits. It calls that model, and prints where the verdicts are:

```bash
lab judge <runs-dir> <judge.toml>
```

## Documentation

- `SPEC.md`: purpose, scope, invariants and requirements.
- `DOMAIN.md`: terms, and how the Pi SDK and Node behave on the pinned versions.
- `DECISIONS.md`: the decisions in force and what each rules out.
- `features/`: the acceptance scenarios, one file per requirement.

## License

[MIT](LICENSE)
