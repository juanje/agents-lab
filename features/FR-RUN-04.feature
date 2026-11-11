@FR-RUN-04
Feature: lab run shows its progress

  Background:
    Given the test scenario "slots" is in the scenario library, with agents "a" and "b"
    And the scripted model "scripted/one", whose agents end every turn without a tool call
    And an experiment file "e-test" for the scenario "slots", with the model "scripted/one", 2 replicas, the base seed 7, 1 activation per agent, and the condition "baseline", with no change

  Scenario: lab run says when each run starts and ends, and when the experiment ends
    When "lab run" runs the experiment file
    Then it printed, before each run, a line with its number out of 2, the condition "baseline", the model "scripted/one", its replica and its seed
    And it printed, after each run, a line saying it completed, with its duration, 2 activations, its model turns and its cost
    And it printed, last, a line saying 2 runs completed, with the total duration and the total cost

  Scenario: lab run reports a run's progress at its interval
    Given each scripted turn takes 300 milliseconds
    And "lab run" reports progress every 100 milliseconds
    When "lab run" runs the experiment file
    Then during each run it printed at least 2 progress lines, each with the time since the run started, the activations done out of 2, the model turns and the cost so far

  Scenario: A run that stops says so
    Given the scripted model "scripted/one"'s session fails to open
    When "lab run" runs the experiment file
    Then it printed, after the first run, a line saying it stopped

  Scenario: Progress is not written to the log
    When "lab run" runs the experiment file
    Then no line of any run's log holds what lab run printed
