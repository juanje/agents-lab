@FR-TOOL-02
Feature: Only tool calls act

  Background:
    Given a test world with 3 slots, all empty
    And the sensor "look" returns which slots are empty and which are held
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

  Scenario: A call with an argument the tool does not declare applies nothing, even when the tool's schema lets it through
    Given the effector "take" declares only the argument "slot", and its schema does not forbid others
    And agent "a" runs on a scripted model that calls "take" with the arguments {"slot": 1, "x": 2}, then ends without a tool call
    When the run ends
    Then agent "a"'s "take" call has the outcome "invalid_arguments"
    And the call is kept with the arguments {"slot": 1, "x": 2}, as the model made it
    And every slot is empty
    And the result agent "a"'s model received for its "take" call is marked as an error and says "invalid_arguments: \"take\" takes no argument \"x\""
    And agent "a"'s model was offered "take" with the schema the scenario declares, unchanged

  Scenario: A call to a tool the session does not offer applies nothing
    Given agent "a" runs on a scripted model that calls "fly" with slot 1, then ends without a tool call
    When the run ends
    Then agent "a"'s "fly" call has the outcome "unknown_tool"
    And every slot is empty
    And the run did not stop

  Scenario: A tool acts as the agent that called it, whatever its arguments say
    Given agent "a" runs on a scripted model that calls "take" with the arguments {"slot": 1, "agent": "b"}, then ends without a tool call
    When the run ends
    Then no slot holds agent "b"

  Scenario: A failed call tells the agent it failed, and why
    Given agent "b" holds slot 1
    And agent "a" runs on a scripted model that calls "take" with slot 1, then ends without a tool call
    When the run ends
    Then the result agent "a"'s model received for its "take" call is marked as an error and says "slot_taken"

  Scenario: An effector's result is the text its scenario declares for the outcome
    Given the effector "take" declares the text "Someone already holds that slot; you have not taken it." for "slot_taken" and "You took the slot." for "success"
    And agent "b" holds slot 1
    And agent "a" runs on a scripted model that calls "take" with slot 1, then calls "take" with slot 2, then ends without a tool call
    When the run ends
    Then the result agent "a"'s model received for its first "take" call is marked as an error and says "Someone already holds that slot; you have not taken it."
    And the result it received for its second "take" call is not marked as an error and says "You took the slot."
