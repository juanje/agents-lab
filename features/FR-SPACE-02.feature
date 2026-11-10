@FR-SPACE-02
Feature: Moving across the grid takes time in proportion to distance

  Background:
    Given a test grid world 5 cells wide and 5 cells high, with a capacity of 1 per cell
    And the effector "walk" moves the calling agent to a cell, taking 100 milliseconds per cell of distance, and fails with "cell_full" when the cell is held when it arrives
    And agent "a" is at 0, 0

  Scenario Outline: A move takes the time per cell multiplied by the distance
    Given agent "a" runs on a scripted model that calls "walk" to <x>, <y>, then ends without a tool call
    When the run ends
    Then agent "a"'s "walk" call ended at least <ms> milliseconds after it started
    And agent "a" is at <x>, <y>

    Examples:
      | x | y | ms  |
      | 1 | 0 | 100 |
      | 3 | 0 | 300 |
      | 2 | 2 | 200 |

  Scenario: An agent stays in its cell until its move ends
    Given agent "a" runs on a scripted model that calls "walk" to 3, 0, then ends without a tool call
    When the run ends
    Then 150 milliseconds after agent "a"'s "walk" call started, agent "a" was still at 0, 0 and the cell at 3, 0 was empty

  Scenario: The destination is checked when the agent arrives
    Given agent "b" is at 2, 0
    And agent "a" runs on a scripted model that calls "walk" to 3, 0, then ends without a tool call
    And agent "b" runs on a scripted model that calls "walk" to 3, 0 while agent "a"'s "walk" is under way, then ends without a tool call
    When the run ends
    Then agent "b"'s "walk" call succeeded
    And agent "a"'s "walk" call failed with "cell_full"
    And agent "a" is still at 0, 0
