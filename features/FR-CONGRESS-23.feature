@FR-CONGRESS-23
Feature: Corrections from the E1 baseline's second check run

  Background:
    Given the congress scenario of FR-CONGRESS-09, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1, unless a scenario says otherwise
    And the draw gives no board, no partner, no agency, "budget" [8000, 8000] and "advance" [3000, 3000], and the variant draws the venues "v1" (catering "outside_free", rooms "hall-a" of 90 seats, extra "ramp" 100) and "v2" (catering "outside_fee", outside_fee_per_head 5), the speakers "s1" to "s6" with no condition, and the caterer "c1" (serves every diet)

  Scenario: No special diet reads as standard
    Given the attendee "a-1" with no special diet registered through the ticket page, which required "diet"
    When the organiser reads "ticket_page"
    Then "a-1"'s diet reads "standard", and no registrant's diet reads "none"

  Scenario: A venue with free outside catering says so
    Given the organiser's contract with "v1" for "day 26" is confirmed
    And the organiser's scripted turns call "send_mail" to "v1" with the act "request_extra", the item "outside_catering" and the attendance 60, then end
    When the run ends
    Then "v1" answered "not_needed" with the item "outside_catering", and the organiser's commitments did not change

  Scenario Outline: A caterer takes an order for a free-catering venue with any permit or none
    Given the organiser's scripted turns call "send_mail" to "c1" with the act "order", the venue "v1", the date "day 26" and the counts "standard: 40"<permit>, then end
    When the run ends
    Then "c1" answered "order_confirmed"

    Examples:
      | permit                  |
      |                         |
      | , and the permit "pending" |

  Scenario: An unknown room is named
    Given the organiser's contract with "v1" for "day 26" is confirmed with "hall-a"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "change_booking", rooms "hall-a, step-free toilets" and hours "08:00-18:00", then end
    When the run ends
    Then "v1" answered "unavailable" with the room "step-free toilets" and no date

  Scenario: A repeated invitation gets its answer again
    Given "s1" declined the organiser's invitation to session 1 on "day 5"
    And the organiser's scripted turns call "send_mail" to "s1" with the act "invite", the session 1, the time "09:00", the fee 0 and travel_paid false on "day 6", then end
    When the run ends
    Then "s1" answered "decline" for session 1 again on "day 6", and its answers are unchanged

  Scenario: An extra is confirmed once
    Given the organiser's contract with "v1" for "day 26" is confirmed, and "v1" confirmed the extra "ramp" at 100
    And the organiser's scripted turns call "send_mail" to "v1" with the act "accept_extra" and the item "ramp", then end
    When the run ends
    Then "v1" answered "already_confirmed" with the item "ramp", and the organiser has one commitment of 100 for the ramp

  Scenario Outline: On time means real by day 12
    Given the organiser's contract with "v1" was confirmed on "day 6", "s1" to "s5" accepted their sessions by "day 8", and "s6" accepted session 6 on <accepted>
    And the organiser published a programme of six sessions with "s1" to "s6" in "hall-a" on "day 10 10:00", and never again
    And every registrant believes that version
    When "programme_on_time" and "programme_published" are evaluated at the end of preparation
    Then <result>

    Examples:
      | accepted        | result                                                                                  |
      | "day 11 08:08"  | "programme_on_time" holds, and "programme_published" was reached at "day 11 08:08"     |
      | "day 13 09:00"  | "programme_on_time" does not hold, and "programme_published" was reached at "day 13 09:00" |
