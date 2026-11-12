@FR-RUN-07
Feature: An interrupted experiment resumes where it stopped

  Background:
    Given the test scenario "slots" is in the scenario library, with agents "a" and "b"
    And the scripted model "scripted/one", whose agents wait 200 milliseconds and then end every turn without a tool call
    And an experiment file "e-test" for the scenario "slots", with the model "scripted/one", 2 replicas, the base seed 7, 1 activation per agent, and the conditions "baseline", with no change, and "five-slots", which sets "slots.count" to 5

  Scenario: Resuming runs only the runs not completed, with their seeds
    Given "lab run" ran the experiment file and was interrupted after its first 2 runs completed and while its third was in progress
    When "lab run --resume" runs the experiment file
    Then it ran 2 runs: "five-slots" replica 1 and "five-slots" replica 2
    And each had the seed its replica has in "baseline"
    And the first 2 runs' logs are unchanged
    And "runs/e-test/index.jsonl" lists 4 completed runs, one for each condition and replica, and the interrupted run as stopped
    And before the first run it printed that 2 runs were already completed and 2 were left

  Scenario: Resuming a completed experiment runs nothing
    Given "lab run" ran the experiment file to the end
    When "lab run --resume" runs the experiment file
    Then no model was called
    And it printed that 4 runs were already completed and 0 were left

  Scenario: Resuming with no runs directory runs the whole experiment
    When "lab run --resume" runs the experiment file
    Then 4 runs ran

  Scenario Outline: Resuming an experiment whose setup has changed is refused before any model call
    Given "lab run" ran the experiment file and was interrupted after its first 2 runs completed
    And <change>
    When "lab run --resume" runs the experiment file
    Then it fails with an error that names <named>
    And no model was called

    Examples:
      | change                                                        | named          |
      | the condition "baseline" now sets "slots.count" to 4          | "slots.count"  |
      | the file's base seed is now 8                                 | the seed       |
      | the code's commit differs from the one the runs recorded      | the commit     |
