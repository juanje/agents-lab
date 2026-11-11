@FR-EXPERIMENT-05
Feature: An experiment file sets the model's thinking level

  Background:
    Given the test scenario "slots" is in the scenario library, with agents "a" and "b"
    And the scripted model "scripted/one", which can reason, whose agents end every turn without a tool call
    And an experiment file "e-test" for the scenario "slots", with the model "scripted/one", 1 replica, 1 activation per agent, the condition "baseline", with no change, and the thinking level "low"

  Scenario: Every session of every run uses the file's thinking level
    When "lab run" runs the experiment file
    Then every session of the run used the thinking level "low"
    And the first line of the run's log gives the thinking level "low"

  Scenario: A file without a thinking level is refused, naming it
    Given the experiment file has no thinking level
    When the engine reads it
    Then reading fails with an error that names "thinking_level"

  Scenario: A thinking level that does not exist is refused, naming the levels
    Given the experiment file sets the thinking level to "huge"
    When the engine reads it
    Then reading fails with an error that names "thinking_level" and "off, minimal, low, medium, high, xhigh or max"

  Scenario: A level the model cannot use is refused before any model call
    Given the scripted model "scripted/plain", which cannot reason
    And the experiment file names the model "scripted/plain" and the thinking level "high"
    When "lab run" runs the experiment file
    Then it fails with an error that names "scripted/plain" and "high"
    And no model was called
