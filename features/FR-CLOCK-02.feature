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

  Scenario: A sensor call still running at the time limit is cut off and leaves no sensing
    Given the sensor "look" takes 1000 milliseconds
    And agent "a" runs on a scripted model that calls "look", then ends without a tool call
    And the run's time limit is 200 milliseconds
    When the run ends
    Then agent "a"'s "look" call has the outcome "cut_off"
    And the engine has no sensing for agent "a"

  Scenario: A model turn still running at the time limit is aborted
    Given agent "a" runs on a scripted model whose first turn is the text "Thinking." with no tool call, after 1000 milliseconds
    And the run's time limit is 200 milliseconds
    When the run ends
    Then agent "a"'s first model turn has the outcome "cut_off"
    And the run ended within 300 milliseconds of starting

  Scenario: After the time limit, no agent takes another turn or wakes again
    Given agent "a" runs on a scripted model that calls "take" with slot 1, then writes "Done." with no tool call
    And agent "b" makes 3 activations, each ending its first turn without a tool call, waiting 150 milliseconds between them
    And the run's time limit is 200 milliseconds
    When the run ends
    Then agent "a" made no model turn after its "take" call was cut off
    And agent "b" made only the activations that began before the time limit

  Scenario: A model turn still waiting for a slot at the time limit is cut off without calling the model
    Given the parallelism limit is 1
    And agent "a" runs on a scripted model whose first turn is the text "Busy." with no tool call, after 1000 milliseconds
    And agent "b" runs on a scripted model whose first turn is the text "Waiting." with no tool call, and wakes 50 milliseconds after agent "a"
    And the run's time limit is 200 milliseconds
    When the run ends
    Then agent "b"'s first model turn has the outcome "cut_off"
    And agent "b"'s scripted model was never called
