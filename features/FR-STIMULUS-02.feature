@FR-STIMULUS-02
Feature: An effector's effect can deliver stimuli to other agents

  Background:
    Given a test world with 3 slots, all empty
    And agents "a", "b" and "c"
    And the channel "news" delivers the stimulus "took slot {slot}." from the source "the agent that claims a slot"
    And the effector "claim" takes 100 milliseconds, puts the agent in a slot when it lands, and fails with "slot_taken" when the slot is held when it lands
    And when the effect of "claim" is applied, it delivers on the channel "news", to every other agent, the stimulus with the claimed slot, from the claiming agent as its source
    And the effector "nap" takes 2000 milliseconds, changes nothing, and ends early with the outcome "interrupted" when a stimulus reaches its agent

  Scenario: An applied effect reaches every other agent, with the caller as its source
    Given agent "a" runs on a scripted model that calls "claim" with slot 2, then ends without a tool call
    And agents "b" and "c" run on scripted models whose turns are: the text "Thinking." with no tool call, after 400 milliseconds; the text "Done." with no tool call
    When the run ends
    Then agent "b"'s second model turn received "took slot 2." from "a"
    And agent "c"'s second model turn received "took slot 2." from "a"
    And agent "a" received no stimulus on the channel "news"

  Scenario: Each delivery is a stimulus line in the log
    Given agent "a" runs on a scripted model that calls "claim" with slot 2, then ends without a tool call
    And agents "b" and "c" run on scripted models whose turns are: the text "Thinking." with no tool call, after 400 milliseconds; the text "Done." with no tool call
    When the run ends
    Then the log has a stimulus line for agent "b" and one for agent "c", each with the channel "news", the source "a" and the content "took slot 2."
    And each was delivered no earlier than the end of agent "a"'s "claim" call, and within 50 milliseconds of it

  Scenario: A failed effect delivers nothing
    Given slot 2 is held by "parcel"
    And agent "a" runs on a scripted model that calls "claim" with slot 2, then ends without a tool call
    And agents "b" and "c" run on scripted models whose turns are: the text "Thinking." with no tool call, after 400 milliseconds; the text "Done." with no tool call
    When the run ends
    Then agent "a"'s "claim" call has the outcome "slot_taken"
    And the log has no stimulus line on the channel "news"

  Scenario: A call cut off by the time limit delivers nothing
    Given agent "a" runs on a scripted model that calls "claim" with slot 2, then ends without a tool call
    And agents "b" and "c" run on scripted models that end every turn without a tool call
    And the run's time limit is 50 milliseconds
    When the run ends
    Then agent "a"'s "claim" call has the outcome "cut_off"
    And the log has no stimulus line on the channel "news"

  Scenario: A delivery reaches a resting agent when it next wakes, on a channel that does not wake
    Given agent "a" runs on a scripted model that calls "claim" with slot 2, then ends without a tool call
    And agent "b" waits 600 milliseconds before each activation and ends its first turn without a tool call
    And agent "c" runs on a scripted model that ends every turn without a tool call
    When the run ends
    Then agent "b"'s first activation began no earlier than 600 milliseconds into the run
    And agent "b"'s first activation received "took slot 2." from "a" when it woke

  Scenario: A delivery on a waking channel wakes a resting agent at once
    Given the channel "news" wakes
    And agent "a" runs on a scripted model that calls "claim" with slot 2, then ends without a tool call
    And agent "b" waits 5000 milliseconds before each activation and ends its first turn without a tool call
    And agent "c" runs on a scripted model that ends every turn without a tool call
    When the run ends
    Then agent "b" started an activation within 100 milliseconds after agent "a"'s "claim" call ended, with "took slot 2." from "a" among its stimuli

  Scenario: A delivery ends a call that ends early at a stimulus
    Given agent "a" runs on a scripted model that calls "claim" with slot 2 after 100 milliseconds, then ends without a tool call
    And agent "b" runs on a scripted model that calls "nap" at once, then ends without a tool call
    And agent "c" runs on a scripted model that ends every turn without a tool call
    When the run ends
    Then agent "b"'s "nap" call ended with the outcome "interrupted" within 100 milliseconds after agent "a"'s "claim" call ended

  Scenario: The inventory gives the channel an effector delivers through
    When "lab inventory" lists it
    Then it lists the tool "claim" with the channel "news" it delivers through
    And it lists the channel "news" with the source "the agent that claims a slot" and the text "took slot {slot}."

  Scenario: An effector that delivers through a channel the scenario does not declare is refused before any model call
    Given the effect of "claim" delivers on the channel "rumours" instead, which the scenario does not declare
    When the run is attempted
    Then it is refused before any model call, with an error that names "claim" and "rumours"

  Scenario Outline: A delivery to the caller itself, or to no agent of the run, stops the run
    Given the effect of "claim" delivers to <name> instead
    And agent "a" runs on a scripted model that calls "claim" with slot 2, then ends without a tool call
    And agents "b" and "c" run on scripted models that end every turn without a tool call
    When the run ends
    Then the run stopped with an error that names "claim" and "<recipient>"
    And the log's last line says the run stopped, with that error

    Examples:
      | name                         | recipient |
      | its own caller, "a"          | a         |
      | "z", which is no agent       | z         |
