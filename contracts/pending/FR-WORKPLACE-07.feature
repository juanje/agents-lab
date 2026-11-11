@FR-WORKPLACE-07
Feature: The worker can wait

  Background:
    Given the workplace scenario with the world and situations of FR-WORKPLACE-01, the tools' durations of FR-WORKPLACE-02, and "ms_per_length" 20
    And the world's "[day] start" is "09:00" and the configuration's "time_scale" is 6000, so one depot minute is 10 milliseconds of the run
    And the configuration's "wait_max_minutes" is 60
    And the worker is in "counter"

  Scenario: A wait takes its minutes and changes nothing
    Given the worker's scripted turns call "wait" with 20 minutes, then end
    When the run ends
    Then the "wait" call succeeded with the text "You have waited."
    And it ended at least 200 milliseconds after it started
    And the world's version did not change during it

  Scenario: A person entering the worker's place interrupts the wait
    Given "ferrer" is a visitor instead of a person: she enters "counter", arrives between "09:05" and "09:05", waits 20 minutes, and comes for ["lamp"]
    And the worker's scripted turns call "wait" with 30 minutes, then end
    When the run ends
    Then the "wait" call ended with the outcome "interrupted" and the text "Something happened where you are; you stopped waiting."
    And it ended within 20 milliseconds after "ferrer" appeared in "counter"

  Scenario: A person entering another place does not interrupt it
    Given "ferrer" is a visitor instead of a person: she enters "store", arrives between "09:05" and "09:05", waits 20 minutes, and comes for ["lamp"]
    And the worker's scripted turns call "wait" with 20 minutes, then end
    When the run ends
    Then the "wait" call succeeded

  Scenario: A stimulus that reaches the worker interrupts the wait
    Given the worker's scripted turns call "wait" with 30 minutes, then end
    And a stimulus on the channel "person" reaches the worker 50 milliseconds into the run
    When the run ends
    Then the "wait" call ended with the outcome "interrupted" about 50 milliseconds into the run

  Scenario Outline: Minutes out of range are refused and take no time
    Given the worker's scripted turns call "wait" with <minutes> minutes, then end
    When the run ends
    Then the "wait" call ended with the outcome "invalid_arguments"
    And it took no time

    Examples:
      | minutes |
      | 0       |
      | 61      |

  Scenario: The inventory lists the wait with its duration
    When "lab inventory" lists it
    Then it lists the tool "wait" with its duration in depot minutes, up to 60
