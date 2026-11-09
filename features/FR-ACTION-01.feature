@FR-ACTION-01
Feature: Actions are declared, and unknown answers apply nothing

  Background:
    Given a test world with 3 slots, all empty
    And the declared actions are "take <slot>" and "wait"

  Scenario: An answer that names a declared action with valid arguments is applied
    When agent "a" answers "take 1"
    Then the decision's outcome is "success"
    And slot 1 holds agent "a"

  Scenario: An answer that matches no declared action applies nothing
    When agent "a" answers "fly to slot 1"
    Then the decision's outcome is "unparsed"
    And every slot is empty
    And the world's version is 0

  Scenario: An answer that names a declared action with arguments it does not take applies nothing
    When agent "a" answers "take seven"
    Then the decision's outcome is "invalid_arguments"
    And every slot is empty
