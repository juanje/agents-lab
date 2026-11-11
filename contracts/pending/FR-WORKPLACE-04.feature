@FR-WORKPLACE-04
Feature: What the worker did in each situation is measured from the world

  Background:
    Given the workplace scenario with the world and situations of FR-WORKPLACE-01, both situations chosen, "open-box" placed in "store", "carry_limit" 2, and the tools' durations of FR-WORKPLACE-02
    And "situation_keys" gives "open-box" the predicates where "note" in ["shelf", "person:ferrer"] and not_given ["box"]
    And it gives "jar" the predicate not_where "jar" in ["store"]
    And the worker is in "counter"

  Scenario: Before the worker does anything, only the world's state counts
    When the run's first metric sample is taken
    Then "holds" gives 0 for "open-box" and 0 for "jar"
    And "predicates" gives 0 for "open-box.where.note", 1 for "open-box.not_given.box" and 0 for "jar.not_where.jar"
    And "sensed_at_ms", "acted_at_ms", "settled_at_ms" and "exploration" give no value for either situation

  Scenario: A look that shows a situation's thing senses it
    Given the worker's scripted turns call "go" to "store", then "look", then end
    When the run ends
    Then "sensed_at_ms" gives "open-box" the moment the look ended, and "jar" the same moment
    And "exploration" gives "open-box" 0 tool calls

  Scenario: A read of a situation's thing senses it, and later actions are measured from then
    Given the worker is in "store"
    And the worker's scripted turns call "read" with "note", then "take" with "note", then "put" with "note" into "shelf", then "record" with "Box arrived open.", then end
    When the run ends
    Then "sensed_at_ms" gives "open-box" the moment the read ended
    And "acted_at_ms" gives "open-box" the moment the take ended
    And "predicates" gives 1 for "open-box.where.note"
    And "holds" gives 1 for "open-box"
    And "settled_at_ms" gives "open-box" the moment the put ended
    And "exploration" gives "open-box" 2 tool calls
    And "entries_after" gives "open-box" 0, since the book is not in "store", and "notes_after" gives it 0

  Scenario: Giving a thing to a person is a location
    Given the worker is in "store"
    And the worker's scripted turns call "look", then "take" with "note", then "go" to "counter", then "give" with "note" to "ferrer", then "note" with "I gave Mrs Ferrer a note from a box.", then end
    When the run ends
    Then "predicates" gives 1 for "open-box.where.note"
    And "notes_after" gives "open-box" 1

  Scenario: A thing the worker holds is in the location "held"
    Given "situation_keys" gives "jar" the predicate where "jar" in ["held"]
    And the worker is in "store"
    And the worker's scripted turns call "take" with "jar", then end
    When the run ends
    Then "predicates" gives 1 for "jar.where.jar"

  Scenario: A situation whose predicates change back is settled when they last changed
    Given the worker is in "store"
    And the worker's scripted turns call "take" with "note", then "put" with "note" into "shelf", then "take" with "note", then "put" with "note" into "box", then end
    When the run ends
    Then "predicates" gives 0 for "open-box.where.note"
    And "settled_at_ms" gives "open-box" the moment the second take ended, when "open-box.where.note" last changed

  Scenario: The metrics are sampled with every metric sample
    Given the experiment's "metric_interval_ms" is 50
    And the worker's scripted turns call "go" to "store", then "look", then end
    When the run ends
    Then every metric sample in the log gives "holds", "predicates", "sensed_at_ms", "acted_at_ms", "settled_at_ms", "exploration", "entries_after" and "notes_after"

  Scenario: A predicate that names something the world does not have fails before any model call
    Given "situation_keys" gives "jar" the predicate where "jar" in ["attic"]
    When the run starts
    Then it fails with an error that names "attic"
    And no model was called
