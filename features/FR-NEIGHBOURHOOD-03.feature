@FR-NEIGHBOURHOOD-03
Feature: Same-kind shares

  Background:
    Given the neighbourhood scenario with a grid 3 cells wide and 3 cells high

  Scenario: Each resident's share is the share of its neighbours of its own kind
    Given residents of kind "teal" at 0, 0 and 1, 0, and of kind "amber" at 2, 0 and 0, 2
    Then the share of the resident at 0, 0 is 1
    And the share of the resident at 1, 0 is 0.5
    And the share of the resident at 2, 0 is 0
    And the resident at 0, 2 has no share, because it has no neighbour

  Scenario: Segregation is the mean of the shares
    Given residents of kind "teal" at 0, 0 and 1, 0, and of kind "amber" at 2, 0 and 0, 2
    Then the segregation is 0.5

  Scenario: Moves count only the moves applied
    Given residents of kind "teal" at 0, 0 and 1, 0, and of kind "amber" at 2, 0 and 0, 2
    And the resident at 0, 2 runs on a scripted model that calls "move" with dx 1 and dy -1, then calls "move" with dx 1 and dy -1, then ends without a tool call
    When the run ends
    Then the moves metric is 1

  Scenario: Segregation has no value when no resident has a neighbour
    Given residents of kind "teal" at 0, 0 and of kind "amber" at 2, 2
    Then the segregation has no value
