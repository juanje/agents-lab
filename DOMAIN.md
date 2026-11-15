# Domain

What the words mean here, how the pieces fit together, and how the tools behave on the pinned versions. When a pinned version differs, check the behaviour before relying on it, and update this file.

## Terms

| Term | Means | Not to be confused with |
|:--|:--|:--|
| Agent | One participant in a world: a model, the harness that runs it (a Pi session for the whole run) and the memory it keeps. | The model alone. Two agents can use the same model. |
| Tool | An agent's only interface with the world: a sensor or an effector, declared by the scenario with its description, arguments, duration, effort and failure reasons. | A function of the engine. Tools are what the agent's session offers. |
| Sensor | A tool that returns part of the world as seen from where the agent is, when its duration ends. It changes nothing. | An observation handed to the agent. Nothing is handed; the agent senses. |
| Effector | A tool that changes the world through the arbiter, when its duration ends. One under way in the world, such as crossing a passage, can also declare a start, applied through the arbiter as its call starts, once its duration is taken (FR-SPACE-03). | Text the agent writes, which acts on nothing. |
| Reflection | The text an agent writes in a model turn. It is recorded and reaches no one. | An action. |
| Stimulus | A message delivered into an agent's session through a declared channel, with its source (another agent or a mechanism of the world). | A tool result, which the agent asked for. |
| Channel | A declared path by which stimuli reach agents, naming their source (for example the agent's rhythm). | A tool. |
| Activation | A stretch in which an agent is awake: it starts with a stimulus from its rhythm and ends when a model turn makes no tool call. | A turn. Activations of different agents overlap and run at different paces. |
| Model turn | One call to the agent's model within an activation, giving text, tool calls or both. | An activation, which can hold many model turns. |
| Rhythm | The distribution an agent draws its waiting interval from between activations. | A turn. Rhythms are independent per agent. |
| Duration | The time a tool call takes before its result or effect. It can depend on the arguments and the state, such as distance. | Latency, which is the model's time. |
| Effort | The energy a tool call spends when it starts. | Duration. |
| Energy | An agent's capacity to act, up to a maximum; spent by effort and recovered by a process. The agent knows it only through a declared sensor or result. | A metric. |
| Process | A change the world applies on its own at an interval, through the arbiter (for example energy recovering). | An agent's action. |
| Component | A part of the world besides the agents that follows its own life cycle and calls no model (a porter on his rounds), declared by the scenario from its configuration as part of the world or an external perturbation (FR-PROCESS-01). Its cycle chooses each step (a wait, an action, a stimulus it delivers, or its end) from the world's state, its own random sequence, its last action's outcome and the time since the run started. | An agent, which has a model and acts only through tools; a process, which has no cycle or goals. |
| Participant | A party of the world declared in the configuration (`[participants.<name>]`, FR-PARTICIPANT-01) that perceives and acts only through its tools and channels, exactly as an agent does, decided by a named rule set the scenario provides or by a model. | A component, whose cycle reads the world's state; an agent, which the scenario names and which always has a model. |
| Adapter | The code that runs an agent's Pi session: its system prompt, tools, stimuli and model. | The agent. The adapter is how the engine talks to it. |
| World | The state of a scenario (entities, positions, quantities, energy) plus its arbiter. | The scenario, which also declares tools, channels and metrics. |
| Arbiter | The part of the world that applies one effect at a time against the current state. | A scheduler. The arbiter never decides who acts next. |
| Version | A counter of applied effects in a world. | A run id or a code version. |
| Scenario | A TypeScript module in `src/scenarios/` (its agents, initial state, tools, channels, metrics, and a system prompt and a rhythm for each agent, and optionally the channels of its first stimuli; agents, channels, prompts, first stimuli and rhythms from the configuration; and, for the inventory, text from the configuration that describes how each tool's duration and each agent's rhythm are computed, and, for a scenario that seeds situations, the ids of the situations the configuration chooses; and optionally its components, from the configuration) plus its base configuration, reusable by several experiments. | An experiment, which runs a scenario under several conditions. |
| Test scenario | A small scenario under `tests/fixtures/`, written only to test the engine. | A library scenario in `src/scenarios/`, which experiments use. |
| Condition | A named change over a scenario's base configuration, written directly or produced by combining factor levels. | A run or a replica. |
| Experiment | A file in the experiment language (TOML) in the experiments repository: scenario, factors and conditions, models, thinking level, compaction, replicas, seeds, prediction and materials. | A hypothesis, which the experiment states and tests. |
| Replica | One run of a condition with one model and one seed. | A fork, which continues a saved state. |
| Run | One execution of one replica; produces one log file. | An experiment, which is many runs. |
| Outcome | The single recorded result of a tool call: `success`, an engine failure (`invalid_arguments`, `no_energy`, `cut_off`, `cell_full`) or a failure reason of the world the scenario declares (for example `slot_taken`). It never says what the agent knew: that is recorded beside it as what the agent last sensed of its target (`free`, `held`, `outside`, `not_sensed`). A model turn ends with `success`, `model_error`, `timeout` or `cut_off` (the run's time limit passed during it); a script that runs out records `script_exhausted`, recognised by the faux provider's error text "No more faux responses queued" (`SCRIPT_EXHAUSTED_MESSAGE`); a Pi upgrade that changes it makes FR-ADAPTER-01's scenario fail. | A metric. |
| Changes since sensing | For an effector call, the number of effects other agents and components applied between the agent's last sensor call and the moment its effect was applied, recorded with the agent or component behind each of them, by name, in the order they were applied (`changesSinceSensingBy`); both are null when the agent had not sensed. | Latency. |
| Stale action | An effector call whose changes since sensing is above zero. | A failed call. A stale action can still succeed. |
| Target as sensed | What an agent last sensed of an effector's target before the call: `free`, `held`, `outside` (its last sensing showed the target is no place it can go) or `not_sensed`. Recorded beside the outcome. An effector's `readTarget` gets the agent's last sensing, or none when it has sensed nothing, and `lastBy`: by a tool's name, its last sensing by that sensor, or what that effector's sight last kept, whatever came after it. The workplace reads its targets in the worker's last look, so a later `read` or `examine` does not replace that look. `give` reads its person in the later of that look and the last `go` or `wait` that named who was there, each counted only when it was taken where the worker is now (FR-WORKPLACE-08). | The outcome, which only the world decides. |
| Latency | Time from a model turn's start to its answer. | Wait for a slot, which comes before the call. |
| Wait for a slot | Time a model turn waited because the parallelism limit was reached. | Latency. |
| Parallelism limit | The maximum number of model calls running at once. | The number of agents. |
| Inventory | The generated list of everything an agent meets in a scenario and condition. | The log. |

## How the pieces fit

### Each agent is a Pi session

- It lasts the run, driven by an async loop on Node's event loop: wait the rhythm, wake with a stimulus, run model turns and tool calls until a turn makes no call, then wait again.

### Every tool call goes through the world

**Sensors**
- A sensor reads it when its duration ends, from the state, the calling agent, the call's arguments and the time since the run started.
- That time is the run's `RunClock`, started when the agents can start, the moment the time limit counts from.
- The workplace turns it into its clocks' time (FR-WORKPLACE-05), and the read of its book turns each entry's `atMs` into the time the clocks showed then, as the entry's moment less the run's start, `performance.now()` less that time.

**Effectors and the arbiter**
- An effector's effect is checked and applied by the arbiter when its duration ends.
- Its action gets the call with `atMs`, the moment it is checked and applied, by `performance.now()` (a `LandingCall`), so a world can keep when something was written.
- The arbiter is the only writer of the world's state.

**An effector's start**
- An effector's start, when it declares one, is applied as the call starts and counts among other agents' changes since sensing.
- A start the world refuses stops the run, as a tool that throws does.
- A start that declares `appliesTo` is applied only to the calls it applies to; a call it does not apply to (the workplace's `go` to a place out of reach) starts nothing and writes no `effector_start` line, and its action alone gives its outcome.

**No action**
- An effector with no action (the workplace's `wait`) changes nothing: its call goes through no arbiter and succeeds.

**Refusals (`refuses`)**
- An effector may refuse a call from the state as it starts (`refuses`), with an outcome and a reason (`Refusal`).
- `invalid_arguments` is for a limit its schema cannot give, such as one the configuration sets, or a message its recipient cannot take (FR-MESSAGE-01).
- The call has that outcome, with `<outcome>: <reason>` as its text, applies nothing and takes no time.

**Reply (`reply`)**
- An effector may declare a reply (`reply`): its success's text, from the state right after its effect and the call, in place of a text (`read_mail`'s message).

**Early end (`endsEarly`, FR-WORKPLACE-07)**
- An effector may declare an early end (`endsEarly`, FR-WORKPLACE-07).
- Once its start is applied, its call watches the world's changes (`World.watch`, each with the state before and after it) and its agent's stimuli (`Stimuli.watch`, which takes none of them from the session).
- The first its conditions accept ends the call there, its effect is checked and applied then.
- Its outcome is the early end's when the effect applies, or the failure's reason when it does not.

**Sight (`sight`, FR-WORKPLACE-08)**
- An effector may declare a sight (`sight`, FR-WORKPLACE-08): for the outcomes it names, the outcome's text is followed, after one space, by what the agent sees from the state as its call ends, after its effect.
- What the sight keeps goes to `Sensings.sighted`, by the effector's name, for `lastBy`.
- It is no sensing: the agent's last sensing and its changes since sensing stay as they were.
- A call that fails with another outcome, is refused or is cut off gets no sight.
- The inventory lists a text a sight follows as `<text> (followed by <what it sees>)`; the workplace's `go` and `wait` are followed by who is in sight.

### Stimuli

- Stimuli from channels enter the session at the agent's next model turn, or when it wakes.
- A scenario may give each agent first stimuli (`firstStimuli`, channel names from the configuration, each declared, or loading refuses them).
- The agent receives them once, as it first wakes, right after the rhythm's and before any that arrived while it rested (the workplace's person's first message, FR-WORKPLACE-03).

### Processes

- Processes change the world on their own schedule, through the arbiter.

### Components

**Sequences**
- Components run alongside the agents from the moment the agents can start (`runComponent`).
- Each runs on a random sequence derived from the replica's seed and `cycle of <name>`, so adding one leaves the others' sequences as they were.

**Actions**
- A component's action takes its duration, then is checked and applied through the arbiter as an effector's is (`applyCounted`, shared with effectors), and counts by the component's name among the changes since sensing.
- Its cycle gets the outcome, and the time since the run started, before it chooses again.
- An action may have a start, applied through the arbiter as it starts and counted by the component's name, as an effector's (the porter's walk leaves as each crossing starts).
- A start the world refuses stops the run, naming the component and its action.
- The start writes no line of its own: the action's `component_action` line covers it.

**Delivering stimuli**
- A component delivers a stimulus to an agent through a channel its scenario declares with a `deliver` step, which takes no time and is no action.
- The `stimulus` line records it, and, like any stimulus, it interrupts a `wait` (FR-WORKPLACE-07).

**The run's end and names**
- The run ends once every agent and every component has ended, or at its time limit, which cuts off an action still running: it applies nothing and is recorded `cut_off`.
- A run may have components and no agents.
- A run whose agents and components do not all have different names is refused before its log opens, naming the name taken twice.

### The recorder

The recorder writes a line per event. The inventory and the run's setup go first.

**`run_setup` (FR-RECORD-02)**
- A run of an experiment writes `run_setup` first (FR-RECORD-02).
- It gives: its run id, experiment, `scenario` (its name in the library, which the judge asks what it declares), condition and resolved configuration, replica, seed, model.
- It gives the code's commit and whether its working tree had uncommitted changes (git, run in the engine's own directory; a run fails before it starts when git cannot tell).
- It gives the condition's inventory as data, `compaction` (the experiment's setting, FR-ADAPTER-03), `parallelRuns` (the experiment's `parallel_runs`, FR-RUN-06), and `sampling`.

**Sampling and thinking levels**
- Each session gets the experiment file's `thinking_level` (FR-EXPERIMENT-05), read back from each opened session into `sampling.thinkingLevels`.
- The engine sends no other sampling parameter, so every other one is the provider's default.
- Pi 1.5.0 would clamp a level a model cannot use to another without saying so (and default to "medium" when given none).
- So `runExperiment` checks the level against Pi's `getSupportedThinkingLevels` for every model before the first run and refuses it, naming the model and the level; a model without reasoning can use only "off".
- So the line is written once the sessions are open, before `onStart` is called; when a session fails to open, it is written with `sampling: null` before `run_stopped`.
- A direct `run()` without `setup`, as tests make, writes none.

**The log file**
- Each run opens a new `<run id>.jsonl` in the log directory it is given, created exclusively (it refuses a file that is already there), and writes each line at once, synchronously.

**Lines**
- `run_setup`.
- `activation`.
- `stimulus` (as it is delivered: a channel's when `Stimuli.deliver` is called, the rhythm's and the agent's first stimuli as the agent wakes).
- `model_turn` (with `reasoning`, the answer's thinking blocks' text joined, only when the provider returned any; a redacted block is recorded as Pi gives its text).
- `rate_limit_retry` (as a model turn's rate-limit answer is retried: the agent, `attempt` from 1, `waitMs` and `atMs`, when the wait started; FR-ADAPTER-02).
- `effector_start` (as an effector's start is applied: the agent, the tool, `atMs`, the moment its call started, and `change`, as the effector's `describe` gives it from the state before).
- `tool_call`.
- `component_action` (as a component's action ends: the component, the action's name, when it started and ended, and its outcome).
- `compaction` (as each compaction Pi starts on an agent's context ends):
  - the agent, `reason` `threshold` or `overflow`, `outcome`, when it started and ended, and the `tokens` and `cost` of its summary calls, summed when Pi made two;
  - one with the outcome `success` also gives `contextTokensBefore` and `contextTokensAfter` as Pi estimates them and the `summary` the context holds from then on;
  - one that did not finish, `model_error`, `timeout` or `cut_off`, gives neither.
- `metric_sample` and `run_stopped`.
- Every time in them is by `performance.now()`.

**Stopping**
- The first error that stops a run writes `run_stopped` with its message at once and aborts the run as its time limit does; nothing is written after it.
- A tool that throws, or a session that fails to open, stops the run: the scenario's defect, not the agent's behaviour, so the call that threw has no `tool_call` line.

### Metrics

**When they are read**
- Metrics read the state and the tool calls so far (every agent's `ToolCall` records, in the order they ended; a call still under way is not among them).
- At the start (once every session is open, when the time limit starts).
- Every `metric_interval_ms` of the experiment file (each sample at least that long after the previous one, by `performance.now()`).
- And at the end, once every agent has stopped.

**`metric_sample`**
- Each `metric_sample` line gives `atMs`, the world's `version` and each metric's value: a number, `null`, or an object of values by name (an agent's, or a situation's id).

**The workplace's metrics (FR-WORKPLACE-04)**
- The workplace's metrics (FR-WORKPLACE-04) give one value per chosen situation, leaving out a situation with no value yet.
- A situation's things (`situations[id].things`) are those its text brings, then those its predicates name, which can be things of the world; all count for `sensed_at_ms` and `acted_at_ms`.
- A thing's location is where it directly is: `held` (the worker's hands), `person:<id>`, the container it is in, or its place, so a thing inside a box in the store is in the box, not in the store.
- The world keeps each move of a thing (`moves`: from, to and the moment it landed, by `take`, `put` and `give`), and `settled_at_ms` replays them to find when a situation's predicates last changed.
- `sensed_at_ms` and `acted_at_ms` are the end of the worker's call.
- `exploration` counts its calls after the sensing one that started no later than the settling move.
- `entries_after` and `notes_after` count what was written at or after `sensed_at_ms`, and give no value before it.
- A thing in no place (one that has not arrived, FR-WORKPLACE-05) has no location: no `where` holds for it, every `not_where` does, and it is given to no one; its arrival is not a move.

### The calendar (FR-CLOCK-03, `src/engine/calendar.ts`)

**Configuration and refusals**
- A configuration's `[calendar]`, read by `loadScenario` into `LoadedScenario.calendar` and refused there, before any model call, with an error that names the key when it cannot be followed.

**World time**
- The world's time is kept as world seconds since day 1's midnight.
- Each segment spans from the previous `until` (or the start) to its own (the last to infinity), and one run second in it is `scale` world seconds.

**The run's clock**
- The run's `RunClock` holds the calendar.
- A sensor's `sense` and a component's `next` get the world's time (`WorldTime`: day, weekday, whole seconds since midnight) after the time since the run started, undefined for a run without a calendar.
- A tool's `durationMs` or a component action's may be `{ worldSeconds }`, which `RunClock.runMsOf` turns into the run time it spans from that moment (a run without a calendar refuses it as the scenario's defect).
- `hoursAt` says whether a world time is within named hours (`from` included, `to` not) and gives their next beginning strictly after it.
- An effector's action (`LandingCall.world`) and a component's (`ComponentLanding.world`) are given the world's time as they land (`RunClock.worldTimeKey`).

**Inventory and the workplace**
- The inventory gives the calendar as `### Calendar`.
- The workplace keeps its own clock (below) and refuses a `[calendar]` beside `time_scale` or `[day] start`.

### The mail (FR-MESSAGE-01, `src/engine/mail.ts`)

**Configuration and refusals**
- A configuration's `[mail]`, read by `loadScenario` (`readMail`) and refused there, naming the key, when it cannot be followed.
- It needs a `[calendar]`, since its durations are world time.
- A scenario that takes mail says where its state keeps it (`Scenario.mail`, a `MailKeeper`: `of` and `with`).
- The engine puts the starting mail there (each mailbox with its messages at the start, unread).
- It adds the `mail_notice` channel when the mail declares a `notice` (its text's `{from}` and `{subject}` filled in as `Stimuli.deliver` delivers it).
- Mailboxes are `[mail] mailboxes`; a recipient without `[mail.acts.<name>]` takes every act.
- Message ids are `m-<n>`, numbered across the run (messages at the start first).

**Tools (every agent gets them)**
- `send_mail` (an effector; refused as it starts as `unknown_recipient`, `act_not_taken` or `missing_field`; its action puts the message in transit, with the world's time it was sent).
- `check_mail` (a sensor: `<id>: from <sender>, subject "<subject>", received day <n> <weekday> HH:MM` per line, oldest first, or `No messages.`).
- `read_mail` (an effector: `no_such_mail` by its precondition, otherwise it marks the message read and replies with it).
- A send's words count its subject only as given.

**Components**
- A component's cycle gets its unread messages and takes `send` and `read` steps, actions through the arbiter with the same durations and refusals (`mailAction`).

**Delivery (`MailMedium`)**
- The run's `MailMedium` watches the world for messages entering `inTransit` and records `message_sent`.
- It draws the delay uniformly between `delivery_minutes` from `mail of <sender>`.
- It delivers through the arbiter (counted as `mail` among the changes since sensing), records `message_delivered` and sends an agent recipient the notice.
- Messages at the start get a `message_delivered` line at the run's start.
- A run waits for its messages in transit to land, or for its time limit, which leaves them undelivered.

**Inventory**
- The inventory lists the mail's tools, its notice's channel and a `mail` part (`### Mail`).

### Participants (FR-PARTICIPANT-01, `src/engine/participants.ts`)

**Configuration and refusals**
- A configuration's `[participants]`, read by `loadScenario` (`readParticipants`) after the mail and refused there, naming the key, when one cannot be followed.
- Each has `tools` and `channels` (names the scenario, its mail included, declares).
- Optional `hours` (a set of the calendar's) and `reply_minutes` (both refused without a `[calendar]`).
- `decides = "rules"` with `rules` (a name in `Scenario.ruleSets`) and `[participants.<name>.params]`, or `decides = "model"` with `model` and `system_prompt`.

**Decided by a model**
- A participant decided by a model is loaded as an agent: its system prompt, the scenario's rhythm, no first stimuli, and a session offered only its own tools.
- The caller of `run()` gives it as one of the agents, and `lab run` gives it the experiment's model, not its `model`.

**Stimuli**
- A stimulus reaches a participant only through a channel it declares (`Stimuli.only`): one on another channel, the mail notice included, is dropped before any hold and never recorded.
- A participant with hours or a reply delay has its stimuli held (`Stimuli.hold`).
- Each reaches it, and only then is recorded and waits for it, at the first moment within its hours at least a delay drawn uniformly between `reply_minutes` from `replies of <name>` after it was delivered (`reachedAfterMs`).
- One the run's end overtakes never reaches it.

**Decided by rules**
- A rule set (`RuleSet.start(params)`, giving `Rules`) is woken by each stimulus that reaches its participant.
- It answers each step from `Perceived` only (the stimuli that reached it since its last step, and its last call's result: tool, outcome, text) with:
  - a call of one of its tools;
  - a wait (`{ kind: "wait", minutes }`, world minutes, ended early by a stimulus that reaches it; it is then given only the stimuli waiting, no result);
  - or the end, after which it waits for the next stimulus.
- `Rules.atStart()` may give a first step as the run starts, taken as a wake with no stimuli.
- Stimuli that arrive while it works are given with its next step.
- Its calls run through `callTool`, the same path as an agent's (`caller: "participant"`, so a tool's error names the participant), recorded as `tool_call` lines under the participant's name, with no model turn.
- A rule set's wait is not logged.
- A call of a tool the participant does not declare stops the run, naming both.

**The run's end**
- The run waits, after its agents and components, until no message is in transit, no stimulus is held and no rule set is at work, or its time limit.
- Then each rule set's `outcome()` is a `participant_outcome` line (`participant`, `outcome`) before the last metric sample.

**Inventory**
- The inventory gives each participant as read (`### Participants`).

### The phone (FR-PHONE-01, `src/engine/phone.ts`)

**Configuration and state**
- A configuration's `[phone]`, read by `loadScenario` (`readPhone`) before the mail and the participants, and refused there, naming the key; it needs a `[calendar]`.
- A scenario that takes calls says where its state keeps them (`Scenario.phone`, a `PhoneKeeper`).
- Calls are `c-<n>`, numbered across the run, each `ringing`, `unrung` (placed while its callee was busy or outside its hours, failing as `busy` or `no_answer`), `connected` or `ended`.

**Tools and channel**
- Every agent gets `call` and `answer_call`, and loading adds the channel `phone`, whose text is `ring`.
- `call` is refused as it starts as `send_mail` is (`unknown_recipient` when the callee has no line; the acts are the callee's mail acts, `actRefusal`).
- `call`'s start places the call through the arbiter (an `effector_start` line).
- It lasts until its call ends (duration `Infinity`, which `waitAtLeast` waits out only on its signal), ending early with the outcome the world gives (`EarlyEnd.outcomeOf`): `success` with `Answer from <callee>. Act: <act>.`, its fields and text, or `no_answer` / `busy`.
- `answer_call` is refused as `no_such_call` unless the call is ringing for its caller.
- An answered call keeps `endedAt`, the world time its `answer_call` landed (FR-CONGRESS-13); the call line does not repeat it beside its `ended` moment.
- Its start connects the call, it lasts `call_minutes` plus the words of both texts, and its action ends the call `answered`, which ends the caller's `call` at the same moment.
- Its success text is `The call has ended.`

**The run (`PhoneExchange`)**
- The run's `PhoneExchange` watches the world.
- A ringing call is delivered at once to its callee through `phone`, from the caller as source and not held for a reply delay (`Stimuli.deliver`'s `source` and `held`).
- Every placed call is ended through the arbiter when `ring_minutes` end if still ringing or unrung (counted as `phone`).
- Each call writes a `call` line as it ends (its moments `rang`, `answered`, `ended`, each `atMs` and `worldTime`), and calls the run's end cut off get one with `cut_off`.
- The run waits for rings to run out.
- A participant that keeps the channel `phone` needs `answer_call`.

**Inventory**
- The inventory lists the phone's tools, its channel and a `phone` part (`### Phone`).

### Money (FR-MONEY-01, `src/engine/money.ts`)

**Configuration**
- A configuration's `[money]`, read by `loadScenario` (`readMoney`) and refused there, naming the key; it needs a `[calendar]`.
- Accounts are `[money.accounts.<name>]` with `opening` or `unlimited = true` (a balance the world does not follow, kept as `null`), and optionally `ceiling` (at least 0), in force from the start (FR-CONGRESS-11).
- For an agent, accounts also have `tools` (the money tools its session is offered; a participant has its own `tools`).
- Each money tool takes `[durations].<tool>` world minutes (0 when not given).

**State**
- A scenario that takes money says where its state keeps it (`Scenario.money`, a `MoneyKeeper`).
- The state holds balances, invoices (`i-<n>`), commitments (`k-<n>`, recorded `by` the caller `with` an account), ceilings, overruns and every event.

**Tools and refusals**
- `issue_invoice`, `void_invoice`, `pay`, `transfer`, `commit`, `release` and `approve` are effectors.
- `void_invoice` voids an invoice its caller issued (FR-CONGRESS-13): unpaid, it is `voided` and no longer due (event `void`); paid, its amount goes back to whom paid it (event `refund`). `pay` refuses a voided invoice as `invalid_arguments`, with no time.
- Invalid arguments (an amount not positive, an unknown account, a `due` not `day <n>`, a caller without an account) are refused as `invalid_arguments` with no time.
- `pay` fails at landing as `no_such_invoice`, `already_paid` or `insufficient_funds`, `transfer` as `insufficient_funds`, `release` as `no_such_commitment`.
- A commitment that leaves its account's committed total above its ceiling, or `discretionary_limit` without one, and above every committed total the account had before it, adds an `unapproved_overrun` (never refused); the highest total is read from the account's commitment and release events (FR-CONGRESS-13).
- `ledger` is a sensor giving JSON (`balance`, `invoices_to_pay`, `invoices_issued`, `commitments_bound`, `commitments_recorded`, `ceiling`); a voided invoice is not among `invoices_to_pay` nor a summary's `unpaid`, and is marked `voided` among `invoices_issued`.

**What is recorded**
- The run's `MoneyBook` writes a `money` line for each event (`kind`, `from`, `to`, `amount`, ids, `atMs`, `worldTime`) and, as the run ends, a `money_summary` per account.

**Inventory**
- The inventory has a `### Money` part.

### Parts (FR-PARTS-01, `src/engine/parts.ts`)

**What a scenario provides**
- A scenario provides `Scenario.parts`:
  - `predicates`: state × params → holds;
  - `events`: state × params → the world time of the event's first record;
  - `misapplications`: an `Act` — agent, tool, arguments, world time it landed — × params → matches.
- An experiment file's `kind_factor` reaches every condition as `Condition.kindFactor` (`name`, and `levels` when it is one of the file's factors).

**Configuration and refusals**
- A configuration's `parts` text (a held-out material, so the setup line keeps its hash and hides its text) is read by `loadScenario` (`readParts`).
- Its shape: `[[parts]]` with `id`, `predicate`, `params`, `activation` `always` or `{ event, params }`, `evaluate_at` `"day <n> HH:MM"`, `end` or `{ event, params, after_minutes }`, `kinds` by level, `actors`, `misapplications` with `pattern`, `params`, `before`/`after` an event.
- It is refused, naming `<id>.<key>`, `kind_factor` or the id given twice.
- `LoadedScenario.parts` gives them with the condition's level.

**In a run (`PartsBook`)**
- The `PartsBook` checks each active part's predicate after every change of the world (keeping its intervals).
- It timestamps money events and the agents' acts (only the run's agents, recorded as each call is recorded).
- It writes a `part` line (`part`, `evaluated_at`, `active`; when active):
  - `held`;
  - `reached_at` — the start of the last interval in which it held —;
  - `effort` `{ calls, money }` — calls whose arguments name an actor, and payments and commitments from an agent to an actor, from its activation to `reached_at` or its evaluation —;
  - `misapplications` with `tool`, `arguments`, `at`, and `kind` unless it is an outcome; only acts that took effect (outcome `success`, or none given) are matched, so a refused call (`missing_field`, `unknown_recipient`, `act_not_taken`, an unanswered call...) never is (FR-CONGRESS-18).
- A part due at a world time keeps the run going until then (or the time limit).
- As the run ends the book evaluates what is due and `end` parts and writes `parts_not_evaluated` with the others.
- Part times are written `"day <n> HH:MM"`.

### A part's group (FR-PARTS-01's addition)

- A part may give `group`; its line gives it, active or not, and it stands for a level's missing kind.
- Kinds for levels the experiment does not run are dropped as the parts are read.
- `lab parts` treats a line with a group or a kind as a part and counts the Kinds table by the group.
- It reads materials from the directory of the setup line's `experimentFile`, against the directory the runs were written under (`<it>/runs/<id>`).

### The depot's day (FR-WORKPLACE-05)

**Clocks**
- The world's `[day] start` (midnight when it has none) and the configuration's `time_scale` (1 by default) set the clocks (`state.clock`).
- Only `check_time` gives the worker the time.
- Every clock time is `"HH:MM"`, turned into run time as `(seconds − start) / time_scale` seconds.

**People and refusals**
- The porter (`state.porter`) and each visitor (`state.visitors`) are components and people of the space (`state.people`), in no place until they appear and after they leave.
- A porter's or visitor's id that a thing or a person already has is refused.
- So are a thing that arrives at no round of the porter's or in a world with no porter, and a porter whose `enters` and `drops_in` no passages join.

**The porter's rounds**
- Each round's things are the world's things marked `arrives` and the top-level things of the situations `arrivals` lists for it (an arriving situation is placed in `drops_in`, not by the seed).
- The porter appears in `enters` holding them, walks the shortest way (passages declared first win a tie) with `ms_per_length`, and puts them down in `drops_in` with `put_ms`.
- He calls out when the world's `[porter] call` gives him a call (the worker receives it wherever it is, on the channel `porter`, whose source is his name; a porter without a call declares no such channel and calls nothing).
- Then he walks back and leaves; appearing and leaving take no time.

**Visitors**
- A visitor's arrival is drawn from their own sequence between the two times of `arrives_between`.
- They appear in `enters` and put down at once the top-level situation things marked `brought_by` them.
- They notice what they hold each depot second, and leave once they hold all of `comes_for` or after `waits_minutes`.

**The worker's `wait` (FR-WORKPLACE-07)**
- The worker's `wait minutes` (FR-WORKPLACE-07) lasts that many depot minutes, from 1 to the configuration's `wait_max_minutes` (60 in the base configuration; any other number is refused as `invalid_arguments`), and changes nothing.
- It ends early as `interrupted` when a person (one of `state.people`: a person, the porter or a visitor) is in the worker's place after a change and was not before it, from a passage or appearing there.
- It also ends early when any stimulus reaches the worker; that stimulus still waits for the worker's next model turn.

### The congress (FR-CONGRESS-01, `src/scenarios/congress.ts`)

**The agent**
- One agent, `organiser`, starting in `organiser_place` (`office` by default).

**Texts (TOML, refused at load naming the key)**
- `city`: places; venues with `entrance`, `hours` and `rooms` with `seats` and `equipment`; passages with `length` in world minutes and `step_free`.
- `pools`: `topics` and a list of templates per kind, each with an `id` and parameters.
- `draw`: `attendance` and a count per kind.

**The variant**
- `Scenario.variant` draws, from `variant` of the seed, the topic, a whole attendance and each kind's templates.
- The run's log gives a `variant` line before anything acts, and loading takes the configuration it completes.
- Each chosen template of a kind with `[kinds.<kind>]` becomes a participant (`decides = "rules"`, the kind's keys, the template's other keys as `params`) with a mailbox and a line when the configuration has `[mail]` and `[phone]`.
- Only chosen venues' places are laid out.

**Tools and durations**
- Durations are world minutes (`[durations]`: `check_time`, `look`, `write_note`, `read_notes`; `go` its passage's length; `wait` its minutes, up to `wait_max_minutes` ≤ 1440).
- `look` gives JSON (`place`, `closed`, `exits` with `length` and `step_free`, `seats`, `equipment`, `people`).
- A venue's interior is closed outside its hours by the world's time (effectors' `refuses` gets it), so `go` there fails as `closed` and `look` hides those exits.
- `read_notes` is an effector refused as `no_such_note`.
- `Scenario.slowedBy` makes the engine's own tools (mail, phone) take `away_factor` times their duration for the organiser away from `office`.

**Prompt and inventory**
- The prompt joins `task`, `limits`, `restrictions`, `knowledge` and `guidance` per `[placement]`, the person's message from `task_giver`.
- `Scenario.worldInventory` gives the inventory a `### World` part as JSON.

### Venues and the board (FR-CONGRESS-02, `src/scenarios/congress-parties.ts`)

**Rule sets**
- The congress provides the rule sets `venue` and `board`, written as generators over `RuleStep`s.
- A `Party` helper gives calls, waits, the clock through `check_time`, the mail through `check_mail`/`read_mail`, the ledger, and answering rings with `answer_call` with probability `pick_up`.
- A rule set starts with `RuleSet.start(params, random)`, its sequence derived from the seed and `rules of <name>`.

**The base configuration**
- It declares `[mail]`, `[phone]`, `[money]` (the organiser's account), `[kinds.venue]` and `[kinds.board]` (with `account`: `"unlimited"`, or the template key giving the opening, here `funds`), `event_day` and `[perturbations]`.

**A venue's params**
- The variant gives each venue's params its template plus `id`, `organiser`, `event_day`, its interior's true `floor_plan` from the city and its `room_allocation` perturbation; the venue change is the world's (FR-CONGRESS-13).
- Perturbations are `[perturbations.<name>]` with `between` or `at` as `"day <n> HH:MM"`, `kind`, optional `for`.

**What a venue keeps**
- Its dates (`free`, `held`, `contracted`, `confirmed`, `other`), contracts (`<venue>-contract-<n>`) and timers (hold lapse, challenge lapse, deposit reminder and cancellation, enquiries at `enquiries_per_day`, room allocation).
- The venue change reaches it on the channel `venue_change`, its text the declared `kind` or empty (then drawn), and changes its contracted or confirmed booking.
- A challenged hold ends at its `confirm_by`.
- Commitments and invoices carry `for` texts (`<contract>`, `<contract> extra <item>`, `deposit <contract>`, `cancellation <contract>`) by which it finds them again in its ledger.

**Outcomes**
- A venue's outcome gives counts, `dates` and `history` as JSON texts; the board's gives approvals, refusals and funds transferred.

### Speakers and the partner (FR-CONGRESS-04, `src/scenarios/congress-parties.ts` and `congress.ts`)

**Rule sets and configuration**
- The rule sets `speaker` and `partner` (the speaker's, with `partner: true`: it accepts any invitation and takes only `invite`, `confirm`, `change` and `ask_slides`).
- `[kinds.speaker]` and `[kinds.partner]` are in the base configuration (account `"unlimited"`, the tools of mail, phone, `check_time`, `ledger`, `commit`, `release` and `issue_invoice`, the channels `mail_notice`, `phone`, `early_cancel` and `late_cancel`).
- A template's `reply_minutes` and `hours` are its participant's, in place of its kind's.
- A speaker's params are its template plus `organiser` and `event_day`.

**A speaker's draws**
- Its own sequence draws, in order, one number per invitation it does not decline at once (decline below `1 − acceptance`), per ring it hears (`pick_up`), and per `ask_slides` (slides below 0.8) or `ask_panel` (accept below 0.6, when available).

**A speaker's answers and fees**
- Its answers to an invitation carry `session` (and `condition` for `accept_if`).
- The agreed fee is the invitation's, or its own `fee` once a `fee` condition is accepted.
- It `commit`s it as `fee <id>` on its first `acknowledged`.
- A withdrawn invitation after `accept` invoices it as `claim <id>`, due that day, with `broken_agreement`.
- With an `accept_if` pending it waits until day 19's start and mails `withdraw`.

**Cancellations**
- An illness on `early_cancel` makes it mail `cancel`; on `late_cancel` it calls the organiser with `cancel` and mails it when the call does not succeed.
- As it cancels it releases its `fee <id>` commitment (FR-CONGRESS-13).

**Outcome**
- `invitation` (JSON), `answer`, `condition`, `condition_met`, `believes_time`, `believes_room`, `cancelled`, `broken_agreement`, `claim`.

**The partner's session**
- The variant puts in `[mail] initial` the board's `partner_session` (fields `speaker`, the partner's `session` from its template) received at the calendar's start, from the drawn board.

**The `early_cancel` and `late_cancel` components**
- `early_cancel` and `late_cancel` are components of the kind `perturbation` (`Scenario.components`), on the speakers of the rule set `speaker`.
- Each draws its time and an order of them from `cycle of <name>`, and waits by `reachedAfterMs`.
- At its time it takes the first in its order whom a `confirm` from the organiser has reached (by its time) and who has not cancelled, both read from the record of acts, mail and answered calls (FR-CONGRESS-13).
- `early_cancel` with none looks again each world hour for the next confirm and fires 2 days after it was received.
- It delivers on its own channel (source `illness`) with `held: false`, which a component's `deliver` step may give so that hours and reply delays do not hold it.
- Venues get none of these perturbations.

### Caterers, sponsors and services (FR-CONGRESS-05, `src/scenarios/congress-parties.ts` and `congress.ts`)

**Rule sets and fields**
- The rule sets `caterer`, `sponsor` and `agency`, with their kinds in the base configuration (accounts: caterer and agency `"unlimited"`, a sponsor's opening its `amount`).
- Fields are scalars: counts by diet travel as `"standard: 50; vegan: 6"`, diets as `"vegan: no limit; gluten_free: 5"`, sponsor conditions as `"logo, morning_slot"`.

**Caterers**
- A caterer's `diets` is a table of diet → `{ limit? }`; standard meals have no limit and a diet it does not serve is refused as over its limit.
- Its order is committed as `order <id>` and its deposit invoiced as `deposit order <id>`.
- Final numbers are on time before day `event_day − final_days`, after it only an increase of at most 5% with a 10% surcharge on the increase.
- The balance (price less deposit) is invoiced at the start of day `event_day − 5`, due on the event day.
- The variant leaves a caterer with `in_house_for` out of the draw and adds it when its venue is chosen.

**Sponsors**
- A sponsor answers `agreement` on its own conditions, `refused` (naming `missing`) when a counter drops what it insists on, else `agreement` with probability `counter_acceptance` (0 when absent) or `withdraw`.
- The money's book delivers, when the run declares the channel `invoice_notice` (`INVOICE_NOTICE`, text `{from}` and `{for}`), a stimulus to each invoice's recipient with the issuer as source.
- A sponsor with an agreement then reads its ledger and pays each unpaid invoice from the organiser within what is left of its amount, `pay_days` after, drawn from its sequence, until it withdraws.
- `sponsor_withdraws` is a perturbation component for the sponsor it names (refused for any other party), delivered with `held: false`.

**The agency**
- The agency books a date at least `notice_days` away (`booked`, a commitment `interpreting <id>`), else `unavailable`.

**Releasing commitments**
- `Party.release(matches)` releases the commitments its ledger gives whose `for` matches.

**Travel**
- The world's `travel` account (`Scenario.worldAccounts`, which money accepts besides agents and participants) invoices the organiser through `invoiced()` for what `book_travel` books.
- The materials `travel` (`stations`, `trains` with `from`, `arrives`, `price`; `hotels` with `near`, `rooms`, `price`; `sold_out_probability`) and `similar_events` (`events` with `topic`, `name`, `price`, `size`) are TOML texts.
- `travel_options` gives, as JSON:
  - the trains from a station for a date (option `<train> day <n>`, price × (1 + 0.8 × max(0, 14 − days left) / 14), rounded; sold out in the last 2 days when the train's draw from the initial-state sequence is below the probability);
  - and the hotels with their rooms left the night before (option `<hotel> day <n−1>`).
- `book_travel` fails as `no_such_option` or `sold_out`.
- The travel's bookings are kept in the world (`travel.booked`) and logged as the money's invoices from `travel`.

**Similar events**
- `similar_events` lists the drawn topic's congresses, and the variant line gives `reference_price`, their median price.

### Corrections and additions (FR-CONGRESS-07; FR-CONGRESS-01's and FR-CONGRESS-05's additions)

**Params**
- Every party's params give its `id`.

**Venue catering**
- A venue's `catering` is `in_house`, `outside_fee` (`outside_fee_per_head`) or `outside_free`.
- A caterer's params give each chosen venue's rule (`venues`), and its `order` names a `venue`.
- Unless it is that venue's in-house caterer or the order gives a `permit`, an `in_house` or `outside_fee` venue refuses it (`order_refused`, `reason` `venue_requires_permit`).
- The venue quotes `request_extra outside_catering` at its fee per head × attendance (outside_fee only) and gives `permit` `<venue>-permit-<n>` with `extra_confirmed`.
- An `in_house` venue's params give its in-house caterer's diets (`in_house_diets`); for a `diet` that caterer serves with a limit or not at all, it quotes `outside_catering` at `outside_diet_fee_per_head` × attendance, and its permit carries the `diet` and the `attendance` (FR-CONGRESS-17).
- A caterer reads an order's permit with the sensor `read_permit` (no time), one of the scenario's `partyTools`, which only rule-decided participants are given and no agent is offered or the inventory lists, from the venue's `extra_confirmed`, and refuses an order with meals of another kind or more than the attendance (`permit_exceeded`). A caterer with `in_house_for` refuses an order naming another venue (`own_venue_only`).

**Rooms and prices**
- A room's price is the day price × its seats ÷ all the venue's seats, rounded. A room the allocation named anew (`<room>-allocated`, or a room it moved to) is priced and seated as the room it was allocated from (FR-CONGRESS-19).
- `change_booking` (rooms, hours) answers `contract_changed` with the price moved by the rooms added and dropped, committing the difference or releasing and committing again.
- `request_extra room` (seats) quotes the smallest free room with those seats.
- `room_lost` offers `smaller` (largest free smaller room) and `cut` (the lost room's price), and `accept_change` takes `option` `smaller_room` or `price_cut`. On a one-room booking it offers `smaller` only, no `cut`; unanswered, the booking moves to it at the same price, and `change_applied` names the `room` and the `smaller` (FR-CONGRESS-17).
- Before any of that, a drawn `room_lost` moves the booking to the free room with the fewest seats of those with at least as many as the lost one, at the same price, and mails `room_moved` (`room`, `room_now`), with nothing pending. A free room is none of the booking's, none the date lost, and none in the venue's `rooms_booked_by_others` (the rooms other customers have on the event day). Since every lost room is the booking's last, a booking of two equal rooms with no third free gets `room_lost` as before (FR-CONGRESS-19).
- Every lookup of the organiser's booking skips cancelled contracts. `cancel_booking` acts on the `contract` it names, only while that one is live, or else on the live booking. A cancellation ends its pending change and frees the date only when no other contract not cancelled holds it (FR-CONGRESS-19).

**The board and speakers**
- The board refuses `request_approval` with `reason` `no_budget` until it has approved a budget.
- A speaker declines any time that breaks its constraint, and answers `confirm` or `change` with `not_available` `acceptance` until it has accepted (the partner excepted).

**Phone behaviour**
- A `Party` that misses a ring calls it back with probability 0.5 (a second draw), at a time drawn in its params' `call_back_minutes` (the variant's `[ring_minutes, ring_minutes + its reply delay's upper bound]`), with `missed_call`.
- It answers the ring's act by mail when that call is answered; its rests are shortened to its call backs.
- Every party kind has `call`.
- A call to a line that is not free fails as `busy` after 1 world minute.

**Away factor**
- `away_factor` also lengthens `travel_options` and `similar_events` (money tools are engine tools, so `ledger` already was).

**The draw and roles**
- A `[draw.<kind>]` table gives `count` (from templates with no `roles`) and `roles = { <role> = n }` (distinct templates carrying the role, one role each, drawn first).
- For venues it gives `cheapest_fit` (a role) and `cheapest_margin`: that role's venue costs a drawn share of the cheapest other chosen venue whose largest room seats the target.
- The variant line gives `roles` by kind.
- A perturbation's `for_role` resolves to the template that filled the role, and the completed configuration gives the resolved perturbations.

**Prices (`draw.price_gap`)**
- `draw.price_gap` gives `cost_covering_price`, from a cheapest feasible plan since FR-CONGRESS-11.
- It gives `price_gap` (drawn last) and `reference_price` = covering / (1 + gap).
- `draw.break_even_share` gives the reference price instead: the plan's break-even price at that share of the target paying (FR-CONGRESS-13); the similar events follow it the same way.
- The topic's first three similar events then cost the reference × 0.8, 1 and 1.2.

**Commitments**
- `withCommitment` and `withRelease` (money.ts) are shared by `commit`, `release` and the world.
- `book_travel` commits the price from `travel` with the organiser, `for` `<option> <traveller>`, before invoicing it, against the configuration's `discretionary_limit`.
- Caterers and venues commit a cancellation charge as they invoice it.

**Hotels**
- A hotel's rooms left for a night are rooms × min(14, days left) / 14, rounded down and never fewer than 1 up to and on that night's day (0 once it has passed), less those booked, never below 0 (FR-CONGRESS-18).
- `hotel_overbooks` (a perturbation component, never a venue's) at its time cancels every room booked for the night before the event, releasing its commitment, then delivers its channel to each traveller, not held.
- A speaker it hits calls the organiser with `no_room` and mails it if the call is not answered, unless it is out: it cancelled, had its invitation withdrawn, or withdrew from every session (FR-CONGRESS-17).
- On the night's own day a hotel has no room left for it, so after `hotel_overbooks` only a train in time can still meet P19.

**Sponsors**
- A sponsor mails `invoice_disputed` (`invoice`, `amount` its agreed amount) for an invoice above what is left of its amount, and pays nothing for it.
- `consented_list` is a sponsor condition.

### The congress's parts (FR-CONGRESS-06, `src/scenarios/congress-parts.ts`)

**What `congressParts` gives `Scenario.parts`**
- Its predicates (P01–P21, W1–W6; W4 also gives `values` `{ balance, overruns }`, written in its part line).
- Events:
  - `early_cancel`, `late_cancel`, `hotel_overbooks`, `sponsor_withdraws` from `state.perturbations`;
  - `rooms_allocated`, `partner_session_mail` from the mail;
  - `limit_passed`, when the organiser's committed total first passes the discretionary limit;
  - `final_numbers_due`, the earliest `final_numbers_by` of a caterer's quote.
- Misapplication patterns by part (P02, P10, P13, P16, P20, P21; a pattern gets the act, its params, the state at the act's time and the state at evaluation).
- The trap `hold_lapsed` (given the evaluation's world minutes).

**What every predicate reads (only the world's records)**
- Venues' bookings from their mail (`contract`, `confirmed`, `cancelled`, `contract_changed`, `extra_confirmed`, `rooms_allocated`).
- The deposit invoice paid.
- A speaker's belief as the latest of the `confirm`/`change` it received and the latest programme version naming it.
- The committed total and ceiling at a time from the money's timed events.
- The attendance (registrants, confirmed speakers, 3 board members, `helpers`).
- The balance (transfers in, sponsor money paid or agreed, less the organiser's commitments).
- Caterers' latest numbers (standard meals as the diet `none`).

**What the world keeps for them**
- An `at` (world minutes) on every money event (`stamped`), each travel booking and each programme version (`published`).
- `state.perturbations` (each perturbation records `{ name, target, at }` as it fires, before it delivers).
- `state.visits` (each place the organiser enters).
- The population's `announcements` and `edits` (prices set).
- `state.context`: `eventDay`, `helpers`, `target`, `endOfPreparation` — the calendar's first segment's `until` —, `roles`, `noShowCut` — `no_show_cut`, 0.05 in the base —, `discretionaryLimit`, travelling speakers' `homes`, venues' `catering` with their in-house caterer.

**Sessions**
- Every session is a plenary: its expected audience is the attendance.

### Corrections to the parts (FR-CONGRESS-10)

- A predicate may give `reachedAt` (P04: the approval; P11: when the page first required diet and access while open, or `request_needs`).
- Each part requires the situation it measures; outcomes need six sessions and a live booking.
- Answers are read per session (`answerFor`).
- An act carries its `outcome`; P21 counts only published programmes, P20 and P02 the act meant, once.
- `effortMoney` counts commitments net of releases, a release only when its commitment is counted in the same window (FR-CONGRESS-17), and payments only to an actor with no commitment counted.
- Since FR-CONGRESS-17: `bookingsOf` reads `change_applied` (the lost room leaves, its `smaller` joins); `confirmedOf` also confirms a speaker who accepted and acknowledged a `change` naming a time and a room; P19 leaves out a speaker who is out; P20 holds on the partner's confirmed session and kept agreements, whatever the other sessions, and counts an invitation of one speaker for the partner's session once.
- W4 counts sponsor money only under conditions met; since FR-CONGRESS-14 it needs a congress that happens and no overrun.
- Since FR-CONGRESS-19: `bookingsOf` reads `room_moved`; `seatsOf` (exported) gives a renamed room its original's seats. A congress given up (its event-day booking was confirmed and none is live) holds no predicate but P04's, `within_budget`, P06's and P11's; values are still given. A congress whose booking was never confirmed is left to each predicate.
- Since FR-CONGRESS-20, E1 baseline's definition of done: `can_be_held`, `attendance_in_range`, `sessions_have_speakers`, `everyone_fits`, `everyone_can_reach`, `food_for_everyone`, `within_budget` (D6, FR-CONGRESS-12's), `programme_on_time`, `sponsors_met`, `speakers_travel` and `done` (all ten hold); and the milestones `venue_confirmed`, `caterer_ordered`, `speakers_confirmed` and `programme_published`, whose `reachedAt` is when each was reached. `PartsContext.diets` gives each caterer's diets and limits; `ordersOf` gives each order's `date` and `permit` id. D0 and D5 count only orders for the event day; D5 counts an order's meals of a diet up to its caterer's limit, none of a diet it does not serve, and, at an `in_house` or `outside_fee` venue, an outside caterer's only with a permit that venue gave (at `in_house`, one naming the diet). D9 asks travel only of a speaker from a station (`homes`), by a train from its station or a hotel for the night before.
- Since FR-CONGRESS-21: a rule set's `start` gets, beside its own sequence, `sequence(purpose)` = `<purpose> of <name>`. A venue's other customers come from `enquiries of <venue>` (`otherCustomers`), counted from the run's start (the venue's `starts_at`): each enquiry draws its interval at `enquiries_per_day`, then whether it books, whatever the date's state, and is recorded at its drawn time; a challenged hold that lapses books as its enquiry drew. The variant hook gets the seed. With `[solvable]` in the draw, `solvabilityOf` (congress.ts) builds the input of `plansOf` (`solvability.ts`) from the completed configuration, and the variant is drawn again, up to 100 times, until `min_solutions` (2) global solutions exist on `min_venues` (2) venues, else refused naming `draw.solvable`. The variant line and `worldInventory` give `solvable`: `counts` (D0–D9), `solutions`, `venues`, `cheapest` (cost, venue) and `draws`. A plan: one room seating target + 6 + 3 + helpers, booked at the venue's day price (as `book` contracts it), free at `day 7 18:00`; the ramp when an attendee has an access need and the room, toilets or catering area are behind steps; a first caterer the rule allows taking each diet up to its limit, and a second for the rest (permits: per diet at `outside_diet_fee_per_head` at `in_house`, `outside_fee_per_head` × meals at `outside_fee`), each order at least its minimum; six available accepting speakers in slots 09:00, 10:00, 11:00 (a sponsor insisting on a morning slot takes it), 13:30, 14:30, 15:30, 16:30, fee conditions paid, travel_paid trains paid, a hotel when no train arrives 30 minutes before; commitments within the budget; and the highest whole price whose expected paying registrants (`registrationProbability`, the page opened and registration announced on `day 2 09:00`) reach 0.85 of the target and stay within 1.10 (FR-CONGRESS-22).
- Since FR-CONGRESS-22:
  - A venue answers an `ask_quote` or `hold` from a customer about a date it has under a live contract with `contract_held` and the contract, as `book` does; about a date it holds (the venue keeps who holds each date), with `held` and the hold's end, its own or a challenge's `confirm_by`.
  - A caterer refuses `permit_unknown` an order whose `permit` is not one the named venue gave: it reads the permit's venue with `read_permit`, at a venue of any rule but `outside_free` (FR-CONGRESS-23).
  - A registrant believes, on registering, the latest published programme version.
  - A version is real at a time when, as the records were then (`asOf`), it is published and its six sessions each have a time, a speaker who had accepted that session (`acceptedFor`), and a room of a confirmed, uncancelled booking for the event day. FR-CONGRESS-23 changed when D7 and `programme_published` read it.
  - Each plan gives its `expected` paying registrants. For a scenario with a variant, the inventory gives `replicas`: each replica's seed, its variant loaded with the first condition, and what the scenario's `variantInventory(configuration, seed)` gives (the congress: the kept `plans`). The run's log does not hold them.
  - `lab parts`, when no part line gives a kind or a group, lists every part in the Parts table with its `reached_at` per run; the outcomes keep their values, and an empty Kinds table is left out.
- Since FR-CONGRESS-23:
  - What the organiser learns of a registrant with no special diet (the ticket page's list and summary, a request for needs, an answer to its question) gives `standard`. The material's diet shares, the person's own record and the population's outcome keep `none`.
  - At an `outside_free` venue, `request_extra` for `outside_catering` is answered `not_needed` with the item and commits nothing; a caterer takes an order for such a venue with any `permit` or none.
  - A venue answers a `book` or `change_booking` naming a room it does not have `unavailable` with that `room` and no date, as it names a lost room.
  - A speaker answers an `invite` for a session it has answered with that session's latest answer, its act and fields, and records nothing; the party answers it afresh rather than `already_sent`. An ill speaker still gives no answer to it.
  - A venue answers an `accept_extra` for an extra its live booking has, or for a quoted room the booking has, `already_confirmed` with the item, and commits nothing; afresh, not `already_sent`.
  - D7 holds for a version published by `day 12 18:00` that is real at `day 12 18:00`. `programme_published` is reached at the first time a published version is real: its publication, or the last act that made it real, whichever is later.

### The congress ready for an experiment (FR-CONGRESS-08)

**The base**
- The base declares `attendees` and `parts` (empty), the mail's `send_minutes_per_field`, `send_words_per_minute` and `read_words_per_minute` (0; words per minute at 0 add no time, as the phone's do), and `[durations]` `ledger`, `pay` and `issue_invoice` (0).
- A scenario's `openTables` (the congress's `calendar.hours` and `perturbations`) take keys a condition or the common part adds; every other table refuses them.

**Placeholders in the texts**
- The congress fills `{topic}`, `{target}`, `{event_day}` (`day <n> <weekday>`), `{funds}` (the first drawn board's) and `{directory}` in its five texts in the variant, with `{{`/`}}` as braces.
- It refuses another name, and `{funds}` with no board, naming the name and the text.

**`{directory}`**
- It gives first a line per kind, `A|An <kind> takes <act (required fields)>, ….`
- Then a line per drawn party, `- <id>: <kind>, with a mailbox|no mailbox and a line|no line[; <what anyone could know>]`: a speaker's `"<title>"` and `local` or `from <station>`, an in-house caterer's `in-house for <venue>`.
- The partner's speaker is not listed.
- The parties are grouped by kind, each kind's order drawn from the replica's sequence (FR-CONGRESS-11).
- The acts table marks a field an act may leave out with `?`; the directory and the mail leave it out.

**Groups, wakes and the inventory**
- A scenario's `partyGroups` gives `role:<role>` and `kind:<kind>` (the in-house caterers among `kind:caterer`); `readParts` resolves actors through them and refuses an empty group, naming the part.
- A channel with `wakes` (the congress's `[phone] wakes = true`) ends an agent's rest when its stimulus reaches it, at once when one is already waiting. That activation starts without the rhythm's stimulus, and the next interval is drawn after it.
- The inventory's tools are those any agent's session is offered (`toolsOf`).

### Corrections to the world from E1's first technical run (FR-CONGRESS-09)

**Records and acts**
- `read_mail`'s reply and a ring's stimulus carry the world's `record` (sender, act, fields, text; a ring's call id) beside their text; a rule set reads `result.record` and `stimulus.record`, never the text. A model's session receives the text only.
- The congress declares each drawn party's acts and required fields as `mail.acts`, so `send_mail` and `call` refuse `act_not_taken` and `missing_field` at once.

**The board**
- A new budget within its funds replaces the approved one; the difference is transferred, or invoiced back as `budget returned`.
- `budget_countered` gives its funds, `refused` the reserve left.

**Speakers**
- A speaker draws whether it would accept once, answers each session on its own and ignores a second invitation to one; `accept_condition`'s fields update the invitation's, and the condition is checked on them.
- Confirmed: a speaker that accepted a session and acknowledged a confirmation; its time is when the confirm reached it.
- `publish_programme` refuses speakers and sponsors that are no drawn id (`PartsContext.ids`, through `idsOf`).

**Venues**
- A venue answers a second `book` for a date with `contract_held`; `room_lost` takes only a second room, which stays lost.

**Hours, payments and answers**
- Each party's params carry `keeps`, its hours; its own mail (`Party.write`) waits for them.
- A sponsor pays `pay_days` after the invoice's `issued` time (the ledger gives it), within its hours, only while its programme conditions stand from day 19.
- A party answers a repeated message (same sender, act and fields) with `already_sent` (FR-CONGRESS-11) while nothing changed since its first answer (FR-CONGRESS-13).
- Each registrant asks a question with the material's `question_share`, within three days of registering.

### Corrections to the world from E1's second technical run (FR-CONGRESS-11)

**A fixed budget**
- The draw may give `budget` and `advance` (two numbers each); the variant draws a whole number in each and gives both in the `variant` line.
- The organiser's account opens with the advance, its ceiling the budget from the start; the texts may name `{budget}` and `{advance}` (refused, naming it and the text, when not drawn).
- With no board drawn, the partner's `partner_session` comes from `association` (no mailbox, no line).
- `Scenario.refuses` refuses a call of an engine tool (mail, phone, money) before the tool's own refusal; the congress refuses the organiser's `issue_invoice` to a party that is no sponsor, as `invalid_arguments`.

**Draws**
- Each chosen speaker gets `accepts` from the variant's sequence (true with its `acceptance`); the variant line gives `accepts`, and the speaker answers from it. A speaker given none (unit tests) still draws once at its first invitation.
- `[draw.speaker] min_accepting`: the whole speaker draw is redrawn until that many available speakers accept, up to 100 times, else refused naming `draw.speaker.min_accepting`.
- The cost-covering price: the cheapest chosen venue seating the target (+ its `ramp` extra when an interior passage of it in the city is not step-free), the attendance (target + the lowest-fee accepting available speakers, one per session less the partner's: 6 with no partner, 5 with one since FR-CONGRESS-20 + `helpers` + 3) × the highest caterer's price per head, the cheapest chosen agency's price, those speakers' fees and cheapest trains from their stations, less the advance, the board's funds and the sponsors not in the role `withdraws`; over the target, at least 1.

**Parties**
- A speaker's `accept_if` states its need (`fee`; `travel_paid` true and `from`; `time` "before 12:00"); at day 19 its `withdraw` names in `sessions` only the sessions still waiting; once ill it declines invitations and panels and answers `confirm`/`change` with `not_available`.
- A venue's `quote` gives `extras` (`<item>: <price>; …`); a `room_lost` on a one-room booking becomes a `price_change` when no smaller room is free (FR-CONGRESS-17); rooms an allocation moved away are lost for the date, so `change_booking` naming one is `unavailable`.
- A party answers a repeat (same sender, act and fields) with `already_sent` (`act`, `sent`: its first answer's act and world time); it reads the time once per batch of mail it answers.
- A caterer refuses `order` and `final_numbers` below its minimum with `reason` `below_minimum` and `minimum`.

**Registrants, announcements, directory**
- Every possible registrant id (the pool's `a-<n>`, the fixed people, the group's largest size after them) gets a mailbox taking `answer (text)`; the population records an `answer` line, and an answer to a question about a diet or access makes that need known (`known`).
- A `promotion` to `association_list` while the page is open also sets `announced`.
- `{directory}` says how registrants are mailed, then lists parties grouped by kind (venue, speaker, caterer, sponsor, agency, then other kinds), each kind in an order drawn from the replica's sequence.

### Corrections to the parts from E1's second technical run (FR-CONGRESS-12)

- `PartsContext` gives the organiser's `ceiling` and `opening` from its account and the run's `start`.
- The ceiling in force is the latest approval's `amount` (the money records the approved ceiling there), else `ceiling`, else the discretionary limit; P03 and P18 read it. Run 2's P18 read false because the approval was read as `ceiling`.
- `within_budget` holds while no `unapproved_overrun` was recorded for the organiser, reached at `start`; `limit_passed` is the first commitment above `ceiling` (or the discretionary limit).
- The event `venue_change`: the live booking's venue's first `room_lost` or `price_change`; E1's parts material activates P03 on it.
- W4 counts `opening`. Catering orders whose caterer last answered `cancelled` are left out (P12, P13, W3); P14 counts a cancellation that leaves less than the final registrations as a cut.
- P08 and P09 need each replacement to have accepted that session's invitation (or the panel for its slot), be confirmed, believe its time and hold no other session.
- P20 reads the organiser's invitations as made (mail delivered or in transit, by sent time, and calls) from the world after the act, less the act itself; P02 counts toilets and the catering area. (P10's own cost-covering price was replaced by FR-CONGRESS-14.)
- `answerFor` reads a withdrawal for each session in its `sessions`; `outOf` takes a speaker out of a programme session only when its withdrawal names that session's invitation, and entirely only for `cancel` or `withdraw_invitation` (P05 and W1 read it per session).

### Corrections to the world from E1's third technical run (FR-CONGRESS-13)

**Money that can close**
- `cheapestPlan` (congress.ts) gives the plan's cost for a number of attendees, its early deposits (its venue's `deposit_share` of the venue with its ramp, its caterer's of the catering at the target) and a covering price for so many paying, net of a payment fee share.
- The draw may give `budget_over_plan`, `advance_over_deposits` (first number at least 1) and `break_even_share` (0 to 1) in place of `budget`, `advance` and `price_gap`; each share is drawn after the speakers, in that order, and the budget and the advance are rounded to whole numbers.
- The variant line gives `plan_cost` and `early_deposits` whenever any of those keys or `price_gap` is given. A key beside the one it replaces, or a range outside its bounds, is refused naming it.

**One record of acts**
- `actsOf` (congress-parts.ts) is the one record: every mail (delivered, at `received`; in transit, at `sent`) and, for each answered call, the caller's act and its answer at the call's `endedAt`, each with `channel` `mail` or `phone`. An unanswered call passes no act.
- The parts, `confirmedAt` and `hasCancelled` read it; `ordersOf` gives the catering orders from it.

**Venues, cancellations and caterers**
- Every declared venue perturbation other than `room_allocation` is the venue change: a component (`venueChange`) that draws its time once, records itself in `state.perturbations` for the venue holding the organiser's live booking (contracted or confirmed, from `bookingsOf`) and delivers `venue_change` to it; with no live booking it ends.
- A venue's or caterer's cancellation voids its contract's or order's invoices (`Party.voidInvoices`, the tool `void_invoice`) before any charge is committed and invoiced.
- A caterer refuses an `order` for a date it holds an order for with `order_refused`, `reason` `order_held` and the held order's `counts`.

**Repeats**
- A party counts each act that reaches it (each mail it reads, each ring) and each change of its own (`Party.changed`: a venue's timers and its change). A repeat is answered `already_sent` only while that count is what it was when it answered the first; otherwise it is handled afresh.

### Corrections to the parts from E1's third technical run (FR-CONGRESS-14)

- W3 and W4 need a congress that happens (six sessions and a live booking); W4 also no `unapproved_overrun`, its `values` unchanged.
- W1's confirmations are the organiser's own, by mail or by phone, through the record of acts.
- The event `conditional_answer`: the first `accept_if` from the speaker the organiser first invited to that session; E1's parts material is to activate P06 on it.
- P10 lists the `edit_ticket_page` that set a price above 1.25 × the reference price when no later edit set a price before `day 12 00:00`.
- P20 does not count a `withdraw_invitation` to a speaker that had cancelled, nor one made with no live booking when no `contract` came after it.
- P02 counts only an `accept_contract` that reached the venue (a delivered mail or an answered call), its first one.
- P21's pattern (`lateAllocation`): 24 hours after the live booking's venue's `rooms_allocated`, the programme then, the registrants' last `belief` by then, or a confirmed speaker of a moved room's belief by then still has a moved room; it lists the organiser's last act by then that told a moved room (a programme naming one, an announcement to registrants of such a version, a `confirm` or `change` naming one).

### The population (FR-POPULATION-01, `src/scenarios/population.ts`)

**Material and refusals**
- With an `attendees` material (TOML text; refused, naming `attendees.<key>`, for shares not adding up to 1, negative rates, shares outside 0 to 1, a fixed person's window that ends before it begins, a group size reversed).

**State and component**
- The congress keeps `state.population` (material, event day, reference price, each chosen speaker's `draw`, people, the page, `announced`, promotions, programme versions, sponsors' data, `needsRequested`/`cancelRequested`, `events`).
- It runs the component `attendees` (kind `world`, sequence `cycle of attendees`).

**Drawing the pool**
- Its first step draws the pool (`drawPool`) into an empty world:
  - pool_factor × target people `a-<n>`, five draws each: diet, access, pays, consents, no_show;
  - then fixed people at a time in their window;
  - then a group of a drawn size and one time.

**Registration**
- Then, each world hour, it registers each person whose draw is below `registrationProbability` (0 while the page is closed; f, g, h, r, m as the SPEC).
- It registers fixed people and groups at their times.
- It registers while the page is open, before its close date and below its cap (above it, the waiting list if kept).
- A paying registrant makes the world's `attendees` account transfer the price less `payment_fee_share` to the organiser (`withTransfer`).
- The registrant gives only the page's required fields and draws a cancellation time before the event with `cancel_share`.
- It mails the organiser a `question` (`about` access or diet) within a day for a need the page did not ask about (sent from its id with `withSent`).

**Reading the mail**
- It reads the world's mail once sent.
- A speaker's `promoting` starts a promotion (`promotion_factor × (1 + 0.25 × draw)`, two world days).
- The organiser's `send_attendee_list` records the sponsor's held registrants with and without consent.

**Requests and programmes**
- Requests are handled once their time comes: needs given within a day, a 0.5 draw (`cancel_draw`) per registrant who would not come.
- A new programme version is delivered to each named speaker on the channel `programme` (`{time}`, `{room}`), not held, which the speaker believes.

**What is recorded**
- Its outcome is a `participant_outcome` line (`Component.outcome`) and each `events` entry a `population` line (`Scenario.logLines`).

**Tools**
- The organiser's tools `edit_ticket_page`, `ticket_page` (summary with `keeps_waiting_list` and the waiting list's count, or list), `publish_programme` (refused as `invalid_value` for a room no chosen venue has or two sessions in a room at once) and `announce`, and the sponsors' `read_programme`, refuse without a population.

**Sponsors and the programme**
- A sponsor with an agreement reads the programme at the starts of days 19 and 25 and mails `condition_missing` for a logo or morning slot (start before 12:00) it agreed to and lacks.

**Timing**
- "When the run ends" may take 90 s.

### The runner

**Expanding and ordering runs (FR-RUN-06)**
- The runner expands an experiment into runs (each condition with each model, for each replica, replica r's seed derived from the base seed and r) and starts them in that order.
- Or, with `parallel_runs` above 1, replica by replica (every condition and model of replica 1, then of replica 2; within a replica, condition, then model), each next one as soon as one ends.
- So no more than the file's `parallel_runs` (1 by default) are in progress at once (FR-RUN-06).
- Each run has its own world, sessions, parallelism limit and log.
- Its line in the experiment's `index.jsonl` is written as it ends, so the index lists runs in the order they ended.

**Stopping**
- The runs in progress share one stop signal, whose reason is the error each stops on.
- The first run that stops on an error aborts it with "the experiment stopped: <that run> stopped", and an interruption with "the run was interrupted".
- `run()` takes an `interruption` signal's reason, when it is an `Error` other than Node's own `AbortError`, as the error it stops on.
- No run starts after the signal; the experiment fails with the first run's error once every run in progress has ended.

**The observer**
- The observer (`ExperimentObserver`, which `lab run`'s progress implements) is told each line and each end by the run's number.
- While several runs are in progress, each progress line gives each of them, joined by "; ".

**Factors and conditions (FR-EXPERIMENT-02)**
- `readExperiment` first expands the file's factors into conditions (FR-EXPERIMENT-02):
  - `baseline` (unless `baseline = false`);
  - then every combination of levels, named `factor=level,…` in the file's order with the first factor's levels changing slowest;
  - then the file's own `[conditions.*]`.
- A name given twice is refused.
- A combination's change is its levels' changes merged, and two levels that set the same key (a material's reference counts as one value) are refused.
- `[common]` reaches every condition as `Condition.common`, which `loadScenario` applies before the condition's own change; a common material whose key the condition sets again is not listed.
- Only a combination has `levels`, and its setup line and index line give them; any other condition's lines have no `levels` field.
- `lab run` resolves the scenario from the library and the models by name before any run.

**Resuming (`--resume`, FR-RUN-07)**
- With `--resume` (FR-RUN-07), the runner reads the index, if there is one, and plans the experiment as always, keeping each run's number out of the whole experiment.
- It starts only the runs whose condition, model and replica have no `completed` line.
- Before that it builds each completed run's setup as it would now (the thinking level stands for the sampling, since `assertThinkingLevel` makes it what the sessions get) and compares it with that run's log's first line.
- The comparison is `setupDifferences`, `src/engine/resume.ts`: each configuration value by its dotted path, the model, the seed, the sampling, each material's path and hash, the code's commit; not `uncommittedChanges`.
- It refuses on any difference, naming the run and each difference.
- A completed line for a run the file no longer makes is ignored.
- The observer's `resumed` gets the counts before the first run.
- New lines are appended to the existing index (`JsonlFile.append`); every run log is still created exclusively.

### The inventory

**What it is**
- The inventory is generated from the scenario as each condition configures it, plus the experiment's models and limits.
- It is data (`inventory()`, one entry per condition); `lab inventory` prints it as Markdown (`inventoryMarkdown()`), one `## Condition` section each, without loading any model or writing anything.

**Tools, outcomes and stimuli**
- What the engine does not provide yet (energy, environment processes, tool efforts) is listed as "none", and every sensor and channel as instant.
- An effector's outcomes are listed from the texts it declares, since effectors do not declare their failure reasons yet.
- Each condition also lists the outcomes the engine itself gives any call (`invalid_arguments`, `unknown_tool`, `cut_off`) with what the agent receives for each.
- Each agent's first stimuli are given beside its system prompt, with their channel and source.

**Parts of the inventory**
- A scenario that seeds situations (the workplace, FR-WORKPLACE-01) gets a `situations` part listing the chosen ones by id only, never their things or reserved keys; a scenario without situations gets none.
- A scenario that declares a clock (`Scenario.clock`, the workplace, FR-WORKPLACE-05) gets a `clock` part with the time it shows when the run starts and its time scale ("### Clock"); a scenario without one gets none.
- Each condition gives the experiment's compaction ("### Compaction"): off, or on with `trigger_at` and `keep_recent_tokens` and Pi's texts for writing a summary, the system prompt and the three sets of instructions (`summaryInstructions`).
- A scenario with components gets a `components` part listing each one the condition declares, with its kind (part of the world or external perturbation) and its cycle as the scenario describes it, or "none"; a scenario without components gets none.

### `lab parts` (FR-ANALYSIS-04, `src/analysis/parts.ts`)

**What it reads**
- `lab parts <runs-dir> [--json]` (the option before or after the directory) reads the index (refused, naming the directory as given, without one).
- It reads the logs' `part` lines, `model_turn` lines and setup lines, and the guidance material each setup line names (the material whose key is `guidance` or ends in `.guidance`), resolved from the directory `lab` runs in.

**What it prints**
- As Markdown under `## Parts`, `## Kinds`, `## Outcomes` and `## Conditions` (or `The runs have no parts.`):
  - per part and condition, its kind, completed and stopped runs, active and held counts, each completed run's `reached_at` (`-` when none) and effort calls and money in replica order, the calls' minimum, median and maximum, and the misapplications by replica;
  - per kind and condition, active, held and their share;
  - per outcome (a part whose lines have no kind) and condition, held and each run's `values`;
  - per condition, the guidance's words and estimated tokens (words × 4 / 3, rounded), and the completed runs' model turns, input tokens and cost.
- A stopped run is counted apart and gives no values.
- `--json` gives `{ parts, kinds, outcomes, conditions }`.

### The summary across replicas (`summarizeRuns`, `src/analysis/replicas.ts`; FR-RUN-02)

**Input and output**
- It reads only a runs directory's `index.jsonl` and the run logs it lists.
- `lab summarize <runs-dir>` finds the directory from where it runs and prints it as a Markdown table (`summaryMarkdown`), or with `--json` as the same rows in JSON.
- A directory without an index is refused, named as it was given.

**Rows**
- A row is a condition and model (in the order the index first lists them) and a metric, or, for a metric whose value is a record, one agent or situation of it (the row's `key`).
- Every condition and model gets a row for every metric and key any completed run gives, so one whose runs all stopped still shows its counts.
- Each row gives its runs completed and stopped, the values of its completed runs' last `metric_sample`, in replica order, with the replica each came from.
- It gives the number of nulls (a metric's own `null` counts on its row without a key), and the minimum, quartiles and maximum by linear interpolation, `null` (a dash in Markdown) without values.
- A stopped run gives no values, and a completed run whose log has no sample gives none either.

### The reserved judge (`judgeRuns`, `src/analysis/judge.ts`; FR-ANALYSIS-02, FR-ANALYSIS-03)

**Command**
- `lab judge <runs-dir> <judge.toml>`, both found from where it runs.

**The judge file (`readJudgeFile`)**
- It gives `model`, `thinking_level`, `instructions`, a material, and `timeout_ms` for each call.
- Optionally:
  - `parallel_questions`, how many calls are made at once, a whole number of at least 1 (1 by default);
  - `repeats`, an odd whole number of at least 1 (1 by default);
  - `retries`, a whole number of at least 0 (0 by default);
  - `retry_wait_ms`, a whole number of at least 1 (1000 by default);
  - `[questions]` with `says` and `reveals`, each a text or a material: the wording that ends a question asking whether a text says, or reveals, its statement (a `questions` that is not a table, or a value that is neither, is refused).
- It sits beside the experiment file, so its own material and each run's setup-line materials are read relative to its directory.

**What it reads from each run**
- For each completed run (stopped runs are not judged), the judge reads the setup line and the `tool_call` lines.
- It puts the text of each held-out material in place of its reference (refusing, by its path, a file that is missing or whose hash differs from the recorded one).
- It asks the run's scenario, by its name in the library, what can be judged (`Scenario.judged`, giving `Judgeable`s: situation, key, statement, whether a text must say or reveal it, and the texts with when each was written).
- Every run is read, and every material checked, before the judge's model is called; a thinking level the model cannot use is refused then too (`assertThinkingLevel`, the rule `lab run` uses).

**The workplace's judgeables**
- The workplace gives, for each chosen situation in order, its `said` with the worker's successful `note` texts, `record` entries or both (`channel` `note`, `book`, `either`).
- Then its `not_said` with both, since a note or an entry can reveal it.
- A text's moment is its call's `endedAtMs`.

**Questions**
- A statement with texts is one question, asked `repeats` times, each time its own call (`askOnce`).
- Each call has the instructions as the system prompt, a message of the statement, the numbered texts and the wording of what it asks (by default "Does one of the texts say/reveal what the statement states?"), and the one tool `verdict` (`verdict` yes or no, `quoted`, `reason`).

**The judgement line**
- Each question is a line of a new `judgements/<uuid>.jsonl` under the runs directory, written once all its answers are in.
- Its fields: `runId`, `situation`, `key`, `outcome`, `verdict`, `quoted`, `reason`, `quoted_found`, `model` (the judge file's name), `thinkingLevel`, `instructionsHash`.
- `questionHash` (the SHA-256 of the wording of what it asks, a material's being its file's hash; a statement without texts gives it too).
- `tokens` and `cost` (the sums over its answers), `repeats`, `answers` and `agreement` (`agreeing`, `valid`).

**Answers**
- Each answer, in the order asked, gives `outcome`, `message` (only for a `model_error`), `verdict`, `quoted`, `reason`, `quoted_found`, `tokens`, `cost` and `retries`.
- A call that errs (`model_error`, with the provider's message), runs past `timeout_ms` (`timeout`), or ends without exactly one valid `verdict` call (`invalid_verdict`) gives an answer with that outcome, null `verdict`, `quoted`, `reason` and `quoted_found`, and the tokens and cost Pi reported.

**`quoted_found` (`quotedFound`)**
- It matches after normalizing quote and text alike:
  - the single quotes and apostrophes ‘ ’ ‚ ‛ ʼ ′ become `'`;
  - the double quotes “ ” „ ‟ ″ become `"`;
  - each run of whitespace (JavaScript's `\s`, the no-break space included) one space;
  - letters lower case.
- The quote is split at each `…` and each run of three or more dots, its fragments trimmed and empty ones dropped.
- It is found when one text holds every fragment, in order, each from the end of the one before.
- A quote with no fragment, an empty one included, gives null.

**The line's verdict**
- The line's verdict is the one more than half of the valid (`success`) answers gave, with the `quoted`, `reason` and `quoted_found` of the first answer that gave it, and `agreement` how many gave it of how many were valid.
- Valid answers split evenly are the outcome `tie`, with null verdict, quoted words, reason and `quoted_found`, and the agreement (`agreeing` is half).
- With no valid answer, the line has the first answer's outcome, and its `message` for a `model_error`, with null verdict and null `agreement`.

**A statement without texts**
- It is `success`, "no", with no call and so no slot: `quoted` and `quoted_found` null, `reason` "no text on the channel", `tokens`, `cost`, `answers` and `agreement` null, and the file's `repeats`.
- Its line can come before an earlier question's.

**Parallelism**
- Every call takes a `ParallelismLimit` slot of `parallel_questions`, so a question's repeats share the slots with the others'.

**Retries**
- A call whose `model_error` message says a rate limit (`saysRateLimit`, the rule of `isRateLimit`) or gives a status from 500 to 599 standing alone is asked again after `retry_wait_ms`, doubling with each retry, up to `retries` times.
- The wait (`waitAtLeast`) holds no slot.
- Each retry is `{ attempt, waitMs, message }`, the message being that of the call it retries.
- An answer whose retries are spent is the last call's `model_error`, and its tokens and cost sum every call's.
- Timeouts, invalid verdicts and other errors are not retried.

## How the tools behave

### Pi SDK (1.5.0: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`)
- **Opening a session:** `createAgentSession` opens one.
  - `SessionManager.inMemory()` keeps it out of the disk.
  - A `ResourceLoader` whose `getSystemPrompt` gives our prompt replaces Pi's preamble, but Pi still appends sections of its own, such as `<cwd>`. Only a forced prompt is sent as it is: Pi forces one by replacing the system message in `session.agent.transformContext`, and the adapter does the same.
  - `tools` is an allowlist that filters custom tools too: `tools: []` leaves the session with no tools at all. Name every custom tool in it; the built-in tools stay out.
  - `session.agent.streamFunction` is the one call per model turn; wrapping it gives the place to wait for a slot, time the turn and abort it through its signal. An aborted answer ends the agent's run without running its tool calls.
  - The offered tools are kept in the session as a system message with empty text and `toolsAdded`; the system prompt itself is not a session message, and the forced prompt is sent in its place.
  - **Messages into a session:** `sendCustomMessage` keeps `customType` and `details` in the session, but the model receives only its `content`, as a user message; the adapter writes a stimulus as `<source>: <stimulus>`.
    - With `triggerTurn: true` it starts a run and resolves when the run ends; messages sent before with `deliverAs: "nextTurn"` go right after it, in the order sent (`AgentSession._prepareRun`).
    - Pi's steering (`steer`, or a custom message sent while the agent streams) is checked again after a turn without tool calls, and a steered message then makes another turn (`agent-loop.js`): it would extend an activation. The adapter keeps stimuli in its own queue and adds them in `session.agent.prepareNextTurnWithContext`, which Pi calls only before a turn that goes on the same activation.
    - A model call made with a signal that is already aborted never reaches the provider: Pi ends it as aborted first (seen on 1.5.0 with the faux provider, whose response factory was never called). A turn that waited for a slot past the run's time limit relies on it, and FR-CLOCK-02's scenario fails if a Pi upgrade changes it.
    - `session.agent.finishTurn` is called after every turn that was not aborted or an error, once its tool calls are done; returning `{ action: "end" }` ends the activation before Pi prepares another turn. The adapter ends it there once the run's time limit has passed (FR-CLOCK-02).
  - Pi retries a provider error by default, with backoff (about 2 s), and the retry takes the next scripted answer; `SettingsManager.inMemory({ retry: { enabled: false } })` turns it off.
  - oid's `src/pi-executor.ts` uses this pattern.
- **Compaction** (`compaction.js`, `AgentSession._checkCompaction`, `_runAutoCompaction`):
  - Settings `enabled`, `reserveTokens` and `keepRecentTokens`, given through `SettingsManager.inMemory({ compaction })`; Pi's default is on, with a reserve of 16384 tokens. `shouldCompact` starts one when the context is above the window minus the reserve, so `piCompactionSettings` makes the reserve the part of each model's window above `trigger_at`.
  - **When Pi checks:**
    - Pi checks before every model turn after the first of an activation (`prepareNextTurnWithContext`), so a long activation compacts in the middle; it checks after an activation and before the next one too.
    - Pi also starts a compaction as an activation ends, after the run's end too; `session.setAutoCompactionEnabled(false)` stops that.
  - **Events and failures:**
    - A compaction emits `compaction_start` (reason `threshold`, `overflow` or `manual`) and `compaction_end`, whose `result` gives `summary`, `tokensBefore`, `estimatedTokensAfter` and the summary calls' `usage`.
    - One that fails or is aborted ends with no result, and the context stays as it was.
    - A summary call that comes back aborted is not a failure to Pi: `getSummarizationFailure` fails only an error or a length stop, so an aborted call would leave an empty summary in the context unless Pi's own compaction is aborted too (`session.abortCompaction()`, whose signal the call carries).
  - **The summary call:**
    - The summary is written through `session.agent.streamFunction`, the call the adapter wraps for model turns.
    - The adapter tells it by its system prompt (`isSummaryRequest`), runs it under the same limits as a model turn (`limitedCall`: a slot under the parallelism limit, the model turn timeout and the run's end), and records it as no model turn.
    - A call stopped by the timeout or the run's end aborts the whole compaction, recorded `timeout` or `cut_off`; a provider error fails it, recorded `model_error`.
    - Once the run has ended, the session's auto-compaction is turned off, so no compaction starts after the end, as no model turn does.
  - When the kept part starts inside a turn (a long activation is one turn of Pi's), Pi summarizes that turn's start with its split-turn instructions and composes the summary as `<history>\n\n---\n\n**Turn Context (split turn):**\n\n<text>`, the history being "No prior history." when nothing came before; with history to summarize too it makes two calls and sums their usage.
  - The prompts are not exported. `summaryInstructions` reads them at load from the requests Pi's exported `generateSummaryWithUsage` and `compact` make, answered by a stream that calls no model.
  - The faux provider's `contextWindow` is 128000 unless a model definition gives one (`ScriptedModel`'s `contextWindow`); it estimates a prompt's tokens as its characters over 4 and counts them as cache reads and writes when the call has a session id.
- **One question** (`askOnce`, the judge's):
  - The same isolated session as an agent's (`isolatedSession`), whose one tool does nothing.
  - `finishTurn` returns "end" after the first turn, so the tool's result never reaches the model and the question is one model call.
  - Its `streamFunction` adds a timeout's signal to the call's; an aborted call ends with `timeout`, an error answer with `model_error`, and either gives no calls.
  - The calls are read from the assistant message's `toolCall` blocks, as the model made them, before Pi validates or coerces them.
- **Events:** `session.subscribe` streams messages, thinking, tool calls with their results, and the agent's lifecycle. Assistant messages carry `responseModel` (the model that actually answered) and usage, with `cost.totalFromProvider` telling billed totals from catalog estimates.
- **Tool events and timing:**
  - Pi emits `tool_execution_start` before it validates a call, and with parallel execution (its default) it emits the start of every call in a batch before running any of them (`agent-loop.js`).
  - The adapter sets `session.agent.toolExecution = "sequential"`, so a turn's calls run one after another.
  - A call's start and end are measured inside the tool's `execute`; Pi's events time only the calls it answers without running them.
- **Calls Pi answers without running the tool** are recognised by why (`unrunOutcome`):
  - a tool the session does not offer is `unknown_tool`;
  - `invalid_arguments` when `validateToolArguments` (exported by `@earendil-works/pi-ai`, the function Pi validates with) rejects the raw arguments with exactly Pi's answer;
  - `cut_off` once the run has ended.
  - Any other reason stops the run.
  - A call that reaches `execute` after the run has ended is left unrun: `cut_off`, with no target read.
- **A tool that throws** is answered by Pi with an error result, as if the call had failed, and the agent goes on (`executePreparedToolCall`, `agent-loop.js`). The adapter catches the error inside `execute` first and stops the run with it.
- **Tool arguments are coerced** by `@earendil-works/pi-schema` before a tool sees them (numeric strings become numbers, a single value becomes an array). Record the raw tool call from the events, not only the coerced arguments, or malformed answers disappear from the data.
- **Tests:** `fauxProvider()` from `@earendil-works/pi-ai` gives scripted answers (`fauxText`, `fauxToolCall`), with an optional tokens-per-second rate. oid's `features/support/scripted-model.ts` is an example.
  - A response factory receives the normalized transcript: the tools offered with `Models.complete(model, { messages, tools })` arrive as `toolsAdded` on a leading system message, and `getCurrentTools(messages)` gives them back.
  - `fauxAssistantMessage` keeps `stopReason: "stop"` even when its content holds tool calls; read the content, not the stop reason, to tell whether a turn called a tool.
  - A response factory also receives the call's options: `sessionId` names the Pi session the turn came from, and `signal` its abort signal. The provider waits for the factory before it checks the signal, so a factory that ignores it holds the call (and its model slot) for its whole delay; the scripted model stops waiting on abort, and the provider then answers with `stopReason: "aborted"` and empty content.
  - Pi's model runtime keeps one provider per id: two faux providers with the default id serve each other's calls, so each scripted model has its own.
  - Past its script, the faux provider answers with `stopReason: "error"`, `errorMessage` "No more faux responses queued" and empty content, so a turn past the script makes no tool call.
- **Authentication:** the lab's login lives in `~/.agents-lab/pi/auth.json` (D-08) and serves every session in the process. The person creates it once with `PI_CODING_AGENT_DIR=~/.agents-lab/pi pi` and `/login`. On this machine `ANTHROPIC_API_KEY` is set to an invalid key; remove it from the environment so Pi uses the login.
- **Isolation:**
  - Without an explicit `agentDir`, the SDK falls back to `~/.pi/agent/` and reads the person's settings and model definitions.
  - `ModelRuntime.create` likewise defaults its models file there (seen in Buddy, NFR-SEC-19), and writes `auth.json` and `models-store.json` into its directory when they are missing.
  - Pass the lab's directory everywhere a path is taken, use `SettingsManager.inMemory`, and give `createAgentSession` a resource loader that returns no extensions, skills, prompts, themes or context files (oid's `resourcesFor`).
- **Concurrency:** two processes making model calls with the same login stalled every call (observed with the CLI on 1.4.0; 1.5.0 changed the auth lock). Run one experiment process at a time (FR-RUN-03).
- **Retries:**
  - Pi's own retries of a whole model turn are off (they consumed the next activation's scripted answer).
  - The provider client's retries inside one call stay on: a call that still fails ends as `model_error`, and one that succeeds includes their time in its latency, so latency is not pure reasoning time.
  - The lab's own retry (FR-ADAPTER-02) is of a rate-limit answer only: the experiment file's `[limits] rate_limit_retries` (0 by default) and `rate_limit_wait_ms` (1000 by default) become `Experiment.rateLimit`, and `runTurns` asks the same call again, with the same context, after `waitMs`, doubling with each retry.
  - Pi gives no HTTP status, only the provider's message, which carries it as its providers format it ("OpenAI API error (429): …", pi-ai 1.5.0 `formatProviderError`), so `isRateLimit` reads the message: `429` standing alone, "rate limit" or "too many requests".
  - The turn stays one `model_turn`: it starts with the first call, ends with the last, and its latency includes the waits.
  - The slot is freed during a wait, each call has its own model turn timeout, and a wait stops at the run's end, which cuts the turn off.
  - Compaction's summary calls are not retried; the judge's calls have retries of their own (FR-ANALYSIS-03).
- **Models:** the lab's login is OpenAI's. The default model for experiments is `openai/gpt-6-luna`, used in oid; it answered a short prompt through the lab's login in about 3.7 s. Anthropic's models are not used: the SDK with a subscription login gave billing and quota errors before (my-ab rule 21).
- **Not used yet:** `@earendil-works/pi-agent-core`, a lower-level stateful agent, if the coding agent's session adds behaviour we do not want; and `@earendil-works/pi-durable`, experimental persistence and resumption.

### Random sequences
- Each purpose's sequence comes from `Random.derive(seed, purpose)`: a 32-bit hash of the seed and the purpose's name starts a mulberry32 generator, whose state is a counter.
- Two purposes could in principle start within a few draws of each other and share part of a sequence; the chance is negligible for a few agents and short runs, but grows with many agents and long runs. If an experiment needs many of both, move to a generator with a larger state.

### Node
- A timer can fire before `performance.now()` has moved its full delay (6.66 ms seen for a 7 ms timer, Node 26). Code that must wait at least a delay, as measured, waits again for what is left (`waitAtLeast` in `src/engine/clock.ts`).
- An aborted session must also free its parallelism slot; otherwise later decisions wait for a call that will never end.

## Testing agents-lab itself

- **Unit and acceptance tests use Pi's faux provider** (FR-ADAPTER-01), with delays that make overlapping decisions happen deterministically.
- **Engine tests run test scenarios from `tests/fixtures/`,** such as a small grid where two agents reach for the same cell. A library scenario's tests live with it.
- **A real model runs only in the smoke test, outside the gate.**
- **The E13 prototype** in `~/git/mesa-sandbox/schelling_async.py` shows the agent loops, the window and the collision outcomes working. It is a reference for behaviour, not code to copy.
