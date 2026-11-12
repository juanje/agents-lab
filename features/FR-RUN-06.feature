@FR-RUN-06
Feature: Runs can run in parallel

  Background:
    Given the test scenario "slots" is in the scenario library, with agents "a" and "b"
    And the scripted model "scripted/one", whose agents wait 200 milliseconds and then end every turn without a tool call
    And an experiment file "e-test" for the scenario "slots", with the model "scripted/one", 2 replicas, the base seed 7, 1 activation per agent, and the conditions "baseline", with no change, and "five-slots", which sets "slots.count" to 5

  Scenario: Without parallel_runs, runs go one after another
    When "lab run" runs the experiment file
    Then 4 runs ran and no two of them overlapped in time

  Scenario: With parallel_runs, up to that many runs are in progress at once, replica by replica
    Given the file sets "parallel_runs" to 2
    When "lab run" runs the experiment file
    Then 4 runs ran, and at some moment 2 of them were in progress
    And never more than 2 were in progress
    And they started in the order "baseline" replica 1, "five-slots" replica 1, "baseline" replica 2, "five-slots" replica 2
    And each run has its own log, and "runs/e-test/index.jsonl" has one line per run
    And each run's setup line gives "parallel_runs" as 2

  Scenario: Each replica keeps its seed when runs run in parallel
    Given the file sets "parallel_runs" to 4
    When "lab run" runs the experiment file
    Then each replica has the same seed in every condition, and the seeds are those of the same file run without "parallel_runs"

  Scenario: The progress lines give each run in progress
    Given the file sets "parallel_runs" to 2
    And progress is printed every 100 milliseconds
    When "lab run" runs the experiment file
    Then a progress line printed while 2 runs were in progress gives both runs by their numbers

  Scenario: An interrupted experiment ends every run in progress
    Given the file sets "parallel_runs" to 2
    And the scripted model's agents wait 2000 milliseconds before each turn
    When "lab run" is interrupted 300 milliseconds after it starts
    Then the 2 runs in progress end as stopped, each log's last line saying it was interrupted
    And no other run started
    And the experiment's total says 0 runs completed and 2 stopped

  Scenario: A run that stops on an error stops the experiment and the runs in progress
    Given the file sets "parallel_runs" to 2
    And the scripted model's first session in "baseline" replica 1 fails to open
    When "lab run" runs the experiment file
    Then "baseline" replica 1 stopped on its error
    And "five-slots" replica 1 ended as stopped, saying the experiment stopped
    And no other run started

  Scenario Outline: A parallel_runs that is not a whole number of at least 1 is refused before any model call
    Given the file sets "parallel_runs" to <value>
    When "lab run" runs the experiment file
    Then it fails with an error that names "parallel_runs"
    And no model was called

    Examples:
      | value |
      | 0     |
      | 1.5   |
