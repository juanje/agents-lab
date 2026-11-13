@FR-CONGRESS-08
Feature: The congress ready for an experiment

  Background:
    Given the congress scenario of FR-CONGRESS-07 with its base configuration, whose calendar starts at "day 1 Monday 08:00" with one segment of scale 60000, so one world hour is 60 milliseconds of the run
    And the variant draws the topic "rural development", the target attendance 67, the board "chair" with funds 1200, the venue "mill-house" in the role "false_claim" and the sponsor "nordtech" in the role "slot"

  Scenario: An experiment sets the population, the parts and the duration keys the base declares
    Given an experiment whose common part sets "attendees" and "parts" to materials, "[mail] send_words_per_minute" to 40 and "[durations] ledger" to 3
    When the experiment's inventory is made
    Then it is not refused, and the inventory gives those values

  Scenario: An experiment adds hours and perturbations, which are open tables
    Given an experiment whose common part adds "[calendar.hours.office]" and "[perturbations.change]", and a condition that adds "[perturbations.late_cancel]"
    When the experiment's inventory is made
    Then it is not refused, and the inventory gives the hours and the three perturbations

  Scenario: Other tables still refuse keys the base lacks
    Given a condition that sets "[mail] colour" to "blue"
    When the experiment's inventory is made
    Then it is refused, with an error that names "mail.colour"

  Scenario: The texts are filled with what the replica drew
    Given the "task" text is "Organise a congress on {topic} for about {target} people on {event_day}. The board has {funds} to give; costs are in {{euros}}."
    When the run ends
    Then the organiser's first message from the person reads "Organise a congress on rural development for about 67 people on day 26 Friday. The board has 1200 to give; costs are in {euros}."

  Scenario: The directory lists every drawn party and how to deal with it
    Given the "knowledge" text is "Who is who:\n{directory}"
    When the run ends
    Then the organiser's system prompt has one line per drawn party, among them "mill-house", a venue, with a mailbox and a line, taking "ask_quote (date, attendance)", "book (date, rooms, hours)" and its other acts

  Scenario: A name in braces that is not drawn is refused
    Given the "limits" text is "Spend at most {budget}."
    When the run is attempted
    Then it is refused before any model call, with an error that names "budget" and "limits"

  Scenario: A part's actors are named by role and kind, for each replica
    Given the part "p1" has the actors "role:false_claim" and "kind:board"
    When the run ends
    Then "p1"'s effort counts the organiser's calls naming "mill-house" or "chair"

  Scenario: A role no draw fills is refused for a part
    Given the part "p1" has the actor "role:ghost"
    When the run is attempted
    Then it is refused before any model call, with an error that names "p1"

  Scenario: A ring wakes a resting organiser, and a mail notice does not
    Given the organiser's rhythm wakes it every 10 world hours and its scripted turns, each activation, call "check_time", then end
    And "nordtech" calls the organiser at "day 1 Monday 10:00" and mails it at "day 1 Monday 11:00"
    When the run's time limit passes at "day 1 Monday 14:00"
    Then the organiser started an activation at "day 1 Monday 10:00", within one world hour, with the ring among its stimuli
    And no activation started between "day 1 Monday 10:30" and "day 1 Monday 14:00"

  Scenario: The inventory lists only the tools the organiser is offered
    When the experiment's inventory is made
    Then the organiser's tools in the inventory are exactly those its session is offered, and do not include "transfer", "commit", "release" or "approve"

  # Approved addition (2026-11-13): a fuller, shorter directory. Appended to FR-CONGRESS-08.feature when the FR is reopened.

  Scenario: The directory gives each kind's acts once, then each party with what anyone could know of it
    Given the variant draws the speakers "ana-ruiz" (title "Soil and water", home "north") and "ben-ott" (title "Village shops", home "local"), the caterer "library-cafe", in-house for "old-library", and the partner "lena-ford"
    And the "knowledge" text is "{directory}"
    When the run ends
    Then the organiser's system prompt gives the speakers' acts once
    And the lines "ana-ruiz", a speaker, "Soil and water", from "north"; "ben-ott", a speaker, "Village shops", local; and "library-cafe", a caterer, in-house for "old-library"
    And no line for "lena-ford"
