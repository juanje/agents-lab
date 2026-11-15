@FR-CONGRESS-18
Feature: Readings from FR-CONGRESS-17's build

  Background:
    Given the congress scenario of FR-CONGRESS-09, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1, unless a scenario says otherwise
    And the travel has the hotels "h1" (near "v1", 10 rooms) and "h2" (near "v1", 10 rooms), and the event is on "day 26"

  Scenario Outline: A hotel keeps a room up to its own night
    When the organiser calls "travel_options" for "day 26" on "<today>"
    Then "h2" has <left> rooms left for the night of "day 25"

    Examples:
      | today  | left |
      | day 5  | 10   |
      | day 18 | 5    |
      | day 25 | 1    |

  Scenario: A speaker whose room was cancelled the night before can get another
    Given the organiser booked "h1" for "s1" for the night of "day 25", and the hotel overbooks on "day 25" at 21:00
    And the organiser's scripted turns, woken by the call, call "book_travel" for "s1" with the option "h2 day 25", then end
    When "P19" is evaluated on "day 26" at 06:30
    Then "s1" has a booking of "h2 day 25" and "P19" holds

  Scenario: A refused invitation is no misapplication
    Given the partner's session is 3 and the association's mail naming it was in the organiser's inbox on "day 1"
    And the organiser's scripted turns call "send_mail" to "s1" with the act "invite" and the session 3 but no time, which fails as "missing_field", then end
    When the run ends
    Then "P20" records no misapplication
