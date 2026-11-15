@FR-WORKSHOP-04
Feature: Done, and the workshop's measures

  Background:
    Given the workshop scenario with its base configuration, but the calendar's scale is 600, so one world minute is 100 milliseconds of the run
    And the rhythm's "min_ms" and "max_ms" are 0
    And every worker whose turns are not given ends every turn without a tool call

  # Scenarios that end in a run use scripted workers; scenarios that give a record compute the measures from a world and a
  # record of calls built to match it, each effect landing at its call's end. Times and durations are world minutes.

  Scenario: The run ends at the mount that completes the device
    Given "tessa", "ulm", "vorn", "wick" and "zeth" are mounted, "Dal" holds a module "yarl" with "fim" joined and a loose "gor", and the pile holds the rest
    And "Dal"'s scripted turns call "join" with the module "yarl" and the kind "gor", then "mount", then the text "Done." with no tool call
    And "Mik"'s scripted turns call "wait" with 10 minutes at once, then end
    When the run ends
    Then "Dal"'s "mount" call succeeded, and "Dal" made no model turn after it
    And the log has a "world_finished" line, giving as the moment the world was finished the end of "Dal"'s "mount" call, within 20 milliseconds
    And "Mik"'s "wait" call has the outcome "cut_off"
    And the last metric sample gives "done" as 1, "modules_mounted" as 6, and "time_to_done" as 5, within 0.3

  Scenario: A run that reaches its time limit is not done
    Given "Dal" holds a finished module "tessa"
    And "Dal"'s scripted turns call "mount" at once, then end
    And the run's time limit is 500 milliseconds
    When the run ends
    Then the log has no "world_finished" line
    And the last metric sample gives "done" as 0, "modules_mounted" as 1 and "time_to_done" as null

  Scenario: Every measure has its value at the start of a run
    When the run ends
    Then the first metric sample gives "done" 0, "modules_mounted" 0, "time_to_done" null, "effort_total" 0, "pieces_wasted" 0, "modules_taken_apart" 0, "first_take_time" null, "joins_share_by_worker" null, "duplicated_modules" 0 and "bench_refusals" 0
    And it gives "effort_by_worker" as 0 for each of "Dal", "Mik", "Nar" and "Ren"
    And it gives "speech_before_first_take" as "calls" 0 and "words" 0

  Scenario: Outcome measures, from a record
    Given the workshop starts with "Dal" holding a module "tessa" with "arn", "arn", "bex" and "cal" joined and a loose "dov", "Mik" holding a module "ulm" with "bex" joined and a loose "eln", and the rest in the pile
    And the record holds these calls:
      | worker | start | end | tool       | arguments  | outcome |
      | Dal    | 0     | 2   | join       | tessa, dov | success |
      | Mik    | 0     | 2   | join       | ulm, eln   | success |
      | Nar    | 0     | 1   | take       | arn        | success |
      | Ren    | 0     | 1   | take       | bex        | success |
      | Ren    | 1     | 3   | join       | zeth, bex  | success |
      | Dal    | 2.5   | 5.5 | mount      |            | success |
      | Ren    | 3     | 5   | take_apart |            | success |
      | Mik    | 3     | 6   | mount      |            | success |
    When the measures are computed
    # effort: Dal 2 + 3, Mik 2 + 3, Nar 1, Ren 1 + 2 + 2; wasted: Nar's loose arn (the 7 pieces of tessa and ulm are mounted, Ren's bex is back in the pile)
    Then "done" is 0, "modules_mounted" is 2 and "time_to_done" is null
    And "effort_total" is 16, and "effort_by_worker" gives "Dal" 5, "Mik" 5, "Nar" 1 and "Ren" 5
    And "pieces_wasted" is 1
    And "modules_taken_apart" is 1

  Scenario: Measures before starting, and speech by worker, from a record
    Given the workshop starts as its base configuration gives it
    And the record holds these calls:
      | worker | start | end  | tool | arguments                                                                       | outcome |
      | Dal    | 0     | 0.5  | look |                                                                                 | success |
      | Dal    | 0.5   | 1.25 | say  | I will build tessa now and Mik could build vorn while Nar builds zeth please    | success |
      | Mik    | 1     | 1.35 | say  | Fine, vorn then.                                                                | success |
      | Dal    | 1.25  | 2.25 | take | arn                                                                             | success |
      | Mik    | 1.35  | 2.35 | take | cal                                                                             | success |
      | Nar    | 2     | 2.45 | say  | I will take the zeth pieces                                                     | success |
    When the measures are computed
    # Dal's speech has 15 words (0.25 + 15 / 30 = 0.75 minutes), Mik's 3, Nar's 6; Nar's ends after the first take
    Then "first_take_time" is 2.25
    And "speech_before_first_take" gives "calls" 2 and "words" 18
    And "own_first_take_time" gives "Dal" 2.25 and "Mik" 2.35, and no key for "Nar" or "Ren"
    And "speech_by_worker" gives "Dal.calls" 1, "Dal.words" 15, "Mik.calls" 1, "Mik.words" 3, "Nar.calls" 1, "Nar.words" 6, "Ren.calls" 0 and "Ren.words" 0

  Scenario: The split, from a record
    Given the workshop starts with "Dal" holding the loose pieces "arn" and "arn", "Mik" holding "arn" and "bex", "Nar" holding "cal", "cal" and "fim", and the rest in the pile
    And the record holds these calls:
      | worker | start | end | tool       | arguments  | outcome      |
      | Dal    | 0     | 2   | join       | tessa, arn | success      |
      | Mik    | 0     | 2   | join       | tessa, arn | success      |
      | Nar    | 0     | 2   | join       | vorn, cal  | success      |
      | Dal    | 2     | 4   | join       | tessa, arn | success      |
      | Mik    | 2     | 4   | take_apart |            | success      |
      | Nar    | 2     | 4   | join       | vorn, cal  | success      |
      | Mik    | 4     | 6   | join       | ulm, bex   | success      |
      | Nar    | 4     | 6   | join       | vorn, fim  | success      |
      | Nar    | 6     | 9   | mount      |            | out_of_order |
    When the measures are computed
    # 7 applied joins: Dal 2, Mik 2, Nar 3. Two instances of tessa were started (Dal's and Mik's), one of ulm, one of vorn.
    Then "builders_by_module" gives exactly "tessa.joined_by.Dal" 1, "tessa.joined_by.Mik" 1, "ulm.joined_by.Mik" 1 and "vorn.joined_by.Nar" 1
    And "joins_share_by_worker" gives "Dal" 2/7, "Mik" 2/7, "Nar" 3/7 and "Ren" 0
    And "modules_by_worker" gives "Nar.finished" 1, and 0 for every other worker's "finished" and for every worker's "mounted"
    And "module_switches" gives "Mik" 1, and 0 for "Dal", "Nar" and "Ren"
    And "duplicated_modules" is 1
    And "refused_by_cause" gives exactly "mount.out_of_order" 1

  Scenario: Stumbles, from a record
    Given the workshop starts with "Dal" holding a module "tessa" with "arn", "arn", "bex" and "cal" joined and a loose "dov", "Mik" holding a module "vorn" with "cal" and "cal" joined and a loose "fim", "Nar" holding a module "zeth" with "bex" and "dov" joined and a loose "dov", and the rest in the pile
    And the record holds these calls:
      | worker | start | end | tool  | arguments  | outcome    |
      | Dal    | 0     | 2   | join  | tessa, dov | success    |
      | Mik    | 0     | 2   | join  | vorn, fim  | success    |
      | Nar    | 0     | 2   | join  | zeth, dov  | success    |
      | Ren    | 0     | 1   | take  | gor        | success    |
      | Ren    | 1     | 2   | take  | gor        | success    |
      | Dal    | 2     | 5   | mount |            | success    |
      | Ren    | 2     | 3   | take  | gor        | none_left  |
      | Mik    | 2.5   | 5.5 | mount |            | success    |
      | Nar    | 3     | 3.5 | mount |            | bench_full |
      | Nar    | 5.5   | 8.5 | mount |            | success    |
    When the measures are computed
    # each module's last join landed at 2; its mount started at 2, 2.5 and 5.5
    Then "finish_to_mount" gives "tessa" 0, "vorn" 0.5 and "zeth" 3.5
    And "bench_refusals" is 1
    And "refused_by_cause" gives exactly "mount.bench_full" 1 and "take.none_left" 1
    And "builders_by_module" gives "tessa.mounted_by.Dal" 1, "vorn.mounted_by.Mik" 1 and "zeth.mounted_by.Nar" 1
    And "modules_by_worker" gives "Dal.finished" 1, "Dal.mounted" 1, "Mik.finished" 1, "Mik.mounted" 1, "Nar.finished" 1 and "Nar.mounted" 1
    And "effort_by_worker" gives "Dal" 5, "Mik" 5, "Nar" 5.5 and "Ren" 3, and "effort_total" is 18.5

  Scenario: Time by activity, from a record
    Given the workshop starts as its base configuration gives it
    And the record holds these calls:
      | worker | start | end  | tool      | arguments                                                                    | outcome     |
      | Dal    | 0     | 0.5  | look      |                                                                              | success     |
      | Dal    | 0.5   | 1.5  | read_plan |                                                                              | success     |
      | Dal    | 1.5   | 4    | wait      | 5                                                                            | interrupted |
      | Mik    | 3.25  | 4    | say       | I will build tessa now and Mik could build vorn while Nar builds zeth please | success     |
    When the measures are computed
    Then "time_by_activity" gives exactly "Dal.look" 0.5, "Dal.read_plan" 1, "Dal.wait" 2.5 and "Mik.say" 0.75
    And "effort_by_worker" gives "Dal" 4, "Mik" 0.75, "Nar" 0 and "Ren" 0
    And "refused_by_cause" gives no key

  Scenario: A call refused before it runs counts as refused and takes no effort
    Given "Dal"'s scripted turns call "wait" with 0 minutes, then end
    When the run ends
    Then the last metric sample gives "refused_by_cause" as exactly "wait.invalid_arguments" 1
    And it gives "effort_by_worker" for "Dal" as 0

  Scenario: Each applied speech is a line of the speech timeline
    Given "Dal"'s scripted turns call "say" with "I will build tessa now and Mik could build vorn while Nar builds zeth please" at once, then call "say" with "", then end
    When the run ends
    Then the log has exactly one "speech" line
    And it gives the speaker "Dal", the start 0 and the end 0.75, each within 0.1, and 15 words
    And it was written when the "say" call ended
