@FR-EXPERIMENT-02
Feature: Factors expand into conditions

  Background:
    Given the test scenario "slots" is in the scenario library, with agents "a" and "b"
    And the scripted model "scripted/one", whose agents end every turn without a tool call
    And an experiment file "e-test" for the scenario "slots", with the model "scripted/one", 1 replica, the base seed 7 and 1 activation per agent, and no conditions
    And the factor "count" with the levels "three", which sets "slots.count" to 3, and "five", which sets "slots.count" to 5
    And the factor "held" with the levels "none", with no change, and "two", which sets "slots.held" to 2

  Scenario: Every combination of levels runs as one condition, named after its levels, after the baseline
    When "lab run" runs the experiment file
    Then 5 runs ran, with the conditions "baseline", "count=three,held=none", "count=three,held=two", "count=five,held=none" and "count=five,held=two", in that order
    And the run of "count=five,held=two" had "slots.count" as 5 and "slots.held" as 2
    And the run of "baseline" had the base configuration

  Scenario: Each run records the level of each factor
    When "lab run" runs the experiment file
    Then the setup line and the index line of the run of "count=five,held=none" give the level "five" for "count" and "none" for "held"
    And those of the run of "baseline" give no levels

  Scenario: The file can turn the baseline off
    Given the file sets "baseline" to false
    When "lab run" runs the experiment file
    Then 4 runs ran, none of them with the condition "baseline"

  Scenario: A common change applies to every condition, and a level wins over it
    Given the common change sets "slots.take_ms" to 300 and "slots.count" to 4
    When "lab run" runs the experiment file
    Then every run had "slots.take_ms" as 300
    And the run of "baseline" had "slots.count" as 4
    And the run of "count=three,held=none" had "slots.count" as 3

  Scenario: A material in the common change reaches every condition
    Given the file "materials/wake.md", next to the experiment file, holds "Morning comes."
    And the common change sets "rhythm.text" to the material "materials/wake.md"
    When "lab run" runs the experiment file
    Then in every run agent "a"'s rhythm stimulus has the content "Morning comes."

  Scenario: The file's own conditions run after the combinations
    Given the condition "six-slots", which sets "slots.count" to 6
    When "lab run" runs the experiment file
    Then 6 runs ran, the last with the condition "six-slots"

  Scenario: Two levels of one combination that set the same key are refused before any model call
    Given the factor "size" with the levels "small", which sets "slots.count" to 2, and "large", which sets "slots.count" to 8
    When "lab run" runs the experiment file
    Then it fails with an error that names "count", "size" and "slots.count"
    And no model was called

  Scenario: A condition whose name is taken is refused before any model call
    Given the condition "baseline", with no change
    When "lab run" runs the experiment file
    Then it fails with an error that names "baseline"
    And no model was called

  Scenario: A file without conditions or factors is refused
    Given the file declares no factors
    When the engine reads it
    Then reading fails with an error that names "conditions" and "factors"
