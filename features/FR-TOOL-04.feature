@FR-TOOL-04
Feature: Acting takes time, and its effect is checked when it lands

  Background:
    Given a test world with 3 slots, all empty
    And the sensor "look" takes no time and returns which slots are empty and which are held
    And the effector "take" takes 300 milliseconds, puts the agent in a slot when it lands, and fails with "slot_taken" when the slot is held when it lands
    And the target of "take", in the agent's last sensing, is the slot it names

  Scenario: An effect is applied when the effector's duration ends
    Given agent "a" runs on a scripted model that calls "take" with slot 1, then ends without a tool call
    When the run ends
    Then slot 1 was still empty 150 milliseconds after agent "a"'s "take" call started
    And slot 1 holds agent "a"
    And agent "a"'s "take" call ended at least 300 milliseconds after it started

  Scenario: The agent is busy until its effector ends
    Given agent "a" runs on a scripted model that calls "take" with slot 1, then ends without a tool call
    When the run ends
    Then agent "a"'s second model turn began after its "take" call ended

  Scenario Outline: A collision fails the same way whatever the agent sensed, and what it sensed is recorded beside it
    Given <before>
    And agent "a" runs on a scripted model that <calls>, then ends without a tool call
    When the run ends
    Then agent "a"'s "take" call failed with "slot_taken"
    And agent "a"'s "take" call recorded its target as sensed: "<sensed>"

    Examples:
      | before                                                                       | calls                                           | sensed     |
      | agent "b"'s "take" of slot 1 lands while agent "a"'s "take" is under way     | calls "look", then calls "take" with slot 1     | free       |
      | agent "b" holds slot 1                                                        | calls "look", then calls "take" with slot 1     | held       |
      | agent "b" holds slot 1                                                        | calls "take" with slot 1 without looking        | not_sensed |
