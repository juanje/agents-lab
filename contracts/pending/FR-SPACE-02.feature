@FR-SPACE-02
Feature: Moving across the grid takes time in proportion to distance

  Background:
    Given a grid 5 cells wide and 5 cells high, with a capacity of 1 per cell
    And moving takes 100 milliseconds per cell

  Scenario Outline: A move takes the time per cell multiplied by the distance
    Given entity "a" is at 0, 0
    When entity "a" moves to <x>, <y>
    Then the move ended at least <ms> milliseconds after it started
    And entity "a" is at <x>, <y>

    Examples:
      | x | y | ms  |
      | 1 | 0 | 100 |
      | 3 | 0 | 300 |
      | 2 | 2 | 200 |

  Scenario: An entity stays in its cell until its move ends
    Given entity "a" is at 0, 0
    When entity "a" moves to 3, 0
    Then 150 milliseconds after the move started, entity "a" was still at 0, 0 and the cell at 3, 0 was empty

  Scenario: The destination is checked when the entity arrives
    Given entity "a" is at 0, 0
    And entity "b" moves into the cell at 3, 0 while entity "a"'s move there is under way
    When entity "a" moves to 3, 0
    Then entity "a"'s move fails with "cell_full"
    And entity "a" is still at 0, 0
