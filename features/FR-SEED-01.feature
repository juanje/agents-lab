@FR-SEED-01
Feature: One seed gives the same start

  Background:
    Given the test scenario "slots" with 10 slots, which places 3 agents on random empty slots

  Scenario: The same seed gives the same initial world
    When two replicas start with the seed 42
    Then both start with the agents on the same slots

  Scenario: Different seeds give different initial worlds
    When one replica starts with the seed 42 and another with the seed 43
    Then the agents start on different slots in the two replicas

  Scenario: The same seed gives each agent the same waiting intervals
    Given each agent waits a random interval between 10 and 100 milliseconds between decisions
    When two replicas run with the seed 42
    Then each agent waited the same sequence of intervals in both replicas

  Scenario: A condition that places more agents leaves the other agents' intervals as they were
    Given each agent waits a random interval between 10 and 100 milliseconds between decisions
    And a condition "four-agents" that places 4 agents instead of 3
    When one replica runs with the seed 42 and the base configuration, and another with the seed 42 and the condition "four-agents"
    Then each of the 3 agents present in both replicas waited the same sequence of intervals in both
