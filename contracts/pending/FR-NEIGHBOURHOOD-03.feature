@FR-NEIGHBOURHOOD-03
Feature: Same-kind shares

  Background:
    Given the neighbourhood scenario with a grid 3 cells wide and 3 cells high
    And residents of kind "teal" at 0, 0 and 1, 0, and of kind "amber" at 2, 0 and 0, 2

  Scenario: Each resident's share is the share of its neighbours of its own kind
    Then the share of the resident at 0, 0 is 1
    And the share of the resident at 1, 0 is 0.5
    And the share of the resident at 2, 0 is 0
    And the resident at 0, 2 has no share, because it has no neighbour

  Scenario: Segregation is the mean of the shares
    Then the segregation is 0.5

  Scenario: Moves count the applied moves
    Given resident at 0, 2 moves to 1, 1
    Then the moves metric is 1
