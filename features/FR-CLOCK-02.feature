@FR-CLOCK-02
Feature: A run ends at its budget or its time limit

  Background:
    Given a test world with 3 slots, all empty
    And the sensor "look" takes no time and returns which slots are empty and which are held
    And the effector "take" takes 1000 milliseconds and puts the agent in a slot, only if that slot is empty

  Scenario: A run ends when every agent has used its activation budget
    Given agent "a" makes 2 activations and agent "b" makes 3, each ending its first turn without a tool call
    And the run's time limit is 10 seconds
    When the run ends
    Then agent "a" made 2 activations and agent "b" made 3
    And the run ended well before its time limit

  Scenario: A tool call still running at the time limit is cut off and applies nothing
    Given agent "a" runs on a scripted model that calls "take" with slot 1, then ends without a tool call
    And the run's time limit is 200 milliseconds
    When the run ends
    Then agent "a"'s "take" call has the outcome "cut_off"
    And every slot is empty
    And the run ended within 300 milliseconds of starting
