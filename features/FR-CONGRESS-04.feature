@FR-CONGRESS-04
Feature: Speakers and the partner's session

  Background:
    Given the congress scenario of FR-CONGRESS-02, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every speaker has "reply_minutes" [60, 60], no hours and "pick_up" 1
    And the variant has the speakers "s1" (local, available, no constraint, "acceptance" 1, no condition, "fee" 0), "s2" (from a station, available, "acceptance" 1, the condition "travel_paid"), "s3" (not available), "s4" (local, available, "acceptance" 1, the constraint "morning", no condition) and "s5" (local, available, "acceptance" 1, the condition "fee", "fee" 300), and the partner "p1" with the preferred session 3
    And the organiser's account opens at 5000

  Scenario Outline: An invitation is answered after the speaker's reply delay, from its template
    Given the organiser's scripted turns call "send_mail" to "<speaker>" with the act "invite", session 2, time "<time>", fee <fee> and travel_paid <travel>, then end
    When the run's time limit passes at "day 2 Tuesday 09:00"
    Then "<speaker>" answered "<answer>" one world hour after the invitation landed, within 30 world minutes

    Examples:
      | speaker | time  | fee | travel | answer             |
      | s1      | 10:00 | 0   | false  | accept             |
      | s2      | 10:00 | 0   | false  | accept_if travel_paid |
      | s2      | 10:00 | 0   | true   | accept             |
      | s3      | 10:00 | 0   | false  | decline            |
      | s4      | 14:00 | 0   | false  | decline            |
      | s4      | 10:00 | 0   | false  | accept             |
      | s5      | 10:00 | 100 | false  | accept_if fee      |
      | s5      | 10:00 | 300 | false  | accept             |

  Scenario: A speaker declines with the probability its acceptance leaves, from its own sequence
    Given "s1"'s "acceptance" is 0.5
    When two replicas run with the seed 42, the second with another speaker "s6" added
    Then "s1" gave the same answer to the same invitation in both

  Scenario: A condition accepted turns an accept_if into an accept
    Given "s2" answered "accept_if" with the condition "travel_paid"
    And the organiser's scripted turns call "send_mail" to "s2" with the act "accept_condition" and travel_paid true, then end
    When the run ends
    Then "s2" answered "accept"

  Scenario: A condition not met by day 19 makes the speaker withdraw
    Given "s2" answered "accept_if" with the condition "travel_paid" on "day 2"
    When the run's time limit passes at "day 20 Saturday 09:00"
    Then "s2" mailed the organiser "withdraw" on "day 19"

  Scenario: A confirmation sets what the speaker believes, and a change moves it
    Given "s1" has accepted
    And the organiser's scripted turns call "send_mail" to "s1" with the act "confirm", time "10:00", room "main-hall", length 45 and travel "none", then wait 2 world hours, then "send_mail" to "s1" with the act "change" and room "room-b", then end
    When the run ends
    Then "s1" answered "acknowledged" twice
    And "s1" believes its session is at "10:00" in "room-b"

  Scenario: A speaker with a fee commits it when first confirmed, and claims it when its invitation is withdrawn
    Given "s5" has accepted with the fee 300
    And the organiser's scripted turns call "send_mail" to "s5" with the act "confirm", time "10:00", room "main-hall", length 45 and travel "none", then wait 2 world hours, then "send_mail" to "s5" with the act "withdraw_invitation", then end
    When the run ends
    Then "s5" committed 300 with the organiser's account when it acknowledged
    And "s5" answered "withdrawn", recorded a broken agreement and issued an invoice of 300

  Scenario: A speaker asked for slides sends them before the date, most of the time
    Given "s1" has accepted and been confirmed
    And the organiser's scripted turns call "send_mail" to "s1" with the act "ask_slides" and by "day 5", then end
    When the run's time limit passes at "day 6 Saturday 09:00"
    Then "s1" either mailed "slides" before "day 5", or sent nothing, as its sequence drew with probability 0.8

  Scenario: An early cancellation hits a confirmed speaker at its drawn time
    Given the configuration declares the perturbation "early_cancel" between "day 9 09:00" and "day 9 12:00"
    And "s1" has been confirmed on "day 2"
    When the run's time limit passes at "day 10 Wednesday 09:00"
    Then "s1" mailed the organiser "cancel" on "day 9" between "09:00" and "12:00"

  Scenario: An early cancellation with no confirmed speaker hits the next one confirmed, two days later
    Given the configuration declares the perturbation "early_cancel" between "day 9 09:00" and "day 9 12:00"
    And "s1" is confirmed on "day 11 10:00"
    When the run's time limit passes at "day 14 Sunday 09:00"
    Then "s1" mailed the organiser "cancel" on "day 13" at about "10:00"

  Scenario: A late cancellation comes by phone, and by mail when the call is not answered
    Given the configuration declares the perturbation "late_cancel" at "day 23 10:00"
    And "s1" and "s4" have been confirmed
    And the organiser does not answer calls
    When the run's time limit passes at "day 24 Saturday 09:00"
    Then a confirmed speaker other than the early cancellation's called the organiser at "day 23 10:00" with the act "cancel"
    And the call was not answered, and it mailed "cancel" after it

  Scenario: The board's mail about the partner's session is in the organiser's mailbox at the start
    Given the organiser's scripted turns call "check_mail", then "read_mail" "m-1", then end
    When the run ends
    Then the "check_mail" result lists one message from "board" with the subject "partner_session", received at "day 1 Monday 09:00"
    And the "read_mail" result gives the speaker "p1" and the session 3

  Scenario: The partner's speaker accepts the session it is given and believes its confirmation
    Given the organiser's scripted turns call "send_mail" to "p1" with the act "confirm", time "11:00", room "main-hall", length 45 and travel "none", then end
    When the run ends
    Then "p1" answered "acknowledged" and believes its session is at "11:00" in "main-hall"

  Scenario: A speaker answers a call it picks up as it would answer mail
    Given the organiser's scripted turns call "call" to "s1" with the act "ask_panel" and slot 4, then end
    When the run ends
    Then the "call" result gives the act "accept" or "decline", as "s1"'s sequence drew with probability 0.6

  Scenario: Each speaker's outcome is recorded
    Given "s1" has accepted and been confirmed for "10:00" in "main-hall"
    When the run ends
    Then the run's log has a "participant_outcome" line for "s1" with its invitation, its answer, what it believes about its session, and no cancellation or broken agreement

  Scenario Outline: A speaker that cannot be followed is refused before any model call
    Given the configuration is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<it>"

    Examples:
      | change                                              | it           |
      | "s1"'s "acceptance" is 1.2                          | s1           |
      | "s1"'s "draw" is 4                                  | s1           |
      | "s1"'s "fee" is -50                                 | s1           |
      | "s1"'s "condition" is "lunch"                       | s1           |
      | "s1"'s "constraint" is "evening"                    | s1           |
      | the perturbation "late_cancel" is at "Monday"       | late_cancel  |
      | the draw chooses 2 partners                         | draw.partner |
