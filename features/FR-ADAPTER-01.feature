@FR-ADAPTER-01
Feature: A scripted model answers in tests

  Background:
    Given a test world with 3 slots, all empty
    And the declared actions are "take <slot>" and "wait"

  Scenario: The scripted model gives its answers in order
    Given agent "a" runs on a scripted model that answers "take 1", then "wait"
    And agent "a" makes 2 decisions
    When the run ends
    Then agent "a"'s decisions had the answers "take 1" and "wait", in that order
    And slot 1 holds agent "a"

  Scenario: Each answer comes after the delay the script gives
    Given agent "a" runs on a scripted model that answers "wait" after 200 milliseconds
    And agent "a" makes 1 decision
    When the run ends
    Then agent "a"'s decision had a model latency of at least 200 milliseconds

  Scenario: A decision after the script runs out applies nothing
    Given agent "a" runs on a scripted model that answers "take 1"
    And agent "a" makes 2 decisions
    When the run ends
    Then agent "a"'s second decision has the outcome "script_exhausted"
    And only slot 1 is held
