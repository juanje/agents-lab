@FR-RUN-01
Feature: An experiment runs every condition, model and replica

  Background:
    Given the test scenario "slots" is in the scenario library, with agents "a" and "b"
    And the scripted models "scripted/one" and "scripted/two", whose agents end every turn without a tool call
    And an experiment file "e-test" for the scenario "slots", with the models "scripted/one" and "scripted/two", 2 replicas, the base seed 7, 1 activation per agent, and the conditions "baseline", with no change, and "five-slots", which sets "slots.count" to 5

  Scenario: Every condition runs with every model, for every replica, one run after another
    When "lab run" runs the experiment file
    Then 8 runs ran, one for each condition, model and replica
    And no two runs overlapped in time
    And every agent of each run used that run's model

  Scenario: Each replica has its own seed, the same in every condition and model
    When "lab run" runs the experiment file
    Then replica 1 and replica 2 have different seeds
    And each replica has the same seed in every condition and model

  Scenario: Each run's log is written into the experiment's runs directory, and the index lists it
    When "lab run" runs the experiment file
    Then "runs/e-test/" holds 8 run logs
    And "runs/e-test/index.jsonl" has one line per run, with its run id, condition, model, replica, seed and "completed"
    And each line's run id names one of the run logs

  Scenario: The experiment's limits apply to every run
    When "lab run" runs the experiment file
    Then each agent's log in every run has exactly 1 activation

  Scenario Outline: A file that names something unknown fails before any model call, naming it
    Given the experiment file <change>
    When "lab run" runs the experiment file
    Then it fails with an error that names "<name>"
    And no model was called
    And no run log was written

    Examples:
      | change                                                   | name           |
      | names the scenario "slotz"                               | slotz          |
      | names the model "scripted/none"                          | scripted/none  |
      | has a condition "typo" that sets "slots.cuont" to 5      | slots.cuont    |

  Scenario: A run that stops on an error stops the experiment
    Given the scripted model "scripted/two"'s session fails to open
    When "lab run" runs the experiment file
    Then it fails with an error that names "scripted/two"
    And "runs/e-test/index.jsonl" ends with a line that says that run stopped
    And no run started after it
