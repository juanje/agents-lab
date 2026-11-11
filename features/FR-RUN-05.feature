@FR-RUN-05
Feature: An interrupted experiment ends its run like a stopped one

  Background:
    Given the test scenario "slots" is in the scenario library, with agents "a" and "b"
    And the scripted model "scripted/one", whose turns take 500 milliseconds and end without a tool call
    And an experiment file "e-test" for the scenario "slots", with the model "scripted/one", 2 replicas, 3 activations per agent, and the condition "baseline", with no change

  Scenario: An interrupted run is recorded as stopped
    When "lab run" runs the experiment file
    And it is interrupted 300 milliseconds into its first run
    Then the first run's log ends with a line saying the run stopped because it was interrupted
    And "runs/e-test/index.jsonl" lists the first run as stopped
    And every session of the first run is closed

  Scenario: No run starts after an interruption, and the total is printed
    When "lab run" runs the experiment file
    And it is interrupted 300 milliseconds into its first run
    Then no second run started
    And it printed, last, a line saying 0 runs completed and 1 stopped
