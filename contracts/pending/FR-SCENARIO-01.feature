@FR-SCENARIO-01
Feature: A scenario plugs into the engine

  Scenario: A complete scenario loads with its base configuration
    Given the test scenario "slots", whose base configuration has 3 slots, none held
    When the engine loads it
    Then it loads
    And its world starts with 3 empty slots

  Scenario: A condition changes the base configuration
    Given the test scenario "slots", whose base configuration has 3 slots, none held
    And a condition "five-slots" that sets the number of slots to 5
    When the engine loads it with the condition "five-slots"
    Then its world starts with 5 empty slots

  Scenario: A condition changes one value inside a table and keeps the others
    Given the test scenario "slots", whose base configuration has 3 slots, none held
    And a condition "two-held" that sets "slots.held" to 2
    When the engine loads it with the condition "two-held"
    Then its world starts with 3 slots, 2 of them held

  Scenario Outline: A scenario that lacks a part is refused before any model call
    Given the test scenario "slots" without its <part>
    When the engine loads it
    Then loading fails with an error that names "<part>"
    And no model was called

    Examples:
      | part               |
      | initial state      |
      | tools              |
      | stimulus channels  |
      | metrics            |
      | system prompt      |
      | base configuration |

  Scenario Outline: A scenario whose text part holds nothing is refused before any model call
    Given the test scenario "slots" with an empty <part>
    When the engine loads it
    Then loading fails with an error that names "<part>"
    And no model was called

    Examples:
      | part               |
      | system prompt      |
      | base configuration |

  Scenario: A condition that sets a key the base configuration lacks is refused before any model call
    Given the test scenario "slots", whose base configuration has 3 slots, none held
    And a condition "typo" that sets "slots.cuont" to 5
    When the engine loads it with the condition "typo"
    Then loading fails with an error that names "slots.cuont"
    And no model was called

  Scenario: A condition that changes the kind of a value is refused before any model call
    Given the test scenario "slots", whose base configuration has 3 slots, none held
    And a condition "text-count" that sets "slots.count" to the text "five"
    When the engine loads it with the condition "text-count"
    Then loading fails with an error that names "slots.count", "number" and "string"
    And no model was called
