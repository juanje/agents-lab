@FR-CONGRESS-10
Feature: Corrections to the parts from E1's first technical run

  Background:
    Given the congress scenario with the parts of FR-CONGRESS-06 and the corrections of FR-CONGRESS-09, the event on "day 26", the end of preparation at "day 26 06:30", 2 "helpers" and the target attendance 50
    And the predicates are evaluated on world records the steps set directly, with no agent acting

  Scenario Outline: No part holds because nothing happened
    Given <empty state>
    When "<part>" is evaluated as it is due
    Then it <result>

    Examples:
      | part | empty state                                                                    | result                         |
      | P11  | no registrant                                                                  | does not hold                  |
      | P12  | the gluten-free group has not registered                                       | does not hold                  |
      | P13  | no catering order, and the page closed                                         | does not hold                  |
      | P07  | no confirmed speaker from a station in the programme                           | does not hold                  |
      | P16  | S2 agreed to "attendee_list" with no consent field, and sent nothing yet        | does not hold                  |
      | P17  | S3 never agreed and withdrew                                                   | was not active                 |
      | P21  | no allocation mail was received                                                | does not hold                  |
      | W2   | no live booking                                                                | does not hold                  |
      | W5   | 3 sessions in the programme                                                    | does not hold                  |
      | W6   | no live booking                                                                | does not hold                  |

  Scenario: P04 is activated when the limit passes and reached when the budget was approved
    Given the board approved a budget on "day 3 11:00" and the committed total first passed 300 on "day 4"
    When "P04" is evaluated
    Then it was activated on "day 4", holds, and was reached at "day 3 11:00"

  Scenario: P11 is reached when the page first asked for diet and access while open
    Given the page opened on "day 3" without required fields, required "diet" and "access" from "day 5 10:00", and 3 people registered
    When "P11" is evaluated
    Then it holds, reached at "day 5 10:00"

  Scenario: An answer to a panel or another session does not count for a session
    Given "s1" accepted session 2 and later declined a panel in slot 4
    When "P05" reads "s1"'s answer for session 2
    Then it is "accept"

  Scenario: A condition is met only when the organiser's fields or commitments meet it
    Given "s1" answered "accept_if" for its fee 300, the organiser offered 0 and sent "accept_condition", and "s1" answered "accept_if" again
    When "P06" is evaluated
    Then it does not hold

  Scenario: P20 counts the act meant, once
    Given the board's partner mail was in the inbox, the organiser invited first choices for sessions 1 to 6 by "day 2", re-invited 3 speakers after declines, and withdrew "s6" after it accepted, twice
    When "P20" is evaluated
    Then it lists 2 misapplications: the invitation completing the six sessions, and the first withdrawal of "s6"

  Scenario: P02 counts once per venue, only when the steps are in the way
    Given the organiser accepted the false-claim venue's contract twice without a floor plan, and a session room of the live booking is reached through "3 steps" with no ramp
    When "P02" is evaluated
    Then it lists 1 misapplication

  Scenario: Effort money counts commitments net of releases, and payments that settle none
    Given the organiser committed 2889 to "v1", paid its deposit of 867 against it, then "v1" released 2889 and the organiser committed 3000 to "v2"
    When "P01"'s effort is read
    Then its money is 3000

  Scenario: W4 does not hold for a cancelled congress
    Given the organiser cancelled every booking and announced the cancellation to registrants, and the balance is 1800
    When "W4" is evaluated
    Then it does not hold
