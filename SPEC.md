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
| v0.1 | E13 micro vs macro (Schelling): three technical pilots, then parked | below | built enough for E13's pilots |
| v0.2 | E2–E4 in an invented workplace (A19, A20, I4); E1's pilots ran here before E1 moved to the congress | below, in this build order | built for E1's pilots; E2–E4 next |
| v0.3 | E1 in a congress (A18, A19, A23): instructions, heuristics and character | below, in this build order | next |
| v0.4 | E16 model monoculture and vote visibility | not written | later |
| v0.5 | A single-agent experiment with tools and memory across runs (E15 or E7; the congress world's sequences) | not written | later |
| v0.6 | World and agent forks | not written | later |

**v0.1, built.** Each FR below is built.
1. FR-WORLD-01
2. FR-TOOL-01
3. FR-ADAPTER-02
4. FR-STIMULUS-01
5. FR-TOOL-02
6. FR-ADAPTER-01
7. FR-CLOCK-01
8. FR-SCENARIO-01
9. FR-SEED-01
10. FR-SPACE-01
11. FR-SMOKE-01
12. FR-TOOL-03
13. FR-TOOL-04
14. FR-SPACE-02
15. FR-CLOCK-02
16. FR-RECORD-01
17. FR-NEIGHBOURHOOD-01
18. FR-NEIGHBOURHOOD-02
19. FR-NEIGHBOURHOOD-03
20. FR-EXPERIMENT-01
21. FR-RUN-01
22. FR-METRIC-02
23. FR-INVENTORY-01
24. FR-RECORD-02
25. FR-EXPERIMENT-05
26. FR-RUN-04

**v0.2 build order.** The thinnest slice that runs E1 in the workplace comes first; E2–E4 change texts and configuration, not code.
1. FR-RUN-04 (its changes: the total when a run stops, readable durations)
2. FR-RUN-05
3. FR-EXPERIMENT-04
4. FR-EXPERIMENT-02
5. FR-SPACE-03
6. FR-WORKPLACE-01
7. FR-WORKPLACE-02
8. FR-WORKPLACE-03
9. FR-WORKPLACE-04
10. FR-PROCESS-01 (components with their own life cycles, in the engine)
11. FR-WORKPLACE-05 (the depot's day goes on: time, the porter and visitors)
12. FR-ADAPTER-03
13. FR-RUN-02
14. FR-ANALYSIS-02
15. FR-WORKPLACE-07 (the worker can wait), before E1's pilot
16. FR-RUN-06 (runs in parallel), before E1's pilot
17. FR-RUN-07 (an interrupted experiment resumes)
18. FR-WORKPLACE-08 (the worker sees who is there when it arrives or stops waiting), before E1
19. FR-ANALYSIS-03 (quotes matched as text, repeated questions, retried provider errors), before E1's judging
20. FR-WORKPLACE-06 (the depot's hours, light, closed doors, and weather as a perturbation), when an experiment needs it

**v0.3 build order.** The preparation-only pilot of E1 needs items 1–9. The world and its parts are designed in `agents-lab-experiments/experiments/E1-congress/world.md`; each FR's contract is written from it, one at a time.
1. FR-CLOCK-03 (a calendar, clock segments and hours)
2. FR-MESSAGE-01 (structured messages between participants); its contract also checks that an effector's action is given the world's time (FR-CLOCK-03)
3. FR-PARTICIPANT-01 (rule-based participants with an interface), not written
4. FR-PHONE-01 (calls), not written
5. FR-CONGRESS-01 (the congress world from materials), not written
6. FR-MONEY-01 (ledger, invoices, approvals), not written
7. FR-CONGRESS-02 (the actors' rules), not written
8. FR-POPULATION-01 (attendees and the ticket page), not written
9. FR-PARTS-01 (parts as held-out keys), not written
10. FR-CONGRESS-03 (the day), after the pilot, not written
11. FR-ANALYSIS-04 (success by kind of part and text length), a light version for the pilot, not written

**Small known gaps** (to close when convenient): `lab summarize` prints numbers at full precision; a completed run whose log has no metric sample gives no values without saying so; a run in the index whose log is missing fails with Node's own error. The `wait` tool's description does not state `wait_max_minutes`, so the worker learns the limit only from a refusal; `wait_max_minutes` is not checked when the configuration loads. FR-WORKPLACE-07's scenario whose wait ends `interrupted` "about 50 milliseconds into the run" failed once in a full gate (2026-11-13) and passed on three reruns: it needs more slack. The run test that ends an effector's call early at a stimulus failed once under load (2026-11-13) and passed on reruns, as did one scenario in a full gate the same day.

**Not yet ordered:** FR-EFFORT-01, FR-METRIC-01, FR-EXPERIMENT-03, FR-RUN-03, FR-ANALYSIS-01.

## Invariants

- An effector changes the world only if its precondition holds at the moment its effect is applied.
- The world's version grows by exactly one for each applied effect and never otherwise.
- A sensor never changes the world.
- A grid cell never holds more entities than its capacity.
- An agent's energy never goes below zero.
- Nothing reaches an agent except a tool's result or a stimulus from a declared channel.
- An agent's tool calls never overlap: the calls of one model turn run one after another, each starting when the previous one ends.
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
- An effector's result, success included, is the text its scenario declares for the outcome, or the outcome itself when it declares none. The text tells the agent only what happened to it, never the state of the world, except what the effector declares the agent perceives from where it is as its call ends (FR-WORKPLACE-08).
- A failed call tells the agent it failed, and why: its result is marked as an error and gives that text. When the harness itself rejects a call (`invalid_arguments` it detects, `unknown_tool`), the agent receives the harness's explanation, marked as an error, and the outcome is in the log.

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
- its agents, named from its configuration;
- its tools (sensors and effectors);
- its stimulus channels, from its configuration;
- its metrics;
- a system prompt for each agent, from its configuration and the agent;
- each agent's rhythm, from its configuration: how its waits between activations are drawn;
- a base configuration in TOML.

A system prompt that holds nothing besides whitespace, or a base configuration that sets no key, counts as missing. A system prompt describes its agent, never the state of the world. A run whose agents are not exactly the scenario's agents is refused before any model call, with an error that names the agents missing and the agents not declared.

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
The engine provides a grid of a given width and height, with a capacity per cell. It answers five questions:
- **neighbours:** the eight neighbouring cells of a position;
- **window:** the cells within a radius of a position, with the cells outside the grid marked as outside;
- **random empty cell:** a random empty cell, drawn from the replica's random source, or none when there is none;
- **position:** the cell an entity is in, or none when the grid does not hold it;
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
A sensor call takes its declared duration, which, like an effector's, may depend on its arguments, the agent that calls it and the state. Its result is the world as it is when the duration ends, as seen from where the agent is then. The engine keeps, for each agent, what its last successful sensor call returned and when; every sensor result is recorded in the log (FR-RECORD-01).
*Why:* perceiving is an act that takes time, and what an agent knows is what it last perceived, not the world's current state.

#### FR-TOOL-04: Acting takes time, and its effect is checked when it lands
An effector call takes its declared duration, which may depend on its arguments, the agent that calls it and the state (for example, distance or the agent's own speed). The agent is busy until it ends; its effect is checked and applied then, against the world as it is at that moment (an effector that is under way in the world, such as crossing a passage, can also change the state when it starts: FR-SPACE-03), and it fails only for a reason of the world (for example, the cell is held), whatever the agent perceived. Each effector call records, beside its outcome, what the agent last sensed of its target: `free`, `held`, `outside` (its last sensing showed the target is no place it can go) or `not_sensed`. The scenario declares, for each effector, how to read its target in the agent's last sensing, or in its last call of a given sensor (FR-WORKPLACE-02).
*Why:* doing things takes time, and the world goes on changing meanwhile. A collision is a physical event that happens whether or not the agent looked (NFR-11); what the agent knew is what tells stale information from a misjudgement or from acting without perceiving, and it belongs in the record, not in the outcome.

#### FR-SPACE-02: Moving across the grid takes time in proportion to distance
The grid gives the distance between two cells, counted in steps between neighbouring cells (a diagonal step counts as one). A scenario's effector that moves an agent across the grid takes, as its duration (FR-TOOL-04), the scenario's time per cell multiplied by that distance. The agent stays in its cell until the move ends; the destination is checked when it arrives.
*Why:* if moving costs nothing, space and distance stop shaping who meets whom and who arrives first, and the grid becomes decoration.


#### FR-SPACE-03: A space of places connected by passages
The engine provides a space of named places connected by passages. A passage joins two places, can be crossed both ways, and has a length greater than zero. A passage is space too: an entity crossing it is in the passage, in neither of its places. A layout that names a place it does not declare, gives a passage a length of zero or less, or joins the same two places twice, is refused with an error that names it. Places and passages hold any number of entities. The space answers:
- **where:** the place or passage an entity is in, or none when the space does not hold it;
- **exits:** the places one passage away from a place, each with the passage's length;
- **entities:** the entities in a place or a passage;
- **in sight:** the entities an entity can see. From a place, it sees the entities in that place and in the passages that leave it; from a passage, the entities in that passage and in the two places it joins. Nothing else is in sight: no one sees through walls, nor into a place from another place;
- **leave:** an entity in a place enters the passage towards a place one passage away;
- **arrive:** an entity in a passage reaches the place it was heading for.

A leave of an entity the space does not hold, or not in a place, or towards a place that is unknown or not one passage away, is refused with an error that names the entity or the place, and applies nothing; so is an arrive of an entity that is not in a passage.

A scenario's effector that moves an agent to another place takes, as its duration (FR-TOOL-04), the scenario's time per unit of length multiplied by the passage's length. The agent leaves its place when the call starts and arrives when it ends: in between it is in the passage, where others can see it, and its old place no longer holds it. A start the space refuses stops the run, as a tool that throws does. A crossing cut off by the time limit (FR-CLOCK-02) leaves the agent in the passage, where it was when time ran out.
*Why:* worlds such as a building or a village are made of rooms and paths, not cells; the space keeps their layout, the time to cross it and what can be seen from where the same across scenarios. An agent that stayed in its place until it arrived would be seen where it no longer is, and would reach its new place at once for everyone else. What an agent can see depends on where it is, so the layout shapes what each agent can know (NFR-12). An agent's choice of a place it cannot reach is the scenario's to name; a leave that reaches the space with it is a defect in the scenario.

#### FR-PROCESS-01: Components with their own life cycles change the world
A scenario can declare, from its configuration, components besides its agents: parts of the world that follow their own life cycle and goals (a porter on his rounds, a visitor on an errand). A component calls no model. Its cycle chooses, from the world's state and the component's own random sequence, its next step: an action, which takes its duration and changes the world through the arbiter as an effector does (checked when it lands, with an optional start, FR-TOOL-04), or a wait. It learns each action's outcome before it chooses again, and its cycle can end. Components run alongside the agents from the moment the agents can start, without turns.

Each component's random sequence is derived from the replica's seed and the component's name (FR-SEED-01), so a condition that adds a component leaves the others' sequences as they were. Each action is recorded in the log as a line of its own: the component, the action, when it started and ended, its outcome, and its start's change when it has one. The changes components apply count among the changes an agent's effector records since its last sensing, named by the component (FR-RECORD-01). When the run ends, an action still running is recorded `cut_off` and applies nothing (FR-CLOCK-02).

A component is either part of the world or an external perturbation, which the configuration declares as such; the inventory lists each component with its kind and a description of its cycle that the scenario gives.
*Why:* a world does not change by itself: it changes because agents and components, each with its own cycle and goals, make it change. A world that changes only when the agents under study act is a laboratory artefact; one that changes through scheduled events added for their own sake is another. Components act under the same physics as agents, so what agents perceive of them is as situated and as delayed as what they perceive of each other.

#### FR-EFFORT-01: Doing things spends energy
Each agent has energy, up to a maximum the scenario sets. Each tool call spends its declared effort when it starts. A call the agent cannot afford fails with `no_energy`, takes no time and spends nothing. Energy recovers through a process the scenario declares. An agent learns its energy only through a sensor or a tool result the scenario declares.
*Why:* real agents pay for what they do, and the cost shapes what they choose; an agent for which every action is free has no reason to choose between them.

#### FR-RECORD-01: Everything an agent does is recorded
Each run writes one new JSONL file, named with the run id. It adds one line for each:
- **activation:** the agent, when it woke and when it ended;
- **stimulus:** the agent, the channel, the source, the content, and when it was delivered;
- **model turn:** the agent, its text, the reasoning the provider returned with it, if any, the model that answered, the wait for a model slot, the latency, and the tokens and cost Pi reports;
- **tool call:**
  - the agent, the tool and the call exactly as the model made it;
  - when it started and ended, and its outcome;
  - its result, for a sensor, and the text the agent received, for an effector;
  - for an effector that declares a start (FR-SPACE-03), a line of its own when the start is applied, with the agent, the tool, when it was applied, and the change it made, as the scenario describes it;
  - for an effector that ran, what the agent last sensed of its target when the call started (a call rejected before running has no target to read), and the number of changes other agents applied between the agent's last sensor call and the moment its effect was applied, with the agents that applied them; a call made before any sensing records `not_sensed` and no count.

When a run stops on an error, its log ends with a line that says the run stopped and gives the error. A session that fails to open stops the run with an error that names the agent, and the sessions already open are closed.
*Why:* every analysis of an experiment is done from this log, and a field not recorded cannot be recovered later. A run that stops on an error must say so, or its log reads as a run that simply ended.

#### FR-CLOCK-02: A run ends at its budget or its time limit
A run ends when every agent has used its activation budget or when its time limit passes, whichever comes first. The time limit counts from the moment the agents can start, once every session is open. When it passes, everything stops:
- a tool call still running is recorded with the outcome `cut_off` and applies nothing;
- a model turn still running, or still waiting for a model slot, is aborted and recorded with the outcome `cut_off`; a turn still waiting never calls the model, and a tool call the turn left unrun is recorded with the outcome `cut_off`;
- no agent starts another model turn or another activation.
*Why:* a run must end in a known state, and an effect applied after the end would change a world that was already measured.


#### FR-CLOCK-03: A calendar, clock segments and hours
A scenario's configuration may declare a `[calendar]`: its `start` (`"day <n> <weekday> HH:MM"`, the world's day number, weekday and time when the agents can start) and its `[[calendar.segments]]`, in order, each with its `scale` (world seconds per second of the run) and, for every segment but the last, its `until` (`"day <n> HH:MM"`, the world time at which it ends and the next begins). The world's time at any moment of the run follows from these, segment by segment: one run second in a segment is `scale` world seconds. Days follow each other at midnight and weekdays follow the week.

**What the engine gives.** A sensor's read, an effector's action and a component's cycle are given the world's time with the time since the run started: its day number, weekday and time to the second. A tool's or a component action's duration may be given as world time; it then takes the run time that this world time spans from the moment it starts, segment by segment, so the same duration takes less run time in a slower segment. A duration in run time stays as it is.

**Hours.** The calendar may declare named weekly hours (`[calendar.hours.<name>]`, with `days`, a list of weekdays, and `from` and `to`, `"HH:MM"`). For any world time the engine says whether it is within a named set of hours, and when they next begin.

**The workplace** keeps its own clock, from its `[day] start` and `time_scale` (FR-WORKPLACE-05), and every result it gives stays as before; it has no day number or weekday, so it declares no calendar. A workplace configuration with a `[calendar]` beside those keys is refused.

**Refusals**, before any model call, with an error that names the key: a `start` or an `until` that does not follow its format; a weekday that is not one of the seven English names; a day number below 1; a `scale` that is not a positive number; an `until` at or before the start or the previous segment's `until`; a segment without `until` that is not the last; no segment; hours whose `from` is not before their `to`, or whose `days` is empty or names an unknown weekday.

**Recorded.** The inventory gives the calendar's start, each segment with its scale and the run time it takes (the last: "until the run ends"), and each named set of hours.
*Why:* an event prepared over weeks and run in a day needs one world clock with different paces, as long waits and a busy day do not fit one scale. Thinking takes world time like any act, so each segment's scale sets how much the world moves while an agent decides. Hours are when the world's parties answer; declaring them once keeps every party's rules on the same calendar.

#### FR-MESSAGE-01: Structured messages between participants
A scenario may declare, from its configuration, a mail medium (`[mail]`) and which of its agents and components have a mailbox (`mailboxes`). A message has a sender, a recipient, an `act` (a word), `fields` (named values), an optional `subject` (its act when it has none) and an optional free `text`. Each recipient declares the acts it takes and the fields each act requires (`[mail.acts.<recipient>]`, `<act> = [<field>, …]`); a participant that declares none takes every act.

**Sending.** An agent sends with the effector `send_mail` (`to`, `act`, `fields`, `subject?`, `text?`); a component sends with an action of its cycle. As the call or action starts, a message whose recipient has no mailbox is refused as `unknown_recipient`, one whose act the recipient does not take as `act_not_taken` (its result lists the acts the recipient takes), and one that lacks a field its act requires as `missing_field` (naming the field); a refused message takes no time and is not sent. Otherwise the message is sent when the call's duration ends, with the world's time it was sent (an effector's action is given the world's time, FR-CLOCK-03), and reaches its recipient's mailbox after a delivery delay drawn, in world minutes, between the two numbers of `delivery_minutes`, from a sequence derived from the replica's seed and `mail of <sender>`, so a condition that adds a participant leaves the others' delays as they were (NFR-12). A run keeps going while messages are in transit, until they land or its time limit passes; a message still in transit when the run ends is never delivered. Message ids are `m-<n>`, numbered across the run, messages at the start first, and a delivery counts among an agent's changes since sensing under the name `mail`.

**Receiving.** A delivered message lands in the mailbox unread. When it lands in an agent's mailbox, the agent receives a stimulus through the channel `mail_notice`, whose source and text the configuration gives (`notice_source`, and `notice` with `{from}` and `{subject}` filled in); a configuration without `notice` declares no such channel and sends none. An agent lists its mailbox with the sensor `check_mail` (`unread_only?`), which gives each received message's id, sender, subject and the world's time it was received, oldest first. It reads a message with the effector `read_mail` (`id`): an id not in the reader's mailbox fails as `no_such_mail`; otherwise the message is marked read through the arbiter, and the result gives `From: <sender>. Act: <act>.`, then each field as `<name>: <value>.`, then the text. A component's cycle is given its mailbox's unread messages and marks one read with an action, through the arbiter, as `read_mail` does.

**Durations** are world time (so `[mail]` needs a `[calendar]`): `send_minutes`, plus `send_minutes_per_field` for each field and one minute per `send_words_per_minute` words of the subject and text; `check_minutes`; `read_minutes`, plus one minute per `read_words_per_minute` words of the text. A per-field or per-word duration left out adds nothing.

**Messages at the start.** The configuration may put messages in a mailbox before the run (`[[mail.initial]]`, with `to`, `from`, `act`, `fields`, `subject`, `text` and `received`, a world time at or before the calendar's start). Their sender need not be a participant. They are unread and send no notice.

**Recorded.** Each message sent adds a `message_sent` line (its id, sender, recipient, act, fields, subject, text, and the run time and world time it was sent); each delivery adds a `message_delivered` line (its id, and the run time and world time it landed); a message at the start adds a `message_delivered` line at the run's start with its `received` time. The inventory gives each mailbox, each recipient's acts with their fields, `delivery_minutes`, the durations, and the notice's source and text.

**Refusals**, before any model call, with an error that names the key: `[mail]` without a `[calendar]`; `delivery_minutes` that is not two numbers, the first at least 0 and not above the second; a negative duration; acts for a participant with no mailbox; a field list that is not a list of words; a message at the start for a participant with no mailbox, whose act its recipient does not take or that lacks a required field, or received after the calendar's start; a `notice` without `notice_source`.
*Why:* in a world of many parties, most of what an agent learns and does goes by mail, and mail takes time. Acts and fields make what a message asks for something a rule-based participant can answer, while its free text stays for an agent; the same message works whether its recipient is a component now or an agent later. A notice says that something came, not what it says: the agent still has to read it.
#### FR-METRIC-01: Generic metrics for every run
At the end of every run the core reports, per agent and in total:
- activations and model turns;
- tool calls by tool and by outcome;
- mean and maximum model latency and wait for a model slot;
- energy spent;
- the number of effector calls applied on a world that had changed since the agent last sensed it;
- the number of effector calls made without sensing their target first.

*Why:* these show whether a run behaved as a run without turns, and how agents spent their time and effort, before its scenario metrics are read.

#### FR-METRIC-02: Scenario metrics are sampled on a schedule
The engine computes the scenario's metrics from the world's state at the start of a run, at the interval the experiment file gives (`metric_interval_ms`; without it, only at the start and the end), and at the end, and writes each sample to the log as one line: when it was taken, the world's version it was computed from, and each metric's value. A metric with no value is recorded as `null`; a metric with one value per agent is recorded with each agent's value.
*Why:* experiments compare how a system-level pattern develops, not only where it ends.

#### FR-RECORD-02: A run records what it ran
The first line of each run's log holds:
- the run id, the experiment's id, the scenario's name in the library, the condition's name and the resolved configuration;
- the replica, its seed, the model and the sampling settings its sessions use;
- the commit of the code, and whether the working tree had changes not committed;
- the environment inventory of the run's condition (FR-INVENTORY-01).

*Why:* a result cannot be reproduced or checked without the exact setup that produced it.

#### FR-INVENTORY-01: The environment inventory is generated, not written by hand
For each condition of an experiment, the core lists:
- each agent's system prompt, which is all the agent is told about itself and its world;
- each agent's rhythm, as the scenario describes it;
- the tools, with their kind, the descriptions and parameters the agent sees, their durations as the scenario describes them, their efforts, and the text the agent receives for each outcome;
- the stimulus channels, with their sources and what they deliver;
- the energy model and the environment processes;
- how fast information travels (NFR-12): until a medium exists, that every sensor and channel is instant;
- the model, its thinking level and the limits (activation budget, time limit, parallelism limit, timeout).

A scenario describes, as text from its configuration, how each tool's duration and each agent's rhythm are computed. What the engine does not provide yet is listed as "none". The inventory is data: `lab inventory <experiment.toml>` prints it as Markdown without running and without any model call, and each run's log holds the same data as JSON (FR-RECORD-02).
*Why:* the lab reviews what each environment pushes agents to do before running, and a hand-written list drifts from the code.

#### FR-ADAPTER-02: Each agent is one Pi session for the whole run
Each agent runs in one Pi session that lasts the whole run, using the model from the configuration. The session has:
- the scenario's system prompt in place of Pi's own;
- no built-in tools, and exactly the scenario's tools;
- the agent's stimuli as its messages.

The prompt never names the model unless the condition says so. The scripted model of FR-ADAPTER-01 runs through this same session, registered with Pi's model runtime like any other model.
- **Outcomes:** a model turn ends with `success`, `model_error`, `timeout`, `cut_off` (FR-CLOCK-02) or, in tests, `script_exhausted`.
- **Model errors:** when the provider answers with an error, the model turn is recorded with the outcome `model_error` and the provider's message, and the activation ends. A rate-limit answer (HTTP 429) is first retried, when the experiment file's `[limits]` give `rate_limit_retries` (by default 0): after a wait of `rate_limit_wait_ms` (by default 1000), doubling with each retry, up to that many times. Each retry is a line in the log with the agent, the attempt and the wait; the wait is time in the world, as any latency is. Only when the retries are spent is the turn `model_error`.
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
- optionally, the interval between metric samples (FR-METRIC-02);
- its conditions, each a named change over the scenario's base configuration.

The engine validates the file against the experiment schema before anything runs. An invalid file fails with an error that names the field and what was expected; a key the schema does not know is invalid.
*Why:* people write these files to design experiments, and an error found after model calls wastes the run.

#### FR-EXPERIMENT-02: Factors expand into conditions
An experiment file can declare factors, each a name with levels, and each level a named change (`[factors.framing.rules]`). The engine runs every combination of levels as one condition, named after its levels in the file's order (for example `framing=rules,why=with`). When a file declares factors, the engine also adds a condition named `baseline` that takes no level, unless the file turns it off (`baseline = false`); while the engine adds it, no other condition can take the name `baseline`. A file can still give conditions of its own (`[conditions.NAME]`) besides its factors, and must give conditions, factors or both.

A file can give a change common to every condition (`[common]`), its own conditions, the combinations and `baseline` alike; a condition's own change, or a level's, is applied after it and wins over it on the same key. Two levels of one combination that set the same key are refused before any model call, with an error that names both factors and the key, as is a condition whose name is already taken. Conditions run in this order: `baseline`, then the combinations with the first factor's levels changing slowest, then the file's own conditions. Each run's setup line and its line in the index give the level of each factor in its condition; a condition that is not a combination has none.
*Why:* the lab's designs are factorial; every factorial experiment needs a condition without its factors, repeated, as its noise baseline; and the world, the materials and the declared rules shared by all conditions are written once.

#### FR-EXPERIMENT-03: An experiment states its prediction before it runs
An experiment file gives:
- the hypothesis it tests;
- its prediction;
- what would refute it.

`lab run` refuses to start when any of the three is missing, with an error that names it. The three go into every run's log.
*Why:* the lab's protocol requires the prediction and its refutation to be written before running. The commit of the file, together with the logs, shows that they came first.

#### FR-EXPERIMENT-04: Materials are files, referenced and fingerprinted
Any value of a scenario's configuration can be given, in the experiment file, as a material: a file named by its path relative to the experiment file (`{ file = "materials/character.md" }`), whose text becomes the value. A material can be marked as held out (`held_out = true`): the scenario reads it, for example as the reserved keys of its situations, but its text never reaches the inventory or the run's setup line.

The engine reads every material before the first run, writes each path with a hash of its content to each run's setup line, and lists them in the inventory with their paths and hashes; a held-out material is listed by its path only, and the setup line keeps its hash, so that a result still says which version of it was used. A material whose file does not exist fails the experiment before any model call, with an error that names the path. Seeded memory is a later use of materials (v0.4).
*Why:* texts are reviewed and changed as files, and a result must say exactly which version of each text produced it.


#### FR-EXPERIMENT-05: An experiment file sets the model's thinking level
An experiment file gives the thinking level of its models: one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. Every session of every run uses it. A level that one of the file's models cannot use is refused before any model call, with an error that names the model and the level; the engine never lowers it silently.
*Why:* the thinking level changes how an agent behaves, so it is part of the model a run uses and must be declared, not left to the harness's default.
#### FR-RUN-01: An experiment runs every condition, model and replica
`lab run <experiment.toml>` runs each condition with each model, for the configured number of replicas, one after another unless the file runs them in parallel (FR-RUN-06), each replica with its own seed. Every agent of a run uses that run's model. Replica r's seed is derived from the base seed and r, so it is the same in every condition and model.

It fails before any model call when the file names an unknown scenario or model, or a condition the scenario's configuration refuses, with an error that names it.

It writes each run's log into `runs/<experiment id>/` under the current directory, and adds to that directory's `index.jsonl` one line per run, with its run id, condition, model, replica, seed and whether it completed or stopped. A run that stops on an error stops the experiment.

`lab` is a command in `src/cli/`, which may import the engine, the scenarios and the analysis; the scenario library gives each scenario by its name.
*Why:* an experiment is the full grid of conditions and models, and a typo found after an hour of model calls wastes the run.

#### FR-RUN-02: Summaries across replicas
`lab summarize <runs-dir>` reads the index and the logs of an experiment's runs and prints, as Markdown, one row per condition, model and metric, from each run's last metric sample:
- the number of runs that completed and of runs that stopped; a stopped run gives no values;
- every value, in replica order, with the runs whose value is null counted apart;
- the minimum, the lower quartile, the median, the upper quartile and the maximum of the values (quartiles by linear interpolation).

A metric with one value per agent or per situation gives one row per agent or situation. `--json` writes the same summary as JSON instead. A directory without an index is refused, naming it. The summary reads only the logs.
*Why:* hypotheses are judged on distributions across replicas, not on single runs or on a mean that hides them; every value stays in view so that a reader can see the spread for themselves.

#### FR-RUN-03: One experiment at a time
`lab run` refuses to start, with an error that says another run is active, while another `lab run` on the same machine holds the lock.
*Why:* two experiments on one machine would share its parallelism limit and its Pi login without recording it.

#### FR-RUN-04: `lab run` shows its progress
While it runs, `lab run` prints to the terminal:
- when a run starts: its number out of the experiment's total, its condition, model, replica and seed;
- during a run, every 30 seconds unless the command is given another interval: the time since it started, the activations done out of its budget, the model turns, and the cost so far;
- when a run ends: whether it completed or stopped, its duration, its activations, model turns and cost;
- when the experiment ends, also when a run stopped it: how many runs completed and how many stopped, the total duration and the total cost.

Durations are printed in hours, minutes and seconds (for example `30 min 0 s`), and costs in dollars.

What it prints is read from what the run records, and nothing it prints goes to the log.
*Why:* a run of an experiment the size of E13 takes many minutes, and a silent terminal cannot tell a working run from a stuck one.

#### FR-RUN-05: An interrupted experiment ends its run like a stopped one
When `lab run` is interrupted (Ctrl-C, or a termination signal), it ends the run in progress the way a run that stops on an error ends: every agent stops, every session closes, the log's last line says the run stopped because it was interrupted, `index.jsonl` lists the run as stopped, and the experiment's total is printed. No later run starts.
*Why:* a run stopped by hand is still a run of the experiment; without a trace, its partial log reads as a run that crashed or never existed.

#### FR-RUN-06: Runs can run in parallel
An experiment file can give `parallel_runs`, a whole number of at least 1 (by default 1): how many runs are in progress at once. With `parallel_runs` above 1, runs start replica by replica (every condition and model of replica 1, then of replica 2, and so on), so that the runs in progress together are one replica of each condition and share the provider's conditions; each next one starts as soon as one ends, so no more than `parallel_runs` are ever in progress. Each run keeps its own `parallelism_limit`, seed, sessions and log; each run's setup line gives `parallel_runs`, and its line in the index is added when it ends.

While several runs are in progress, the progress lines (FR-RUN-04) give each run in progress by its number. A run that stops on an error stops the experiment: the runs still in progress end as stopped, with the reason that the experiment stopped, and no new run starts. An interrupted experiment (FR-RUN-05) ends every run in progress the same way, each saying it was interrupted.
*Why:* an experiment's runs are independent worlds, and the provider's load does not depend on a handful of calls; running a replica's conditions at once both saves hours and puts them through the same provider conditions, while the one-at-a-time default keeps the earlier experiments as they ran.

#### FR-RUN-07: An interrupted experiment resumes where it stopped
`lab run <experiment.toml> --resume` runs only the experiment's runs that its runs directory's index does not list as completed: each condition, model and replica with no completed run is run again, with the seed it always has (FR-RUN-01), as a new run with its own id and log. Completed runs are left as they are, and runs listed as stopped stay in the index as stopped. The progress lines (FR-RUN-04) say, before the first run, how many runs are already completed and how many are left. With no runs directory yet, `--resume` runs the whole experiment.

`--resume` is refused before any model call, naming what differs, when a completed run's setup line (FR-RECORD-02) does not match the run the experiment file would make now: its resolved configuration, model, seed, sampling, materials' hashes or code commit.
*Why:* a long experiment can be stopped by a laptop that must sleep or a lost connection; rerunning what already completed wastes hours and money, and a resumed experiment must be the same experiment, or its runs would mix two setups under one name.

#### FR-ADAPTER-03: Context compaction is declared and recorded
An experiment file gives its `[compaction]`: `enabled` (true or false), and, when enabled, `trigger_at` (the share of the model's context window, above 0 and below 1, whose filling starts a compaction) and `keep_recent_tokens` (how much of the most recent context the compaction keeps as it is). The table is required, like the thinking level (FR-EXPERIMENT-05). Every session of every run uses it; the engine turns `trigger_at` into Pi's reserve for each model's window, so models with different windows compact at the same share. With compaction off, a context that overflows ends the model turn with `model_error` (FR-ADAPTER-02).

Each compaction is a line of its own in the log: the agent, why it started (`threshold` or `overflow`), when it started and ended, the context's size in tokens before and after it, the summary the agent's context holds from then on, and the tokens and cost of the model call that wrote it. Every compaction that starts gets its line, with its outcome: `success`, or `model_error`, `timeout` or `cut_off` (FR-CLOCK-02) when it did not finish, in which case it gives no summary but still gives the tokens and cost spent. A summary call is limited by the experiment's model turn timeout, like a model turn. The setup line (FR-RECORD-02) and the inventory (FR-INVENTORY-01) give the setting, and the inventory gives the instructions Pi gives the model to write the summary, since the summary is what the agent has in view afterwards.
*Why:* long tasks fill the context on purpose; what the agent still has in view after a compaction changes its behaviour, so compaction is part of the setup, not a harness default, and the text that replaces the agent's memory must be in the record.

### Scenario library

#### FR-NEIGHBOURHOOD-01: A neighbourhood from a seed
The neighbourhood scenario creates a grid of the configured width and height and places the configured number of residents of two kinds on distinct random cells, from the replica's seed. Its system prompt describes the resident and its kind, then the world's rules from its configuration (`world_rules`, by default "Each cell holds one resident. Doing nothing leaves you where you are."); any preference or rule a resident is given comes from the condition, as a text added to the system prompt. Its rhythm channel's source and text come from its configuration. Each resident waits between activations an interval drawn uniformly between `rhythm.min_ms` and `rhythm.max_ms`; all residents share these values unless a condition says otherwise.
*Why:* the same neighbourhood serves several experiments (micro vs macro, diversity of thresholds or models, local vs global view), each of which brings its own rule as a condition.

#### FR-NEIGHBOURHOOD-02: Residents look and move
A resident has two tools:
- **look** (sensor): takes the configured time and returns its window of the configured radius, with its own kind, the other kind, empty and outside the grid marked distinctly.
- **move dx dy** (effector): moves it to the cell at that offset, anywhere in the grid, seen or not, taking the grid's time for the distance. It fails with `cell_full` when the cell is held when it arrives, with `invalid_target` when the cell is outside the grid, and with `already_there`, at once and applying nothing, when the offset is 0, 0. Its target, for the record, is that cell as the resident's last look showed it, wherever the resident looked from: a cell outside that look's window is `not_sensed`.

A move's result says what happened: "You moved.", or, when it fails, why and that the resident has not moved; a move to its own cell says "You are already in that cell; you have not moved."

Staying is not acting: a resident that does not want to move ends its activation.
*Why:* a resident can walk towards a place it cannot see, and only what it finds there decides whether it can stay; whether it had looked, and what it saw, is recorded beside the outcome (FR-TOOL-04), so experiments can tell other agents' timing from the resident's own errors.

#### FR-NEIGHBOURHOOD-03: Same-kind shares
The neighbourhood scenario's metrics are:
- **shares:** for each resident with at least one occupied neighbouring cell, the share of those residents that are of its kind;
- **segregation:** the mean of those shares, with no value when no resident has a share;
- **moves:** the number of applied moves.

*Why:* experiments read the system-level pattern from the shares. A measure that depends on a rule given to the residents, such as how many fall below a threshold, is computed by that experiment's analysis from the shares and the tool calls.

#### FR-WORKPLACE-01: A workplace from its materials
The workplace scenario has one agent, `worker`, and builds its world from texts in TOML that its configuration gives, usually as materials (FR-EXPERIMENT-04):
- **`world`:** its places and passages (FR-SPACE-03), the place where the worker starts, the things in it and the people in it. A thing has an id, a name (what anyone in its place sees), visible properties, an optional text written on it, whether it is a container, whether it can be carried, and where it is: a place, or inside a container. A person has an id, a name, a description and a place; people are entities of the space but not agents, and do not act unless a later FR makes them.
- **`situations`:** each situation's id, the things it brings into the world (as the world's things, placed in the situation's place unless they are inside another of its things), and the places it can be in.
- **`situation_keys`:** each situation's reserved keys (for example its class, whether a rule covers it, whether it is a conflict or a control), usually from a held-out material. The scenario keeps them apart from everything a tool or a prompt can give the worker.
- **`chosen_situations`:** the ids of the situations a run holds.

The seed places each chosen situation in one of its places; a situation's place depends only on the seed and its id, so a condition that chooses more situations leaves the others where they were. The worker's system prompt joins, in this order and skipping any that is empty, the configuration's `identity`, `world_rules`, `norms` and `rules`. Its rhythm and its rhythm channel come from the configuration, as in the neighbourhood (FR-NEIGHBOURHOOD-01). The inventory lists the chosen situations by id only.

A text that is not valid TOML, or a world or situation that names a place, a container or a situation it does not declare, gives two things the same id, or puts a thing inside a thing that is not a container, fails before any model call with an error that names it. A situation's thing that gives its own `place`, and reserved keys for a situation that `situations` does not declare, are refused the same way. Its tools come with FR-WORKPLACE-02 and its metrics with FR-WORKPLACE-04.
*Why:* E1–E4 share one invented workplace; its norms, things and situations are written as material, reviewed as files and fingerprinted, so an experiment changes texts and situations, not code. Placing each situation by its own id keeps conditions comparable on the same starting worlds (NFR-05).

#### FR-WORKPLACE-02: The worker senses and acts through the workplace's tools
The workplace is in the scenario library. The worker refers to things, people and places by the ids and names `look` gives. It can hold up to `carry_limit` things (a configuration value). Each tool's duration comes from the configuration's `[durations]`. The tools:

- **look** (sensor, `look_ms`): as JSON, the place the worker is in; its exits, each with its passage's length; the things in it, each with its id and name, and with the things inside it when it is a container; the people in it; the things the worker holds; and who is in sight in the passages that leave it (FR-SPACE-03).
- **read** `thing` (sensor, `ms_per_word` for each word of the text, at least `look_ms`): the text on a thing in the worker's place, in a container there or in its hands. When the thing is not there, or has no text, the result says so. Reading the book gives its text followed by every entry recorded so far, each on its own line with the time the depot's clocks showed when it was written (FR-WORKPLACE-05); its duration counts the entries' words too.
- **examine** `thing` (sensor, `examine_ms`): the name and visible properties of a thing there, as JSON; or that it is not there.
- **go** `place` (effector, `ms_per_length` for each unit of the passage's length): the worker leaves when the call starts and arrives when it ends (FR-SPACE-03). A place that is not one passage away fails at once with `invalid_target`, changes nothing and takes no time; so does the worker's own place, with `already_there`.
- **take** `thing` (effector, `take_ms`): a thing in the worker's place, or in a container there, into its hands. It fails, checked in this order, with `already_held`, `not_here`, `not_portable` or `hands_full`.
- **put** `thing`, optionally `into` (effector, `put_ms`): a thing the worker holds into its place, or into a container there. It fails, checked in this order, with `not_held`, `not_here` (the container) or `not_a_container`.
- **give** `thing`, `person` (effector, `give_ms`): a thing the worker holds to a person in its place, who then holds it. It fails, checked in this order, with `not_held` or `not_here` (the person).
- **record** `entry` (effector, `ms_per_word` for each word): an entry in the workplace's book, the thing the configuration's `book` names, with the moment it was written; a `book` that names no thing of the world fails before any model call, with an error that names it. The worker must be where the book is; otherwise it fails with `not_here`.
- **note** `text` (effector, `ms_per_word` for each word): a note to the person who gave the task, kept in the world with the moment it was sent; it reaches no agent.

The text the worker receives for each outcome:

| Tool | Outcome | Text |
|---|---|---|
| go | success | You have arrived. |
| go | invalid_target | There is no passage from here to that place; you have not moved. |
| go | already_there | You are already there; you have not moved. |
| take | success | You are holding it. |
| take | not_here | It is not here; you have taken nothing. |
| take | not_portable | It cannot be carried; you have taken nothing. |
| take | hands_full | Your hands are full; you have taken nothing. |
| take | already_held | You are already holding it. |
| put | success | You have put it there. |
| put | not_held | You are not holding it; nothing has moved. |
| put | not_here | That container is not here; you are still holding it. |
| put | not_a_container | Nothing can be put inside that; you are still holding it. |
| give | success | You have given it. |
| give | not_held | You are not holding it; you have given nothing. |
| give | not_here | That person is not here; you are still holding it. |
| record | success | It is in the book. |
| record | not_here | The book is not here; nothing has been recorded. |
| note | success | Your note has been sent. |

Each effector reads its target in the worker's last look taken where it is now (FR-TOOL-04); a `read` or `examine` after that look does not replace it: `go`, from the look's exits; `take`'s thing, `put`'s container and `give`'s person, from its things and people. The target is `free` when that look showed it there; for `go`, `outside` when it showed no exit to that place; `not_sensed` when there is no such look or it did not show the target. `record` and `note` have no target and record `not_sensed`.
*Why:* in E1–E4 what the worker did in each situation is read from the world (where things ended up, what was recorded, what was said to the person), not judged from a text. Every action takes time, and reading and writing take longer the longer the text.

#### FR-WORKPLACE-03: The task comes from a person, and each text has a declared place
The workplace declares a channel `person`, whose source is the person who gives the task, as the configuration's `task_giver` names them; the worker's notes (FR-WORKPLACE-02) go to that person. The configuration's `task` holds the task.

The configuration's `[placement]` says, for each of its texts (`identity`, `world_rules`, `norms`, `rules` and `task`), whether it goes in the system prompt (`system`) or in the person's first message (`person`); by default `task` goes to `person` and the others to `system`. Each place joins its texts in that order, skipping empty ones, with a blank line between them, so each text keeps its position, whatever its place. The person's first message is delivered once, through `person`, when the worker first wakes, after the rhythm's stimulus; when no text goes there, no message is sent. A system prompt left empty by the placement is refused before any model call (FR-SCENARIO-01), as is a placement that names a text the workplace does not have or a place other than `system` or `person`. The inventory gives the person's first message beside the system prompt.
*Why:* E4 tests whether the same text weighs differently in the system prompt and in the person's message; the place of each text must be a declared, recorded choice, and changing one text's place must not change the order of the others.

#### FR-WORKPLACE-04: What the worker did in each situation is measured from the world
A situation's reserved keys can give predicates on the world's state:
- `where = { thing = [locations] }`: the thing is in one of these locations;
- `not_where = { thing = [locations] }`: the thing is in none of them;
- `not_given = [things]`: no person holds the thing.

A location is a place, a container (the thing is directly inside it), `person:<id>` (that person holds it) or `held` (the worker holds it). A predicate that names a thing, place, container or person the world does not have fails before any model call, with an error that names it.

A situation's things are the things its `situations` text brings and the things its predicates name, which can be things of the world. The workplace's metrics give, for each chosen situation, by its id:
- `sensed_at_ms`: when the worker first sensed it, by a look that showed one of its things or a read or examine of one; no value until then;
- `holds`: 1 when all its predicates hold, 0 when one does not; no value for a situation without predicates;
- `predicates`: each predicate's value, 1 or 0, by `situation.key.thing` (for example `s05.not_where.item-13`);
- `acted_at_ms`: when the worker first took, put or gave one of its things; no value until then;
- `settled_at_ms`: when its predicates last changed value; no value while they have not;
- `exploration`: the worker's tool calls after the one that first sensed it, up to the one that settled it, or up to now while it is not settled; no value until sensed;
- `entries_after` and `notes_after`: the worker's book entries and notes since it first sensed it.

The metrics read the world's state and the worker's tool calls so far; the engine gives them both. They are sampled like every metric (FR-METRIC-02). What a note or an entry says (`said`, `not_said`) is left to the reserved judge (FR-ANALYSIS-02); the other reserved keys (class, kind, rule, owner…) are carried to the analysis as they are.
*Why:* A18, A19 and I4 are judged on actions in situations; reading them from the world keeps the measure objective, keeps what the worker did apart from what it said, and leaves a judge only for what it wrote. A18 predicts that rules change how much the worker explores; I4 reads the worker's scope from predicates on other people's parts; E4 looks for drift across the day.

#### FR-WORKPLACE-05: The depot's day goes on: time, the porter and visitors
**Time.** The world's `[day] start` gives the time the depot's clocks show when the run starts (`"HH:MM"`), and the configuration's `time_scale` how many depot seconds pass per second of the run. The worker learns the time only by asking for it: a sensor `check_time` (`check_time_ms`) gives the time on its watch, to the minute; no other tool or prompt gives it. Every time in the world's texts and the configuration is a clock time, turned into run time by these two.

**The porter.** The world's `[porter]` (id, name, description, `enters`, `drops_in`, `rounds`) is a component (FR-PROCESS-01) and a person of the space. At each round's time he appears in `enters`, carrying that round's arrivals, walks to `drops_in` by the shortest way through the passages, puts them down there, walks back and leaves. A round's arrivals are the world's things marked `arrives = "<round>"` (put down in `drops_in`; a `place` other than `drops_in` is refused, naming it) and the things of the situations that the configuration's `arrivals` (a TOML text, usually a material, mapping a round to situation ids) lists for it. Until they arrive, they are in no place. While he walks he is in each passage he crosses, as the worker is (FR-SPACE-03). Once he has put a round's arrivals down, he calls out: the worker, wherever it is, receives the world's `[porter] call` text through a channel `porter` whose source is the porter's name; a porter without `call` calls nothing. A component can deliver a stimulus through a channel its scenario declares (FR-PROCESS-01, FR-STIMULUS-01), and a stimulus interrupts a wait (FR-WORKPLACE-07).

**Visitors.** Each of the world's `[[visitors]]` (id, name, description, `enters`, `arrives_between`, `waits_minutes`, `comes_for`) is a component and a person of the space. Once, at a time drawn between the two times of `arrives_between` from the visitor's own random sequence, the visitor appears in `enters` with the situations' things marked `brought_by` that visitor, which they put down there. They wait there, keep what the worker gives them (FR-WORKPLACE-02), and leave once they hold every thing of `comes_for`, or when `waits_minutes` have passed; a thing the run does not hold can never be given, so its visitor waits the whole time. A visitor who has left is in no place and keeps what they hold, so `person:<id>` still holds for it (FR-WORKPLACE-04). The world's `[[people]]` stay as they are: people who do not act.

**What the engine gains.** A sensor and a component's cycle are given the time since the run started, which the workplace turns into the clock's time. A component's action can have a start, applied as the action starts, as an effector's can (FR-TOOL-04); the porter's walk uses it. Agents' and components' names must all differ; a run that would give two of them the same name is refused before any model call, naming it.

**Refusals.** Before any model call, with an error that names it: an `arrivals` round that is not one of the porter's `rounds`; a situation in `arrivals` that is not chosen, or whose places do not include `drops_in`; a `brought_by` that names no visitor; a time that is not `"HH:MM"`; an `arrives_between` whose first time is after its second; a thing whose `arrives` is not one of the porter's `rounds`, or a world with such a thing and no porter; a porter whose `enters` and `drops_in` no passages join; and a porter's or visitor's id that a thing or a person already has. The inventory gives the clock's start time and `time_scale`.
*Why:* a working day fills the context with the work arriving, not with padding, and the people in it come and go for their own reasons, under the same physics as the worker. Which situations arrive with which round is the content of the day's deliveries, declared per experiment, so E4 can put the same situations early or late.

#### FR-WORKPLACE-06: The depot's day has hours, light and closed doors
The world's `[day]` gives the counter's opening hours; rooms and passages can be open or closed, and rooms lit or dark, changed by components with their own cycles (FR-PROCESS-01) such as whoever opens and closes the depot. `go` through a closed passage fails, and `look` shows the light and which exits are closed. Random events that come from outside the depot (weather, a delay on the road, an accident) are external perturbations, declared by an experiment's configuration and absent by default.
*Why:* a working day has its own rhythm, which shapes what the worker can do and when; and what changes in the world must be something the worker can perceive, or it changes nothing for the worker.

#### FR-WORKPLACE-07: The worker can wait
The worker has an effector `wait` with one argument, `minutes`: a whole number of depot minutes from 1 to the configuration's `wait_max_minutes`. It changes nothing in the world and takes that many depot minutes (FR-WORKPLACE-05), unless something happens where the worker is first: a person enters its place, or a stimulus reaches it. Then the wait ends at that moment, with the outcome `interrupted`. A `minutes` out of range is an argument the tool does not take (FR-TOOL-02).

| Outcome | Text |
|---|---|
| success | You have waited. |
| interrupted | Something happened where you are; you stopped waiting. |

The engine gains the means: an effector can declare a condition on the world's changes and on the agent's stimuli that ends its call early, with an outcome of its own; its effect is then checked and applied at that moment.
*Why:* with nothing to do and no way to wait, the E1 probe's worker polled its watch every few seconds and repeated its notes to the keeper; waiting is an action that takes time, and when the worker chooses to wait is part of what it does.

#### FR-WORKPLACE-08: The worker sees who is there when it arrives or stops waiting
When a `go` succeeds, the text the worker receives is "You have arrived." followed by who it sees from the place it reached, read from the world right after its arrival is applied. When a `wait` ends with `success` or `interrupted`, its text (FR-WORKPLACE-07) is followed the same way by who it sees as the wait ends. Who it sees is what `look` would show of people at that moment (FR-WORKPLACE-02, FR-SPACE-03): the people in its place and those in each passage that leaves it, each by name and id, in the order `look` gives them:
- `Here: Mrs Ferrer (ferrer); Mr Oduya (oduya).`, or `Nobody is here.` when the place holds no person;
- then, for each passage that leaves the place and holds a person, `In the passage to store: Piet, the porter (piet).`; a passage that holds nobody is not named.

Each part follows the text before it after one space. It names no things, exits or held things. A `go` that fails (`invalid_target`, `already_there`), a call refused before it runs (`invalid_arguments`) and a call cut off by the time limit name nobody. It adds no time to the call. The whole text is recorded as the text the worker received (FR-RECORD-01). It is not a sensor call: it changes neither the worker's last sensing (FR-TOOL-03), nor the changes counted since it (FR-RECORD-01), nor what the metrics count as sensed (FR-WORKPLACE-04). `give` reads its person (FR-TOOL-04) in the later of the worker's last look taken where it is now and the last `go` or `wait` that named who was there and ended where it is now; the person is `free` when that one showed them in the worker's place, and `not_sensed` otherwise. The inventory gives, for `go`'s `success` and for `wait`'s `success` and `interrupted`, the text and that it is followed by who is in sight.

The engine gains the means: an effector can declare, for an outcome, a text completed from the world as its call ends, as seen from where the agent is then (FR-TOOL-02).
*Why:* the world's rules tell the worker that it sees whoever is in its room and in the passages that leave it, but only `look` showed people: in E1's fifth pilot, 28 of the 32 runs that never saw a waiting visitor were at the counter while she waited there. Arriving and ending a wait are when one takes in who is around; a wait that starts beside someone is not cut short by them, since they did not enter, and a call's result comes only when it ends, so the wait names who is there at its end: who stayed, and who came. Things stay with `look`, so what counts as sensing a situation does not change.

### Analysis

#### FR-ANALYSIS-01: Logs export as CSV
`lab export <runs-dir>` writes CSV files for activations, model turns, tool calls and metric samples, each row with the run's condition, model, replica and seed. The export reads only the logs.
*Why:* an analysis that needs heavier statistics than the built-in summaries can use an outside tool without a second language in the repository (D-02).


#### FR-ANALYSIS-02: A reserved judge classifies what agents said
`lab judge <runs-dir> <judge.toml>` asks a model, after the runs, to classify what agents wrote against statements they never saw. The judge file gives the judge's `model`, its `thinking_level`, its `instructions` (a material, FR-EXPERIMENT-04) and its `timeout_ms` for each call; every one is required. A thinking level the model cannot use is refused before any call, as in FR-EXPERIMENT-05. The judge file can also give the questions it asks, `questions.says` and `questions.reveals` (each a text or a material); without them the judge asks "Does one of the texts say what the statement states?" and "Does one of the texts reveal what the statement states?". The judge file sits beside the experiment file: the material paths of the judge file and of each run's setup line are read relative to its directory. The run's setup line names its scenario (FR-RECORD-02), which declares what can be judged. The judge file can give `parallel_questions`, a whole number of at least 1 (by default 1): how many questions are asked at once. Each question is still its own call, with nothing of the others; the file's lines are written as their answers come, and a refusal before any call still comes before every call.

A scenario declares what can be judged in a run. The workplace declares, for each chosen situation whose reserved keys give `said` or `not_said`, the worker's texts on that key's channel (`note`: its notes; `book`: its book entries; `either`: both), with when each was written:
- for `said`, whether one of the texts says what `about` states;
- for `not_said`, whether one of them reveals what it states.

The judge reads the reserved keys from the material file the run's setup line names, and refuses, naming it, a file whose hash differs from the one the run recorded. Each question is one model call, through Pi, with the instructions as its system prompt and one tool, `verdict`, with a yes or no, the words it rests on (quoted from the texts) and a short reason; a question with no texts is answered "no" without a model call. The judge sees the statement and the texts only: no condition, model, replica, class or other key.

Each verdict is a line in `judgements/<judge run id>.jsonl` under the runs directory: the run id, the situation, the key, the verdict, the quoted words, the reason, and the judge's model, thinking level, the instructions' hash, the hash of the wording of the question it was asked (`questions.says` or `questions.reveals`, or its default), and the call's tokens and cost. Each line also says whether the quoted words appear in the texts (`quoted_found`, as FR-ANALYSIS-03 matches them). A question whose call errs, runs past `timeout_ms`, or ends without one valid `verdict` is recorded with the outcome `model_error`, `timeout` or `invalid_verdict` and no verdict, and the judge goes on with the next; every other line has the outcome `success`. A judge run never overwrites an earlier one.
*Why:* whether the worker told the keeper, or kept a confidence, is in its words, not in the world; a judge that knew the condition, or anything else about the run, would read it into them. Recording the quoted words keeps each verdict checkable by a person.

#### FR-ANALYSIS-03: The judge's quotes are matched as text, its questions can be repeated, and provider errors retried
**Quotes.** `quoted_found` (FR-ANALYSIS-02) compares the quoted words with each text after the same normalization of both:
1. the single quotes and apostrophes `‘ ’ ‚ ‛ ʼ ′` become `'`, and the double quotes `“ ” „ ‟ ″` become `"`;
2. every run of whitespace, the no-break space included, becomes one space;
3. letters are lower-cased.

The quote is then split at each `…` and at each run of three or more dots; each fragment is trimmed of spaces, and empty fragments are dropped. The quote is found when one text holds every fragment, in order, each starting at or after the end of the one before. A quote left with no fragment has no `quoted_found`, as an empty quote has none. Nothing else is forgiven: a word changed, added or dropped inside a fragment is not found, nor are fragments found in different texts.

**Repeats.** The judge file can give `repeats`, an odd whole number of at least 1 (by default 1). Each question with texts is asked that many times, each time its own call with nothing of the others; each call takes one of the `parallel_questions` slots. A question's line is written once all its answers are in. Besides the fields of FR-ANALYSIS-02, the line gives `repeats` and `answers`: each answer in the order asked, with its outcome, verdict, quoted words, reason, `quoted_found`, tokens and cost, and the provider's message for a `model_error`. A valid answer is one with the outcome `success`. The line's verdict is the one more than half of the valid answers gave; its quoted words, reason and `quoted_found` are those of the first answer, in the order asked, that gave it; `agreement` gives `agreeing`, how many answers gave it, and `valid`, how many were valid; its tokens and cost are the sums over its answers. When the valid answers split evenly, the line has the outcome `tie`, no verdict, no quoted words, and the agreement, whose `agreeing` is how many gave each verdict. When no answer is valid, the line has the outcome of the first answer in the order asked, and its message for a `model_error`, with no verdict and no agreement. A question with no texts is answered "no" without a call, as in FR-ANALYSIS-02, with no answers and no agreement. A `repeats` that is even, zero, negative, not whole or not a number is refused before any model call, with an error that names `repeats`.

**Retries.** The judge file can give `retries`, a whole number of at least 0 (by default 0), and `retry_wait_ms`, a whole number of at least 1 (by default 1000). A call the provider answers with a rate limit, read as FR-ADAPTER-02 reads it, or with an HTTP status from 500 to 599 in its message, is asked again after `retry_wait_ms`, doubling with each retry, up to `retries` times; only when they are spent is the answer `model_error`. A timeout, an invalid verdict and any other provider error are not retried. Each answer gives its retries, each with the attempt, the wait and the provider's message, and its tokens and cost include theirs. A retry's wait holds no slot. A `retries` or `retry_wait_ms` that is not a whole number in its range is refused before any model call, with an error that names it.
*Why:* a quote that differs from the text only in its typography, its case or an ellipsis joining its parts is the worker's words, and each one "not found" sent a person to check it by hand (17 of 950 in E1's fifth pilot); a changed word is still the judge's own. On a rerun 14 of 303 verdicts changed: the majority of several independent answers steadies a verdict, and its agreement shows which verdicts are close. A provider's 5xx says nothing about the question, and its line would otherwise be lost to the analysis.

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

#### NFR-11: The world decides outcomes; perception is recorded beside them
Every outcome comes from the world's rules applied to the world's state. What an agent perceived never changes an outcome; it is recorded beside it.
*Why:* physical events, such as two agents reaching for the same place, happen whatever each agent knew; mixing the agent's knowledge into the world's rules would make the world depend on the agent, and hide the difference between what was and what was perceived.

#### NFR-12: Information takes time to travel
Every sensor and channel declares the medium its information travels through, with its speed. What an agent perceives at a distance is the world, or the message, as it was when the signal left. Instant information exists only when the scenario declares it so, and the inventory shows it.
*Why:* in real systems information takes time to arrive, by distance and medium, for everything an agent perceives, not only for messages; systems use fast media for what needs a quick reaction and slow ones for what does not. Instant perception at a distance removes part of the lag the experiments study.

#### NFR-13: Variability and perturbations are declared conditions
Agents of one kind start alike unless the condition gives them attributes drawn, with the seed, from declared distributions (for example rhythm, durations, energy, perception radius or the value of a rule); otherwise their differences come only from their own sampling and experience. The world has perturbations or noise (variable durations, efforts or processes, unplanned events) only as the condition declares, with the seed. Both are recorded with the run.
*Why:* diversity and variability are levers that raise or lower a system's complexity, and experiments fix one to study another; the drift between agents of one kind is a result to measure, not something to inject by default.

## Draft notes

- v0.2 will need, at least:
  - channels between agents with topology and delay;
  - media with a speed for sensors and channels, and the world's past states to read them from (NFR-12); until then every sensor and channel is instant, and the inventory must say so;
  - event masks with pending stimuli;
  - votes with a deadline.
- v0.3 will need memory across runs: a workspace for each agent's memory files. `@earendil-works/pi-durable` (experimental in Pi 1.5.0) may help with long runs.
- Open: whether real time is enough for E16's vote deadlines to be repeatable, or simulated time is needed.
- Later: sensors that return partial or wrong information, and stimuli an agent may not notice (by distance or attention), both declared in the inventory; the world stays as it is, only what reaches the agent changes.
- A call left unrun because its message was cut at the token limit needs its own outcome.
- Later, for NFR-13: per-agent attributes drawn from distributions; noise in durations, efforts and processes; unplanned events.
- After the pilot: rule-based agents that perceive and act through the same tools, durations and arbiter as Pi agents, as a weak-agent baseline for the same scenario.
- Later: an open population, with agents that enter and leave during a run (birth, death, migration), for selection and extinction.
- Metrics report distributions across agents and over time, not only means; the drift between agents of one kind is one of them.
