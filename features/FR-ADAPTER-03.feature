@FR-ADAPTER-03
Feature: Context compaction is declared and recorded

  Background:
    Given the test scenario "slots" is in the scenario library, with agents "a" and "b"
    And the scripted model "scripted/small", with a context window of 4000 tokens, whose agents call "look" in every turn for 8 turns, then end without a tool call, and which writes the summary "Summary: I looked at the slots." when asked to compact
    And an experiment file "e-test" for the scenario "slots", with the model "scripted/small", 1 replica, 1 activation per agent, the condition "baseline", with no change, and the thinking level "off"

  Scenario: With compaction on, a filled context is compacted and the compaction is recorded
    Given the file's compaction is enabled, with "trigger_at" 0.5 and "keep_recent_tokens" 500
    When "lab run" runs the experiment file
    Then agent "a"'s log has at least one compaction line, with the reason "threshold", when it started and ended, the context's size before and after it, the summary "Summary: I looked at the slots.", and the tokens and cost of the call that wrote it
    And the context's size after it is smaller than before it
    And agent "a"'s model turns after the compaction received the summary "Summary: I looked at the slots."

  Scenario: The trigger is a share of each model's context window
    Given the file's compaction is enabled, with "trigger_at" 0.5 and "keep_recent_tokens" 500
    When "lab run" runs the experiment file
    Then agent "a"'s first compaction started when its context was above 2000 tokens and no earlier turn's context was

  Scenario: With compaction off, nothing is compacted
    Given the file's compaction is not enabled
    When "lab run" runs the experiment file
    Then no log has a compaction line

  Scenario: The setup line and the inventory give the compaction setting
    Given the file's compaction is enabled, with "trigger_at" 0.5 and "keep_recent_tokens" 500
    When "lab run" runs the experiment file
    And "lab inventory" runs on the experiment file
    Then the run's setup line gives compaction enabled, with "trigger_at" 0.5 and "keep_recent_tokens" 500
    And the inventory gives the same setting and the instructions the model is given to write the summary

  Scenario Outline: A file without compaction, or with a setting out of range, is refused before any model call
    Given <setting>
    When "lab run" runs the experiment file
    Then it fails with an error that names <named>
    And no model was called

    Examples:
      | setting                                                          | named                 |
      | the file gives no compaction                                     | "compaction"          |
      | the file's compaction is enabled, with "trigger_at" 1.2          | "trigger_at"          |
      | the file's compaction is enabled, with no "keep_recent_tokens"   | "keep_recent_tokens"  |

  Scenario Outline: A compaction that does not finish is recorded with its outcome
    Given the file's compaction is enabled, with "trigger_at" 0.5 and "keep_recent_tokens" 500, and a model turn timeout of 500 milliseconds
    And <summary>
    When "lab run" runs the experiment file
    Then agent "a"'s log has a compaction line with the outcome "<outcome>", no summary, and the tokens and cost spent

    Examples:
      | summary                                                                                  | outcome     |
      | the scripted model answers the summary call with a provider error                        | model_error |
      | the scripted model takes 1000 milliseconds to answer the summary call                    | timeout     |
      | the scripted model takes 1000 milliseconds to answer the summary call, and the run's time limit passes while it waits | cut_off |
