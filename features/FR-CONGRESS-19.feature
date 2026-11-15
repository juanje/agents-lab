@FR-CONGRESS-19
Feature: Corrections from E1's check run

  Background:
    Given the congress scenario of FR-CONGRESS-09, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1, unless a scenario says otherwise
    And the draw gives no board, "budget" [8000, 8000] and "advance" [3000, 3000], and the variant draws the venue "v1" (price 2100, rooms "hall-a" of 90 seats, "hall-b" of 90 seats and "room-c" of 30 seats), the speakers "s1" and "s2", the partner "p1" (session 3) and the caterer "c1"

  Scenario Outline: A lost room is replaced by an equal free room before a smaller one is offered
    Given the organiser's contract "c-1" with "v1" is confirmed at 2000 with <booked>
    When "v1" draws "room_lost" on "c-1" at "day 8 10:00"
    Then <result>

    Examples:
      | booked                     | result                                                                                                                              |
      | "hall-a" only              | "v1" mailed "room_moved" with the room "hall-a" and the room now "hall-b", and "c-1" stays confirmed with "hall-b" only, at 2000, with no change pending |
      | "hall-a" and "hall-b"      | "v1" mailed "room_lost" for "hall-b" with the offer "smaller_room" and the smaller room "room-c"                                    |

  Scenario: The parts read a moved room
    Given "v1" mailed "room_moved" for the organiser's contract "c-1" with the room "hall-a" and the room now "hall-b"
    When the parts read the organiser's bookings
    Then "c-1" has "hall-b" and not "hall-a"

  Scenario: Cancelling acts on the live contract, not on one already cancelled
    Given the organiser's contract "c-1" with "v1" for "day 26" was cancelled on "day 18", and its contract "c-2" with "v1" for "day 26" was confirmed on "day 22" at 2000
    And the organiser's scripted turns call "send_mail" to "v1" with the act "cancel_booking" on "day 23", then end
    When the run ends
    Then "v1" answered "cancelled" for "c-2", and the organiser has no commitment with "v1" for "c-2"

  Scenario: A cancelled contract does not free a date another contract holds
    Given the organiser's contract "c-1" with "v1" for "day 26" was cancelled on "day 18", and its contract "c-2" with "v1" for "day 26" is confirmed
    When "v1" receives "cancel_booking" naming the contract "c-1"
    Then "c-2" stays confirmed and "day 26" stays booked at "v1"

  Scenario: Dropping an allocated room takes off its price
    Given the organiser's contract "c-1" with "v1" is confirmed with "hall-a" and "hall-b" at hall-a's and hall-b's prices, whose rooms are indicative
    And "rooms_allocated" moved no room, so it named "hall-b" anew as "hall-b-allocated"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "change_booking", rooms "hall-a" and hours "08:00-18:00", then end
    When the run ends
    Then "v1" answered "contract_changed" with the rooms "hall-a" and hall-a's price
    And the parts read "hall-b-allocated" as 90 seats

  Scenario Outline: A congress that does not happen holds nothing for its event
    Given the organiser's contract "c-1" with "v1" was confirmed and the latest programme has six sessions with confirmed speakers
    And <situation>
    When the parts and outcomes are evaluated at the end of preparation
    Then <result>

    Examples:
      | situation                                                 | result                                                                       |
      | the organiser cancelled "c-1" on "day 21" and booked nothing else | "P01", "P21", "W2", "W5" and "W6" do not hold, and "P04" is evaluated as before |
      | "c-1" stays confirmed                                     | "P01" is evaluated as before                                                 |

  Scenario: The contacts give request_extra's fields
    When the organiser's prompt is built
    Then the venue's acts in the contacts read "request_extra (item, seats, attendance, diet)"
