@FR-TOOL-01
Feature: Tools are the agent's only interface with the world

  Background:
    Given a test world with 3 slots, all empty
    And the sensor "look" returns which slots are empty and which are held
    And the effector "take" puts the agent in a slot, only if that slot is empty, and otherwise fails with "slot_taken"

  Scenario: The agent's session offers exactly the scenario's tools
    Given agent "a" runs on a scripted model that ends its first turn without a tool call
    When the run ends
    Then agent "a"'s model was offered the tools "look" and "take" and no others

  Scenario: A sensor returns part of the world and changes nothing
    Given agent "b" holds slot 2
    And agent "a" runs on a scripted model that calls "look", then ends without a tool call
    When the run ends
    Then agent "a"'s "look" call returned slot 2 held and slots 1 and 3 empty
    And the world's version is the same as before the run

  Scenario: An effector changes the world through the arbiter
    Given agent "a" runs on a scripted model that calls "take" with slot 1, then ends without a tool call
    When the run ends
    Then slot 1 holds agent "a"
    And the world's version grew by 1
