@FR-CONGRESS-16
Feature: Corrections from E1's fifth technical run

  Background:
    Given the congress scenario of FR-CONGRESS-09, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1, unless a scenario says otherwise
    And the draw gives no board, "budget" [8000, 8000] and "advance" [3000, 3000], and the variant draws the venues "v1" (rooms "hall-a" and "hall-b") and "v2" (rooms "room-x" and "room-y"), the speakers "s1" (condition "fee", fee 300) and "s2", the partner "p1" (session 3), the caterer "c1" and the sponsor "sp1" (amount 1000, conditions "logo, table", insists on nothing, "counter_acceptance" 0)

  Scenario Outline: A sponsor that has agreed answers with its agreement and does not withdraw
    Given "sp1" answered "agreement" with the conditions "logo, table" to the organiser's "accept_sponsorship" on "day 2"
    And the organiser's scripted turns call "send_mail" to "sp1" with the act "<act>" and the conditions "<conditions>" on "day 3", then end
    When the run ends
    Then "sp1" answered "agreement" with the amount 1000 and the conditions "logo, table", and has not withdrawn

    Examples:
      | act                | conditions        |
      | accept_sponsorship | logo, table       |
      | accept_sponsorship | logo              |
      | counter            | logo, morning_slot |

  Scenario: A pending change holds the booking
    Given the organiser's contract "c-1" with "v1" is confirmed at 2000 with "hall-a" and "hall-b"
    And "v1" announced a "price_change" on "c-1" to 2400 at "day 8 10:00"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "change_booking", rooms "hall-a, hall-b" and hours "08:00-18:00" at "day 9 10:00", then end
    When the run ends
    Then the "price_change" mail gave "answer_by" "day 11 10:01"
    And "v1" answered "change_pending" with the kind "price_change" and the price 2400, and "c-1" stays at 2000 with its commitment of 2000

  Scenario: An unanswered price change is declined at its deadline
    Given the organiser's contract "c-1" with "v1" is confirmed at 2000 and its deposit invoice of 600 is paid
    And "v1" announced a "price_change" on "c-1" to 2400 at "day 8 10:00", and the organiser sent nothing to "v1" after it
    When the run's time limit passes at "day 12 10:00"
    Then "v1" mailed "cancelled" for "c-1" with the reason "change_unanswered" at "day 11 10:01"
    And the organiser has no commitment with "v1", no charge was invoiced, and the organiser's account got back 600

  Scenario: An unanswered room loss takes its price cut at its deadline
    Given the organiser's contract "c-1" with "v1" is confirmed at 2000 with "hall-a" and "hall-b", and "hall-b"'s price is 800
    And "v1" announced "room_lost" for "hall-b" on "c-1", offering the price cut 800, at "day 8 10:00", and the organiser sent nothing to "v1" after it
    When the run's time limit passes at "day 12 10:00"
    Then "v1" mailed "change_applied" with the room "hall-b" and the cut 800 at "day 11 10:01"
    And "c-1" stays confirmed with "hall-a" only, at 1200, with its commitment of 1200

  Scenario: An answer before the deadline settles the change as before
    Given the organiser's contract "c-1" with "v1" is confirmed at 2000
    And "v1" announced a "price_change" on "c-1" to 2400 at "day 8 10:00"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "accept_change" at "day 9 10:00", then end
    When the run's time limit passes at "day 12 10:00"
    Then "v1" answered "confirmed", "c-1" stays confirmed at 2400, and "v1" mailed no "cancelled" and no "change_applied"

  Scenario Outline: Outside catering is quoted only for an attendance
    Given "v1" allows outside catering at 5 a head
    And the organiser's scripted turns call "send_mail" to "v1" with the act "request_extra", the item "outside_catering"<attendance>, then end
    When the run ends
    Then <result>

    Examples:
      | attendance           | result                                                                                               |
      |                      | the call failed with the outcome "missing_field", naming "attendance", took no time, and "v1" received nothing |
      | and the attendance 40 | "v1" answered "extra_quote" with the item "outside_catering" and the price 200                        |

  Scenario Outline: A condition is withdrawn at day 19, or two days after a late conditional answer
    Given the organiser invited "s1" to session 2 with fee 0 on "<invited>", and "s1" answered "accept_if" with the condition "fee" on "<answered>"
    And the organiser sent "s1" nothing after it
    When the run's time limit passes at "day 24 09:00"
    Then "s1" mailed "withdraw" for session 2 <withdrew>

    Examples:
      | invited      | answered     | withdrew                                  |
      | day 10 10:00 | day 10 10:00 | on "day 19"                               |
      | day 20 19:10 | day 20 19:10 | on "day 22", not before "day 22 19:10"    |

  Scenario: A room lost to the allocation is named in the answer
    Given the organiser's contract "c-1" with "v1" is confirmed with "hall-a" and "hall-b", whose rooms are indicative, and "rooms_allocated" moved "hall-b" to "annex"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "change_booking", rooms "hall-a, hall-b" and hours "08:00-18:00", then end
    When the run ends
    Then "v1" answered "unavailable" with the room "hall-b" and no date

  Scenario Outline: The parts read the booking the programme uses
    Given the organiser's contract with "v1" was confirmed on "day 5" and its contract with "v2" on "day 8", both for the event day and neither cancelled
    And "v1" is the false-claim venue, whose session rooms are reached through "3 steps" with no ramp, and "v2"'s rooms are step-free
    And no floor plan or photos were asked for and there was no visit, and the latest programme has six sessions in <rooms>
    When "P02" is evaluated as it is due
    Then it <result>

    Examples:
      | rooms                  | result        |
      | "room-x" and "room-y"  | holds         |
      | "hall-a" and "hall-b"  | does not hold |

  Scenario Outline: P20 leaves out speakers who were out
    Given the partner "p1" is in session 3 of the latest programme, confirmed and acknowledged, and each of the six sessions has a confirmed speaker
    And "s2" accepted session 4 and is not in the latest programme, and <situation>
    When "P20" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | situation                                                                                     | result        |
      | "s2" cancelled at "early_cancel" on "day 8", and the organiser sent it "withdraw_invitation" on "day 10" | holds         |
      | the organiser sent "s2" "withdraw_invitation" on "day 10"                                      | does not hold |
      | the organiser booked a train for "s2" on "day 7", and "s2" cancelled at "early_cancel" on "day 8" | holds         |
      | "s2" cancelled at "early_cancel" on "day 8", and the organiser booked a train for "s2" on "day 9" | does not hold |
