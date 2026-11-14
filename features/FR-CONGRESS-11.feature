@FR-CONGRESS-11
Feature: Corrections to the world from E1's second technical run

  Background:
    Given the congress scenario of FR-CONGRESS-09, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1, unless a scenario says otherwise
    And the draw gives no board, "budget" [4000, 4000] and "advance" [1500, 1500], and the variant draws the venue "v1" (rooms "hall-a" and "hall-b", extras "early_access" 50 and "ramp" 200), the speakers "s1" (acceptance 1, condition "fee", fee 300), "s2" (acceptance 1, condition "travel_paid", from "north"), "s3" (acceptance 1, condition "morning_slot") and "s4" (acceptance 1, no condition), the caterer "c1" (minimum 30), the sponsor "sp1" and the partner "p1"

  Scenario: The organiser's account opens with the advance, and the budget is its ceiling from the start
    Given the organiser's scripted turns call "ledger", then end
    When the run ends
    Then the "ledger" result gives the balance 1500 and the ceiling 4000
    And the variant line gives the budget 4000 and the advance 1500

  Scenario: Committing beyond the budget is recorded, and nothing is refused
    Given "v1" committed 3500 with the organiser, and then "c1" commits 900
    When the run ends
    Then the money records an "unapproved_overrun" for "c1"'s commitment, with the committed total 4400 and the limit 4000, and both commitments stand

  Scenario: The budget and the advance are drawn between their two numbers
    Given the draw gives "budget" [3000, 5000] and "advance" [1000, 2000]
    When the variant is drawn for the seeds 1 to 20
    Then each budget is a whole number from 3000 to 5000 and each advance one from 1000 to 2000, the same for every condition of a replica

  Scenario: The texts may name the budget and the advance
    Given the "task" text is "You may spend {budget}; the association advances {advance}."
    When the run starts
    Then the organiser's first message from the person reads "You may spend 4000; the association advances 1500."

  Scenario: With no board drawn, the partner's session mail comes from the association
    Given the organiser's scripted turns call "check_mail", then end
    When the run ends
    Then the "check_mail" result lists one message from "association" with the act "partner_session", received at "day 1 Monday 09:00"
    And the directory lists no "association" and no board

  Scenario Outline: A budget that cannot be followed is refused before any model call
    Given the configuration is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<it>"

    Examples:
      | change                                                    | it                         |
      | "budget" is [5000, 3000]                                  | budget                     |
      | "advance" is [2000, 1000]                                 | advance                    |
      | the "task" text names "{budget}" and the draw gives none  | {budget}                   |
      | a money account's "ceiling" is -1                         | ceiling                    |
      | "min_accepting" is 5 and the pool has 4 available speakers | draw.speaker.min_accepting |

  Scenario: Each speaker's acceptance is drawn with the variant, and the speakers are redrawn until enough accept
    Given the speaker pool has 12 available templates with acceptance 0.5 and the draw takes 8 of them with "min_accepting" 6
    When the variant is drawn for the seeds 1 to 20
    Then each replica's variant line gives every chosen speaker's "accepts", and at least 6 available chosen speakers accept
    And each speaker answers its first invitation as its "accepts" says

  Scenario: A speaker withdraws at day 19 only the sessions still waiting on its condition
    Given "s1" accepted session 2 with fee 300 and answered "accept_if" to session 5 with fee 0
    When the run's time limit passes at "day 19 Friday 12:00"
    Then "s1"'s "withdraw" mail names session 5 only, and "s1" still holds its acceptance of session 2

  Scenario: A speaker who fell ill declines everything afterwards
    Given "s4" accepted session 3, acknowledged its confirmation and cancelled at the perturbation "early_cancel"
    And the organiser's scripted turns then send "s4" "ask_panel" for slot "16:00", "invite" to session 4 at "11:00", and "confirm" for session 3, then end
    When the run ends
    Then "s4" answered "decline" to the panel and to session 4, and "not_available" to the confirmation

  Scenario Outline: An accept_if states what it needs
    Given the organiser invites "<speaker>" to session 1 at "15:00" with fee 0 and travel_paid false
    When the run ends
    Then "<speaker>" answered "accept_if" with the condition "<condition>" and <needs>

    Examples:
      | speaker | condition    | needs                                  |
      | s1      | fee          | the fee 300                            |
      | s2      | travel_paid  | travel_paid true and from "north"      |
      | s3      | morning_slot | the time "before 12:00"                |

  Scenario: A venue's quote gives its extras with their prices
    Given the organiser's scripted turns call "send_mail" to "v1" with the act "ask_quote", date "day 26" and attendance 60, then wait 1 world hour, then "read_mail", then end
    When the run ends
    Then "v1"'s "quote" gives the extras "early_access: 50" and "ramp: 200"

  Scenario: A venue's change takes no room from a one-room booking and raises the price instead
    Given the organiser's confirmed contract with "v1" has only "hall-a", and the perturbation "change" of the kind "room_lost" fires
    When the run ends
    Then "v1" announced "price_change", and lost no room

  Scenario: An allocated-away room cannot be added back
    Given the organiser's confirmed contract with "v1" has "hall-a" and "hall-b", whose rooms are indicative, and "rooms_allocated" moved "hall-b" to "annex"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "change_booking", rooms "hall-a, hall-b, annex" and hours "08:00-18:00", then end
    When the run ends
    Then "v1" answered "unavailable"

  Scenario: A repeated request is answered already sent
    Given "v1" answered "quote" to the organiser's "ask_quote" for "day 26" and attendance 60 at "day 1 Monday 10:01"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "ask_quote", date "day 26" and attendance 60 again, then end
    When the run ends
    Then "v1" answered "already_sent" with the act "quote" and sent "day 1 Monday 10:01", and changed nothing else

  Scenario Outline: A caterer refuses below its minimum
    Given "c1" confirmed an order for 40 people, unless the scenario's message is the order
    And the organiser's scripted turns call "send_mail" to "c1" with <message>, then end
    When the run ends
    Then "c1" answered "<answer>" with the reason "below_minimum" and the minimum 30

    Examples:
      | message                                                                 | answer          |
      | the act "order", counts "standard: 20", date "day 26" and venue "v1" | order_refused   |
      | the act "final_numbers" and counts "standard: 25"                       | numbers_refused |

  Scenario: Only sponsors can be invoiced by the organiser
    Given the organiser's scripted turns call "issue_invoice" to "v1" with the amount 500, due "day 20" and for "deposit", then end
    When the run ends
    Then the call failed with the outcome "invalid_arguments", saying that only sponsors are invoiced, and took no time

  Scenario: A registrant who asked a question takes the organiser's answer
    Given the registrant "a-7", who needs a wheelchair, mailed the organiser a question about access
    And the organiser's scripted turns call "send_mail" to "a-7" with the act "answer", the text "There is a ramp at the side door." and access "wheelchair", then end
    When the run ends
    Then the mail was delivered, the population recorded the answer, and "a-7"'s access need is known to the organiser
    And the directory says that registrants are mailed at their id with the act "answer"

  Scenario: A promotion to the association's list also opens registration
    Given the ticket page is open and nothing was announced
    And the organiser's scripted turns call "announce" with the audience "association_list" and the kind "promotion", then end
    When the run ends
    Then registration counts as announced from that moment, and a promotion runs for 2 world days

  Scenario: The directory groups the parties by kind and draws their order within each kind
    When two replicas run with the seeds 1 and 2
    Then each directory lists each kind's acts once, then the venues, the speakers, the partner, the caterers, the sponsors and the agency in that order
    And within each kind the parties are in an order drawn from the replica's seed
