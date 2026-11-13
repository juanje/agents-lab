@FR-PARTS-01
Feature: Parts as held-out keys

  Background:
    Given a test scenario with the agent "ana" and the participant "shop", whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the scenario provides the predicate "flag_set" (holds while the world's flag named by its params is set), the event "flag_raised", and the misapplication pattern "act_named" (a call of the tool its params name)
    And "ana" has the effectors "set_flag" and "clear_flag" (each 60 world minutes) and the tool "send_mail"
    And the experiment has the factor "guidance" with the levels "none" and "rules", and the "kind_factor" "guidance"
    And the held-out material "parts" has the part "p1": predicate "flag_set" with flag "door", activation "always", evaluated at "day 1 18:00", kinds "none" new and "rules" covered, actors "shop"

  Scenario: A part held at its evaluation, with when it was reached
    Given the condition's "guidance" is "rules"
    And "ana"'s scripted turns call "set_flag" "door", then end
    When the run's time limit passes at "day 1 Monday 19:00"
    Then the run's log has a "part" line for "p1": active, held at "day 1 18:00", reached at "day 1 10:00" within 30 world minutes, kind "covered"

  Scenario: A part that held and then stopped holding is not reached
    Given "ana"'s scripted turns call "set_flag" "door", then "clear_flag" "door", then end
    When the run's time limit passes at "day 1 Monday 19:00"
    Then the "part" line for "p1" says it did not hold at "day 1 18:00" and has no "reached_at"

  Scenario: reached_at is the start of the last interval in which it held
    Given "ana"'s scripted turns call "set_flag" "door", then "clear_flag" "door", then "set_flag" "door", then end
    When the run's time limit passes at "day 1 Monday 19:00"
    Then the "part" line for "p1" gives "reached_at" "day 1 12:00", within 30 world minutes

  Scenario: The kind is the one for the run's level of the kind factor
    Given the condition's "guidance" is "none"
    When the run's time limit passes at "day 1 Monday 19:00"
    Then the "part" line for "p1" gives the kind "new"

  Scenario: A part activated by an event exists only after it
    Given the part "p2": predicate "flag_set" with flag "gate", activation the event "flag_raised" with flag "alarm", evaluated at "end", kinds "none" new and "rules" variant
    And "ana"'s scripted turns call "set_flag" "gate", then end
    When the run's time limit passes at "day 1 Monday 19:00"
    Then the "part" line for "p2" says it was not active

  Scenario: Effort counts the agent's calls that name the part's actors, until it was reached
    Given "ana"'s scripted turns call "send_mail" to "shop" with the act "ask", then "send_mail" to "shop" with the act "ask", then "set_flag" "door", then "send_mail" to "shop" with the act "ask", then end
    When the run's time limit passes at "day 1 Monday 19:00"
    Then the "part" line for "p1" gives the effort 2 calls and 0 money

  Scenario: A misapplication is found from the agent's acts, relative to an event
    Given "p1" has the misapplication "act_named" with tool "clear_flag", before the event "flag_raised" with flag "alarm"
    And the participant "shop" raises the flag "alarm" at "day 1 15:00"
    And "ana"'s scripted turns call "clear_flag" "door", then wait 8 world hours, then "clear_flag" "door", then end
    When the run's time limit passes at "day 1 Monday 19:00"
    Then the "part" line for "p1" lists one misapplication: the first "clear_flag", with its time

  Scenario: An outcome has no kind
    Given the part "w1": predicate "flag_set" with flag "door", activation "always", evaluated at "end", no kinds
    And "ana"'s scripted turns call "set_flag" "door", then end
    When the run's time limit passes at "day 1 Monday 19:00"
    Then the "part" line for "w1" has no kind

  Scenario: Parts not yet evaluated when the run ends are listed so
    Given the part "p3": predicate "flag_set" with flag "door", activation "always", evaluated at "day 3 09:00", kinds "none" new and "rules" new
    When the run's time limit passes at "day 1 Monday 19:00"
    Then the run's log lists "p3" as "not_evaluated"

  Scenario: No tool or prompt gives the agent the parts
    When the run ends
    Then no text "ana" received contains "p1", "flag_set" or "covered"
    And the setup line gives the "parts" material's hash

  Scenario Outline: Parts that cannot be followed are refused before any model call
    Given the parts material is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<it>"

    Examples:
      | change                                              | it              |
      | "p1"'s predicate is "moon_full"                     | p1.predicate    |
      | "p1"'s kind for "rules" is "easy"                   | p1.kinds        |
      | "p1"'s kinds lack "none"                            | p1.kinds        |
      | "p1"'s kinds name the level "chaos"                 | p1.kinds        |
      | the experiment's "kind_factor" is "colour"          | kind_factor     |
      | "p1" is evaluated at "Monday"                       | p1.evaluate_at  |
      | "p1"'s actors name "zoe"                            | p1.actors       |
      | two parts have the id "p1"                          | p1              |
