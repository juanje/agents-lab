@FR-SCENARIO-01
Feature: A scenario plugs into the engine

  Scenario: A complete scenario loads with its base configuration
    Given the test scenario "slots", whose base configuration has 3 slots
    When the engine loads it
    Then it loads
    And its world starts with 3 empty slots

  Scenario: A condition changes the base configuration
    Given the test scenario "slots", whose base configuration has 3 slots
    And a condition "five-slots" that sets the number of slots to 5
    When the engine loads it with the condition "five-slots"
    Then its world starts with 5 empty slots

  Scenario Outline: A scenario that lacks a part is refused before any model call
    Given the test scenario "slots" without its <part>
    When the engine loads it
    Then loading fails with an error that names "<part>"
    And no model was called

    Examples:
      | part               |
      | initial state      |
      | perception         |
      | actions            |
      | metrics            |
      | system prompt      |
      | base configuration |
