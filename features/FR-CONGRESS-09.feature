@FR-CONGRESS-09
Feature: Corrections to the world from E1's first technical run

  Background:
    Given the congress scenario of FR-CONGRESS-08, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1, unless a scenario says otherwise
    And the variant draws the board "chair" (funds 6000, reserve 1000), the venue "v1" (rooms "hall-a" and "hall-b"), the speakers "s1" (acceptance 1, condition "fee", fee 300) and "s2" (acceptance 0.5, no condition), and the sponsor "sp1" (amount 1200, conditions "logo" and "morning_slot")
    And the organiser's account opens at 0

  Scenario: Free text after the fields does not change them
    Given the organiser's scripted turns call "send_mail" to "chair" with the act "submit_budget", costs 5000, income 3000, contingency 500, funds_requested 2500 and the text "Please approve. Notes: costs: none. funds: 9." then end
    When the run ends
    Then "chair" answered "budget_approved", and the organiser's ceiling is 5500 and its balance 2500

  Scenario Outline: A wrong act or a missing field to a drawn party fails at once
    Given the organiser's scripted turns call "send_mail" to "<to>" with <message>, then end
    When the run ends
    Then the "send_mail" call failed with the outcome "<outcome>" and took no time, <result>

    Examples:
      | to   | message                                  | outcome       | result                                    |
      | sp1  | the act "offer"                          | act_not_taken | listing the acts "sp1" takes              |
      | chair | the act "submit_budget" and costs 5000  | missing_field | naming "income"                           |

  Scenario: A new budget replaces the approved one
    Given "chair" approved a budget with costs 5000, contingency 500 and funds_requested 2500
    And the organiser's scripted turns call "send_mail" to "chair" with the act "submit_budget", costs 7000, income 2000, contingency 700 and funds_requested 4000, then end
    When the run ends
    Then "chair" answered "budget_approved", transferred 1500 more, and the organiser's ceiling is 7700

  Scenario: Countered and refused answers say what is available
    Given "chair" approved a budget with funds_requested 5500
    And the organiser's scripted turns call "send_mail" to "chair" with the act "submit_budget", costs 9000, income 1000, contingency 500 and funds_requested 8000, then "send_mail" to "chair" with the act "request_approval", amount 1500 and reason "venue", then end
    When the run ends
    Then "chair" answered "budget_countered" with the funds 6000, and "refused" with the reserve 1000

  Scenario: A speaker draws its acceptance once and answers each session on its own
    Given the organiser invites "s2" to session 2 at "10:00", then to session 5 at "14:00", then to session 2 at "10:00" again
    When the run ends
    Then "s2" answered session 2 once and session 5 once, both "accept" or both "decline", as its one draw gave

  Scenario Outline: Accepting a condition turns it into an acceptance only when it is met
    Given "s1" answered "accept_if" with the condition "fee" to an invitation with fee <offered>
    And the organiser's scripted turns call "send_mail" to "s1" with the act "accept_condition", then end
    When the run ends
    Then "s1" answered "<answer>"

    Examples:
      | offered | answer   |
      | 300     | accept   |
      | 0       | accept_if |

  Scenario: Cancellations choose only speakers who accepted and acknowledged a confirmation
    Given "s2" declined, and the organiser sent it a confirmation, which it answered "not_available"
    And "s1" accepted and acknowledged its confirmation
    And the perturbation "early_cancel" fires at "day 2 10:00"
    When the run's time limit passes at "day 3 Wednesday 09:00"
    Then "s1" cancelled, and "s2" did not

  Scenario: The programme takes ids only
    Given the organiser's scripted turns call "publish_programme" with a session whose speaker is "Rosa Ferreira", then end
    When the run ends
    Then the call failed with the outcome "invalid_value", naming "Rosa Ferreira"

  Scenario: The directory's order is drawn from the seed
    When two replicas run with the seeds 1 and 2
    Then each directory lists the same parties, in an order drawn from its seed, not grouped by role

  Scenario: A second booking at a venue answers with the contract already held
    Given the organiser holds a contract "v1-contract-1" with "v1" for "day 26"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "book", date "day 26", rooms "hall-a" and hours "08:00-18:00", then end
    When the run ends
    Then "v1" answered "contract_held" with "v1-contract-1"

  Scenario: A lost room takes only a second room, and stays lost
    Given the organiser's contract with "v1" has only "hall-a", and the perturbation "change" of the kind "room_lost" fires
    When the run ends
    Then "v1" lost no room
    And with the rooms "hall-a" and "hall-b" booked instead, "v1" lost "hall-b", and a later "change_booking" adding "hall-b" is answered "unavailable"

  Scenario: A sponsor pays only when its conditions stand, within its hours
    Given "sp1" keeps the hours "office", agreed to "logo" and "morning_slot", and the latest programme has its logo but no morning slot after day 19
    And the organiser issued "sp1" an invoice of 1200 on "day 20 Friday 17:30"
    When the run's time limit passes at "day 24 Tuesday 09:00"
    Then "sp1" paid nothing
    And with the slot published, "sp1" pays on "day 23 Monday" within its hours

  Scenario: A party's own mail goes out within its hours
    Given "v1" keeps the hours "office", and its hold-lapse reminder falls due at "day 3 Wednesday 23:00"
    When the run's time limit passes at "day 5 Friday 09:00"
    Then "v1" sent it at "day 4 Thursday 09:00", within one world hour

  Scenario: Mail is handled in the order it landed, and a repeat gets no second answer
    Given "c1" confirmed an order, and the organiser mails "c1" "final_numbers" and then "cancel_order", and then "cancel_order" again
    When the run ends
    Then "c1" handled "final_numbers" before "cancel_order", and answered "cancelled" once

  Scenario: Registrants ask questions
    Given the attendees material's "question_share" is 1 and 4 people registered
    When the run's time limit passes 5 world days after they registered
    Then the organiser received 4 questions from registrants
