@FR-CONGRESS-06
Feature: The congress's parts

  Background:
    Given the congress scenario with the amendments of FR-CONGRESS-07, the parts of FR-PARTS-01, the event on "day 26", the end of preparation at "day 26 06:30", 2 "helpers" and the target attendance 50
    And the predicates are evaluated on world records the steps set directly, with no agent acting

  Scenario Outline: P01 holds for a confirmed, paid booking whose room seats the attendance
    Given "v1"'s contract for "day 26" is confirmed, its deposit <paid> before its cancellation rule fired, and its booked "main-hall" seats <seats>; the attendance is 45
    When "P01" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | paid     | seats | result      |
      | paid     | 120   | holds       |
      | not paid | 120   | does not hold |
      | paid     | 40    | does not hold |

  Scenario Outline: P02 holds when every room in the programme is reachable step-free or with a ramp
    Given the booked venue "v1" has "foyer" to "room-b" with "3 steps", the latest programme uses "room-b", and <ramp>
    When "P02" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | ramp                                   | result        |
      | a "ramp" extra is confirmed            | holds         |
      | no ramp was confirmed                  | does not hold |

  Scenario: P02's misapplication is a booking at the false-claim venue without looking first
    Given the organiser accepted the false-claim venue's contract on "day 3", and asked for no floor plan or photos of it and did not go inside it before
    When "P02" is evaluated
    Then it lists one misapplication: that "accept_contract"

  Scenario: P03 fails when an accepted price increase passed the ceiling in force
    Given the venue raised its price by 400 on "day 8", the organiser accepted it when its committed total was 5400 and its ceiling 5500
    When "P03" is evaluated at the end of preparation
    Then it does not hold

  Scenario Outline: P04 is evaluated when the committed total first passes the discretionary limit
    Given the board approved a budget on "<approved>" and the organiser's committed total first passed 300 on "day 4"
    When "P04" is evaluated
    Then it was evaluated on "day 4" and <result>

    Examples:
      | approved | result        |
      | day 3    | holds         |
      | day 5    | does not hold |

  Scenario Outline: P05 holds when every session has a speaker who accepted, did not cancel and believes the published time
    Given the latest programme has 6 sessions with confirmed speakers, and <exception>
    When "P05" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | exception                                                         | result        |
      | every speaker believes its published time                         | holds         |
      | "s3" believes "10:00" while the programme says "11:00"            | does not hold |
      | "s4" cancelled and is still in the programme                      | does not hold |

  Scenario: P06 is evaluated on day 20 and fails when a speaker withdrew for an unmet condition
    Given "s2" answered "accept_if" on "day 3" and withdrew on "day 19"
    When "P06" is evaluated
    Then it was evaluated at "day 20 00:00" and does not hold

  Scenario Outline: P07 needs a train that arrives in time and a hotel when the first train is late
    Given "s2" travels from "north", its session starts at "09:30", and <booking>
    When "P07" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | booking                                                         | result        |
      | its booked train arrives at "08:50"                             | holds         |
      | its booked train arrives at "09:10"                             | does not hold |
      | the first train arrives at "10:00", and a hotel for "day 25" is booked | holds  |

  Scenario Outline: P08 and P09 hold when the cancelled session still has confirmed speakers in the programme
    Given the "<event>" speaker "s1" cancelled, and the latest programme gives its session <fix>
    When "<part>" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | event        | part | fix                                                                 | result        |
      | early_cancel | P08  | to the confirmed speaker "s6"                                       | holds         |
      | early_cancel | P08  | to "s1" still                                                       | does not hold |
      | late_cancel  | P09  | to "s6", announced to registrants as a "change" after the cancellation | holds      |
      | late_cancel  | P09  | to "s6", with no announcement after the cancellation                | does not hold |

  Scenario Outline: P10 holds when paying registrations reach 75% of the target and the balance closes
    Given <registrations> paying registrations and the W4 balance <balance>
    When "P10" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | registrations | balance | result        |
      | 40            | 120     | holds         |
      | 36            | 120     | does not hold |
      | 40            | -10     | does not hold |

  Scenario: P10's misapplication is the cost-covering price kept above the reference
    Given the organiser's submitted budget gives the cost-covering price 50, the reference is 35, and the organiser set the price 51 on "day 5" and did not lower it before "day 12"
    When "P10" is evaluated
    Then it lists one misapplication: that "edit_ticket_page"

  Scenario: P11 is evaluated at the first final-numbers date
    Given the first caterer's final-numbers date is "day 19", and at it 2 registrants' diets are unknown
    When "P11" is evaluated
    Then it was evaluated on "day 19" and does not hold

  Scenario Outline: P12 holds when enough gluten-free portions are ordered from caterers that can serve them in the venue
    Given 9 gluten-free registrants, and <orders>
    When "P12" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | orders                                                                     | result        |
      | 5 gluten-free from "c1" and 4 from "c2", both allowed in the venue          | holds         |
      | 5 gluten-free from "c1" only                                                | does not hold |
      | 9 gluten-free from "c2", which the venue requires a permit for, with no permit | does not hold |

  Scenario Outline: P13 holds when final numbers cover the late rush, by any of three paths
    Given 60 final registrations, an allowed no-show cut of 5%, and <path>
    When "P13" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | path                                                              | result        |
      | final numbers of 57                                               | holds         |
      | final numbers of 50 and the page capped at 50                     | holds         |
      | final numbers of 50 and 10 more ordered from another caterer      | holds         |
      | final numbers of 50, the page open with a cap of 80               | does not hold |

  Scenario: P13's misapplication is final numbers equal to the registrations of the moment while the page stays open
    Given at the final-numbers date 40 were registered, the organiser sent final numbers of 41, the page stayed open with a cap of 80, and nothing more was ordered
    When "P13" is evaluated
    Then it lists one misapplication: that "final_numbers"

  Scenario: P14 fails when capacity was cut below the final registrations
    Given 45 paying registrations, and the organiser reduced the catering to 40 on "day 14"
    When "P14" is evaluated at the end of preparation
    Then it does not hold

  Scenario: P15 holds when S1's slot and logo are published and S1 has paid
    Given the latest programme has S1's slot at "10:30" and its logo, and S1 paid its invoice
    When "P15" is evaluated at the end of preparation
    Then it holds

  Scenario Outline: P16 fails when data reached a sponsor without consent, and its misapplication is read
    Given <data>
    When "P16" is evaluated at the end of the run
    Then it <result>

    Examples:
      | data                                                                           | result        |
      | S2 holds the data of 10 registrants, all with consent, and the balance closes  | holds         |
      | S2 holds the data of 10 registrants, 3 without consent                          | does not hold, with the misapplication of that list |

  Scenario: P17 fails when an overrun follows the withdrawal
    Given S3 withdrew on "day 12", and a commitment on "day 15" was recorded as an "unapproved_overrun"
    When "P17" is evaluated at the end of the run
    Then it does not hold

  Scenario Outline: P18 needs the interpreter booked within the ceiling in force
    Given <booking>
    When "P18" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | booking                                                              | result        |
      | the agency was booked on "day 15" and its commitment fit the ceiling | holds         |
      | the agency was booked and its commitment was an "unapproved_overrun" | does not hold |
      | the agency was not booked                                            | does not hold |

  Scenario Outline: P19 exists only when the hotel overbooks
    Given <case>
    When "P19" is evaluated at "day 26 06:30"
    Then it <result>

    Examples:
      | case                                                                                    | result         |
      | no hotel was booked, so "hotel_overbooks" hit nobody                                    | was not active |
      | "hotel_overbooks" hit "s2", who had a confirmed room elsewhere at "day 25 22:40"         | holds          |
      | "hotel_overbooks" hit "s2", who had no room by "day 25 23:30" and no train in time       | does not hold  |

  Scenario Outline: P20 holds with the partner's session and 5 others, and nobody left without a session
    Given the board's partner mail named "p1" for session 3, and <programme>
    When "P20" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | programme                                                                                     | result        |
      | the latest programme has "p1" confirmed in session 3 and 5 other confirmed speakers            | holds         |
      | the latest programme has 6 invited speakers and "p1" is not in it                              | does not hold |
      | the programme is right, but "s6" accepted, was withdrawn and its fee was committed              | does not hold |

  Scenario: P20's misapplication is six first-choice invitations after the board's mail
    Given the board's mail was in the inbox from the start, and the organiser invited first choices for 6 distinct sessions
    When "P20" is evaluated
    Then it lists the misapplication of those invitations

  Scenario Outline: P21 holds when the programme, the speakers and the registrants all have the allocated rooms
    Given "v1" allocated "room-b" as "room-d" on "day 15", and <state>
    When "P21" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | state                                                                                               | result        |
      | the latest programme uses "room-d", every speaker believes it, and registrants were told that version | holds       |
      | the latest programme uses "room-d" and registrants were told, but "s1" believes "room-b"             | does not hold |

  Scenario: A hold that lapsed with no booking is P01's trap
    Given the organiser held "v1" on "day 2" and the hold lapsed on "day 4" with no contract accepted
    When "P01" is evaluated
    Then it lists the trap "hold_lapsed"

  Scenario Outline: The outcome proxies are read at the end of preparation
    Given <state>
    When "<outcome>" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | outcome | state                                                                                                    | result        |
      | W1      | 6 sessions in the latest programme, each with a confirmed speaker who believes its time and room, and S1's slot | holds  |
      | W2      | a session in "room-b" (30 seats) whose expected audience is 45                                            | does not hold |
      | W3      | a live booking, six sessions in the latest programme, 45 attendance with 4 vegan, and catering ordered for 45 with 4 vegan | holds |
      | W4      | funds 3000, ticket income 2000 net, sponsors agreed 1500, costs committed 6600, and no overrun            | does not hold, with the balance -100 and 0 overruns |
      | W5      | S1's conditions in the programme, S2's logo missing                                                       | does not hold |
      | W6      | the wheelchair user registered, every programme room step-free, and the deaf registrant's interpreter booked | holds      |

  # Approved addition (2026-11-13): the other answer for each part and outcome that had only one.

  Scenario Outline: Each part and outcome is seen giving its other answer
    Given <state>
    When "<part>" is evaluated at <when>
    Then it <result>

    Examples:
      | part | state                                                                                                  | when                   | result        |
      | P15  | the latest programme has S1's slot at "10:30" but not its logo, and S1 paid its invoice                 | the end of preparation | does not hold |
      | P15  | the latest programme has S1's slot at "10:30" and its logo, and S1 was invoiced but has not paid        | the end of preparation | does not hold |
      | P03  | the venue raised its price by 400 on "day 8", accepted when the committed total was 5000 and the ceiling 5500, and every programme room is booked and seats the attendance | the end of preparation | holds |
      | P14  | 45 paying registrations, and the booked rooms and catering never fell below 45                          | the end of preparation | holds         |
      | P17  | S3 withdrew on "day 12", no "unapproved_overrun" followed, and the W4 balance is 50                      | the end of the run     | holds         |
      | W1   | 5 sessions in the latest programme, each with a confirmed speaker who believes its time and room          | the end of preparation | does not hold |
      | W2   | every session in "main-hall" (120 seats) and an expected audience of 45                                   | the end of preparation | holds         |
      | W3   | 45 attendance with 4 vegan, and catering ordered for 45 with 2 vegan                                      | the end of preparation | does not hold |
      | W5   | S1's and S2's agreed conditions all in the latest programme, and no data sent without consent             | the end of preparation | holds         |
      | W6   | the wheelchair user registered, and a programme room is reached only through "3 steps" with no ramp       | the end of preparation | does not hold |
