@FR-METRIC-02
Feature: Scenario metrics are sampled on a schedule

  Background:
    Given a test world with 3 slots, all empty, whose metric "held" counts the held slots
    And the effector "take" takes 100 milliseconds, puts the agent in a slot when it lands, and fails with "slot_taken" when the slot is held when it lands

  Scenario: Metrics are sampled at the start and at the end of a run
    Given agent "a" runs on a scripted model that calls "take" with slot 1, then ends without a tool call
    When the run ends
    Then the log's first metric sample gives "held" as 0, computed from the world's version 0
    And its last metric sample gives "held" as 1, computed from the world's version 1

  Scenario: Metrics are sampled at the interval between the start and the end
    Given the metric interval is 100 milliseconds
    And agent "a" runs on a scripted model whose first turn is the text "Waiting." with no tool call, after 450 milliseconds
    When the run ends
    Then the log has at least 4 metric samples between its first and its last
    And no two consecutive metric samples were taken less than 100 milliseconds apart

  Scenario: A metric with no value is recorded as null
    Given the world's metric "first holder" has no value while no slot is held
    And agent "a" runs on a scripted model that ends its first turn without a tool call
    When the run ends
    Then every metric sample gives "first holder" as null

  Scenario: A metric with a value per agent is recorded with each agent's value
    Given the world's metric "slot of" gives, for each agent that holds a slot, the number of its slot
    And agent "a" runs on a scripted model that calls "take" with slot 2, then ends without a tool call
    When the run ends
    Then the log's last metric sample gives "slot of" as agent "a" with 2

  Scenario: The experiment file sets the interval for every run
    Given an experiment file "e-test" for the test scenario "slots", with 1 model, 1 replica, a time limit of 450 milliseconds and "metric_interval_ms" set to 100
    When "lab run" runs the experiment file
    Then the run's log has at least 4 metric samples between its first and its last
