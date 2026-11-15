@FR-WORKSHOP-03
Feature: Workers speak to the room

  Background:
    Given the workshop scenario with its base configuration, but the calendar's scale is 600, so one world minute is 100 milliseconds of the run
    And the rhythm's "min_ms" and "max_ms" are 0
    And every worker whose turns are not given ends every turn without a tool call

  Scenario: Every other worker hears what a worker says, from its name
    Given "Dal"'s scripted turns call "say" with "Mik, take ulm." at once, then end
    And "Mik", "Nar" and "Ren" each run on scripted models whose turns are: the text "Thinking." with no tool call, after 300 milliseconds; the text "Done." with no tool call
    When the run ends
    Then the "say" call succeeded with the text "You have said it."
    And "Mik"'s, "Nar"'s and "Ren"'s second model turns each received "Mik, take ulm." from "Dal", which the worker reads as "Dal: Mik, take ulm."
    And "Dal" received nothing on the channel "voice"

  Scenario: Each speech heard is a stimulus line for each listener
    Given "Dal"'s scripted turns call "say" with "Mik, take ulm." at once, then end
    When the run ends
    Then the log has a stimulus line for each of "Mik", "Nar" and "Ren", with the channel "voice", the source "Dal" and the content "Mik, take ulm."
    And each was delivered no earlier than the end of the "say" call, and within 50 milliseconds of it
    And the log has no stimulus line on the channel "voice" for "Dal"

  Scenario Outline: Speaking takes time in proportion to the words
    Given "Dal"'s scripted turns call "say" with the text of <words> words, "<text>", then end
    When the run ends
    Then the "say" call took at least <ms> milliseconds and less than <ms> + 60

    Examples:
      | words | ms  | text                                                                                                                                                   |
      | 3     | 35  | Mik, take ulm.                                                                                                                                         |
      | 30    | 125 | We should split the work so that each of us builds one module at a time and mounts it when the module it needs first is already on the bench          |

  Scenario: A worker in a tool call hears it at its next model turn
    Given "Mik"'s scripted turns call "take" with "bex" at once, then the text "Done." with no tool call
    And "Dal"'s scripted turns call "say" with "Mik, take ulm." at once, then end
    When the run ends
    Then "Mik"'s "take" call succeeded
    And "Mik"'s second model turn received "Mik, take ulm." from "Dal"

  Scenario: Speech wakes a resting worker at once
    Given "Nar"'s rhythm keeps it resting 5000 milliseconds before each activation, and the others' 0
    And "Dal"'s scripted turns call "say" with "Nar, start zeth." after 100 milliseconds, then end
    When the run ends
    Then "Nar" started an activation within 100 milliseconds after the "say" call ended, with "Nar, start zeth." from "Dal" among its stimuli

  Scenario: Speech ends a wait
    Given "Ren"'s scripted turns call "wait" with 10 minutes at once, then end
    And "Dal"'s scripted turns call "say" with "Mik, take ulm." after 100 milliseconds, then end
    When the run ends
    Then "Ren"'s "wait" call ended with the outcome "interrupted" and the text "Something reached you; you stopped waiting."
    And it ended within 50 milliseconds after the "say" call ended

  Scenario: Look shows a worker speaking while its call lasts
    Given "Dal"'s scripted turns call "say" with the text of 30 words, "We should split the work so that each of us builds one module at a time and mounts it when the module it needs first is already on the bench", at once, then end
    And "Mik"'s scripted turns call "look" at once, then end
    When the run ends
    Then "Mik"'s "look" shows "Dal" doing "speaking"

  Scenario: Two workers speaking at once each reach every other
    Given "Dal"'s scripted turns call "say" with "I build tessa." at once, then end
    And "Mik"'s scripted turns call "say" with "I build vorn." at once, then end
    When the run ends
    Then "Nar" and "Ren" each received "I build tessa." from "Dal" and "I build vorn." from "Mik"
    And "Dal" received "I build vorn." from "Mik", and "Mik" received "I build tessa." from "Dal"

  Scenario Outline: A text with no word is refused after its base time and reaches no one
    Given "Dal"'s scripted turns call "say" with the text <text>, then end
    When the run ends
    Then the "say" call failed with "empty_text" and the text "You said nothing; nobody heard anything."
    And it took at least 25 milliseconds and less than 85
    And the log has no stimulus line on the channel "voice"

    Examples:
      | text         |
      | ""           |
      | "   "        |
      | "\n  "       |

  Scenario: A speech cut off by the time limit reaches no one
    Given the run's time limit is 60 milliseconds
    And "Dal"'s scripted turns call "say" with the text of 30 words, "We should split the work so that each of us builds one module at a time and mounts it when the module it needs first is already on the bench", at once, then end
    When the run ends
    Then the "say" call has the outcome "cut_off"
    And the log has no stimulus line on the channel "voice"

  Scenario: The inventory gives the say tool and the voice channel
    When "lab inventory" lists it
    Then each worker's tools include "say", with its duration as 0.25 world minutes plus one minute per 30 words, and its texts
    And it lists the channel "voice" with the source "the speaker", the text "what was said", and that it wakes
    And it lists the tool "say" with the channel "voice" it delivers through
