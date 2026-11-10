@FR-ACTION-02
Feature: An action can tell a collision from an invalid choice

  Background:
    Given a test world with 3 slots, all empty
    And the action "take" fails with "taken_while_deciding" when the slot was empty when the agent observed but is held now, and with "slot_taken" when it was already held when the agent observed

  Scenario: A slot taken while the agent decided is a collision
    Given agent "slow" runs on a scripted model that answers "take 1" after 300 milliseconds, and makes 1 decision
    And agent "fast" runs on a scripted model that answers "take 1" after 20 milliseconds, and makes 1 decision
    And both agents wait 10 milliseconds between decisions
    When the run ends
    Then agent "fast"'s decision succeeded
    And agent "slow"'s decision failed with "taken_while_deciding"

  Scenario: A slot already taken when the agent observed is an invalid choice
    Given agent "b" holds slot 1
    And agent "a" runs on a scripted model that answers "take 1", and makes 1 decision
    When the run ends
    Then agent "a"'s decision failed with "slot_taken"
