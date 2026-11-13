@FR-CONGRESS-01
Feature: The congress world from materials

  Background:
    Given the congress scenario, whose calendar starts at "day 1 Monday 08:00" with one segment of scale 6000, so one world minute is 10 milliseconds of the run, and declares the hours "office" on Monday to Friday from "09:00" to "18:00"
    And its "city" has the places "office", "station", and the venues "v1", "v2" and "v3" with their entrances "v1-entrance", "v2-entrance" and "v3-entrance", joined to "office" by passages of 40, 60 and 75 world minutes, all step-free
    And "v1"'s interior is "foyer" and "main-hall", open in the hours "office"; "v1-entrance" to "foyer" is a step-free passage of 1 minute, and "foyer" to "main-hall" a passage of 1 minute whose "step_free" is "3 steps"; "main-hall" has 120 seats and the equipment "projector"
    And its "pools" have the venues "v1", "v2" and "v3", the speakers "s1", "s2", "s3" and "s4", and the topics "soil", "rivers" and "bees"
    And its "draw" chooses 3 venues and 3 speakers, and a target attendance between 50 and 80
    And its "[kinds.venue]" and "[kinds.speaker]" give each party the rule set "silent", the tool "send_mail" and the channel "mail_notice"
    And the mail and the phone of FR-MESSAGE-01 and FR-PHONE-01 exist, with "check_minutes" 2, and the configuration's "away_factor" is 1.5

  Scenario: The organiser starts in the office and sees the passages that leave it
    Given the organiser's scripted turns call "look", then end
    When the run ends
    Then the "look" result gives the place "office" and the exits "v1-entrance" (40, step-free), "v2-entrance" (60, step-free) and "v3-entrance" (75, step-free)

  Scenario: Going to a venue takes its passage's length in world minutes
    Given the calendar starts at "day 1 Monday 10:00", within the venue's hours
    And the organiser's scripted turns call "go" to "v1-entrance", then "look", then end
    When the run ends
    Then the "go" call took 400 milliseconds of the run, within 30
    And the "look" result gives the exits "office" and "foyer"

  Scenario: Inside a venue the organiser sees what is in the way, the seats and the equipment
    Given the organiser starts in "foyer" on "day 1 Monday 10:00"
    And the organiser's scripted turns call "look", then "go" to "main-hall", then "look", then end
    When the run ends
    Then the first "look" result gives the exit "main-hall" with the length 1 and "step_free" "3 steps"
    And the second gives "main-hall" with 120 seats and the equipment "projector"

  Scenario: A venue's interior is closed outside its hours
    Given the calendar starts at "day 6 Saturday 10:00" and the organiser starts in "v1-entrance"
    And the organiser's scripted turns call "look", then "go" to "foyer", then end
    When the run ends
    Then the "look" result says the interior is closed and lists no exit into it
    And the "go" call failed with the outcome "closed", took no time and changed nothing

  Scenario: The organiser checks the world's time
    Given the organiser's scripted turns call "check_time", then end
    When the run ends
    Then the "check_time" result is "day 1 Monday 08:00"

  Scenario: Notes are written, replaced and read
    Given the organiser's scripted turns call "write_note" "venues" "ask three", then "write_note" "venues" "v1 is best", then "read_notes", then "read_notes" "venues", then "read_notes" "money", then end
    When the run ends
    Then the first "read_notes" result lists one title, "venues"
    And the second is "v1 is best"
    And the third failed with the outcome "no_such_note"

  Scenario: A wait lasts up to a day and ends early at a stimulus
    Given the configuration's "wait_max_minutes" is 1440
    And a participant "s1" sends the organiser a mail at "day 1 Monday 08:10"
    And the organiser's scripted turns call "wait" 1441, then "wait" 60, then end
    When the run ends
    Then the first "wait" failed with the outcome "invalid_arguments" and took no time
    And the second ended with the outcome "interrupted" when the mail's notice arrived

  Scenario: Away from the office the mail tools take longer
    Given the organiser starts in "v1-entrance"
    And the organiser's scripted turns call "check_mail", then end
    When the run ends
    Then the "check_mail" call took 3 world minutes, 30 milliseconds of the run, within 30

  Scenario: Every condition of a replica meets the same congress
    Given the experiment has two conditions that differ only in their "guidance"
    When one replica of each runs with the seed 42
    Then both runs' "variant" lines give the same topic, target attendance, venues and speakers
    And the speakers are 3 of "s1", "s2", "s3" and "s4", and the target attendance is between 50 and 80

  Scenario: The chosen templates become participants with their kind's settings
    Given the organiser's scripted turns end at once
    When the run ends
    Then each chosen venue and speaker is a participant named by its id, with a mailbox and a line, deciding by "silent", with the tool "send_mail" and the channel "mail_notice"
    And the speaker not chosen is no participant

  Scenario: A venue that is not chosen has no places
    Given the "draw" chooses 2 venues, and the seed draws "v1" and "v2"
    And the organiser's scripted turns call "look", then end
    When the run ends
    Then the "look" result gives the exits "v1-entrance" and "v2-entrance" only

  Scenario: The prompt joins the task, limits, restrictions, knowledge and guidance, in that order
    Given the configuration's "task" is "Organise the congress.", "limits" "Budget: 6000.", "restrictions" "Ask the board before overspending.", "knowledge" "" and "guidance" "Settle the venue first."
    And "[placement]" puts "task" in the person's first message and the others in the system prompt
    When the run ends
    Then the organiser's system prompt is "Budget: 6000.\n\nAsk the board before overspending.\n\nSettle the venue first."
    And its first message from the person is "Organise the congress."

  Scenario: The inventory gives the congress world
    When the inventory is made
    Then it gives the places and passages with their lengths and "step_free", "v1"'s rooms, seats and hours, the draw's ranges, each kind's settings, the tools' durations, the "away_factor", and the prompt's texts and placement

  Scenario Outline: A congress world that cannot be followed is refused before any model call
    Given the configuration is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<it>"

    Examples:
      | change                                                       | it                       |
      | "city" is not valid TOML                                     | city                     |
      | a passage joins "office" to "moon"                           | moon                     |
      | a passage's "step_free" is 3                                 | step_free                |
      | "v1"'s hours are "night", which the calendar lacks           | v1                       |
      | the "draw" chooses 5 speakers from a pool of 4               | draw.speaker             |
      | the "draw" chooses 1 caterer and "pools" has no caterers     | draw.caterer             |
      | the target attendance is between 80 and 50                   | draw.attendance          |
      | "[kinds.sponsor]" is given and "pools" has no sponsors       | kinds.sponsor            |
      | "wait_max_minutes" is 2000                                   | wait_max_minutes         |
      | "away_factor" is 0.5                                         | away_factor              |
      | two speakers in the pool have the id "s1"                    | s1                       |

  # Approved addition (2026-11-13): draws by role, and the price gap. Appended to FR-CONGRESS-01.feature when the FR is reopened.

  Scenario: Each role is filled by a template that carries it
    Given the pools' venues "v1" (roles "false_claim"), "v2" (roles "high_demand") and "v3" (no role), and the "draw" asks for the venue roles "false_claim" 1 and "high_demand" 1 and 1 venue with no role
    When ten replicas run with the seeds 1 to 10
    Then every variant line gives "false_claim" "v1", "high_demand" "v2" and the venue "v3"

  Scenario: A role is filled by distinct templates, drawn from the seed
    Given the pools' speakers "s1" to "s4" carry the role "unavailable" and the "draw" asks for 2 of them
    When two replicas run with the seed 42, the second with another condition
    Then both variant lines give the same 2 distinct speakers for "unavailable"

  Scenario: The cheapest-fit role is priced below every other venue that fits
    Given the role "false_claim" is marked "cheapest_fit" with "cheapest_margin" [0.85, 0.95], "v1"'s price is 3000, "v2" seats the target at 2000 and "v3" does not seat it at 1000
    When the variant is drawn
    Then "v1"'s day price is between 1700 and 1900

  Scenario: A perturbation names a role
    Given the perturbation "sponsor_withdraws" names "for_role" "withdraws", and the draw fills the role "withdraws" with "sp3"
    When the run ends
    Then the perturbation acted on "sp3"

  Scenario Outline: The reference price comes from a cheapest feasible plan, less a drawn gap (FR-CONGRESS-11)
    Given the target attendance is 50, "helpers" is 2, the cheapest venue that seats it costs 2000 <ramp>, the chosen caterers' prices per head are 25 and 30, the agency costs 460, the five lowest-fee accepting available speakers' fees add up to 500 and one of them comes from "north", whose cheapest train costs 40, the budget is 3000, the sponsors outside the role "withdraws" add up to 1000 and the one in it to 500, and "price_gap" is [0.6, 0.6]
    When the variant is drawn
    Then the cost-covering price is <covering>, the reference price is <reference>, and the similar events cost <similar>
    And the variant line gives both prices, the gap and the budget

    Examples:
      | ramp                                                         | covering | reference | similar        |
      | and every interior passage is step-free                      | 16       | 10        | 8, 10 and 12   |
      | and an interior passage has "3 steps", with a "ramp" at 200  | 20       | 12.5      | 10, 12.5 and 15 |

  Scenario Outline: A draw by role that cannot be followed is refused before any model call
    Given the configuration is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<it>"

    Examples:
      | change                                                         | it              |
      | the draw asks for 2 "false_claim" venues and the pool has 1    | false_claim     |
      | "cheapest_margin" is [0.95, 0.85]                              | cheapest_margin |
      | "price_gap" is [0, 0.5]                                        | price_gap       |
      | a perturbation names "for_role" "ghost", which no draw fills   | ghost           |
