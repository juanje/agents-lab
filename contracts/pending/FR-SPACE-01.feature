@FR-SPACE-01
Feature: A grid space

  Background:
    Given a grid 5 cells wide and 5 cells high, with a capacity of 1 per cell

  Scenario Outline: A cell's neighbours are the cells around it inside the grid
    Then the cell at <x>, <y> has <count> neighbours

    Examples:
      | x | y | count |
      | 2 | 2 | 8     |
      | 0 | 2 | 5     |
      | 0 | 0 | 3     |

  Scenario: A window marks the cells outside the grid
    When I take the window of radius 1 around the cell at 0, 0
    Then the window has 9 cells
    And 5 of them are marked as outside the grid

  Scenario: A random empty cell is drawn from the empty ones
    Given every cell holds an entity except the cell at 3, 4
    When I ask for a random empty cell
    Then I get the cell at 3, 4

  Scenario: A full grid has no empty cell
    Given every cell holds an entity
    When I ask for a random empty cell
    Then I get no cell

  Scenario: Moving into a full cell fails and leaves the entity where it was
    Given entity "a" is at 1, 1 and entity "b" is at 1, 2
    When entity "a" moves to 1, 2
    Then the move fails with "cell_full"
    And entity "a" is still at 1, 1
