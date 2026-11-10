@FR-CLOCK-01
Feature: Each agent runs its own loop

  Background:
    Given a test world with 10 slots, all empty
    And the declared actions are "take <slot>" and "wait"

  Scenario: A slow agent does not hold back a fast one
    Given agent "slow" runs on a scripted model that answers "wait" after 1000 milliseconds, and makes 1 decision
    And agent "fast" runs on a scripted model that answers "wait" after 50 milliseconds each time, and makes 5 decisions
    And both agents wait 10 milliseconds between decisions
    When the run ends
    Then all 5 of agent "fast"'s decisions were applied before agent "slow"'s decision was applied

  Scenario: An agent waits an interval from its own rhythm between decisions
    Given agent "a" runs on a scripted model that answers "wait" with no delay, and makes 3 decisions
    And agent "a" waits 100 milliseconds between decisions
    When the run ends
    Then each of agent "a"'s decisions was observed at least 100 milliseconds after the previous one was applied

  Scenario: Agents observe and act while another agent is deciding
    Given agent "slow" runs on a scripted model that answers "take 1" after 500 milliseconds, and makes 1 decision
    And agent "fast" runs on a scripted model that answers "take 1" after 50 milliseconds, and makes 1 decision
    And both agents wait 10 milliseconds between decisions
    When the run ends
    Then agent "fast"'s decision succeeded
    And agent "slow"'s decision failed with "slot_taken"
