@FR-WORKPLACE-03
Feature: The task comes from a person, and each text has a declared place

  Background:
    Given the workplace scenario, whose configuration sets "identity" to "You are the assistant at the depot.", "world_rules" to "Things stay where they are put.", "norms" to "Lost things go to the register.", "rules" to "Record every delivery.", "task" to "Sort today's arrivals." and "task_giver" to "Aldous Penn, the keeper"
    And the worker runs on a scripted model that ends every turn without a tool call, for 2 activations

  Scenario: By default the task comes from the person and the other texts are in the system prompt
    When the run ends
    Then the worker's system prompt is "You are the assistant at the depot.", then "Things stay where they are put.", then "Lost things go to the register.", then "Record every delivery.", each separated by a blank line
    And the worker's first activation received the rhythm's stimulus, then "Sort today's arrivals." from "Aldous Penn, the keeper" on the channel "person"
    And its second activation received no stimulus on the channel "person"

  Scenario: A text placed with the person moves to the first message and keeps its position
    Given "placement.identity" is "person" and "placement.rules" is "person"
    When the run ends
    Then the worker's system prompt is "Things stay where they are put.", then "Lost things go to the register.", separated by a blank line
    And the person's first message is "You are the assistant at the depot.", then "Record every delivery.", then "Sort today's arrivals.", each separated by a blank line

  Scenario: The task can go in the system prompt, and then no message is sent
    Given "placement.task" is "system"
    When the run ends
    Then the worker's system prompt ends with "Record every delivery.", then "Sort today's arrivals.", separated by a blank line
    And the worker received no stimulus on the channel "person"

  Scenario: The worker's notes go to the task giver
    Given the worker's first turn calls "note" with the text "A box arrived open."
    When the run ends
    Then the world holds the note "A box arrived open." to "Aldous Penn, the keeper"

  Scenario: The inventory gives the person's first message beside the system prompt
    Given "placement.rules" is "person"
    When "lab inventory" lists it
    Then the inventory gives the system prompt without "Record every delivery."
    And it gives the person's first message, "Record every delivery.", then "Sort today's arrivals.", from "Aldous Penn, the keeper"

  Scenario: The placement is recorded in the run's setup line
    Given "placement.norms" is "person"
    When the run ends
    Then the run's setup line gives "placement.norms" as "person"

  Scenario Outline: A placement that leaves the system prompt empty, or names an unknown text or place, is refused before any model call
    Given <placement>
    When the run starts
    Then it fails with an error that names <named>
    And no model was called

    Examples:
      | placement                                                                                                         | named               |
      | "placement.identity", "placement.world_rules", "placement.norms" and "placement.rules" are all "person"           | the system prompt   |
      | "placement.motto" is "person"                                                                                     | "placement.motto"   |
      | "placement.rules" is "inbox"                                                                                      | "inbox"             |
