@FR-ANALYSIS-04
Feature: Parts by kind and condition (light)

  Background:
    Given an experiment's runs directory with two conditions, "rules" and "character", one model and two replicas each, all completed
    And each run's log has "part" lines for "p1" (kinds: "rules" covered, "character" new) and "p2" (kinds: "rules" changed, "character" variant), and for the outcome "w1"
    And in "rules", "p1" held in both runs, reached at "day 3 10:00" and "day 5 10:00", with efforts 4 and 6 calls and 0 money; "p2" held in neither, with one misapplication in replica 2
    And in "character", "p1" held in replica 1 only, reached at "day 7 10:00" with effort 9; "p2" held in both
    And the "rules" guidance material has 300 words and the "character" one 150

  Scenario: One row per part and condition
    When "lab parts" runs on the directory
    Then the row for "p1" in "rules" gives the kind "covered", active 2, held 2, reached at "day 3 10:00" and "day 5 10:00", and efforts 4 and 6, minimum 4, median 5, maximum 6
    And the row for "p2" in "rules" gives the kind "changed", held 0 and one misapplication, in replica 2

  Scenario: One row per kind and condition
    When "lab parts" runs on the directory
    Then "covered" in "rules" held 2 of 2 (1.0), "changed" in "rules" 0 of 2 (0.0), "new" in "character" 1 of 2 (0.5) and "variant" in "character" 2 of 2 (1.0)

  Scenario: One row per condition gives the guidance's length and the runs' costs
    When "lab parts" runs on the directory
    Then the row for "rules" gives 300 words and 400 estimated tokens, and the row for "character" 150 words and 200, each with its runs' model turns, input tokens and cost

  Scenario: A stopped run is counted apart and gives no values
    Given replica 2 of "character" stopped
    When "lab parts" runs on the directory
    Then the rows for "character" count 1 completed and 1 stopped, and their values come from replica 1 only

  Scenario: The same as JSON
    When "lab parts --json" runs on the directory
    Then it writes the same rows as JSON

  Scenario: A directory without an index is refused
    When "lab parts" runs on a directory with no index
    Then it fails with an error that names the directory

  Scenario: Runs without parts say so
    Given the runs' logs have no "part" lines
    When "lab parts" runs on the directory
    Then it prints that the runs have no parts
