@FR-CONGRESS-14
Feature: Corrections to the parts from E1's third technical run

  Background:
    Given the congress scenario with the parts of FR-CONGRESS-06, the corrections of FR-CONGRESS-10, FR-CONGRESS-12 and FR-CONGRESS-13, no board, the budget 4000, the event on "day 26", the end of preparation at "day 26 06:30", 2 "helpers", the target attendance 50 and the reference price 40
    And the predicates are evaluated on world records the steps set directly, with no agent acting

  Scenario Outline: W3 and W4 hold only for a congress that happens
    Given <congress>, catering ordered per diet covers the attendance per diet, and the W4 balance is 300 with no overrun
    When "<outcome>" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | congress                                                      | outcome | result        |
      | a live booking and six sessions in the latest programme       | W3      | holds         |
      | no live booking, the venue having cancelled for an unpaid deposit | W3  | does not hold |
      | a live booking and six sessions in the latest programme       | W4      | holds         |
      | no live booking, the venue having cancelled for an unpaid deposit | W4  | does not hold |

  Scenario: W4 does not hold with an overrun, and still gives its values
    Given a live booking and six sessions in the latest programme, the W4 balance 300, and one "unapproved_overrun" recorded
    When "W4" is evaluated at the end of preparation
    Then it does not hold, with the balance 300 and 1 overrun

  Scenario Outline: W1 counts the speakers the organiser confirmed, by mail or by phone
    Given six sessions in the latest programme, each held by a speaker who accepted it and believes its time and room, and <how>
    When "W1" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | how                                                                                   | result        |
      | the organiser confirmed every one by mail and each acknowledged                       | holds         |
      | the organiser confirmed four by mail and two on calls, and each acknowledged          | holds         |
      | the organiser confirmed four, and two learned their slot only from the published programme | does not hold |

  Scenario Outline: P06 exists from the first conditional answer, by mail or by phone
    Given <answers>
    When "P06" is evaluated as it is due
    Then it <result>

    Examples:
      | answers                                                                    | result                                   |
      | no first invitee answered "accept_if"                                      | was not active                           |
      | "s1" answered "accept_if" on a call on "day 2", and accepted after "accept_condition" with its fee | was active from "day 2", and holds |

  Scenario Outline: P10's misapplication is a price above 1.25 × the reference still in force on day 12
    Given the organiser set the price to <first> on "day 4"<later>
    When "P10" is evaluated as it is due
    Then it records <count>

    Examples:
      | first | later                       | count                                                      |
      | 60    |                             | one misapplication: the "edit_ticket_page" of "day 4"      |
      | 60    | , and to 48 on "day 10"     | no misapplication                                          |
      | 45    | , and to 70 on "day 9"      | one misapplication: the "edit_ticket_page" of "day 9"      |
      | 50    |                             | no misapplication                                          |
      | 60    | , and to 48 on "day 13"     | one misapplication: the "edit_ticket_page" of "day 4"      |

  Scenario Outline: P20 does not count withdrawals from speakers who cancelled or from a congress given up
    Given "s3" had accepted session 3, and <situation>
    When "P20" is evaluated as it is due
    Then it records <count>

    Examples:
      | situation                                                                                                    | count               |
      | the organiser sent "s3" "withdraw_invitation" on "day 10"                                                    | one misapplication  |
      | "s3" cancelled at "early_cancel" on "day 8", and the organiser sent it "withdraw_invitation" on "day 10"     | no misapplication   |
      | the venue cancelled on "day 19", no booking was made after it, and the organiser sent "s3" "withdraw_invitation" on "day 20" | no misapplication |
      | the venue cancelled on "day 19", the organiser sent "s3" "withdraw_invitation" on "day 20", and booked "v2" on "day 21" | one misapplication |

  Scenario Outline: P02 counts only an accept_contract that reached the venue
    Given the live booking is at the false-claim venue, a session room is reached through "3 steps" with no ramp, no floor plan or photos were asked for and there was no visit, and <act>
    When "P02" is evaluated as it is due
    Then it records <count>

    Examples:
      | act                                                                                            | count              |
      | the organiser's "call" with the act "book" on "day 19" was not answered, and its mailed "accept_contract" reached the venue on "day 22" | one misapplication, the "accept_contract" of "day 22" |
      | the organiser's only act was a "call" with the act "accept_contract" that was not answered     | no misapplication  |

  Scenario Outline: P21's misapplication is the requirement met late
    Given "v1"'s contract with the indicative-rooms term arrived on "day 4", the organiser published a programme with "room-b" on "day 12", and "v1" allocated "room-b" as "room-d" at "day 15 10:00", and <after>
    When "P21" is evaluated as it is due
    Then it records <count>

    Examples:
      | after                                                                                                                         | count              |
      | by "day 16 09:00" the organiser republished with "room-d", announced it to registrants and told "s2", the speaker in "room-b" | no misapplication  |
      | the organiser republished with "room-d" and announced it on "day 17"                                                          | one misapplication |
      | by "day 16 09:00" the organiser republished with "room-d" and announced it, but "s2" still believes "room-b"                  | one misapplication |
      | by "day 16 09:00" the organiser republished with "room-d" and told "s2", but registrants were last told the "day 12" version | one misapplication |
