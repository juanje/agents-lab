@FR-NEIGHBOURHOOD-02
Feature: Residents look and move

  Background:
    Given the neighbourhood scenario with a grid 5 cells wide and 5 cells high, a look radius of 1, looking taking 50 milliseconds, and moving taking 100 milliseconds per cell
    And resident "r1" of kind "teal" is at 0, 0
    And resident "r2" of kind "amber" is at 1, 0
    And resident "r3" of kind "teal" is at 0, 1

  Scenario: Looking shows the resident's window, with kinds, empty cells and the grid's edge marked distinctly
    Given resident "r1" runs on a scripted model that calls "look", then ends without a tool call
    When the run ends
    Then "r1"'s "look" result marks its own cell, the cell at 0, 1 as its own kind, the cell at 1, 0 as the other kind, the cell at 1, 1 as empty, and the cells to the left and above as outside the grid

  Scenario: Moving to an empty cell anywhere in the grid takes the time for the distance
    Given resident "r1" runs on a scripted model that calls "move" with dx 3 and dy 3, then ends without a tool call
    When the run ends
    Then resident "r1" is at 3, 3
    And "r1"'s "move" call ended at least 300 milliseconds after it started

  Scenario: Moving to a held cell fails when the resident arrives
    Given resident "r1" runs on a scripted model that calls "look", then calls "move" with dx 1 and dy 0, then ends without a tool call
    When the run ends
    Then "r1"'s "move" call failed with "cell_full"
    And resident "r1" is still at 0, 0
    And the call recorded its target as sensed: "held"

  Scenario: Moving outside the grid is an invalid target
    Given resident "r1" runs on a scripted model that calls "move" with dx -1 and dy 0, then ends without a tool call
    When the run ends
    Then "r1"'s "move" call failed with "invalid_target"
    And resident "r1" is still at 0, 0

  Scenario: A resident that does not want to move ends its activation
    Given resident "r1" runs on a scripted model that calls "look", then ends without a tool call
    When the run ends
    Then resident "r1" is still at 0, 0
    And "r1" made no "move" call

  Scenario: Looking takes its configured time
    Given resident "r1" runs on a scripted model that calls "look", then ends without a tool call
    When the run ends
    Then "r1"'s "look" call ended at least 50 milliseconds after it started

  Scenario: A move's target as sensed is the cell the last look showed, wherever the resident looked from
    Given resident "r1" runs on a scripted model that calls "look", then calls "move" with dx 0 and dy 2, then calls "move" with dx 1 and dy 0, then ends without a tool call
    When the run ends
    Then resident "r1" is at 1, 2
    And "r1"'s second "move" call recorded its target as sensed: "not_sensed"

  Scenario: Moving towards an edge the resident saw records the target as outside
    Given resident "r1" runs on a scripted model that calls "look", then calls "move" with dx -1 and dy 0, then ends without a tool call
    When the run ends
    Then "r1"'s "move" call failed with "invalid_target"
    And the call recorded its target as sensed: "outside"

  Scenario Outline: A move tells the resident what happened
    Given resident "r1" runs on a scripted model that calls "move" with dx <dx> and dy <dy>, then ends without a tool call
    When the run ends
    Then the result "r1"'s model received for its "move" call says "<text>"

    Examples:
      | dx | dy | text                                                                   |
      | 1  | 1  | You moved.                                                             |
      | 1  | 0  | Someone already lives in that cell; you have not moved.                |
      | -1 | 0  | That cell is beyond the edge of the neighbourhood; you have not moved. |
      | 0  | 0  | You are already in that cell; you have not moved.                      |

  Scenario: A move to the resident's own cell is already_there and applies nothing
    Given resident "r1" runs on a scripted model that calls "move" with dx 0 and dy 0, then ends without a tool call
    When the run ends
    Then "r1"'s "move" call failed with "already_there"
    And resident "r1" is still at 0, 0
    And the world's version did not change
