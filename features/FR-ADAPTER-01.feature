@FR-ADAPTER-01
Feature: A scripted model answers in tests

  Background:
    Given a test world with 3 slots, all empty
    And the sensor "look" returns which slots are empty and which are held
    And the effector "take" puts the agent in a slot, only if that slot is empty, and otherwise fails with "slot_taken"

  Scenario: The scripted model gives each turn what its script lists, in order
    Given agent "a" runs on a scripted model whose turns are: a call to "look"; a call to "take" with slot 1; the text "Done." with no tool call
    When the run ends
    Then agent "a"'s activation had 3 model turns, in that order
    And slot 1 holds agent "a"

  Scenario: Each turn comes after the delay the script gives
    Given agent "a" runs on a scripted model whose first turn is the text "Nothing to do." with no tool call, after 200 milliseconds
    When the run ends
    Then agent "a"'s first model turn had a latency of at least 200 milliseconds

  Scenario: When the script runs out, the activation ends
    Given agent "a" runs on a scripted model whose only turn is a call to "look"
    When the run ends
    Then agent "a"'s activation ended after its "look" call
    And the run recorded "script_exhausted" for agent "a"

  Scenario: A scripted turn that runs past the timeout frees its model slot
    Given the parallelism limit is 1
    And the timeout for a model turn is 200 milliseconds
    And agent "a" runs on a scripted model whose first turn is a call to "look", after 2000 milliseconds
    And agent "b" runs on a scripted model whose first turn is the text "Done." with no tool call, and wakes 50 milliseconds after agent "a"
    When the run ends
    Then agent "a"'s first model turn has the outcome "timeout"
    And agent "b"'s model turn started within 300 milliseconds of agent "a"'s
