@FR-WORKPLACE-05
Feature: The depot's day goes on: time, the porter and visitors

  Background:
    Given the workplace scenario with the world and situations of FR-WORKPLACE-01, the tools' durations of FR-WORKPLACE-02, and "ms_per_length" 20
    And the world's "[day] start" is "09:00" and the configuration's "time_scale" is 6000, so one depot minute is 10 milliseconds of the run
    And the world's "[porter]" is "piet", named "Piet, the porter", who enters "yard", drops in "store" and has the rounds ["09:10"]
    And the world has the thing "crate", named "a wooden crate", that arrives "09:10"

  Scenario: The worker learns the time only by checking it
    Given the configuration's "check_time_ms" is 10 and its "time_scale" is 600, so one depot minute is 100 milliseconds of the run
    And the worker's scripted turns call "look", then wait 130 milliseconds, then call "check_time", then end
    When the run ends
    Then the "check_time" call's result is "09:01"
    And the look's result gives no time
    And the worker's system prompt and stimuli give no time

  Scenario: The porter brings his round's arrivals, walking through the passages, and leaves
    Given the worker's scripted turns end at once, for 1 activation
    When the run ends
    Then 50 milliseconds into the run, "crate" was in no place
    And 140 milliseconds into the run, "piet" was in the passage between "yard" and "store", carrying "crate"
    And "crate" is in "store"
    And "piet" is in no place
    And the run's log has the porter's actions, each with when it started and ended and its outcome

  Scenario: The situations the configuration lists for a round arrive with it
    Given the configuration's "arrivals" lists "open-box" for "09:10"
    When the run ends
    Then 50 milliseconds into the run, "box" and "note" were in no place
    And "box" is in "store", with "note" inside it

  Scenario: A visitor comes, keeps what the worker gives, and leaves with it
    Given "ferrer" is a visitor instead of a person: she enters "counter", arrives between "09:05" and "09:05", waits 20 minutes, and comes for ["lamp"]
    And the worker holds "lamp"
    And the worker's scripted turns wait 100 milliseconds, then call "give" with "lamp" to "ferrer", then end
    When the run ends
    Then 30 milliseconds into the run, "ferrer" was in no place
    And the "give" call succeeded
    And "ferrer" is in no place and holds "lamp"
    And the predicate where "lamp" in ["person:ferrer"] holds

  Scenario: A visitor who does not get what they came for leaves when their wait runs out
    Given "ferrer" is a visitor instead of a person: she enters "counter", arrives between "09:05" and "09:05", waits 20 minutes, and comes for ["jar"]
    And the situation "jar" is not chosen
    When the run ends
    Then 240 milliseconds into the run, "ferrer" was in "counter"
    And 260 milliseconds into the run, "ferrer" was in no place

  Scenario: A visitor brings the things marked as brought by them
    Given "ferrer" is a visitor instead of a person: she enters "counter", arrives between "09:05" and "09:05", waits 20 minutes, and comes for ["lamp"]
    And the situation "jar" is chosen, and its thing "jar" is brought by "ferrer"
    When the run ends
    Then 30 milliseconds into the run, "jar" was in no place
    And 60 milliseconds into the run, "jar" was in "counter"

  Scenario: A visitor's arrival comes from the seed and the visitor's id
    Given "ferrer" is a visitor instead of a person: she enters "counter", arrives between "09:00" and "09:30", waits 20 minutes, and comes for ["lamp"]
    When two replicas run with the seed 42, the second with another visitor "dale" added
    Then "ferrer" arrived at the same moment in both, between "09:00" and "09:30"

  Scenario Outline: A day that names something it does not have, or a name taken twice, is refused before any model call
    Given <change>
    When the run starts
    Then it fails with an error that names <named>
    And no model was called

    Examples:
      | change                                                                       | named               |
      | the configuration's "arrivals" lists "open-box" for "11:00"                  | "11:00"             |
      | the configuration's "arrivals" lists "jar" for "09:10", "jar" is chosen and can be only in "yard" | "jar" and "store" |
      | the configuration's "arrivals" lists "open-box" for "09:10", and it is not chosen | "open-box"      |
      | the situation thing "jar" is brought by "dale", who is no visitor            | "dale"              |
      | the porter's rounds are ["9.10"]                                             | "9.10"              |
      | the visitor "ferrer" arrives between "10:00" and "09:00"                     | "ferrer"            |
      | the porter's id is "worker"                                                  | "worker"            |
      | the thing "crate" also gives the place "counter"                             | "crate" and "counter" |
      | the thing "crate" arrives "11:00" instead                                    | "crate" and "11:00" |
      | the world has no porter                                                      | "crate"             |
      | the place "cellar" is added with no passage, and the porter enters "cellar"  | "cellar" and "store" |
      | the porter's id is "lamp"                                                    | "lamp"              |
      | the visitor "ferrer" is declared while the person "ferrer" is also declared  | "ferrer"            |

  Scenario: The inventory gives the clock's start time and the time scale
    When "lab inventory" lists it
    Then it gives the clock's start time "09:00" and the time scale 6000
