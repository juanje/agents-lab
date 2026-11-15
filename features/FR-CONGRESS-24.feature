@FR-CONGRESS-24
Feature: D5 on the confirmed order, done with exceptions, parts re-evaluated from the run

  Background:
    Given the congress scenario and the draw of FR-CONGRESS-20's background, with "v1" keeping its catering "outside_fee" and its own caterer "c9"

  Scenario Outline: D5 reads the permit of the order the caterer confirmed
    Given a live booking with "v1", 50 registrants who eat "standard", six confirmed speakers and 2 helpers
    And "v1" confirmed the extra "outside_catering" with the permit "v1-permit-1"
    And the organiser sent "c2" an order for "standard: 61" with <first>, then an order for "standard: 61" with <second>, and "c2" confirmed the second
    When "food_for_everyone" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | first                     | second                    | result        |
      | no permit                 | the permit "v1-permit-1"  | holds         |
      | the permit "required"     | the permit "v1-permit-1"  | holds         |
      | the permit "v1-permit-1"  | no permit                 | does not hold |

  Scenario Outline: done with exceptions
    Given D0 to D9 all hold at the end of preparation, except <failing>
    When a part with predicate "done" and params <params> is evaluated at the end of preparation
    Then it <result>

    Examples:
      | failing                                    | params                                                     | result        |
      | "attendance_in_range"                      | none                                                       | does not hold |
      | "attendance_in_range"                      | except "attendance_in_range"                               | holds         |
      | "attendance_in_range" and "speakers_travel" | except "attendance_in_range"                              | does not hold |
      | "attendance_in_range" and "speakers_travel" | except "attendance_in_range" and "speakers_travel"        | holds         |

  Scenario: An exception that is not a check is refused
    Given a parts file with a part of predicate "done" and params except "attendance"
    When the parts are loaded
    Then they are refused, naming the part

  Scenario: A run's parts are re-evaluated from what it kept
    Given a completed run whose parts file evaluated "food_for_everyone" at "day 26 06:30" with the defect above, and wrote "D5" not held
    When lab reevaluate is run on its directory with a parts file whose "D5" is "food_for_everyone"
    Then "<run id>.parts.jsonl" gives "D5" held, the run's log is unchanged, and lab parts reads the new file and says so

  Scenario: A part with no kept state is not evaluated
    Given a completed run with "parts_state" lines only at "day 26 06:30"
    When lab reevaluate is run with a part evaluated at "day 20 09:00"
    Then that part is reported as not evaluated, naming the part and the run
