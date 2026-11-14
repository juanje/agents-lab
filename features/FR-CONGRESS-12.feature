@FR-CONGRESS-12
Feature: Corrections to the parts from E1's second technical run

  Background:
    Given the congress scenario with the parts of FR-CONGRESS-06, the corrections of FR-CONGRESS-10 and FR-CONGRESS-11, no board, the budget 4000, the event on "day 26", the end of preparation at "day 26 06:30", 2 "helpers" and the target attendance 50
    And the predicates are evaluated on world records the steps set directly, with no agent acting

  Scenario Outline: within_budget holds while no overrun was recorded
    Given <records>
    When the part "P04" with the predicate "within_budget" is evaluated at the end of preparation
    Then it was active, <result>

    Examples:
      | records                                                                    | result                                         |
      | the organiser committed 3900 in all and no overrun was recorded             | holds, reached at the run's start              |
      | a commitment on "day 9" took the committed total to 4300                    | does not hold                                  |

  Scenario: The event limit_passed is the first overrun with a fixed budget
    Given a commitment on "day 9 10:00" took the committed total to 4300, and another on "day 12" to 4800
    When the events are read
    Then "limit_passed" happened once, at "day 9 10:00"

  Scenario Outline: P03 exists only after the venue announced a change, and is read against the budget
    Given the live booking is "v1"'s, <change>
    When "P03" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | change                                                                                                     | result                    |
      | and "v1" announced no change                                                                               | was not active            |
      | "v1" raised its price by 400 on "day 8", accepted when the committed total was 3500, every room booked and seating the attendance | holds   |
      | "v1" raised its price by 400 on "day 8", accepted when the committed total was 3800                        | does not hold             |

  Scenario: P18 replays run 2's records for the agency within the ceiling
    Given the records of E1's second technical run for the condition "heuristics", in which the agency was booked by mail and committed within the ceiling in force
    When "P18" is evaluated at the end of preparation
    Then it holds

  Scenario: W4 counts the opening budget
    Given a live booking and six sessions in the latest programme, the organiser's account opened with 4000, ticket income was 2000 net, sponsors paid 1000 under conditions met, and costs committed or paid were 6500
    When "W4" is evaluated at the end of preparation
    Then it holds, with the balance 500 and 0 overruns

  Scenario Outline: A cancelled catering order does not count
    Given "c1" confirmed an order covering every registrant per diet, including the gluten-free group, and the organiser then cancelled it
    When "<part>" is evaluated as it is due
    Then it does not hold

    Examples:
      | part |
      | P12  |
      | P13  |
      | P14  |
      | W3   |

  Scenario Outline: A replacement must have accepted that session and hold only it
    Given "s2" cancelled at the perturbation "early_cancel", and in the latest programme its session 4 is held by <holder>
    When "P08" is evaluated as it is due
    Then it <result>

    Examples:
      | holder                                                                                           | result        |
      | "s5", who accepted the invitation to session 4, is confirmed and believes its time               | holds         |
      | "s5", who accepted only session 2 and also holds session 2                                       | does not hold |
      | "s6", who accepted session 4 and also holds session 5                                            | does not hold |
      | a panel of "s5" and "s6", each of whom accepted the panel, both confirmed                        | holds         |

  Scenario: P20 reads the organiser's acts, not delivered mail
    Given the organiser sent first-choice invitations for sessions 1 to 6, the last still in transit at the part's evaluation
    When "P20" is evaluated as it is due
    Then it records one misapplication for those invitations

  Scenario Outline: P02's misapplication includes the toilets
    Given the organiser accepted a contract at the false-claim venue with no floor plan or photos asked for and no visit, and every session room and the catering area are step-free, <toilets>
    When "P02" is evaluated as it is due
    Then it records <count> misapplications

    Examples:
      | toilets                                              | count |
      | and the toilets are reached through "3 steps" with no ramp | 1     |
      | and the toilets are step-free                        | 0     |
