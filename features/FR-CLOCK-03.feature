@FR-CLOCK-03
Feature: A calendar, clock segments and hours

  Background:
    Given a test scenario with one agent and a sensor "now" that gives the world's time to the minute, as "day <n> <weekday> HH:MM"
    And the configuration's calendar starts at "day 1 Friday 17:00"
    And its first segment has the scale 600 until "day 1 17:10", so one world minute is 100 milliseconds of the run and the segment takes 1000
    And its second segment has the scale 300, so one world minute is 200 milliseconds of the run

  Scenario Outline: The world's time follows the segments
    Given the agent's scripted turns wait <ms> milliseconds, then call "now" with a run-time duration of 0, then end
    When the run ends
    Then the "now" call's result is "<world time>"

    Examples:
      | ms   | world time         |
      | 0    | day 1 Friday 17:00 |
      | 250  | day 1 Friday 17:02 |
      | 1050 | day 1 Friday 17:10 |
      | 1500 | day 1 Friday 17:12 |

  Scenario: A duration in world time takes the run time it spans, segment by segment
    Given a sensor "slow" whose duration is 15 world minutes and that gives the world's time when it ends
    And the agent's scripted turns wait 250 milliseconds, then call "slow", then end
    When the run ends
    Then the "slow" call took 2250 milliseconds of the run, within 30: 750 in the first segment and 1500 in the second
    And its result is "day 1 Friday 17:17"

  Scenario: A duration in run time stays as it is
    Given a sensor "fast" whose duration is 300 milliseconds of the run and that gives the world's time when it ends
    And the agent's scripted turns call "fast", then end
    When the run ends
    Then the "fast" call took 300 milliseconds of the run, within 30
    And its result is "day 1 Friday 17:03"

  Scenario: Days and weekdays follow each other
    Given the configuration's calendar starts at "day 1 Sunday 23:58" with one segment of scale 600
    And the agent's scripted turns wait 350 milliseconds, then call "now" with a run-time duration of 0, then end
    When the run ends
    Then the "now" call's result is "day 2 Monday 00:01"

  Scenario Outline: The engine says whether a time is within a set of hours, and when they next begin
    Given the calendar declares the hours "office" on Monday, Tuesday, Wednesday, Thursday and Friday from "09:00" to "18:00", with the calendar starting at "day 1 Friday 17:00"
    When the engine is asked about "office" at "<world time>"
    Then it answers within: <within>, next beginning at "<next>"

    Examples:
      | world time             | within | next                  |
      | day 1 Friday 17:30:00  | yes    | day 4 Monday 09:00:00 |
      | day 1 Friday 18:00:00  | no     | day 4 Monday 09:00:00 |
      | day 2 Saturday 10:00:00| no     | day 4 Monday 09:00:00 |
      | day 4 Monday 08:59:00  | no     | day 4 Monday 09:00:00 |
      | day 4 Monday 09:00:00  | yes    | day 5 Tuesday 09:00:00|

  Scenario: A component's cycle gets the world's time
    Given a component "bell" whose cycle records the world's time it is given, acting every 5 world minutes, 3 times
    When the run ends
    Then "bell" recorded, to the minute, "day 1 Friday 17:00", "day 1 Friday 17:05" and "day 1 Friday 17:10"

  Scenario: The workplace's one-scale clock gives the times it gave before
    Given the workplace scenario of FR-WORKPLACE-05's first scenario, with "[day] start" "09:00" and "time_scale" 600
    When the run ends
    Then the "check_time" call's result is "09:01"

  Scenario: The inventory gives the calendar
    When the inventory is made
    Then it gives the start "day 1 Friday 17:00", the first segment with scale 600 until "day 1 17:10" taking 1000 milliseconds of the run, and the second with scale 300 "until the run ends"

  Scenario Outline: A calendar that cannot be followed is refused before any model call
    Given the configuration's calendar is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<key>"

    Examples:
      | change                                                           | key                         |
      | its start is "Friday 17:00"                                      | calendar.start              |
      | its start's weekday is "Fri"                                     | calendar.start              |
      | its start's day is 0                                             | calendar.start              |
      | the first segment's scale is 0                                   | calendar.segments[0].scale  |
      | the first segment's until is "day 1 16:00"                       | calendar.segments[0].until  |
      | the first segment has no until                                   | calendar.segments[0].until  |
      | it has no segments                                               | calendar.segments           |
      | it declares hours "office" from "18:00" to "09:00"               | calendar.hours.office       |
      | it declares hours "office" with no days                          | calendar.hours.office       |
      | it is a workplace configuration that also sets "time_scale"      | calendar                    |
