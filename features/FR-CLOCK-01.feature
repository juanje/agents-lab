@FR-CLOCK-01
Feature: Each agent has its own activations

  Background:
    Given a test world with 10 slots, all empty
    And the sensor "look" returns which slots are empty and which are held
    And the effector "take" puts the agent in a slot, only if that slot is empty, and otherwise fails with "slot_taken"

  Scenario: A slow agent does not hold back a fast one
    Given agent "slow" makes 1 activation, whose model calls "take" with slot 1 after 1000 milliseconds, then ends
    And agent "fast" makes 3 activations, whose model calls "take" with a free slot after 50 milliseconds, then ends
    And both agents wait 10 milliseconds between activations
    When the run ends
    Then all 3 of agent "fast"'s "take" calls were applied before agent "slow"'s

  Scenario: An activation ends when a model turn makes no tool call
    Given agent "a" makes 1 activation, whose turns are: a call to "look"; a call to "look"; the text "Enough." with no tool call
    When the run ends
    Then agent "a"'s activation ended after its third model turn

  Scenario: An agent waits an interval from its own rhythm between activations
    Given agent "a" makes 3 activations, each ending its first turn without a tool call
    And agent "a" waits 100 milliseconds between activations
    When the run ends
    Then each of agent "a"'s activations began at least 100 milliseconds after the previous one ended

  Scenario: The agent keeps its session across activations
    Given agent "a" makes 2 activations: in the first its model calls "look", then ends; in the second it ends its first turn without a tool call
    When the run ends
    Then the model turn of agent "a"'s second activation received the "look" result of its first activation

  Scenario: Agents do not all wake at the same moment
    Given agents "a" and "b" each make 1 activation, ending its first turn without a tool call
    And each agent waits a random interval between 10 and 100 milliseconds before each activation
    And the run's seed is 42
    When the run ends
    Then each agent's first activation began at least the first interval of its rhythm after the run started
    And agent "a"'s and agent "b"'s first activations began at different moments
