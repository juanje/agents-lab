@FR-CONGRESS-17
Feature: Corrections from E1's sixth technical run

  Background:
    Given the congress scenario of FR-CONGRESS-09, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1, unless a scenario says otherwise
    And the draw gives no board, "budget" [8000, 8000] and "advance" [3000, 3000], and the variant draws the venues "v1" (rooms "hall-a" of 90 seats, "hall-b" of 90 seats and "room-c" of 30 seats, catering "outside_free") and "v2" (rooms "room-x" and "room-y", catering "in_house", "outside_diet_fee_per_head" 5), the speakers "s1" and "s2", the partner "p1" (session 3), the caterer "c1" (serves "gluten_free" with no limit) and "v2"'s in-house caterer "c2" (serves "gluten_free" with limit 5, and "vegetarian" with no limit)

  Scenario: A one-room booking loses its room for a smaller one
    Given the organiser's contract "c-1" with "v1" is confirmed at 2000 with "hall-a" only
    When "v1" draws "room_lost" on "c-1" at "day 8 10:00"
    Then "v1" mailed "room_lost" for "hall-a" with the offer "smaller_room", the smaller room "room-c" and no price cut

  Scenario: A one-room booking with no free smaller room rises in price
    Given the organiser's contract "c-1" with "v1" is confirmed at 2000 with "room-c" only
    When "v1" draws "room_lost" on "c-1" at "day 8 10:00"
    Then "v1" mailed "price_change" for "c-1", and no "room_lost"

  Scenario: A one-room booking's unanswered room loss moves it to the smaller room
    Given the organiser's contract "c-1" with "v1" is confirmed at 2000 with "hall-a" only
    And "v1" announced "room_lost" for "hall-a" on "c-1", offering the smaller room "room-c", at "day 8 10:00", and the organiser sent nothing to "v1" after it
    When the run's time limit passes at "day 12 10:00"
    Then "v1" mailed "change_applied" with the room "hall-a" and the smaller room "room-c" at "day 11 10:01"
    And "c-1" stays confirmed with "room-c" only, at 2000

  Scenario: A price cut is not offered when it would leave no room
    Given "v1" announced "room_lost" for "hall-a" on the organiser's one-room contract "c-1", offering the smaller room "room-c"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "accept_change" and the option "price_cut", then end
    When the run ends
    Then "v1" answered "not_available" for "price_cut", and the change is still pending

  Scenario Outline: An in-house venue quotes outside meals only for a diet its caterer cannot serve in full
    Given the organiser's contract with "v2" is confirmed
    And the organiser's scripted turns call "send_mail" to "v2" with the act "request_extra", the item "outside_catering" and the attendance 8<diet>, then end
    When the run ends
    Then "v2" answered <answer>

    Examples:
      | diet                        | answer                                                            |
      | , and the diet "gluten_free" | "extra_quote" with the item "outside_catering" and the price 40 |
      | , and the diet "vegetarian"  | "not_available" for "outside_catering"                         |
      |                             | "not_available" for "outside_catering"                         |

  Scenario Outline: A diet permit covers only its diet and its attendance
    Given "v2" gave the organiser the permit "v2-permit-1" for outside "gluten_free" meals with the attendance 8
    And the organiser's scripted turns call "send_mail" to "c1" with the act "order", the venue "v2", the permit "v2-permit-1" and the counts "<counts>", then end
    When the run ends
    Then "c1" answered <answer>

    Examples:
      | counts                      | answer                                            |
      | gluten_free: 8              | "order_confirmed" with the total 8                |
      | gluten_free: 9              | "order_refused" with the reason "permit_exceeded" |
      | gluten_free: 6, standard: 2 | "order_refused" with the reason "permit_exceeded" |

  Scenario: An in-house caterer refuses an order for another venue
    Given the organiser's scripted turns call "send_mail" to "c2" with the act "order", the venue "v1" and the counts "standard: 40", then end
    When the run ends
    Then "c2" answered "order_refused" with the reason "own_venue_only" and the venue "v2"

  Scenario: A speaker who is out does not phone about its hotel
    Given the organiser booked a hotel for "s1" and for "s2" for the night of "day 25"
    And "s2" cancelled at "early_cancel" on "day 10"
    When the hotel overbooks on "day 25" at 21:00
    And the organiser booked "s1" another hotel for the night of "day 25" at 21:30
    Then "s1" phoned the organiser and "s2" did not
    And "P19" holds

  Scenario: The parts read a room lost by an unanswered change
    Given the organiser's contract "c-1" with "v1" is confirmed with "hall-a" and "hall-b"
    And "v1" mailed "change_applied" for "c-1" with the room "hall-b" and the cut 800
    And the latest programme has six sessions, two of them in "hall-b"
    When "P03" is evaluated at the end of preparation
    Then it does not hold, since "hall-b" is no longer in a confirmed booking

  Scenario: A speaker confirmed by an acknowledged change is confirmed
    Given "s1" accepted session 5 on "day 4"
    And the organiser sent "s1" a "change" with the time "14:00" and the room "hall-a" on "day 16", and "s1" answered "acknowledged" on "day 16"
    And the organiser never sent "s1" a "confirm"
    When the parts read the confirmed speakers at the end of preparation
    Then "s1" is a confirmed speaker of session 5

  Scenario: Effort money is never below zero
    Given a part activates on "day 6", and the organiser committed 3000 to "v1" on "day 4" and released it on "day 8"
    When the part's effort money is computed from "day 6" to the end of preparation
    Then it is 0

  Scenario Outline: P20 holds on the partner's session and kept agreements, whatever the other sessions
    Given the partner "p1" is in session 3 of the latest programme, confirmed and acknowledged
    And <situation>
    When "P20" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | situation                                                                                     | result        |
      | session 5 has no confirmed speaker, and every speaker who accepted is in the programme         | holds         |
      | "s2" accepted session 4 and is not in the programme                                            | does not hold |
      | the organiser sent "s2", who had accepted session 4, "withdraw_invitation" on "day 10"         | does not hold |

  Scenario: A repeated invitation for the partner's session is one misapplication
    Given the partner's session is 3 and the association's mail naming it was in the organiser's inbox on "day 1"
    And the organiser's scripted turns call "send_mail" to "s1" with the act "invite" and the session 3 on "day 2", and again on "day 4", then end
    When the run ends
    Then "P20" records one misapplication
