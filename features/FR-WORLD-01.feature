@FR-WORLD-01
Feature: Actions are applied one at a time against the current state

  Background:
    Given a test world with 3 slots, all empty
    And the action "take" puts an agent in a slot, only if that slot is empty, and otherwise fails with "slot_taken"

  Scenario: An action whose precondition holds is applied
    When agent "a" takes slot 1
    Then the action succeeds
    And slot 1 holds agent "a"
    And the world's version is 1

  Scenario: An action whose precondition does not hold changes nothing
    Given agent "b" holds slot 2
    When agent "a" takes slot 2
    Then the action fails with "slot_taken"
    And slot 2 holds agent "b"
    And the world's version is the same as before the action

  Scenario: Two actions on the same slot that arrive together are applied one after the other
    When agents "a" and "b" both take slot 3 at the same moment
    Then exactly one of the two actions succeeds
    And the other fails with "slot_taken"
    And the world's version grew by 1
