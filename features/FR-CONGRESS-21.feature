@FR-CONGRESS-21
Feature: A replica the organiser can complete, in more than one way

  Scenario: Other customers' enquiries do not depend on the organiser
    Given two runs with the same seed, in one of which the organiser mails "v1" twenty times before "day 6"
    When both runs reach "day 10"
    Then "v1"'s other customers enquired at the same world times in both

  Scenario Outline: The check counts the plans that complete the task
    Given a draw whose parties allow <plans>
    When the variant is drawn with "[solvable] min_solutions = 2, min_venues = 2"
    Then <result>

    Examples:
      | plans                                                   | result                                                    |
      | plans on venues "v1" and "v2"                           | the variant is kept, and lab inventory gives their count  |
      | plans on "v1" only                                      | the variant is redrawn                                    |
      | no plan, in any of 100 draws                            | the variant is refused, naming "solvable"                 |

  Scenario Outline: A plan meets each check as the world allows
    Given a draw with one venue "v1" and <difference>
    When the variant counts its plans
    Then <result>

    Examples:
      | difference                                                                     | result                                  |
      | its only room seats 70 for a target attendance of 75                           | no plan has "v1"                        |
      | a wheelchair attendee, its toilets behind "3 steps", and a "ramp" extra of 100 | its plans book the ramp                 |
      | catering "in_house" whose caterer serves at most 5 gluten-free, 7 expected     | its plans add a permit and an outside order for 2 gluten-free meals, or have none |
      | its other customers' sequence books the event day on "day 4"                   | no plan has "v1"                        |
      | a budget 100 below its cheapest plan's commitments                             | no plan has "v1"                        |
