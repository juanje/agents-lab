@FR-WORKSHOP-01
Feature: A workshop from its materials

  Background:
    Given the workshop scenario with its base configuration

  Scenario: The workshop is in the scenario library
    Then "lab inventory" can list an experiment file for the scenario "workshop"
    And the inventory lists the agents "Dal", "Mik", "Nar" and "Ren"
    And it gives the plan with its six modules, their recipes and what each is mounted after, the pile's stock, 2 bench places, and hands of 6 loose pieces and one module
    And it gives the durations in world minutes: "look" 0.5, "read_plan" 1, "take" 1, "put_back" 0.5, "join" 2, "take_apart" 2, "mount" 3, "mount_refused" 0.5, "say" 0.25 with "say_words_per_minute" 30, and "wait_max_minutes" 10
    And it gives the calendar's start "day 1 Monday 09:00" and one segment of scale 4 "until the run ends"
    And it gives each worker's rhythm as an interval drawn uniformly between 1000 and 3000 ms, and the channel "rhythm" with the source "your own pace" and the text "You are ready to act."

  Scenario: The world starts with every piece in the pile and nothing held
    When the engine loads it with the seed 42
    Then the pile holds "arn" 4, "bex" 3, "cal" 4, "dov" 5, "eln" 2, "fim" 2 and "gor" 2
    And no module is mounted, and both bench places are free
    And no worker holds a loose piece or a module

  Scenario: The system prompt joins the texts in order, with the worker's name
    When the engine loads it with the seed 42
    Then worker "Dal"'s system prompt is the text of "identity.md" with "{name}" as "Dal", then the text of "task.md", then the text of "world-rules.md", each separated by a blank line
    And it begins "You are Dal, one of the four workers of a small workshop that assembles devices to order."
    And worker "Ren"'s system prompt begins "You are Ren, one of the four workers"

  Scenario: The system prompt gives nothing of the world's state
    When the engine loads it with the seed 42
    Then no worker's system prompt holds any of "arn", "bex", "cal", "dov", "eln", "fim", "gor", "tessa", "ulm", "vorn", "wick", "yarl" or "zeth"
    And worker "Dal"'s system prompt holds none of "Mik", "Nar" or "Ren"

  Scenario: A text placed first reaches the worker once, as it first wakes
    Given the configuration places "task" as "first" and sets "order_source" to "the order on the wall"
    And worker "Dal" makes 2 activations, each ending its first turn without a tool call
    And the other workers' scripted models end every turn without a tool call
    When the run ends
    Then worker "Dal"'s system prompt holds the texts of "identity.md" and "world-rules.md", and not the text of "task.md"
    And worker "Dal"'s first activation received, right after its rhythm's stimulus, the text of "task.md" from "the order on the wall" on the channel "order"
    And its second activation received nothing on the channel "order"

  Scenario: No message is sent when every text is in the system prompt
    Given worker "Dal" makes 1 activation, ending its first turn without a tool call
    And the other workers' scripted models end every turn without a tool call
    When the run ends
    Then worker "Dal" received nothing on the channel "order"

  Scenario: The seed draws the listing orders
    When the engine loads it twice with the seed 42
    Then the order of the pile's kinds, the order of the workers and the order of the modules are the same both times
    And over the seeds 1 to 20, the order of the workers is not always the same, nor the order of the kinds, nor the order of the modules

  Scenario: Changing the workers leaves the other orders as they were
    Given a condition "three" that sets "workers" to ["Dal", "Mik", "Nar"]
    When the engine loads it with the seed 42 and the base configuration, and again with the seed 42 and the condition "three"
    Then the order of the pile's kinds is the same both times, and so is the order of the modules
    And under the condition "three" the agents are "Dal", "Mik" and "Nar"

  Scenario: Each worker rests its own drawn interval before each activation
    When the engine loads it with the seed 42
    Then every interval each worker's rhythm draws is from 1000 to 3000 milliseconds
    And worker "Dal"'s intervals are the same as under the condition "three", which leaves out "Ren"

  Scenario Outline: A configuration the workshop cannot build is refused before any model call
    Given the configuration is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names <named>

    Examples:
      | change                                                         | named                     |
      | the plan has no module                                         | "plan"                    |
      | the recipe of "ulm" is empty                                   | "plan.ulm.recipe"         |
      | the recipe of "ulm" names the kind "hox", which the pile lacks | "plan.ulm.recipe"         |
      | "ulm" is mounted after "quill", which is no module             | "plan.ulm.after"          |
      | "tessa" is mounted after "zeth", which is mounted after "tessa" | "plan.tessa.after"       |
      | the pile holds -1 "arn"                                        | "pile.arn"                |
      | the pile holds 2.5 "arn"                                       | "pile.arn"                |
      | "bench_places" is 0                                            | "bench_places"            |
      | "hand_pieces" is 0                                             | "hand_pieces"             |
      | "workers" is []                                                | "workers"                 |
      | "workers" is ["Dal", "Dal", "Nar", "Ren"]                      | "workers"                 |
      | the duration of "join" is -1                                   | "durations.join"          |
      | "wait_max_minutes" is 0                                        | "wait_max_minutes"        |
      | the calendar has a second segment                              | "calendar.segments"       |
      | "rhythm.min_ms" is 4000                                        | "rhythm"                  |
      | "task" is placed as "person"                                   | "placement.task"          |
      | the placement names the text "norms"                           | "placement.norms"         |
      | "identity" holds "{team}"                                      | "identity" and "{team}"   |
