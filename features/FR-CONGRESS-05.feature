@FR-CONGRESS-05
Feature: Caterers, sponsors and services

  Background:
    Given the congress scenario of FR-CONGRESS-04, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1
    And the variant has the caterer "c1" ("price_per_head" 30, diets "vegan" with no limit and "gluten_free" with the limit 5, "minimum" 20, "final_days" 7, "deposit_share" 0.2, "deposit_due_days" 3, cancellation "any time: 0.3")
    And the sponsors "sp1" (amount 1200, conditions "logo" and "morning_slot", insisting on "morning_slot", "pay_days" [2, 2]) and "sp2" (amount 1000, conditions "logo" and "attendee_list", insisting on none, "counter_acceptance" 1, "pay_days" [2, 2])
    And the agency "a1" ("price" 400, "notice_days" 7)
    And the congress is on "day 26", and the organiser's account opens at 5000

  Scenario: A caterer quotes its prices, diets, limits and dates
    Given the organiser's scripted turns call "send_mail" to "c1" with the act "ask_quote", attendance 60 and diets "vegan" and "gluten_free", then wait 1 world hour, then "read_mail" "m-1", then end
    When the run ends
    Then the message from "c1" has the act "quote", the price per head 30, the limit 5 for "gluten_free", the minimum 20, the final-numbers date "day 19", the deposit share 0.2 and the cancellation schedule

  Scenario: An order within the limits is confirmed, committed and invoiced
    Given the organiser's scripted turns call "send_mail" to "c1" with the act "order", counts "standard" 50, "vegan" 6 and "gluten_free" 4, and date "day 26", then wait 1 world hour, then "ledger", then end
    When the run ends
    Then "c1" answered "order_confirmed"
    And the "ledger" result gives a commitment to "c1" of 1800 and an unpaid invoice of 360 due "day 4"

  Scenario: An order over a diet's limit is refused, naming the diet
    Given the organiser's scripted turns call "send_mail" to "c1" with the act "order", counts "standard" 50 and "gluten_free" 9, and date "day 26", then end
    When the run ends
    Then "c1" answered "order_refused" naming "gluten_free"

  Scenario Outline: Final numbers follow the final-numbers date
    Given "c1" has confirmed an order of 60 in all
    And it is "<day>"
    And the organiser's scripted turns call "send_mail" to "c1" with the act "final_numbers" and a total of <total>, then end
    When the run ends
    Then "c1" answered "<answer>" and the organiser's commitment to "c1" is <commitment>

    Examples:
      | day    | total | answer           | commitment |
      | day 15 | 70    | numbers_accepted | 2100       |
      | day 15 | 55    | numbers_accepted | 1650       |
      | day 21 | 63    | numbers_accepted | 1899       |
      | day 21 | 66    | numbers_refused  | 1800       |
      | day 21 | 55    | numbers_refused  | 1800       |

  Scenario: The caterer invoices the balance five days before the event
    Given "c1" has confirmed an order of 60 in all, and its deposit is paid
    When the run's time limit passes at "day 22 Monday 09:00"
    Then "c1" issued an invoice of 1440 on "day 21"

  Scenario: A venue's in-house caterer comes with the venue
    Given the pools have the caterer "c9" with "in_house_for" "v1", and the variant chooses "v1"
    When the run ends
    Then "c9" is a participant of the run, besides the caterers the draw chose

  Scenario: A sponsor states its conditions and agrees to them
    Given the organiser's scripted turns call "send_mail" to "sp1" with the act "ask_conditions", then wait 1 world hour, then "send_mail" to "sp1" with the act "accept_sponsorship" and conditions "logo" and "morning_slot", then end
    When the run ends
    Then "sp1" answered "conditions" with 1200, "logo" and "morning_slot", then "agreement"

  Scenario: A sponsor refuses a counter that drops what it insists on
    Given the organiser's scripted turns call "send_mail" to "sp1" with the act "counter" and conditions "logo", then end
    When the run ends
    Then "sp1" answered "refused"

  Scenario: A sponsor takes a counter that keeps what it insists on, with its probability
    Given the organiser's scripted turns call "send_mail" to "sp2" with the act "counter" and conditions "logo" and "table", then end
    When the run ends
    Then "sp2" answered "agreement" on "logo" and "table"

  Scenario: An agreed sponsor pays the organiser's invoice after its pay days
    Given "sp1" has agreed on "day 2"
    And the organiser's scripted turns call "issue_invoice" to "sp1" for 1200, due "day 10", for "sponsorship", then end
    When the run's time limit passes at "day 6 Saturday 09:00"
    Then "sp1" paid 1200 two days after the invoice landed
    And the organiser's balance is 6200

  Scenario: A sponsor withdraws at its drawn time and pays nothing more
    Given the configuration declares the perturbation "sponsor_withdraws" for "sp2" between "day 10 09:00" and "day 10 12:00"
    And "sp2" has agreed on "day 2"
    When the run's time limit passes at "day 11 Thursday 09:00"
    Then "sp2" mailed the organiser "withdraw" on "day 10" between "09:00" and "12:00"
    And an invoice to "sp2" issued after that is never paid

  Scenario: A sponsor acknowledges a list and evidence
    Given the organiser's scripted turns call "send_mail" to "sp2" with the act "send_attendee_list" and list "a1, a2", then "send_mail" to "sp2" with the act "send_evidence", then end
    When the run ends
    Then "sp2" answered "received" and "acknowledged"

  Scenario Outline: The interpreter agency books only with its notice
    Given it is "<day>"
    And the organiser's scripted turns call "send_mail" to "a1" with the act "book" and date "day 26", then end
    When the run ends
    Then "a1" answered "<answer>"

    Examples:
      | day    | answer      |
      | day 18 | booked      |
      | day 20 | unavailable |

  Scenario Outline: Train prices rise in the last two weeks
    Given the travel material has a train "t1" from "north" arriving at "station" at "08:10" on any day, with the base price 40
    And the organiser's scripted turns, on "<day>", call "travel_options" from "north" for "day 26", then end
    When the run ends
    Then the train "t1" costs <price>

    Examples:
      | day    | price |
      | day 5  | 40    |
      | day 19 | 56    |
      | day 26 | 72    |

  Scenario: Booking travel invoices it to the organiser
    Given the travel material has a train "t1" from "north" arriving at "station" at "08:10", with the base price 40
    And the organiser's scripted turns call "book_travel" "t1 day 26" for "s2", then "ledger", then end
    When the run ends
    Then the "book_travel" call succeeded
    And the "ledger" result gives an unpaid invoice from "travel" of 40 for "t1 day 26 s2"

  Scenario: Similar events give the reference price
    Given the similar events material has three congresses priced 60, 80 and 120
    And the organiser's scripted turns call "similar_events", then end
    When the run ends
    Then the "similar_events" result lists the three, with their prices and sizes
    And the congress's reference price is 80

  Scenario: Each party's outcome is recorded
    Given "c1" has confirmed an order and "sp1" has agreed and paid
    When the run ends
    Then the run's log has "participant_outcome" lines for "c1", with its order, and for "sp1", with its agreement and payment

  Scenario Outline: A caterer, sponsor, agency or travel that cannot be followed is refused before any model call
    Given the configuration is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<it>"

    Examples:
      | change                                                 | it                |
      | "c1"'s "price_per_head" is -1                          | c1                |
      | "c1"'s "final_days" is 0                               | c1                |
      | "sp1" has the condition "free_coffee"                  | sp1               |
      | "sp1" insists on "attendee_list", not among its conditions | sp1           |
      | "sp2"'s "counter_acceptance" is 2                      | sp2               |
      | "sp2"'s "pay_days" is [5, 2]                           | sp2               |
      | "c9" is in house for "v9", no venue in the pools       | c9                |
      | a train leaves from "moon", no station                 | travel            |
      | "sponsor_withdraws" is for "c1"                        | sponsor_withdraws |

  # Approved addition (2026-11-13): charges, hotels, P19 and sponsors' payments. Appended to FR-CONGRESS-05.feature when the FR is reopened.

  Scenario: Booked travel is committed before it is invoiced, and counts toward overruns
    Given the organiser's ceiling is 30 and the train "t1" from "north" costs 40
    And the organiser's scripted turns call "book_travel" "t1 day 26" for "s2", then end
    When the run ends
    Then "travel" committed 40 with the organiser, then issued an invoice of 40
    And the world recorded an "unapproved_overrun" for that commitment

  Scenario: A cancellation charge is committed as it is invoiced
    Given "c1" has confirmed an order and its cancellation schedule charges 0.3
    And the organiser's scripted turns call "send_mail" to "c1" with the act "cancel_order", then end
    When the run ends
    Then "c1" released its order's commitment, committed the charge and invoiced it

  Scenario Outline: Hotel rooms grow scarce in the last two weeks before a night
    Given the travel material has the hotel "h1" near "v1" with 14 rooms
    And it is "<day>"
    When the organiser reads "travel_options" for the night of "day 25"
    Then "h1" has <rooms> rooms left

    Examples:
      | day    | rooms |
      | day 5  | 14    |
      | day 18 | 7     |
      | day 24 | 1     |

  Scenario: The hotel overbooks the night before the event, and the speaker phones
    Given the configuration declares "hotel_overbooks" at "day 25 21:00", and the organiser booked "h1" for "s2" for the night of "day 25"
    When the run's time limit passes at "day 25 Thursday 23:00"
    Then "h1"'s room for "s2" was cancelled and its commitment released
    And "s2" called the organiser at "day 25 21:00", within one world hour, with the act "no_room"

  Scenario: A sponsor disputes an invoice above its agreed amount
    Given "sp1" agreed to 1200
    And the organiser's scripted turns call "issue_invoice" to "sp1" for 1500, due "day 10", for "sponsorship", then end
    When the run ends
    Then "sp1" mailed "invoice_disputed" with 1200 and paid nothing

  Scenario: A sponsor can be countered with a consented list
    Given the organiser's scripted turns call "send_mail" to "sp2" with the act "counter" and conditions "logo" and "consented_list", then end
    When the run ends
    Then "sp2" answered "agreement" on "logo" and "consented_list"
