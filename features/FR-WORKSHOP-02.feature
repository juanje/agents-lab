@FR-WORKSHOP-02
Feature: The workers' tools

  Background:
    Given the workshop scenario with its base configuration, but the calendar's scale is 600, so one world minute is 100 milliseconds of the run
    And the rhythm's "min_ms" and "max_ms" are 0
    And the replica's draw lists the kinds as "gor, arn, fim, bex, dov, cal, eln", the workers as "Ren, Dal, Nar, Mik" and the modules as "zeth, ulm, wick, tessa, yarl, vorn"
    And every worker whose turns are not given ends every turn without a tool call

  Scenario: Each worker has the workshop's tools, which name no kind and no module
    When "lab inventory" lists it
    Then each worker's tools are "look", "read_plan", "take", "put_back", "join", "take_apart", "mount" and "wait", each with its duration in world minutes and its texts
    And no tool's description or parameters hold any of "arn", "bex", "cal", "dov", "eln", "fim", "gor", "tessa", "ulm", "vorn", "wick", "yarl" or "zeth"

  Scenario: Look gives the room as it is when the call ends, in the drawn orders
    Given "Dal" holds the loose pieces "arn" and "arn" and a module "tessa" with "bex" joined, and the pile holds the rest
    And "Mik"'s scripted turns call "take" with "dov" at once, then end
    And "Dal"'s scripted turns call "look" at once, then end
    When the run ends
    Then "Dal"'s "look" result is this JSON:
      """
      {"clock": 0,
       "pile": {"gor": 2, "arn": 2, "fim": 2, "bex": 2, "dov": 5, "cal": 4, "eln": 2},
       "bench": {"mounted": [], "places": [null, null]},
       "workers": [
         {"name": "Ren", "loose": {}, "module": null, "doing": "nothing"},
         {"name": "Dal", "loose": {"arn": 2}, "module": {"name": "tessa", "joined": ["bex"], "finished": false}, "doing": "nothing"},
         {"name": "Nar", "loose": {}, "module": null, "doing": "nothing"},
         {"name": "Mik", "loose": {}, "module": null, "doing": "taking"}]}
      """

  Scenario: Look shows who occupies the bench while a mount is under way, and the module once it is mounted
    Given "Dal" holds a finished module "tessa"
    And "Dal"'s scripted turns call "mount" at once, then end
    And "Mik"'s scripted turns call "look" after 100 milliseconds, then call "look" after 250 milliseconds, then end
    When the run ends
    Then "Mik"'s first "look" shows the bench places as "Dal" and null, nothing mounted, and "Dal" doing "mounting" with the module "tessa"
    And "Mik"'s second "look" shows the bench places as null and null, "tessa" mounted, and "Dal" doing "nothing" with no module

  Scenario: Read_plan gives the plan in the drawn order
    Given "Dal"'s scripted turns call "read_plan", then end
    When the run ends
    Then the "read_plan" call took at least 100 milliseconds and less than 160
    And its result is this JSON:
      """
      {"modules": [
        {"name": "zeth", "recipe": ["bex", "dov", "dov"], "after": ["tessa"]},
        {"name": "ulm", "recipe": ["bex", "eln"], "after": ["tessa"]},
        {"name": "wick", "recipe": ["arn", "dov", "eln", "gor"], "after": ["ulm", "vorn"]},
        {"name": "tessa", "recipe": ["arn", "arn", "bex", "cal", "dov"], "after": []},
        {"name": "yarl", "recipe": ["fim", "gor"], "after": ["wick"]},
        {"name": "vorn", "recipe": ["cal", "cal", "fim"], "after": ["tessa"]}]}
      """

  Scenario: Taking, joining and mounting put a module on the device
    Given "Dal" holds a module "tessa" with "arn", "arn", "bex" and "cal" joined, and the pile holds the rest
    And "Dal"'s scripted turns call "take" with "dov", then "join" with the module "tessa" and the kind "dov", then "mount", then end
    When the run ends
    Then every call of "Dal" succeeded, with the texts "You are holding it.", "You have joined it." and "You have mounted your module on the device."
    And the "take" call took at least 100 milliseconds and less than 160, the "join" call at least 200 and less than 260, and the "mount" call at least 300 and less than 360
    And "tessa" is mounted, "Dal" holds nothing, and the pile holds 4 "dov"

  Scenario: The first join starts a module; put_back and take_apart return pieces to the pile
    Given "Mik"'s scripted turns call "take" with "bex", "take" with "eln", "join" with the module "ulm" and the kind "bex", "put_back" with "eln", then "take_apart", then end
    When the run ends
    Then every call of "Mik" succeeded, the "put_back" with the text "You have put it back on the pile." and the "take_apart" with the text "You have taken your module apart; its pieces are back on the pile."
    And after the "join" call "Mik" held a module "ulm" with "bex" joined, not finished
    And at the end "Mik" holds nothing and the pile holds its starting stock

  Scenario Outline: A refused call takes its time, says why and changes nothing
    Given <state>
    And "Dal"'s scripted turns call <call>, then end
    When the run ends
    Then the call failed with "<outcome>" and the text "<text>"
    And it took at least <ms> milliseconds and less than <ms> + 60
    And the pile, the bench and every worker's hands are as they were before it

    Examples:
      | state                                                                          | call                                                 | outcome         | ms  | text                                                                                |
      | "Mik" holds both "gor"                                                         | "take" with "gor"                                    | none_left       | 100 | The pile has no piece of that kind; you have taken nothing.                         |
      | nobody holds anything                                                          | "take" with "hox"                                    | none_left       | 100 | The pile has no piece of that kind; you have taken nothing.                         |
      | "Dal" holds six loose pieces: "arn", "arn", "bex", "cal", "dov" and "dov"      | "take" with "eln"                                    | hands_full      | 100 | Your hands are full; you have taken nothing.                                        |
      | "Dal" holds the loose piece "arn"                                              | "put_back" with "cal"                                | not_held        | 50  | You hold no loose piece of that kind; nothing has moved.                            |
      | "Dal" holds the loose piece "bex"                                              | "join" with the module "ulm" and the kind "eln"      | not_held        | 200 | You hold no loose piece of that kind; nothing has been joined.                      |
      | "Dal" holds a module "tessa" with "arn" and "arn" joined, and a loose "arn"    | "join" with the module "tessa" and the kind "arn"    | not_needed      | 200 | That module needs no more pieces of that kind; nothing has been joined.             |
      | "Dal" holds the loose piece "bex" and no module                                | "join" with the module "quill" and the kind "bex"    | not_needed      | 200 | That module needs no more pieces of that kind; nothing has been joined.             |
      | "Dal" holds a module "ulm" with "bex" joined, and a loose "cal"                | "join" with the module "vorn" and the kind "cal"     | other_module    | 200 | You are holding a module of another name; nothing has been joined.                  |
      | "Dal" holds no module                                                          | "take_apart"                                         | no_module       | 200 | You are holding no module; nothing has changed.                                     |
      | "Dal" holds no module                                                          | "mount"                                              | no_module       | 300 | You are holding no module; you have mounted nothing.                                |
      | "Dal" holds a module "tessa" with "arn" joined                                 | "mount"                                              | not_finished    | 300 | Your module is not finished; you have mounted nothing.                              |
      | "Dal" holds a finished module "ulm", and "tessa" is not mounted                | "mount"                                              | out_of_order    | 300 | A module yours must be mounted after is not mounted yet; you have mounted nothing.  |
      | "tessa" is mounted, and "Dal" holds another finished module "tessa"            | "mount"                                              | already_mounted | 300 | A module of that name is already mounted; you have mounted nothing.                 |

  Scenario: An effector is checked when it lands, not when it starts, and records what the worker last saw
    Given "Ren" holds one "gor", so the pile holds one
    And "Mik"'s scripted turns call "look" at once, then "take" with "gor" after 100 milliseconds, then end
    And "Dal"'s scripted turns call "take" with "gor" at once, then end
    When the run ends
    Then "Dal"'s "take" call succeeded
    And "Mik"'s "take" call failed with "none_left", and recorded its target as "free" and 1 change since sensing, applied by "Dal"
    And "Mik" holds no "gor"

  Scenario: Two workers mount at once; a third is refused after half a world minute
    Given the calendar's scale is 150, so one world minute is 400 milliseconds of the run
    And "Dal" holds a finished module "tessa", "Mik" holds a finished module "vorn" and "Nar" holds a finished module "zeth"
    And "Dal"'s scripted turns call "mount" at once, then end
    And "Mik"'s scripted turns call "mount" after 200 milliseconds, then end
    And "Nar"'s scripted turns call "mount" after 400 milliseconds, then end
    And "Ren"'s scripted turns call "look" after 300 milliseconds, then end
    When the run ends
    Then "Nar"'s "mount" call failed with "bench_full" and the text "Every place at the bench was taken; you have mounted nothing."
    And it took at least 200 milliseconds and less than 260
    And "Ren"'s "look" shows the bench places as "Dal" and "Mik", and "Nar" doing "mounting"
    And "Dal"'s and "Mik"'s "mount" calls succeeded, "Nar" still holds "zeth", and "tessa" and "vorn" are mounted

  Scenario: A worker keeps its bench place for the whole call, also when the mount is refused when it lands
    Given "Dal" holds a module "tessa" with "arn" joined, "Mik" holds a finished module "tessa" and "Nar" holds a finished module "zeth"
    And "Dal"'s scripted turns call "mount" at once, then end
    And "Mik"'s scripted turns call "mount" after 50 milliseconds, then end
    And "Nar"'s scripted turns call "mount" after 100 milliseconds, then end
    When the run ends
    Then "Dal"'s "mount" call failed with "not_finished"
    And "Nar"'s "mount" call failed with "bench_full"
    And at the end both bench places are free

  Scenario: A wait takes its minutes, changes nothing, and shows the worker waiting
    Given "Dal"'s scripted turns call "wait" with 2 minutes, then end
    And "Mik"'s scripted turns call "look" after 50 milliseconds, then end
    When the run ends
    Then the "wait" call succeeded with the text "You have waited."
    And it took at least 200 milliseconds and less than 260
    And "Mik"'s "look" shows "Dal" doing "waiting"
    And no worker's hands, the pile or the bench changed during it

  Scenario Outline: Minutes out of range are refused and take no time
    Given "Dal"'s scripted turns call "wait" with <minutes> minutes, then end
    When the run ends
    Then the "wait" call ended with the outcome "invalid_arguments"
    And it took no time

    Examples:
      | minutes |
      | 0       |
      | -1      |
      | 10.5    |

  Scenario: A call cut off by the time limit applies nothing
    Given the run's time limit is 150 milliseconds
    And "Dal" holds the loose piece "arn"
    And "Dal"'s scripted turns call "join" with the module "tessa" and the kind "arn" at once, then end
    When the run ends
    Then the "join" call has the outcome "cut_off"
    And "Dal" holds the loose piece "arn" and no module

  Scenario: The log gives each call and the start of each effector's call
    Given "Dal" holds a finished module "tessa"
    And "Dal"'s scripted turns call "take" with "arn", then "mount", then end
    When the run ends
    Then the log has a tool call line for each of "Dal"'s calls, with its outcome and the text "Dal" received
    And it has an "effector_start" line for each, the first naming that "Dal" began taking, the second that "Dal" began mounting and the bench place it occupies
