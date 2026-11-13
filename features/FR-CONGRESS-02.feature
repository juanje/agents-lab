@FR-CONGRESS-02
Feature: Venues and the board

  Background:
    Given the congress scenario of FR-CONGRESS-01, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and the parties have no hours, no reply delay and "pick_up" 1
    And the variant has the venues "v1" and "v2" and the board "board"
    And "v1"'s template has the room "main-hall" (120 seats, a projector) and "room-b" (40 seats), the access claim "step-free access throughout", "foyer" to "room-b" with "step_free" "3 steps", the price 2000, the extra "ramp" at 150, "hold_days" 2, "deposit_share" 0.25, "deposit_due_days" 3, the cancellation schedule "more than 14 days: 0.1; 14 days or fewer: 0.5", indicative rooms, and "enquiries_per_day" 0
    And the board's template has "funds" 6000 and "reserve" 1000
    And the organiser's account opens at 0, with the money tools "ledger", "pay" and "issue_invoice", and the "discretionary_limit" is 300
    And the congress is on "day 26"

  Scenario: A venue answers a quote with its own claim about access
    Given the organiser's scripted turns call "send_mail" to "v1" with the act "ask_quote", date "day 26" and attendance 60, then wait 1 world hour, then "read_mail" the first message, then end
    When the run ends
    Then the message from "v1" has the act "quote", the rooms "main-hall" (120) and "room-b" (40), access "step-free access throughout", the price 2000, hold days 2, deposit share 0.25 due in 3 days, the cancellation schedule, and rooms indicative

  Scenario: The floor plan shows the steps the claim leaves out
    Given the organiser's scripted turns call "send_mail" to "v1" with the act "request_document" and kind "floor_plan", then wait 1 world hour, then "read_mail" the first message, then end
    When the run ends
    Then the message from "v1" has the act "document" and gives "foyer" to "room-b" with "step_free" "3 steps"

  Scenario: A hold lapses at its end unless a contract is accepted
    Given the organiser's scripted turns call "send_mail" to "v1" with the act "hold" and date "day 26", then end
    When the run's time limit passes at "day 4 Thursday 09:00"
    Then "v1" answered "held" until "day 3 Wednesday 09:01", within one world hour
    And the date "day 26" at "v1" was free again after that time

  Scenario: Booking, accepting the contract, the commitment and the deposit
    Given the organiser's scripted turns call "send_mail" to "v1" with the act "book", date "day 26", rooms "main-hall" and hours "08:00-18:00", then wait 1 world hour, then "read_mail" the first message, then "send_mail" to "v1" with the act "accept_contract" and the contract's id, then wait 1 world hour, then "ledger", then end
    When the run ends
    Then "v1" answered "contract" with an id, the price 2000 and its terms, and then "confirmed"
    And the "ledger" result gives a commitment to "v1" of 2000 and an unpaid invoice from "v1" of 500 due "day 4"
    And the world recorded an "unapproved_overrun" for that commitment, with the limit 300

  Scenario: An unpaid deposit brings a reminder and then a cancellation
    Given the organiser has accepted "v1"'s contract on "day 1", and its deposit invoice is due "day 4"
    When the run's time limit passes at "day 12 Friday 09:00"
    Then "v1" mailed the organiser a "reminder" on "day 9"
    And "v1" mailed "cancelled" with the charge 0 on "day 11", and released its commitment

  Scenario: An enquiry from another customer challenges a hold
    Given "v1"'s "enquiries_per_day" is high enough that an enquiry arrives on "day 1"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "hold" and date "day 26", then end
    When the run's time limit passes at "day 4 Thursday 09:00"
    Then "v1" mailed the organiser "hold_challenged" with a "confirm_by" 48 world hours after the enquiry
    And the hold lapsed at that time, and the date was booked by the other customer with probability 0.5 from "v1"'s sequence, and otherwise free

  Scenario: A date another customer booked is unavailable
    Given another customer has booked "v1" for "day 26"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "ask_quote", date "day 26" and attendance 60, then wait 1 world hour, then "read_mail" the first message, then end
    When the run ends
    Then the message from "v1" has the act "unavailable"

  Scenario: An extra is quoted, then accepted and committed
    Given the organiser has accepted "v1"'s contract
    And the organiser's scripted turns call "send_mail" to "v1" with the act "request_extra" and item "ramp", then wait 1 world hour, then "send_mail" to "v1" with the act "accept_extra" and item "ramp", then end
    When the run ends
    Then "v1" answered "extra_quote" with "ramp" at 150, then "extra_confirmed"
    And the organiser is committed to "v1" for 2150 in all

  Scenario: A cancellation charges what the schedule says for that day
    Given the organiser has accepted "v1"'s contract on "day 1", and it is "day 14"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "cancel_booking", then end
    When the run ends
    Then "v1" answered "cancelled" with the charge 1000, released its commitment and issued an invoice of 1000

  Scenario: An act naming what the venue does not have is answered as not available
    Given the organiser's scripted turns call "send_mail" to "v1" with the act "accept_contract" and contract "x-1", then end
    When the run ends
    Then "v1" answered "not_available" with what "x-1"

  Scenario: A venue loses a room the organiser booked, at the time its perturbation was drawn
    Given the configuration declares the perturbation "change" between "day 6 09:00" and "day 6 10:00", of the kind "room_lost"
    And the organiser has accepted "v1"'s contract with the rooms "main-hall" and "room-b"
    When the run's time limit passes at "day 7 Tuesday 09:00"
    Then "v1" mailed the organiser "room_lost" naming "room-b" between "day 6 09:00" and "day 6 10:00", offering a smaller room or a price cut

  Scenario: A venue raises its price, and the organiser accepts the change
    Given the configuration declares the perturbation "change" between "day 6 09:00" and "day 6 10:00", of the kind "price_change"
    And the organiser has accepted "v1"'s contract
    And the organiser's scripted turns, woken by the "price_change" mail, call "send_mail" to "v1" with the act "accept_change", then end
    When the run's time limit passes at "day 7 Tuesday 09:00"
    Then the "price_change" mail gave a new price between 2300 and 2500
    And "v1" answered "confirmed" and committed the difference

  Scenario: Indicative rooms are allocated on their day, and at least one changes
    Given the configuration declares the perturbation "room_allocation" at "day 15 10:00"
    And the organiser has accepted "v1"'s contract with the rooms "main-hall" and "room-b"
    When the run's time limit passes at "day 16 Tuesday 09:00"
    Then "v1" mailed the organiser "rooms_allocated" at "day 15 10:00", within one world hour, in which at least one booked room is renamed or moved to a room with at least as many seats, as step-free

  Scenario: The board approves a budget within its funds, sets the ceiling and transfers the funds
    Given the organiser's scripted turns call "send_mail" to "board" with the act "submit_budget", costs 5000, income 3000, contingency 500 and funds_requested 2500, then wait 1 world hour, then "ledger", then end
    When the run ends
    Then "board" answered "budget_approved"
    And the "ledger" result gives the balance 2500 and the ceiling 5500

  Scenario: The board counters a budget that asks for more than its funds
    Given the organiser's scripted turns call "send_mail" to "board" with the act "submit_budget", costs 9000, income 1000, contingency 500 and funds_requested 8000, then end
    When the run ends
    Then "board" answered "budget_countered" with 6000

  Scenario Outline: The board approves an extra amount only within its reserve
    Given the board has approved a budget with the ceiling 5500
    And the organiser's scripted turns call "send_mail" to "board" with the act "request_approval", amount <amount> and reason "ramp", then end
    When the run ends
    Then "board" answered "<answer>" and the organiser's ceiling is <ceiling>

    Examples:
      | amount | answer   | ceiling |
      | 800    | approved | 6300    |
      | 1200   | refused  | 5500    |

  Scenario: A venue answers a call it picks up as it would answer mail
    Given the organiser's scripted turns call "call" to "v1" with the act "ask_quote", date "day 26" and attendance 60, then end
    When the run ends
    Then the "call" result gives the act "quote" and the price 2000

  Scenario: A venue that does not pick up leaves the call unanswered
    Given "v1"'s "pick_up" is 0
    And the organiser's scripted turns call "call" to "v1" with the act "ask_quote", date "day 26" and attendance 60, then end
    When the run ends
    Then the "call" failed with the outcome "no_answer"

  Scenario: Each venue's and the board's outcome is recorded
    Given the organiser has accepted "v1"'s contract and the board has approved a budget
    When the run ends
    Then the run's log has "participant_outcome" lines for "v1", with its contract and confirmation, and for "board", with its approval and the funds it transferred

  Scenario: The base configuration lets a condition change the mail, the phone, the money and the kinds
    Given a condition that changes only "[mail] delivery_minutes" to [2, 2] and "[kinds.venue] reply_minutes" to [10, 20]
    When the run is attempted
    Then it is not refused, and the inventory gives those values

  Scenario Outline: A venue or a board that cannot be followed is refused before any model call
    Given the configuration is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<it>"

    Examples:
      | change                                                   | it             |
      | the pools have the venue "v9", which the city lacks      | v9             |
      | "v1"'s template has no price                             | v1             |
      | "v1"'s "deposit_share" is 1.5                            | v1             |
      | "v1"'s cancellation schedule charges 2                   | v1             |
      | "v1"'s "pick_up" is -0.1                                 | v1             |
      | the perturbation "change" is for "board"                 | change         |
      | the perturbation "room_allocation" is at "Monday"        | room_allocation|
      | the board's template has no "funds"                      | board          |
