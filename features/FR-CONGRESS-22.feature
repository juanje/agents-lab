@FR-CONGRESS-22
Feature: Corrections from the E1 baseline's first check run

  Background:
    Given the congress scenario of FR-CONGRESS-09, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1, unless a scenario says otherwise
    And the draw gives no board, no partner, no agency, "budget" [8000, 8000] and "advance" [3000, 3000], and the variant draws the venues "v1" (catering "outside_fee", rooms "hall-a" of 90 seats) and "v2", the speakers "s1" to "s6" with no condition, and the caterer "c1"

  Scenario Outline: A venue answers the asker's own booking
    Given <booking>
    And the organiser's scripted turns call "send_mail" to "v1" with the act "<act>" and the date "day 26", then end
    When the run ends
    Then "v1" answered <answer>, and no "unavailable"

    Examples:
      | booking                                                         | act       | answer                                   |
      | the organiser's contract "c-1" with "v1" for "day 26" is confirmed | ask_quote | "contract_held" with the contract "c-1" |
      | the organiser's contract "c-1" with "v1" for "day 26" is confirmed | hold      | "contract_held" with the contract "c-1" |
      | the organiser holds "day 26" at "v1" until "day 5 10:00"         | ask_quote | "held" with the end "day 5 10:00"        |

  Scenario: Another customer's date is still unavailable
    Given another customer booked "day 26" at "v1"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "ask_quote" and the date "day 26", then end
    When the run ends
    Then "v1" answered "unavailable"

  Scenario Outline: A caterer takes only a permit the venue gave
    Given "v1" gave the organiser the permit "v1-permit-1" for outside catering
    And the organiser's scripted turns call "send_mail" to "c1" with the act "order", the venue "v1", the date "day 26", the counts "standard: 40" and the permit "<permit>", then end
    When the run ends
    Then "c1" answered <answer>

    Examples:
      | permit           | answer                                        |
      | v1-permit-1      | "order_confirmed"                             |
      | outside_catering | "order_refused" with the reason "permit_unknown" |
      | v2-permit-1      | "order_refused" with the reason "permit_unknown" |

  Scenario: A registrant believes the programme it registered under
    Given the organiser published a programme version 2 on "day 20" and announced it on "day 21"
    When the attendee "a-1" registers on "day 23"
    Then "a-1" believes version 2

  Scenario Outline: The on-time programme names accepted speakers in rooms of a live booking
    Given the organiser's contract with "v1" was confirmed on "day 6", and "s1" to "s6" each accepted a session by "day 8"
    And the organiser published a programme of six sessions with "s1" to "s6" in "hall-a" on <first>, and again on "day 11 10:00"
    When "programme_on_time" and "programme_published" are evaluated at the end of preparation, with every registrant believing the latest version
    Then <result>

    Examples:
      | first          | result                                                                                 |
      | "day 3 10:00"  | "programme_published" was reached at "day 11 10:00", and "programme_on_time" holds    |
      | "day 9 10:00"  | "programme_published" was reached at "day 9 10:00", and "programme_on_time" holds     |

  Scenario: A programme first made real after day 12 is late
    Given the organiser published a placeholder programme on "day 3 10:00", and a programme whose six sessions name accepted speakers in rooms of its live booking only on "day 14 10:00"
    When "programme_on_time" is evaluated at the end of preparation
    Then it does not hold

  Scenario: The solvable price leaves a margin
    Given a draw whose plans' expected paying registrants reach 0.85 of the target at a price of 44 and 0.75 at a price of 52
    When the variant counts its plans
    Then each plan's price is 44 or lower

  Scenario: The inventory gives each replica's variant
    Given an experiment with two replicas of different seeds and "[solvable]" in its draw
    When "lab inventory" runs on it
    Then it gives, for each replica, its seed, its drawn venues, its solvability counts, and its kept plans with their price and expected paying registrants

  Scenario: The parts report shows milestones without kinds
    Given a runs directory of an experiment with no "kind_factor", whose parts include "M1" reached at "day 5 10:00"
    When "lab parts" reads it
    Then it lists "M1" with "day 5 10:00" for that run, and no kinds table
