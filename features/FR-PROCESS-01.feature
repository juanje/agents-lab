@FR-PROCESS-01
Feature: Components with their own life cycles change the world

  Background:
    Given a test world with 3 slots, slot 1 held by "parcel"
    And the sensor "look" takes no time and returns which slots are empty and which are held
    And the effector "take" takes 300 milliseconds, puts the agent in a slot when it lands, and fails with "slot_taken" when the slot is held when it lands
    And the component "porter", whose cycle waits a number of milliseconds drawn from 100 to 200 from its own random sequence, then fills slot 2 with "crate", an action that takes 100 milliseconds and fails with "slot_taken" when the slot is held when it lands, then ends

  Scenario: A component changes the world while no agent acts
    Given agent "a" runs on a scripted model that ends every turn without a tool call
    When the run ends
    Then slot 2 holds "crate"
    And the run's log has a line for the porter's action, with when it started and ended and the outcome "success"
    And no model was called for the porter

  Scenario: A component's action is checked when it lands
    Given agent "a" runs on a scripted model that calls "take" with slot 2 at once, then ends without a tool call
    And the porter's wait is drawn as 100 milliseconds
    When the run ends
    Then slot 2 holds agent "a"
    And the porter's action failed with "slot_taken"
    And slot 2 was still empty 50 milliseconds after the porter's action started

  Scenario: A component's changes count among an agent's changes since sensing, by its name
    Given agent "a" runs on a scripted model that calls "look", then waits 400 milliseconds, then calls "take" with slot 3, then ends without a tool call
    When the run ends
    Then agent "a"'s "take" call recorded 1 change since sensing, applied by "porter"

  Scenario: A component's sequence comes from the seed and its name
    Given the component "porter-2", with the same cycle as "porter" but filling slot 3
    When two replicas run with the seed 42, one with "porter" alone and one with "porter" and "porter-2"
    Then the porter's wait is the same in both replicas

  Scenario: An action still running when the run ends is cut off
    Given the run's time limit is 150 milliseconds
    And the porter's wait is drawn as 100 milliseconds
    When the run ends
    Then the porter's action is recorded with the outcome "cut_off"
    And slot 2 is empty

  Scenario: The inventory lists each component with its kind and its cycle
    Given the component "storm" is declared by the configuration as an external perturbation, whose cycle fills slot 3 with "leaves" after 500 milliseconds
    When "lab inventory" lists it
    Then it lists "porter" as part of the world and "storm" as an external perturbation, each with the description of its cycle
