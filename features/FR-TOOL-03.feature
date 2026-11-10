@FR-TOOL-03
Feature: Sensing takes time and reads the world when it ends

  Background:
    Given a test world with 3 slots, all empty
    And the sensor "look" takes 200 milliseconds and returns which slots are empty and which are held
    And the effector "take" takes no time and puts the agent in a slot, only if that slot is empty, and otherwise fails with "slot_taken"

  Scenario: A sensor call takes its declared duration
    Given agent "a" runs on a scripted model that calls "look", then ends without a tool call
    When the run ends
    Then agent "a"'s "look" call ended at least 200 milliseconds after it started

  Scenario: A sensor reads the world as it is when its duration ends
    Given agent "a" runs on a scripted model that calls "look", then ends without a tool call
    And agent "b" runs on a scripted model that calls "take" with slot 1 while agent "a"'s "look" call is under way
    When the run ends
    Then agent "a"'s "look" call returned slot 1 held

  Scenario: The engine keeps what an agent last sensed, and when
    Given agent "a" runs on a scripted model that calls "look", then ends without a tool call
    When the run ends
    Then the engine's last sensing for agent "a" is the result of its "look" call, at the moment that call ended
