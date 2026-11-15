@FR-WORKSHOP-05
Feature: Handing over, a clock on the wall, and the character and limits texts

  Background:
    Given the workshop scenario with its base configuration, but the calendar's scale is 600, so one world minute is 100 milliseconds of the run
    And the rhythm's "min_ms" and "max_ms" are 0
    And every worker whose turns are not given ends every turn without a tool call

  # Scenarios that end in a run use scripted workers; scenarios that give a record compute the measures from a world and a
  # record of calls built to match it, each effect landing at its call's end (FR-WORKSHOP-04). Times are world minutes.

  # Handing over

  Scenario: A worker hands another a loose piece, and only the receiver is told
    Given "Dal" holds the loose piece "arn"
    And "Dal"'s scripted turns call "hand" with "arn" to "Mik" at once, then end
    And "Mik" runs on a scripted model whose turns are: the text "Thinking." with no tool call, after 300 milliseconds; the text "Done." with no tool call
    When the run ends
    Then the "hand" call succeeded with the text "You have handed it over."
    And it took at least 50 milliseconds and less than 110
    And "Dal" holds nothing, "Mik" holds the loose piece "arn", and the pile is as it was before it
    And "Mik"'s second model turn received "handed you a piece of arn." from "Dal", which the worker reads as "Dal: handed you a piece of arn."
    And "Dal", "Nar" and "Ren" received nothing on the channel "hands"

  Scenario: A module handed keeps its joined pieces, and counts apart from the loose pieces
    Given "Dal" holds a module "tessa" with "arn" and "arn" joined, and "Mik" holds six loose pieces: "arn", "bex", "cal", "cal", "dov" and "dov"
    And "Dal"'s scripted turns call "hand" with "tessa" to "Mik" at once, then end
    When the run ends
    Then the "hand" call succeeded with the text "You have handed it over."
    And "Mik" holds a module "tessa" with "arn" and "arn" joined, not finished, and its six loose pieces
    And "Dal" holds nothing
    And the log has a stimulus line for "Mik" with the channel "hands", the source "Dal" and the content "handed you the module tessa."

  Scenario: The receiver of a finished module mounts it and is its mounter
    Given "Dal" holds a finished module "tessa"
    And "Dal"'s scripted turns call "hand" with "tessa" to "Mik" at once, then end
    And "Mik"'s scripted turns call "mount" after 100 milliseconds, then end
    When the run ends
    Then "Mik"'s "mount" call succeeded, and "tessa" is mounted
    And the last metric sample gives "builders_by_module" as exactly "tessa.mounted_by.Mik" 1
    And it gives "handovers" as exactly "Dal.modules_to.Mik" 1

  Scenario Outline: A refused hand takes its time, says why, moves nothing and reaches no one
    Given <state>
    And "Dal"'s scripted turns call <call>, then end
    When the run ends
    Then the call failed with "<outcome>" and the text "<text>"
    And it took at least 50 milliseconds and less than 110
    And the pile, the bench and every worker's hands are as they were before it
    And the log has no stimulus line on the channel "hands"

    Examples:
      | state                                                                                                            | call                         | outcome        | text                                                        |
      | "Dal" holds the loose piece "arn"                                                                                | "hand" with "arn" to "Kel"   | no_such_worker | There is no worker of that name; nothing has been handed.   |
      | "Dal" holds the loose piece "arn"                                                                                | "hand" with "arn" to "Dal"   | to_self        | That is you; nothing has been handed.                       |
      | "Dal" holds the loose piece "bex"                                                                                | "hand" with "arn" to "Mik"   | not_held       | You are not holding that; nothing has been handed.          |
      | nobody holds anything                                                                                            | "hand" with "arn" to "Mik"   | not_held       | You are not holding that; nothing has been handed.          |
      | "Dal" holds a module "ulm" with "bex" joined                                                                     | "hand" with "tessa" to "Mik" | not_held       | You are not holding that; nothing has been handed.          |
      | "Dal" holds the loose piece "eln", and "Mik" holds six loose pieces: "arn", "arn", "bex", "cal", "dov" and "dov" | "hand" with "eln" to "Mik"   | hands_full     | Their hands are full; nothing has been handed.              |
      | "Dal" holds a finished module "tessa", and "Mik" holds a module "ulm" with "bex" joined                          | "hand" with "tessa" to "Mik" | holds_module   | They are already holding a module; nothing has been handed. |

  Scenario: A hand is checked when it lands, not when it starts
    Given "hand" takes 2 world minutes
    And "Dal" holds the loose piece "eln", and "Mik" holds five loose pieces: "arn", "arn", "cal", "dov" and "dov"
    And "Dal"'s scripted turns call "hand" with "eln" to "Mik" at once, then end
    And "Mik"'s scripted turns call "take" with "bex" after 50 milliseconds, then end
    When the run ends
    Then "Mik"'s "take" call succeeded
    And "Dal"'s "hand" call failed with "hands_full" and the text "Their hands are full; nothing has been handed."
    And "Dal" holds the loose piece "eln"

  Scenario: Look shows the giver handing while its call lasts
    Given "hand" takes 2 world minutes
    And "Dal" holds the loose piece "arn"
    And "Dal"'s scripted turns call "hand" with "arn" to "Nar" at once, then end
    And "Mik"'s scripted turns call "look" at once, then end
    When the run ends
    Then "Mik"'s "look" shows "Dal" doing "handing"

  Scenario: A hand wakes a resting receiver at once
    Given "Nar"'s rhythm keeps it resting 5000 milliseconds before each activation, and the others' 0
    And "Dal" holds the loose piece "arn"
    And "Dal"'s scripted turns call "hand" with "arn" to "Nar" after 100 milliseconds, then end
    When the run ends
    Then "Nar" started an activation within 100 milliseconds after the "hand" call ended, with "handed you a piece of arn." from "Dal" among its stimuli

  Scenario: A hand ends the receiver's wait
    Given "Dal" holds the loose piece "arn"
    And "Ren"'s scripted turns call "wait" with 10 minutes at once, then end
    And "Dal"'s scripted turns call "hand" with "arn" to "Ren" after 100 milliseconds, then end
    When the run ends
    Then "Ren"'s "wait" call ended with the outcome "interrupted" and the text "Something reached you; you stopped waiting."
    And it ended within 50 milliseconds after the "hand" call ended
    And "Ren" holds the loose piece "arn"

  Scenario: A hand cut off by the time limit moves nothing and reaches no one
    Given "hand" takes 2 world minutes
    And the run's time limit is 100 milliseconds
    And "Dal" holds the loose piece "arn"
    And "Dal"'s scripted turns call "hand" with "arn" to "Mik" at once, then end
    When the run ends
    Then the "hand" call has the outcome "cut_off"
    And "Dal" holds the loose piece "arn", and "Mik" holds nothing
    And the log has no stimulus line on the channel "hands"

  Scenario: The log gives each hand call, its start and the stimulus the receiver got
    Given "Dal" holds the loose piece "arn"
    And "Dal"'s scripted turns call "hand" with "arn" to "Mik" at once, then end
    When the run ends
    Then the log has a tool call line for "Dal"'s "hand" call, with its outcome and the text "Dal" received
    And it has an "effector_start" line naming that "Dal" began handing
    And the log has a stimulus line for "Mik" with the channel "hands", the source "Dal" and the content "handed you a piece of arn."
    And it was delivered no earlier than the end of the "hand" call, and within 50 milliseconds of it
    And the log has no stimulus line on the channel "hands" for "Dal", "Nar" or "Ren"

  Scenario: The inventory gives the hand tool, its duration and the hands channel
    When "lab inventory" lists it
    Then each worker's tools include "hand", with its duration as 0.5 world minutes, and its texts
    And it gives the duration "hand" as 0.5 world minutes among the durations
    And it lists the channel "hands" with the source "the giver", the text "handed you <what>.", and that it wakes
    And it lists the tool "hand" with the channel "hands" it delivers through
    And no tool's description or parameters hold any of "Dal", "Mik", "Nar" or "Ren"

  Scenario: A configuration with a negative hand duration is refused before any model call
    Given the configuration is changed so that the duration of "hand" is -1
    When the run is attempted
    Then it is refused before any model call, with an error that names "durations.hand"

  Scenario: Handovers, and how the split reads a handed module, from a record
    Given the workshop starts with "Dal" holding the loose pieces "arn", "arn" and "bex", "Mik" holding a module "tessa" with "arn", "arn", "bex" and "cal" joined and a loose "dov", "Ren" holding the loose piece "cal", and the rest in the pile
    And the record holds these calls:
      | worker | start | end | tool  | arguments  | outcome  |
      | Dal    | 0     | 0.5 | hand  | Nar, arn   | success  |
      | Mik    | 0     | 2   | join  | tessa, dov | success  |
      | Dal    | 0.5   | 1   | hand  | Nar, arn   | success  |
      | Dal    | 1     | 1.5 | hand  | Ren, bex   | success  |
      | Nar    | 1     | 1.5 | hand  | Dal, cal   | not_held |
      | Dal    | 1.5   | 2   | hand  | Dal, arn   | to_self  |
      | Mik    | 2     | 2.5 | hand  | Ren, tessa | success  |
      | Ren    | 3     | 6   | mount |            | success  |
    When the measures are computed
    # Mik's join finished tessa at 2; Ren was handed it at 2.5 and mounted it, its mount starting at 3.
    # At the end Nar holds two loose arn and Ren a loose cal and bex: 4 pieces wasted.
    Then "handovers" gives exactly "Dal.pieces_to.Nar" 2, "Dal.pieces_to.Ren" 1 and "Mik.modules_to.Ren" 1
    And "builders_by_module" gives exactly "tessa.joined_by.Mik" 1 and "tessa.mounted_by.Ren" 1
    And "modules_by_worker" gives "Mik.finished" 1, "Ren.mounted" 1, and 0 for every other worker's "finished" and "mounted"
    And "finish_to_mount" gives "tessa" 1
    And "pieces_wasted" is 4
    And "refused_by_cause" gives exactly "hand.not_held" 1 and "hand.to_self" 1
    And "time_by_activity" gives "Dal.hand" 2, "Mik.hand" 0.5 and "Nar.hand" 0.5

  Scenario: Duplicated modules and module switches with handed modules, from a record
    Given the workshop starts with "Dal" holding the loose pieces "arn" and "cal", "Mik" holding the loose pieces "bex", "bex" and "dov", and the rest in the pile
    And the record holds these calls:
      | worker | start | end | tool | arguments  | outcome |
      | Dal    | 0     | 2   | join | tessa, arn | success |
      | Mik    | 0     | 2   | join | ulm, bex   | success |
      | Mik    | 2     | 2.5 | hand | Ren, ulm   | success |
      | Dal    | 2.5   | 3   | hand | Mik, tessa | success |
      | Mik    | 3     | 5   | join | tessa, bex | success |
      | Dal    | 3     | 5   | join | vorn, cal  | success |
      | Mik    | 5     | 7   | join | tessa, dov | success |
    When the measures are computed
    # One instance each of tessa (Dal's), ulm (Mik's) and vorn (Dal's): Mik's joins into the tessa it was handed start none.
    # Dal switched from tessa to vorn; Mik from ulm to tessa. Wasted: Ren's ulm 1, Mik's tessa 3, Dal's vorn 1.
    Then "duplicated_modules" is 0
    And "module_switches" gives "Dal" 1, "Mik" 1, "Nar" 0 and "Ren" 0
    And "builders_by_module" gives exactly "tessa.joined_by.Dal" 1, "tessa.joined_by.Mik" 1, "ulm.joined_by.Mik" 1 and "vorn.joined_by.Dal" 1
    And "handovers" gives exactly "Mik.modules_to.Ren" 1 and "Dal.modules_to.Mik" 1
    And "pieces_wasted" is 5

  Scenario: Handovers have no key at the start of a run
    When the run ends
    Then the first metric sample gives "handovers" as no key

  # A clock on the wall

  Scenario: Look gives the clock first, and the room as before
    Given the replica's draw lists the kinds as "gor, arn, fim, bex, dov, cal, eln", the workers as "Ren, Dal, Nar, Mik" and the modules as "zeth, ulm, wick, tessa, yarl, vorn"
    And "Dal"'s scripted turns call "wait" with 2 minutes at once, then "look", then end
    When the run ends
    Then "Dal"'s "look" result is this JSON:
      """
      {"clock": 2,
       "pile": {"gor": 2, "arn": 4, "fim": 2, "bex": 3, "dov": 5, "cal": 4, "eln": 2},
       "bench": {"mounted": [], "places": [null, null]},
       "workers": [
         {"name": "Ren", "loose": {}, "module": null, "doing": "nothing"},
         {"name": "Dal", "loose": {}, "module": null, "doing": "nothing"},
         {"name": "Nar", "loose": {}, "module": null, "doing": "nothing"},
         {"name": "Mik", "loose": {}, "module": null, "doing": "nothing"}]}
      """

  Scenario Outline: The clock gives whole world minutes since the start, rounded down
    Given "Dal"'s scripted turns <turns>
    When the run ends
    Then "Dal"'s "look" shows the clock as <clock>

    Examples:
      | turns                                                       | look ends at | clock |
      | call "look" at once, then end                               | 0.5          | 0     |
      | call "wait" with 2.1 minutes at once, then "look", then end | 2.6          | 2     |
      | call "wait" with 3 minutes at once, then "look", then end   | 3.5          | 3     |

  Scenario: Look's description gives the clock
    When "lab inventory" lists it
    Then the tool "look"'s description says it gives the clock, in whole minutes since the start

  # Two more texts

  Scenario: In the base, character and limits are empty and add nothing to the system prompt
    When the engine loads it with the seed 42
    Then worker "Dal"'s system prompt is the text of "identity.md" with "{name}" as "Dal", then the text of "task.md", then the text of "world-rules.md", each separated by a blank line
    And the inventory gives the texts "character" and "limits" as empty, each placed as "system"

  Scenario: The system prompt joins identity, character, task, limits and world rules, with the worker's name
    Given the configuration sets "character" to "You are {name}, practical and hands-on." and "limits" to "Only {name} and three others work here."
    When the engine loads it with the seed 42
    Then worker "Dal"'s system prompt is, each separated by a blank line: the identity with "{name}" as "Dal", "You are Dal, practical and hands-on.", the task, "Only Dal and three others work here.", and the world rules
    And worker "Ren"'s system prompt holds "You are Ren, practical and hands-on." and "Only Ren and three others work here."

  Scenario: An empty text leaves no blank section
    Given the configuration sets "limits" to "The workshop closes 90 minutes after you start."
    When the engine loads it with the seed 42
    Then worker "Dal"'s system prompt is, each separated by a blank line: the identity with "{name}" as "Dal", the task, "The workshop closes 90 minutes after you start.", and the world rules
    And it holds no three line breaks in a row

  Scenario: Texts placed first join in the same order, in one message as the worker first wakes
    Given the configuration sets "character" to "You are {name}, practical and hands-on." and "limits" to "Only {name} and three others work here."
    And the configuration places "character" as "first", places "task" as "first" and sets "order_source" to "the order on the wall"
    And worker "Dal" makes 1 activation, ending its first turn without a tool call
    And the other workers' scripted models end every turn without a tool call
    When the run ends
    Then worker "Dal"'s system prompt is, each separated by a blank line: the identity with "{name}" as "Dal", "Only Dal and three others work here.", and the world rules
    And worker "Dal"'s first activation received, right after its rhythm's stimulus, "You are Dal, practical and hands-on.", a blank line and the text of "task.md", from "the order on the wall" on the channel "order"

  Scenario Outline: A character or limits text the workshop cannot build is refused before any model call
    Given the configuration is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names <named>

    Examples:
      | change                            | named                    |
      | "character" holds "{team}"        | "character" and "{team}" |
      | "limits" holds "{closing}"        | "limits" and "{closing}" |
      | "character" is placed as "person" | "placement.character"    |
      | "limits" is placed as "wall"      | "placement.limits"       |
