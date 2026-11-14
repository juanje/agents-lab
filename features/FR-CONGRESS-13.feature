@FR-CONGRESS-13
Feature: Corrections to the world from E1's third technical run

  Background:
    Given the congress scenario of FR-CONGRESS-09, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1, unless a scenario says otherwise
    And the draw gives no board, "budget" [4000, 4000] and "advance" [1500, 1500], and the variant draws the venues "v1" (rooms "hall-a" and "hall-b") and "v2", the speakers "s1" (acceptance 1, condition "fee", fee 300) and "s2" (acceptance 1, no condition), the caterer "c1" (minimum 30) and the sponsor "sp1"

  Scenario: The budget, the advance and the reference price follow the cheapest feasible plan
    Given the draw gives "budget_over_plan" [1.1, 1.1], "advance_over_deposits" [1.2, 1.2] and "break_even_share" [0.75, 0.75] instead of "budget", "advance" and "price_gap", and the target attendance 40
    And the plan's venue costs 2000 with no ramp and "deposit_share" 0.3, its caterer charges 30 a head with "deposit_share" 0.25, its five speakers have no fee and no train, there is no agency, "helpers" is 2, the staying sponsors give 1000, and the attendees' "payment_fee_share" is 0.04
    When the variant is drawn
    Then the variant line gives the plan's cost 3500, its early deposits 975, the budget 3850, the advance 1170 and the reference price 35.76
    # cost: 2000 + (40 + 5 + 2 + 3) × 30 = 3500; deposits: 0.3 × 2000 + 0.25 × 1500 = 975
    # break-even at n = 30: (2000 + (30 + 5 + 2 + 3) × 30 − 1170 − 1000) / (30 × 0.96) = 1030 / 28.8 = 35.76

  Scenario Outline: A money draw that cannot be followed is refused before any model call
    Given the configuration is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<it>"

    Examples:
      | change                                                         | it                         |
      | the draw gives both "budget" and "budget_over_plan" [1.1, 1.2] | draw.budget_over_plan      |
      | the draw gives both "advance" and "advance_over_deposits" [1, 1.2] | draw.advance_over_deposits |
      | the draw gives both "price_gap" and "break_even_share" [0.7, 0.8] | draw.break_even_share      |
      | the draw gives "budget_over_plan" [0.9, 1.2]                   | draw.budget_over_plan      |
      | the draw gives "advance_over_deposits" [0.5, 1]                | draw.advance_over_deposits |
      | the draw gives "break_even_share" [0.7, 1.2]                   | draw.break_even_share      |

  Scenario: Acts on an answered call are recorded as mail is, with the channel phone
    Given the organiser's scripted turns "call" "s2" with the act "invite", session 2 at "11:00", fee 0 and travel_paid false, then end
    When the run ends
    Then the record of acts holds the organiser's "invite" to "s2" and "s2"'s "accept", each with its fields, its world time and the channel "phone"

  Scenario: A call not answered passes no act
    Given "s2" has "pick_up" 0, and the organiser's scripted turns "call" "s2" with the act "invite" to session 2, then end
    When the run ends
    Then the call's outcome is "no_answer", and the record of acts holds no act between the organiser and "s2"

  Scenario: A speaker confirmed by phone is confirmed for the perturbations and the parts
    Given "s2" accepted session 2 on a call, and on a later call the organiser sent "confirm" with the time "11:00" and the room "hall-a", and "s2" answered "acknowledged"
    And the perturbation "early_cancel" fires at "day 3 10:00" and picks among confirmed speakers
    When the run ends
    Then "early_cancel" picked "s2", and "s2" cancelled

  Scenario: A catering order confirmed by phone counts as an order
    Given the organiser's scripted turns "call" "c1" with the act "order", counts "standard: 40", date "day 26" and venue "v1", then end
    When the run ends
    Then "c1" answered "order_confirmed" on the call, and the congress's orders hold that order for 40

  Scenario: The venue change happens once, to the live booking
    Given the organiser's contract with "v1" was cancelled on "day 4", and its contract with "v2" is confirmed
    And the perturbation "change" is drawn for "day 8 10:00"
    When the run ends
    Then "v2" announced one change to the organiser at "day 8 10:00", "v1" announced none, and the run records one venue change in all

  Scenario: With no live booking the venue change does nothing
    Given the organiser has no contracted or confirmed booking at "day 8 10:00", when the perturbation "change" is drawn
    When the run ends
    Then no venue announced a change

  Scenario Outline: A cancelled contract voids its unpaid invoices and returns what was paid
    Given the organiser's contract with "v1" is confirmed at 2000 and its deposit invoice of 600 is <deposit>
    And <cancellation>
    When the run ends
    Then the deposit invoice is no longer due, the organiser's account got back <returned>, and <charge>

    Examples:
      | deposit | cancellation                                                                       | returned | charge                                   |
      | unpaid  | the organiser cancels within the venue's free cancellation window                  | 0        | no charge was invoiced                    |
      | paid    | "v1" raised its price and the organiser declined the change                        | 600      | no charge was invoiced                    |
      | paid    | the organiser cancels when the venue's terms charge 25% of the price               | 600      | a charge of 500 was committed and invoiced |

  Scenario: A voided invoice cannot be paid
    Given "v1" cancelled the organiser's contract, voiding its unpaid deposit invoice "i-1"
    And the organiser's scripted turns call "pay" for "i-1", then end
    When the run ends
    Then the call failed with the outcome "invalid_arguments", saying the invoice was voided, and took no time, and the organiser's balance did not change

  Scenario: A second order to a caterer that holds one is refused
    Given "c1" confirmed the organiser's order for 40 people on "day 26"
    And the organiser's scripted turns call "send_mail" to "c1" with the act "order", counts "standard: 45", date "day 26" and venue "v1", then end
    When the run ends
    Then "c1" answered "order_refused" with the reason "order_held" and the counts "standard: 40", and the organiser's commitments with "c1" are unchanged

  Scenario: An overrun is recorded only when the committed total passes its highest
    Given the organiser's account has the ceiling 4000
    And the world commits 3500 for "v1", then 900 for "c1", then releases "c1"'s 900 and commits 900 for "c1" again, then commits 200 for "c1"
    When the run ends
    Then the money records two "unapproved_overrun": one with the committed total 4400 and one with the committed total 4600

  Scenario: A repeat after the party's state changed is handled afresh
    Given the organiser's confirmed contract with "v1" has "hall-a" and "hall-b", whose rooms are indicative, and "v1" answered "confirmed" to the organiser's "change_booking" with rooms "hall-a, hall-b" and hours "08:00-18:00"
    And then "rooms_allocated" moved "hall-b" to "annex"
    And the organiser's scripted turns call "send_mail" to "v1" with the same "change_booking" again, then end
    When the run ends
    Then "v1" answered "unavailable", not "already_sent"

  Scenario: A speaker who falls ill releases its fee
    Given "s1" accepted session 2 with fee 300, the commitment of 300 stands, and "s1" cancelled at the perturbation "early_cancel"
    When the run ends
    Then the commitment of "s1"'s fee is released, and the organiser's committed total fell by 300
