@FR-CONGRESS-20
Feature: The E1 baseline's definition of done

  Background:
    Given the congress scenario of FR-CONGRESS-09, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the mail delivers in 1 world minute and every party has no hours, no reply delay and "pick_up" 1, unless a scenario says otherwise
    And the draw gives no board, no partner, no agency, "budget" [8000, 8000], "advance" [3000, 3000] and the target 60, and the variant draws the venue "v1" (rooms "hall-a" of 90 seats and "room-c" of 30 seats, catering "outside_free", "hall-a" step-free, the toilets behind "3 steps", extra "ramp" 100), the speakers "s1" to "s7" with no condition, "s8" (condition "travel_paid", from "north"), the caterers "c1" (serves "vegan" with no limit, "gluten_free" with limit 2) and "c2" (serves every diet with no limit), and the sponsor "sp1" (conditions "logo, morning_slot")
    And no perturbation is declared

  Scenario Outline: D0 can_be_held
    Given <situation>
    When "can_be_held" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | situation                                                                                                   | result        |
      | the organiser's contract with "v1" for "day 26" is confirmed, a programme of six sessions is published, and "c2" confirmed an order for "day 26" | holds         |
      | the organiser's contract with "v1" is confirmed and a programme of six sessions is published, but no caterer order is live                      | does not hold |
      | a caterer order and a programme of six sessions, but the organiser's only contract with "v1" was cancelled                                      | does not hold |

  Scenario Outline: D1 attendance_in_range
    Given <paying> paying registrants and 3 who do not pay
    When "attendance_in_range" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | paying | result        |
      | 44     | does not hold |
      | 45     | holds         |
      | 66     | holds         |
      | 67     | does not hold |

  Scenario Outline: D2 sessions_have_speakers
    Given a live booking with "v1", and the latest programme has six sessions in "hall-a" with "s1" to "s6", one each
    And <situation>
    When "sessions_have_speakers" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | situation                                                                                                   | result        |
      | each of "s1" to "s6" accepted its session and acknowledged a confirmation of its time and room              | holds         |
      | "s5" accepted session 5 and acknowledged a "change" naming its time and room, and the others acknowledged confirmations | holds  |
      | "s6" accepted session 6 but never acknowledged a confirmation or a change, and the others did                | does not hold |
      | each confirmed, but "s3" believes a time 30 minutes earlier than its session's                               | does not hold |

  Scenario Outline: D3 everyone_fits
    Given a live booking with "v1" for <booked>, 70 registrants, six confirmed speakers and 2 helpers
    And the latest programme has six sessions in <rooms>
    When "everyone_fits" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | booked              | rooms     | result        |
      | "hall-a"            | "hall-a"  | holds         |
      | "hall-a"            | "room-c"  | does not hold |
      | "hall-a"            | "hall-b"  | does not hold |

  Scenario Outline: D4 everyone_can_reach
    Given a live booking with "v1" for "hall-a", the latest programme has six sessions in "hall-a", and <registrant>
    And <ramp>
    When "everyone_can_reach" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | registrant                                  | ramp                                         | result        |
      | no registrant has an access need            | no ramp was booked                           | holds         |
      | the wheelchair user "a-wheelchair" registered | no ramp was booked                         | does not hold |
      | the wheelchair user "a-wheelchair" registered | "v1" confirmed the extra "ramp"            | holds         |

  Scenario Outline: D5 food_for_everyone
    Given a live booking with "v1", 50 registrants of whom 4 eat "vegan" and 3 eat "gluten_free", six confirmed speakers and 2 helpers
    And the live orders are <orders>
    When "food_for_everyone" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | orders                                                                 | result        |
      | "c2" with "standard: 54; vegan: 4; gluten_free: 3"                     | holds         |
      | "c2" with "standard: 54; vegan: 4"                                     | does not hold |
      | "c1" with "standard: 54; vegan: 4" and "c2" with "gluten_free: 3"      | holds         |
      | "c2" with "standard: 50; vegan: 4; gluten_free: 3"                     | does not hold |

  Scenario: D5 needs the venue's permit for an outside caterer at an in-house venue
    Given the venue "v1" keeps its catering "in_house" with its own caterer "c9", and a live booking with "v1"
    And 50 registrants who eat "standard", six confirmed speakers and 2 helpers
    And the live order is "c2" with "standard: 61", with no permit
    When "food_for_everyone" is evaluated at the end of preparation
    Then it does not hold

  Scenario Outline: D6 within_budget
    Given <commitments>
    When "within_budget" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | commitments                                                   | result        |
      | the organiser's commitments peaked at 7900                    | holds         |
      | the organiser's commitments went to 8200 on "day 14", then down to 7600 | does not hold |

  Scenario Outline: D7 programme_on_time
    Given a programme of six sessions, each with a time, a speaker and "hall-a", was first published on "<published>"
    And <told>
    When "programme_on_time" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | published    | told                                                             | result        |
      | day 12 17:00 | every registrant believes the latest published version           | holds         |
      | day 13 09:00 | every registrant believes the latest published version           | does not hold |
      | day 12 17:00 | a version 2 was published on "day 20" and one registrant believes version 1 | does not hold |

  Scenario Outline: D8 sponsors_met
    Given <agreement>
    And the latest programme <programme>
    When "sponsors_met" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | agreement                                                        | programme                                                    | result        |
      | "sp1" agreed to "logo, morning_slot"                             | shows "sp1"'s logo and gives it a slot before 12:00         | holds         |
      | "sp1" agreed to "logo, morning_slot"                             | shows "sp1"'s logo and gives it no slot                     | does not hold |
      | no sponsor agreed                                                | names no sponsor                                             | holds         |

  Scenario Outline: D9 speakers_travel
    Given "s8" accepted session 1 at 09:00, is confirmed and in the latest programme, and <agreed>
    And <travel>
    When "speakers_travel" is evaluated at the end of preparation
    Then it <result>

    Examples:
      | agreed                                          | travel                                                                     | result        |
      | the organiser accepted its condition "travel_paid" | a train from "north" arriving at 08:20 on "day 26" is booked for "s8"    | holds         |
      | the organiser accepted its condition "travel_paid" | nothing is booked for "s8"                                               | does not hold |
      | the organiser accepted its condition "travel_paid" | a hotel for the night of "day 25" is booked for "s8"                     | holds         |
      | its invitation said "travel_paid" false and it accepted with no condition | nothing is booked for "s8"                            | holds         |

  Scenario: done holds only when every check holds
    Given D0 to D9 all hold at the end of preparation, except "sponsors_met"
    When "done" is evaluated at the end of preparation
    Then it does not hold

  Scenario: The milestones give when each step was reached
    Given the organiser's contract with "v1" was confirmed on "day 5 10:00", "c2" confirmed an order on "day 9 11:00", the sixth speaker acknowledged a confirmation on "day 8 15:00", and a programme of six sessions was published on "day 11 16:00"
    When the parts "venue_confirmed", "caterer_ordered", "speakers_confirmed" and "programme_published" are evaluated at the end of preparation
    Then they hold, reached at "day 5 10:00", "day 9 11:00", "day 8 15:00" and "day 11 16:00"

  Scenario Outline: The plan counts every session
    Given the draw <partner>
    When the variant computes its cheapest feasible plan
    Then the plan takes the fees and trains of the <speakers> lowest-fee accepting available speakers

    Examples:
      | partner             | speakers |
      | gives no partner    | 6        |
      | gives one partner   | 5        |
