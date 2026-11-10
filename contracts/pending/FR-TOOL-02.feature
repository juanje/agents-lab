@FR-TOOL-02
Feature: Only tool calls act

  Background:
    Given a test world with 3 slots, all empty
    And the effector "take" puts the agent in a slot, only if that slot is empty, and otherwise fails with "slot_taken"

  Scenario: Text the agent writes changes nothing
    Given agent "a" runs on a scripted model that writes "I take slot 1." and makes no tool call
    When the run ends
    Then every slot is empty
    And agent "a"'s reflection "I take slot 1." was recorded

  Scenario Outline: A call with arguments the tool does not take applies nothing
    Given agent "a" runs on a scripted model that calls "take" with the arguments <arguments>, then ends without a tool call
    When the run ends
    Then agent "a"'s "take" call has the outcome "invalid_arguments"
    And the call is kept with the arguments <arguments>, as the model made it
    And every slot is empty

    Examples:
      | arguments          |
      | {"slot": "seven"}  |
      | {}                 |
      | {"slot": 1, "x": 2} |
