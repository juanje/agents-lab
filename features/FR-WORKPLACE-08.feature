@FR-WORKPLACE-08
Feature: The worker sees who is there when it arrives or stops waiting

  Background:
    Given the workplace scenario with the world and situations of FR-WORKPLACE-01, the tools' durations of FR-WORKPLACE-02, and "ms_per_length" 20
    And the world's "[day] start" is "09:00" and the configuration's "time_scale" is 6000, so one depot minute is 10 milliseconds of the run
    And the configuration's "wait_max_minutes" is 60
    And the world has the person "oduya", named "Mr Oduya", in "counter", after "ferrer", named "Mrs Ferrer", in "counter"
    And the worker is in "store"

  Scenario: Arriving names the people in the place reached
    Given the worker's scripted turns call "go" with "counter", then end
    When the run ends
    Then the "go" call succeeded with the text "You have arrived. Here: Mrs Ferrer (ferrer); Mr Oduya (oduya)."

  Scenario: Arriving where nobody is says so
    Given the worker's scripted turns call "go" with "yard", then end
    When the run ends
    Then the "go" call succeeded with the text "You have arrived. Nobody is here."

  Scenario: Arriving names the people in the passages that leave the place, and no one beyond them
    Given the world's "[porter]" is "piet", named "Piet, the porter", who enters "yard", drops in "store" and has the rounds ["09:00"], so he is in the passage between "yard" and "store" from the start until 80 milliseconds into the run
    And the person "ferrer" is in "yard" instead
    And the worker is in "counter"
    And the worker's scripted turns call "go" with "store", which arrives 40 milliseconds into the run, then end
    When the run ends
    Then the "go" call succeeded with the text "You have arrived. Nobody is here. In the passage to yard: Piet, the porter (piet)."

  Scenario: The people named are those there when the worker arrives
    Given "lind" is a visitor named "Ms Lind": she enters "counter", arrives between "09:02" and "09:02", waits 20 minutes, and comes for ["lamp"]
    And the worker's scripted turns call "go" with "counter", which leaves "store" at once and arrives 40 milliseconds into the run, then end
    When the run ends
    Then "lind" appeared in "counter" 20 milliseconds into the run
    And the "go" call's text names "Ms Lind (lind)" after "Here:", with "Mrs Ferrer (ferrer)" and "Mr Oduya (oduya)" in the order look gives them

  Scenario: Arriving names people only, and adds no time
    Given the worker's scripted turns call "go" with "counter", then end
    When the run ends
    Then the "go" call's text does not hold "the delivery book", "book" or "store"
    And the "go" call took 40 milliseconds

  Scenario Outline: A go that fails names nobody
    Given the worker is in "counter"
    And the worker's scripted turns call "go" with "<place>", then end
    When the run ends
    Then the "go" call ended with the outcome "<outcome>" and exactly the text "<text>"

    Examples:
      | place   | outcome        | text                                                             |
      | counter | already_there  | You are already there; you have not moved.                       |
      | yard    | invalid_target | There is no passage from here to that place; you have not moved. |

  Scenario: A go cut off by the time limit names nobody
    Given the run's time limit is 20 milliseconds
    And the worker's scripted turns call "go" with "yard", then end
    When the run ends
    Then the "go" call ended with the outcome "cut_off"
    And its text holds neither "Here:" nor "Nobody is here."

  Scenario: A wait that runs its minutes names who is there when it ends
    Given the worker is in "counter"
    And the worker's scripted turns call "wait" with 10 minutes, then end
    When the run ends
    Then the "wait" call succeeded with the text "You have waited. Here: Mrs Ferrer (ferrer); Mr Oduya (oduya)."

  Scenario: A wait that starts beside someone is not cut short by them
    Given the worker is in "counter"
    And the worker's scripted turns call "wait" with 20 minutes, then end
    When the run ends
    Then the "wait" call succeeded, at least 200 milliseconds after it started
    And its text ends with "Here: Mrs Ferrer (ferrer); Mr Oduya (oduya)."

  Scenario: A wait cut short by someone entering names who came
    Given the worker is in "counter"
    And the people "ferrer" and "oduya" are in "yard" instead
    And "lind" is a visitor named "Ms Lind": she enters "counter", arrives between "09:05" and "09:05", waits 20 minutes, and comes for ["lamp"]
    And the worker's scripted turns call "wait" with 30 minutes, then end
    When the run ends
    Then the "wait" call ended with the outcome "interrupted" and the text "Something happened where you are; you stopped waiting. Here: Ms Lind (lind)."

  Scenario: A wait cut short by a stimulus names who is there
    Given the worker is in "yard"
    And the worker's scripted turns call "wait" with 30 minutes, then end
    And a stimulus on the channel "person" reaches the worker 50 milliseconds into the run
    When the run ends
    Then the "wait" call ended with the outcome "interrupted" and the text "Something happened where you are; you stopped waiting. Nobody is here."

  Scenario: A wait with minutes out of range names nobody
    Given the worker is in "counter"
    And the worker's scripted turns call "wait" with 61 minutes, then end
    When the run ends
    Then the "wait" call ended with the outcome "invalid_arguments", and its result does not hold "Mrs Ferrer"

  Scenario: What the worker is told on arriving is recorded, and is no sensor call
    Given the worker's scripted turns call "look", then "go" with "counter", then end
    When the run ends
    Then the log's line for the "go" call gives the text "You have arrived. Here: Mrs Ferrer (ferrer); Mr Oduya (oduya)."
    And the log has no sensor call by the worker after the "look"

  Scenario: Arriving does not count as sensing a situation
    Given the situation "open-box" is chosen and placed in "store"
    And the worker is in "counter"
    And the worker's scripted turns call "go" with "store", then end
    When the run ends
    Then the metric "sensed_at_ms" of "open-box" has no value

  Scenario: A give after arriving reads its person in what the arrival named
    Given the worker holds "lamp"
    And the worker's scripted turns call "go" with "counter", then "give" with the thing "lamp" to the person "ferrer", then end
    When the run ends
    Then the "give" call succeeded and recorded its target as "free"

  Scenario: A give reads its person in the later of the last look and the last arrival there
    Given the worker holds "lamp"
    And the worker is in "counter"
    And the person "ferrer" leaves "counter" towards "store" 30 milliseconds into the run, and is back in "counter" 200 milliseconds into the run
    And the worker's scripted turns call "look", then "go" with "store", then "go" with "counter", then wait 150 milliseconds, then call "give" with the thing "lamp" to the person "ferrer", then end
    When the run ends
    Then the first "look" showed "ferrer" in "counter"
    And the second "go" call's text is "You have arrived. Here: Mr Oduya (oduya). In the passage to store: Mrs Ferrer (ferrer)."
    And the "give" call succeeded and recorded its target as "not_sensed"

  Scenario: A give after an arrival where the person is not recorded as not sensed
    Given the worker holds "lamp"
    And the worker's scripted turns call "go" with "yard", then "give" with the thing "lamp" to the person "ferrer", then end
    When the run ends
    Then the "give" call ended with the outcome "not_here" and recorded its target as "not_sensed"

  Scenario: The inventory says which texts are followed by who is in sight
    When "lab inventory" lists it
    Then it lists "go"'s "success" text "You have arrived." as followed by who is in sight
    And it lists "wait"'s "success" and "interrupted" texts as followed by who is in sight
    And it lists "go"'s "invalid_target" and "already_there" texts as they are
