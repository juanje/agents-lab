@FR-CONGRESS-15
Feature: Corrections from E1's fourth technical run

  Background:
    Given the congress scenario of FR-CONGRESS-09, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1, unless a scenario says otherwise
    And the draw gives no board, "budget" [4000, 4000] and "advance" [1500, 1500], and the variant draws the venue "v1" (rooms "hall-a" and "hall-b"), the speakers "s1" and "s2", the partner "p1" (session 3), the caterer "c1" and the sponsor "sp1"

  Scenario Outline: The reference price is the break-even price or the plan caterer's price per head, whichever is higher
    Given the draw gives "break_even_share" [0.75, 0.75], and the plan's break-even price is <break_even> and its caterer charges <per_head> a head
    When the variant is drawn
    Then the variant line gives the reference price <reference>

    Examples:
      | break_even | per_head | reference |
      | 35.76      | 30       | 35.76     |
      | 23.7       | 38       | 38        |

  Scenario: The directory lists the partner as a contact
    When the run starts
    Then the organiser's directory lists "p1" as a partner, after the speakers and before the caterers, with its title, its home and its acts

  Scenario: The partner's session mail carries its template's text
    Given "p1"'s template gives the mail "Our partner society's speaker {speaker} will give session {session}. Please keep that session for them."
    And the organiser's scripted turns call "check_mail", then "read_mail" of the first message, then end
    When the run ends
    Then the mail from "association" with the act "partner_session" has the text "Our partner society's speaker p1 will give session 3. Please keep that session for them."

  Scenario: A partner mail that names an unknown brace is refused before any model call
    Given "p1"'s template gives the mail "Speaker {speaker} at {room}."
    When the run is attempted
    Then it is refused before any model call, with an error that names "p1" and "mail"

  Scenario: A cancelled contract cannot be accepted again
    Given "v1" raised the price of the organiser's confirmed contract "c-1" and the organiser declined the change, so "v1" cancelled "c-1"
    And the organiser's scripted turns call "send_mail" to "v1" with the act "accept_contract" and the contract "c-1", then end
    When the run ends
    Then "v1" answered "not_available", "c-1" stays cancelled, and the organiser has no commitment with "v1"

  Scenario Outline: accept_change takes only an option the change offered
    Given <change>
    And the organiser's scripted turns call "send_mail" to "v1" with the act "accept_change" and <option>, then end
    When the run ends
    Then "v1" answered "<answer>"

    Examples:
      | change                                                                 | option                    | answer        |
      | "v1" announced a "price_change" on the organiser's contract             | the option "smaller_room" | not_available |
      | "v1" announced a "price_change" on the organiser's contract             | no option                 | confirmed     |
      | "v1" announced "room_lost" for "hall-b", offering a price cut and no smaller room | the option "smaller_room" | not_available |
      | "v1" announced "room_lost" for "hall-b", offering a price cut and no smaller room | the option "price_cut"    | confirmed     |

  Scenario: A withdrawn sponsor rests until a message reaches it
    Given "sp1" agreed 1000, was invoiced with payment due on "day 5", and withdrew at the perturbation "sponsor_withdraws" on "day 4"
    When the run's time limit passes at "day 12 09:00"
    Then "sp1" paid nothing, and called "check_time" at most 10 times after "day 4"

  Scenario: P21 lists one act for an allocation met late, never an announcement without a version
    Given "v1"'s contract with the indicative-rooms term arrived on "day 4", the organiser sent "s2" "confirm" with the room "room-b" on "day 6", published a programme with "room-b" on "day 12", and announced "request_needs" to registrants on "day 13"
    And "v1" allocated "room-b" as "room-d" at "day 15 10:00", and the organiser changed nothing by "day 16 10:00"
    When "P21" is evaluated as it is due
    Then it records one misapplication: the "publish_programme" of "day 12"
