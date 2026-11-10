@FR-SMOKE-01 @smoke
Feature: The basic pieces run with a real model

  Scenario: Two agents take slots on a real model
    Given the test scenario "slots" with 5 slots, whose system prompt describes a resident who wants a slot of its own
    And agents "a" and "b" run on the real model named by AGENTS_LAB_SMOKE_MODEL, through the lab's Pi login
    And each makes 2 activations, waiting 1 second between them
    When the run ends
    Then the run did not stop
    And each agent's activations began with its rhythm stimulus
    And each agent made at least one model turn with the outcome "success"
    And each agent made at least one tool call, and every tool call has an outcome from the declared set
    And the person's Pi directory is unchanged
    And the run printed each agent's model turns with their latencies and its tool calls with their outcomes
