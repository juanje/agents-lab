@FR-CONGRESS-07
Feature: Corrections to venues, speakers and the phone

  Background:
    Given the congress scenario of FR-CONGRESS-05, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1
    And the variant has the venues "v1" (catering "in_house", its in-house caterer "c9") and "v2" (catering "outside_fee", "outside_fee_per_head" 5), the caterer "c1", the speakers of FR-CONGRESS-04, the partner "p1" and the board
    And the congress is on "day 26", and the organiser's account opens at 5000

  Scenario Outline: An outside caterer needs a permit for a venue that asks for one
    Given "v2" gave the organiser the permit "v2-permit-1" for outside catering
    And the organiser's scripted turns call "send_mail" to "<caterer>" with the act "order", counts "standard" 40, date "day 26" and venue "<venue>"<permit>, then end
    When the run ends
    Then "<caterer>" answered "<answer>"

    Examples:
      | caterer | venue | permit              | answer        |
      | c1      | v1    |                     | order_refused |
      | c9      | v1    |                     | order_confirmed |
      | c1      | v2    |                     | order_refused |
      | c1      | v2    | , permit "v2-permit-1" | order_confirmed |

  Scenario: A venue that charges for outside catering gives a permit as an extra
    Given the organiser has accepted "v2"'s contract
    And the organiser's scripted turns call "send_mail" to "v2" with the act "request_extra", item "outside_catering" and attendance 40, then wait 1 world hour, then "send_mail" to "v2" with the act "accept_extra" and item "outside_catering", then end
    When the run ends
    Then "v2" answered "extra_quote" with 200, then "extra_confirmed" with a permit id, and committed 200

  Scenario: A booking's rooms change when they are free
    Given the organiser has accepted "v1"'s contract with "main-hall"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "change_booking", rooms "main-hall" and "room-b", hours "08:00-18:00", then end
    When the run ends
    Then "v1" answered "contract_changed" with the new price, and the commitment follows it

  Scenario: An extra room is quoted when one is free
    Given the organiser has accepted "v1"'s contract with "main-hall"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "request_extra", item "room" and seats 30, then end
    When the run ends
    Then "v1" answered "extra_quote" for "room-b"

  Scenario Outline: After a lost room, the organiser chooses the smaller room or the price cut
    Given "v1" lost "room-b", offering "room-c" or a cut of 300, and the organiser was committed for 2000
    And the organiser's scripted turns call "send_mail" to "v1" with the act "accept_change" and option "<option>", then end
    When the run ends
    Then the booking has the rooms <rooms> and the commitment is <commitment>

    Examples:
      | option       | rooms                    | commitment |
      | smaller_room | "main-hall" and "room-c" | 2000       |
      | price_cut    | "main-hall"              | 1700       |

  Scenario: The board wants a budget before it approves more
    Given the organiser's scripted turns call "send_mail" to "board" with the act "request_approval", amount 400 and reason "interpreter", then end
    When the run ends
    Then "board" answered "refused" with the reason "no_budget"

  Scenario: A constraint is hard, whatever the condition
    Given "s6" is local, available, "acceptance" 1, the constraint "morning" and the condition "fee" with "fee" 300
    And the organiser's scripted turns call "send_mail" to "s6" with the act "invite", session 4, time "14:00", fee 300 and travel_paid false, then end
    When the run ends
    Then "s6" answered "decline"

  Scenario: Cancellations never choose the partner's speaker
    Given the configuration declares "early_cancel" between "day 9 09:00" and "day 9 12:00", and only "p1" has been confirmed by then
    When the run's time limit passes at "day 10 Wednesday 09:00"
    Then "p1" did not cancel

  Scenario: A confirmation to a speaker who has not accepted changes nothing
    Given the organiser's scripted turns call "send_mail" to "s1" with the act "confirm", time "10:00", room "main-hall", length 45 and travel "none", then end
    When the run ends
    Then "s1" answered "not_available" with what "acceptance", believes nothing about its session and committed nothing

  Scenario: The fee committed is the one agreed
    Given "s5" answered "accept_if" with the condition "fee" to an invitation with fee 100, and the organiser sent "accept_condition" with fee 300
    And the organiser's scripted turns call "send_mail" to "s5" with the act "confirm", time "10:00", room "main-hall", length 45 and travel "none", then end
    When the run ends
    Then "s5" committed 300, its template's fee

  Scenario: A missed call is returned, about half the time
    Given "v1"'s "pick_up" is 0 for the first call and 1 afterwards, and its sequence draws a call back
    And the organiser's scripted turns call "call" to "v1" with the act "ask_quote", date "day 26" and attendance 60, then wait 2 world hours, then end
    When the run ends
    Then "v1" called the organiser back within its reply delay with the act "missed_call"

  Scenario: A busy line fails at once
    Given "ben" is on a call with "v1"
    And the organiser's scripted turns call "call" to "v1" with the act "ask_quote", date "day 26" and attendance 60, then end
    When the run ends
    Then the organiser's "call" failed with the outcome "busy" after 1 world minute, within 30 world minutes

  Scenario: Away from the office, the web tools take longer too
    Given the organiser starts in "v1-entrance", "[durations] ledger" is 3 and the configuration's "away_factor" is 1.5
    And the organiser's scripted turns call "ledger", then end
    When the run ends
    Then the "ledger" call took 4.5 world minutes, within 30 world minutes
