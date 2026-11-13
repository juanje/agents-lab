@FR-POPULATION-01
Feature: Attendees, the ticket page, the programme and announcements

  Background:
    Given the congress scenario of FR-CONGRESS-05, whose calendar starts at "day 1 Monday 09:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the congress is on "day 26", its target attendance is 4 and the reference price is 100
    And the attendees material has "pool_factor" 1, "base_per_day" 24, "unannounced" 0, "promotion_factor" 2, "payment_fee_share" 0.03, "cancel_share" 0, "consent_share" 1, every person paying, and the diet shares "none" 1
    And it has no fixed people
    And the organiser's account opens at 0

  Scenario Outline: A person's probability of registering in a world hour follows the published formula
    Given <situation>
    When the population's probability for a person not yet registered is read at "<time>"
    Then it is <probability>, within 0.001

    Examples:
      | situation                                                                                         | time         | probability |
      | the page is open at the price 100 and registration was announced to the association                | day 2 10:00  | 1           |
      | the page is open at the price 100 and nothing was announced                                        | day 2 10:00  | 0           |
      | "base_per_day" is 2.4, the page is open at the price 140 and registration was announced            | day 2 10:00  | 0.0368      |
      | "base_per_day" is 2.4, the page is open at the price 100, registration announced, a programme published whose speakers' draws add up to 5 | day 2 10:00 | 0.15 |
      | "base_per_day" is 2.4, the page is open at the price 100 and registration was announced            | day 16 10:00 | 0.2143      |
      | "base_per_day" is 2.4, the page is open at the price 100 and registration was announced            | day 22 10:00 | 0.3         |
      | "base_per_day" is 2.4, the page is open at the price 100, registration announced, a promotion to the association started on "day 2 09:00" | day 2 10:00 | 0.2 |

  Scenario: Nobody registers while the page is closed
    Given registration was announced to the association, and the page was never opened
    When the run's time limit passes at "day 3 Wednesday 09:00"
    Then nobody registered

  Scenario: People register once the page is open and registration announced, and pay
    Given the organiser's scripted turns call "edit_ticket_page" with open true and price 100, then "announce" to "association_list" the kind "registration_open", then end
    When the run's time limit passes at "day 2 Tuesday 09:00"
    Then all 4 people registered within the first world hour after the announcement
    And the organiser's account received 4 transfers of 97 from "attendees"

  Scenario: The cap stops registrations, and the waiting list takes the rest
    Given the organiser's scripted turns call "edit_ticket_page" with open true, price 100, cap 2 and waiting_list true, then "announce" to "association_list" the kind "registration_open", then end
    When the run's time limit passes at "day 2 Tuesday 09:00"
    Then 2 people registered and 2 are on the waiting list

  Scenario: The closing date ends registrations
    Given "base_per_day" is 0.24 and the page is open at the price 100 with the close date "day 3", and registration was announced on "day 1"
    When the run's time limit passes at "day 6 Saturday 09:00"
    Then nobody registered after "day 3"

  Scenario: The organiser learns diets and needs only for the fields the page requires
    Given the diet shares are "vegan" 1
    And the organiser's scripted turns call "edit_ticket_page" with open true, price 100 and required_fields "diet", then "announce" to "association_list" the kind "registration_open", then wait 2 world hours, then "ticket_page" "summary", then end
    When the run ends
    Then the "ticket_page" result gives 4 registrations, 4 of them "vegan", and no access needs given

  Scenario: A person with a need the page did not ask about mails the organiser
    Given the material has the fixed person "w1", a wheelchair user, registering between "day 2 10:00" and "day 2 11:00"
    And the page is open at the price 100 without required fields, and registration was announced on "day 1"
    When the run's time limit passes at "day 4 Thursday 09:00"
    Then "w1" registered on "day 2" between "10:00" and "11:00"
    And the organiser received a mail from "w1" about access within a world day after that

  Scenario: A group with a shared diet registers together
    Given the material has a group of between 8 and 8 with the diet "gluten_free", registering between "day 3 10:00" and "day 3 10:00", and the target attendance is 20
    And the page is open at the price 100 with required_fields "diet", and registration was announced on "day 1"
    When the run's time limit passes at "day 4 Thursday 09:00"
    Then 8 people with the diet "gluten_free" registered at "day 3 10:00", within one world hour

  Scenario: A programme sets what its speakers believe, and an impossible one is refused
    Given the venue "v1" is booked with the rooms "main-hall" and "room-b", and "s1" and "s4" are confirmed
    And the organiser's scripted turns call "publish_programme" with "s1" at "10:00" in "main-hall" and "s4" at "11:00" in "room-b", then "publish_programme" with "s1" and "s4" both at "10:00" in "main-hall", then end
    When the run ends
    Then the first "publish_programme" succeeded, and "s1" believes "10:00" in "main-hall" and "s4" believes "11:00" in "room-b"
    And the second failed with the outcome "invalid_value"

  Scenario: Registrants believe the version they were last told
    Given 4 people have registered and a programme was published as version 1, announced to "registrants" with the kind "programme"
    And the organiser's scripted turns call "publish_programme" again as version 2, then end
    When the run ends
    Then every registrant believes version 1
    And after an "announce" to "registrants" with the kind "change", every registrant believes version 2

  Scenario: A request for needs makes registrants give what they did not
    Given the diet shares are "vegan" 1, and 4 people registered while the page required no fields
    And the organiser's scripted turns call "edit_ticket_page" with required_fields "diet", then "announce" to "registrants" the kind "request_needs", then wait 1 world day, then "ticket_page" "summary", then end
    When the run ends
    Then the "ticket_page" result gives 4 "vegan"

  Scenario: Asking registrants to cancel if they cannot come
    Given 4 people registered, 2 of whom would not come
    And the organiser's scripted turns call "announce" to "registrants" the kind "request_cancel_if_not_coming", then end
    When the run ends
    Then each of the 2 cancelled with probability 0.5, from the population's sequence, and the others did not

  Scenario: A speaker's promotion is scaled by its draw
    Given "s1" has the draw 2 and accepted, and "base_per_day" is 2.4, and the page is open at the price 100 with registration announced
    And the organiser's scripted turns call "send_mail" to "s1" with the act "ask_promote", then end
    When the population's probability is read two world hours after "s1" answered "promoting"
    Then it is 0.3, within 0.001

  Scenario: A sponsor that misses its logo in the programme on day 19 says so
    Given "sp1" agreed to "logo" and "morning_slot", and the programme published has "sp1"'s morning slot but not its logo
    When the run's time limit passes at "day 20 Saturday 09:00"
    Then "sp1" mailed the organiser "condition_missing" naming "logo" on "day 19"

  Scenario: Cancellations come at their drawn share
    Given "cancel_share" is 1 and 4 people registered on "day 2"
    When the run's time limit passes at "day 26 Friday 06:00"
    Then all 4 cancelled before the event

  Scenario: The log and the outcome keep the population's history
    Given the page is open at the price 100 and registration was announced, and 4 people registered
    When the run ends
    Then the run's log has a "population" line for each registration and payment
    And the population's "participant_outcome" gives 4 registrations by day and by diet, 4 payments, no cancellations and no waiting list

  Scenario: The world records whose data a sponsor holds, and whether they consented
    Given the page required "consent_sponsors", the "consent_share" is 0.5, and 4 people registered, 2 of whom consented
    And the organiser's scripted turns call "send_mail" to "sp2" with the act "send_attendee_list" and list the 4 registrants' ids and "a-99", then end
    When the run ends
    Then the world records that "sp2" holds the data of the 4 registrants, 2 with consent and 2 without, and ignores "a-99"

  Scenario Outline: An attendees material that cannot be followed is refused before any model call
    Given the attendees material is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<it>"

    Examples:
      | change                                                  | it                 |
      | its diet shares add up to 0.9                           | diets              |
      | its "base_per_day" is -1                                | base_per_day       |
      | its "consent_share" is 1.5                              | consent_share      |
      | its "payment_fee_share" is -0.1                         | payment_fee_share  |
      | a fixed person's window is "day 3" to "day 2"           | w1                 |
      | its group size is [12, 8]                               | group_size         |
