@FR-INVENTORY-01
Feature: The environment inventory is generated, not written by hand

  Background:
    Given an experiment file "e-test" for the test scenario "slots", with agents "a" and "b", the model "scripted/one", 3 activations per agent, a time limit of 1000 milliseconds, a parallelism limit of 2, a model turn timeout of 500 milliseconds, and the conditions "baseline", with no change, and "five-slots", which sets "slots.count" to 5

  Scenario: The inventory lists, for each condition, what the agents meet
    When "lab inventory" runs on the experiment file
    Then it prints a section for the condition "baseline" and one for "five-slots"
    And each section gives agent "a"'s and agent "b"'s system prompts and rhythms, as the scenario gives them in that condition
    And each section lists the tools "look" and "take", each with its kind, the description and parameters its agents see, its duration as the scenario describes it, and the text its agents receive for each outcome
    And each section lists the channel "rhythm" with its source and text
    And each section gives the model "scripted/one" and the limits

  Scenario: The inventory follows the condition
    Given the test scenario "slots" describes the duration of "take" from "slots.take_ms" in its configuration
    And the condition "five-slots" also sets "slots.take_ms" to 300
    When "lab inventory" runs on the experiment file
    Then the section for "five-slots" describes the duration of "take" with 300 milliseconds
    And the section for "baseline" does not

  Scenario: What the engine does not provide yet is listed as none, and perception is instant
    When "lab inventory" runs on the experiment file
    Then each section lists the energy model, the environment processes and each tool's effort as "none"
    And each section says that every sensor and channel is instant

  Scenario: The inventory needs no model and runs nothing
    When "lab inventory" runs on the experiment file
    Then no model was called
    And no run log was written

  Scenario: The inventory lists the outcomes the engine itself can give
    When "lab inventory" runs on the experiment file
    Then each section lists, besides each tool's own outcomes, the outcomes the engine gives: "invalid_arguments", with the harness's explanation, "unknown_tool" and "cut_off"
