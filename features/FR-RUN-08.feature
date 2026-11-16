@FR-RUN-08
Feature: A run ends when its world is finished

  Background:
    Given a test world with 3 slots, all empty, whose metric "held" counts the held slots
    And the world is finished when slots 1 and 2 are both held
    And the sensor "look" takes no time and returns which slots are empty and which are held
    And the effector "take" takes 100 milliseconds, puts the agent in a slot when it lands, and fails with "slot_taken" when the slot is held when it lands
    And the effector "fill" takes 2000 milliseconds and puts the agent in a slot when it lands
    And the run's time limit is 10 seconds

  Scenario: The run ends when its world is finished, and the log says when
    Given agent "a" runs on a scripted model whose turns are: a call to "take" with slot 1; a call to "take" with slot 2; the text "Done." with no tool call
    And agent "b" runs on a scripted model whose first turn is the text "Thinking." with no tool call, after 5000 milliseconds
    When the run ends
    Then the run ended within 500 milliseconds after agent "a"'s second "take" call ended
    And the log has a "world_finished" line, giving as the moment the world was finished the end of agent "a"'s second "take" call, within 20 milliseconds

  Scenario: The call that finished the world keeps its outcome, and no agent takes another turn
    Given agent "a" runs on a scripted model whose turns are: a call to "take" with slot 1; a call to "take" with slot 2; the text "Done." with no tool call
    And agent "b" makes 3 activations, each ending its first turn without a tool call, waiting 2000 milliseconds between them
    When the run ends
    Then agent "a"'s second "take" call succeeded
    And agent "a" made no model turn after it
    And agent "b" made only the activations that began before the world was finished

  Scenario: A tool call still running is cut off and applies nothing
    Given agent "a" runs on a scripted model whose turns are: a call to "take" with slot 1; a call to "take" with slot 2; the text "Done." with no tool call
    And agent "b" runs on a scripted model that calls "fill" with slot 3, then ends without a tool call
    When the run ends
    Then agent "b"'s "fill" call has the outcome "cut_off"
    And slot 3 is empty

  Scenario: A model turn still running is aborted
    Given agent "a" runs on a scripted model whose turns are: a call to "take" with slot 1; a call to "take" with slot 2; the text "Done." with no tool call
    And agent "b" runs on a scripted model whose first turn is the text "Thinking." with no tool call, after 5000 milliseconds
    When the run ends
    Then agent "b"'s first model turn has the outcome "cut_off"

  Scenario: A component's action still running is cut off
    Given the component "porter", whose cycle fills slot 3 with "crate" at once, an action that takes 2000 milliseconds, then ends
    And agent "a" runs on a scripted model whose turns are: a call to "take" with slot 1; a call to "take" with slot 2; the text "Done." with no tool call
    When the run ends
    Then the porter's action is recorded with the outcome "cut_off"
    And slot 3 is empty

  Scenario: The final metric sample comes after the line, from the finished world
    Given agent "a" runs on a scripted model whose turns are: a call to "take" with slot 1; a call to "take" with slot 2; the text "Done." with no tool call
    When the run ends
    Then the log's last metric sample comes after its "world_finished" line
    And it gives "held" as 2, computed from the world's version 2

  Scenario: The world is asked after every change, whoever applies it
    Given the component "porter", whose cycle fills slot 2 with "crate" after 300 milliseconds, an action that takes 100 milliseconds, then ends
    And agent "a" runs on a scripted model whose turns are: a call to "take" with slot 1; the text "Done." with no tool call
    And agent "b" runs on a scripted model whose first turn is the text "Thinking." with no tool call, after 5000 milliseconds
    When the run ends
    Then the log has a "world_finished" line, giving as the moment the world was finished the end of the porter's action, within 20 milliseconds

  Scenario: A scenario that does not say its world is finished runs as before
    Given the world is never finished
    And agent "a" runs on a scripted model whose turns are: a call to "take" with slot 1; a call to "take" with slot 2; the text "Done." with no tool call
    And agent "b" runs on a scripted model whose first turn is the text "Thinking." with no tool call, after 600 milliseconds
    When the run ends
    Then the run ended no earlier than agent "b"'s first model turn ended
    And the log has no "world_finished" line

  Scenario: When the time limit passes first, the run ends at it with no line
    Given the run's time limit is 150 milliseconds
    And agent "a" runs on a scripted model whose turns are: a call to "take" with slot 1; a call to "take" with slot 2; the text "Done." with no tool call
    When the run ends
    Then agent "a"'s second "take" call has the outcome "cut_off"
    And slot 2 is empty
    And the log has no "world_finished" line

  Scenario: A run that ends because its world is finished is completed
    Given an experiment file "e-test" for a test scenario whose world is finished when slots 1 and 2 are both held, with agent "a" on a scripted model that takes slot 1, then slot 2, then writes "Done.", 1 replica and a time limit of 10 seconds
    When "lab run" runs the experiment file
    Then the experiment's "index.jsonl" lists the run as completed
    And the run's log has a "world_finished" line
