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
      | agents             |
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

  Scenario: A scenario without a rhythm channel is refused before any model call
    Given the test scenario "slots", whose stimulus channels do not include one named "rhythm"
    When the engine loads it
    Then loading fails with an error that names "rhythm"
    And no model was called

  Scenario: A run uses exactly the parts of the scenario it loaded
    Given the test scenario "slots", whose base configuration has 3 slots, none held
    And the engine loads it
    And agent "a" runs on a scripted model that ends its first turn without a tool call
    When the loaded scenario runs
    Then agent "a"'s model was offered exactly the scenario's tools
    And the system prompt agent "a"'s model received is exactly the scenario's
    And agent "a"'s activation began with the scenario's rhythm stimulus

  Scenario: Each agent gets its own system prompt
    Given the test scenario "slots", whose system prompt names the agent it describes
    When agents "a" and "b" run on scripted models that end their first turn without a tool call
    Then agent "a"'s system prompt names "a"
    And agent "b"'s system prompt names "b"

  Scenario: A channel's source and text come from the configuration
    Given the test scenario "slots", whose rhythm channel's text is "rhythm.text" in its configuration
    And a condition "slow" that sets "rhythm.text" to "A long while passes."
    When agent "a" runs with the condition "slow" on a scripted model that ends its first turn without a tool call
    Then agent "a"'s rhythm stimulus has the content "A long while passes."

  Scenario: A run whose agents differ from the scenario's is refused before any model call
    Given the test scenario "slots", whose configuration declares agents "a" and "b"
    When a run is given agents "a" and "c"
    Then the run fails with an error that names "b" and "c"
    And no model was called

  Scenario: A condition changes the agents' rhythm
    Given the test scenario "slots", whose agents wait "rhythm.interval_ms" between activations
    And a condition "slow" that sets "rhythm.interval_ms" to 300
    When agent "a" runs with the condition "slow" on a scripted model that ends its first turn without a tool call
    Then agent "a"'s first activation began at least 300 milliseconds after the run started
