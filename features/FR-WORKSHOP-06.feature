@FR-WORKSHOP-06
Feature: Speech is addressed

  Background:
    Given the workshop scenario with its base configuration, but the calendar's scale is 600, so one world minute is 100 milliseconds of the run
    And the rhythm's "min_ms" and "max_ms" are 0
    And every worker whose turns are not given ends every turn without a tool call

  # Scenarios that end in a run use scripted workers; scenarios that give a record compute the measures from a world and a
  # record of calls built to match it, each effect landing at its call's end (FR-WORKSHOP-04). Times are world minutes.
  # A speech row's arguments are the names in "to", joined as the heard text joins them, a colon, and the text.
  # A text of 3 words takes 0.25 + 3 / 30 = 0.35 world minutes, 35 milliseconds here.

  # Heard by the room

  Scenario Outline: Each speech tool reaches every other worker, and each reads its kind and who it is for
    Given "Dal"'s scripted turns call "<tool>" with "<text>" to "Mik" and "Nar", then end
    And "Mik", "Nar" and "Ren" each run on scripted models whose turns are: the text "Thinking." with no tool call, after 300 milliseconds; the text "Done." with no tool call
    When the run ends
    Then the "<tool>" call succeeded with the text "<success>"
    And it took at least 35 milliseconds and less than 95
    And "Mik"'s second model turn received '<verb> you and Nar, "<text>"' from "Dal", which the worker reads as 'Dal: <verb> you and Nar, "<text>"'
    And "Nar"'s second model turn received '<verb> Mik and you, "<text>"' from "Dal", which the worker reads as 'Dal: <verb> Mik and you, "<text>"'
    And "Ren"'s second model turn received '<verb> Mik and Nar, "<text>"' from "Dal", which the worker reads as 'Dal: <verb> Mik and Nar, "<text>"'
    And "Dal" received nothing on the channel "voice"

    Examples:
      | tool   | verb    | text              | success                 |
      | ask    | asks    | Who builds tessa? | You have asked them.    |
      | answer | answers | I build tessa.    | You have answered them. |
      | tell   | tells   | Please take ulm.  | You have told them.     |

  Scenario: One name alone, and three with commas and a last "and"
    Given "Dal"'s scripted turns call "tell" with "We start now." to "Mik", "Nar" and "Ren", then end
    And "Nar"'s scripted turns call "ask" with "Who builds tessa?" to "Dal" after 100 milliseconds, then end
    When the run ends
    Then the log has a stimulus line for "Mik" with the channel "voice", the source "Dal" and the content 'tells you, Nar and Ren, "We start now."'
    And the log has a stimulus line for "Nar" with the channel "voice", the source "Dal" and the content 'tells Mik, you and Ren, "We start now."'
    And the log has a stimulus line for "Ren" with the channel "voice", the source "Dal" and the content 'tells Mik, Nar and you, "We start now."'
    And the log has a stimulus line for "Dal" with the channel "voice", the source "Nar" and the content 'asks you, "Who builds tessa?"'
    And the log has a stimulus line for each of "Mik" and "Ren", with the channel "voice", the source "Nar" and the content 'asks Dal, "Who builds tessa?"'

  Scenario: A worker named twice is addressed once
    Given "Dal"'s scripted turns call "ask" with "Who builds tessa?" to "Mik", "Mik" and "Nar", then end
    When the run ends
    Then the "ask" call succeeded with the text "You have asked them."
    And the log has a stimulus line for "Mik" with the channel "voice", the source "Dal" and the content 'asks you and Nar, "Who builds tessa?"'
    And the log has a stimulus line for "Ren" with the channel "voice", the source "Dal" and the content 'asks Mik and Nar, "Who builds tessa?"'
    And the log's "speech" line gives "to" as ["Mik", "Nar"]
    And the last metric sample gives "addressed" as exactly "Dal.ask.Mik" 1 and "Dal.ask.Nar" 1

  Scenario: Speech wakes a resting worker it is not addressed to
    Given "Nar"'s rhythm keeps it resting 5000 milliseconds before each activation, and the others' 0
    And "Dal"'s scripted turns call "tell" with "Please take ulm." to "Mik" after 100 milliseconds, then end
    When the run ends
    Then "Nar" started an activation within 100 milliseconds after the "tell" call ended, with 'tells Mik, "Please take ulm."' from "Dal" among its stimuli

  Scenario: Speech ends the wait of a worker it is not addressed to
    Given "Ren"'s scripted turns call "wait" with 10 minutes at once, then end
    And "Dal"'s scripted turns call "ask" with "Who builds tessa?" to "Mik" after 100 milliseconds, then end
    When the run ends
    Then "Ren"'s "wait" call ended with the outcome "interrupted" and the text "Something reached you; you stopped waiting."
    And it ended within 50 milliseconds after the "ask" call ended

  Scenario Outline: Speaking takes time in proportion to the words of the text, the same for the three
    Given "Dal"'s scripted turns call "<tool>" with the text of <words> words, "<text>", to <to>, then end
    When the run ends
    Then the "<tool>" call took at least <ms> milliseconds and less than <ms> + 60

    Examples:
      | tool   | words | ms  | to                     | text                                                                                                                                         |
      | ask    | 3     | 35  | "Mik"                  | Who builds tessa?                                                                                                                            |
      | answer | 3     | 35  | "Mik"                  | I build tessa.                                                                                                                               |
      | tell   | 3     | 35  | "Mik", "Nar" and "Ren" | Please take ulm.                                                                                                                             |
      | tell   | 30    | 125 | "Mik"                  | We should split the work so that each of us builds one module at a time and mounts it when the module it needs first is already on the bench |
      | ask    | 30    | 125 | "Mik" and "Nar"        | We should split the work so that each of us builds one module at a time and mounts it when the module it needs first is already on the bench |

  Scenario Outline: Look shows a worker speaking while any of the three lasts
    Given "Dal"'s scripted turns call "<tool>" with the text of 30 words, "We should split the work so that each of us builds one module at a time and mounts it when the module it needs first is already on the bench", to "Nar", at once, then end
    And "Mik"'s scripted turns call "look" at once, then end
    When the run ends
    Then "Mik"'s "look" shows "Dal" doing "speaking"

    Examples:
      | tool   |
      | ask    |
      | answer |
      | tell   |

  # Refusals

  Scenario Outline: A refused speech takes its time, says what was wrong and that nothing was said, and reaches no one
    Given "Dal"'s scripted turns call "<tool>" with the text <text> to <to>, then end
    When the run ends
    Then the "<tool>" call failed with "<outcome>" and the text '<refusal>'
    And it took at least <ms> milliseconds and less than <ms> + 60
    And the log has no stimulus line on the channel "voice"
    And the log has no "speech" line

    Examples:
      | tool   | text                | to                     | outcome        | ms | refusal                                                         |
      | ask    | "Who builds tessa?" | nobody                 | no_one         | 35 | You named nobody to speak to; nothing has been said.            |
      | answer | "I build tessa."    | nobody                 | no_one         | 35 | You named nobody to speak to; nothing has been said.            |
      | tell   | "Please take ulm."  | nobody                 | no_one         | 35 | You named nobody to speak to; nothing has been said.            |
      | ask    | "Who builds tessa?" | "Kel"                  | no_such_worker | 35 | There is no worker named "Kel"; nothing has been said.          |
      | answer | "I build tessa."    | "Mik" and "Kel"        | no_such_worker | 35 | There is no worker named "Kel"; nothing has been said.          |
      | tell   | "Please take ulm."  | "mik"                  | no_such_worker | 35 | There is no worker named "mik"; nothing has been said.          |
      | tell   | "Please take ulm."  | "Kel", "Mik" and "Tam" | no_such_worker | 35 | There is no worker named "Kel" or "Tam"; nothing has been said. |
      | ask    | "Who builds tessa?" | "Dal"                  | to_self        | 35 | You cannot speak to yourself; nothing has been said.            |
      | answer | "I build tessa."    | "Mik" and "Dal"        | to_self        | 35 | You cannot speak to yourself; nothing has been said.            |
      | tell   | "Please take ulm."  | "Dal"                  | to_self        | 35 | You cannot speak to yourself; nothing has been said.            |
      | ask    | ""                  | "Mik"                  | empty_text     | 25 | You said nothing; nobody heard anything.                        |
      | answer | "   "               | "Mik"                  | empty_text     | 25 | You said nothing; nobody heard anything.                        |
      | tell   | "\n  "              | "Mik" and "Nar"        | empty_text     | 25 | You said nothing; nobody heard anything.                        |

  Scenario Outline: The refusals are checked in order: nobody, no such worker, oneself, no word
    Given "Dal"'s scripted turns call "tell" with the text <text> to <to>, then end
    When the run ends
    Then the "tell" call failed with "<outcome>"

    Examples:
      | text               | to              | outcome        |
      | ""                 | nobody          | no_one         |
      | ""                 | "Kel" and "Dal" | no_such_worker |
      | "Please take ulm." | "Dal" and "Kel" | no_such_worker |
      | ""                 | "Dal"           | to_self        |

  Scenario Outline: A speech cut off by the time limit reaches no one
    Given the run's time limit is 60 milliseconds
    And "Dal"'s scripted turns call "<tool>" with the text of 30 words, "We should split the work so that each of us builds one module at a time and mounts it when the module it needs first is already on the bench", to "Mik", at once, then end
    When the run ends
    Then the "<tool>" call has the outcome "cut_off"
    And the log has no stimulus line on the channel "voice"
    And the log has no "speech" line

    Examples:
      | tool   |
      | ask    |
      | answer |
      | tell   |

  # What is logged

  Scenario: The log gives each speech call, its start, what each listener read and the speech line
    Given "Dal"'s scripted turns call "ask" with "Who builds tessa?" to "Nar" and "Mik", then end
    When the run ends
    Then the log has a tool call line for "Dal"'s "ask" call, with its outcome and the text "Dal" received
    And it has an "effector_start" line naming that "Dal" began speaking
    And the log has a stimulus line for "Nar" with the channel "voice", the source "Dal" and the content 'asks you and Mik, "Who builds tessa?"'
    And the log has a stimulus line for "Mik" with the channel "voice", the source "Dal" and the content 'asks Nar and you, "Who builds tessa?"'
    And the log has a stimulus line for "Ren" with the channel "voice", the source "Dal" and the content 'asks Nar and Mik, "Who builds tessa?"'
    And each was delivered no earlier than the end of the "ask" call, and within 50 milliseconds of it
    And the log has no stimulus line on the channel "voice" for "Dal"
    And the log has exactly one "speech" line
    And it gives the speaker "Dal", the kind "ask", "to" as ["Nar", "Mik"], the start 0 and the end 0.35, each time within 0.1, and 3 words
    And it was written when the "ask" call ended

  # The inventory and the configuration

  Scenario: The inventory gives the three tools, their descriptions, the voice channel and the durations
    When "lab inventory" lists it
    Then each worker's tools include "ask", "answer" and "tell", each with its duration as 0.25 world minutes plus one minute per 30 words, and its texts
    And each worker's tools do not include "say"
    And the tools' descriptions and parameters are these:
      | tool   | description                                                                                                                                                                                                                                        | to                                                                  | text                |
      | ask    | Ask one or more workers a question. Name them in to, as look names them. Everyone in the room hears it, with your name and who you asked, when you finish speaking; the longer it is, the longer it takes.                                         | The workers you ask, one or more, each named as look names them.    | Your question.      |
      | answer | Answer one or more workers: reply to what they asked or said. Name them in to, as look names them. Everyone in the room hears it, with your name and who you answered, when you finish speaking; the longer it is, the longer it takes.            | The workers you answer, one or more, each named as look names them. | Your answer.        |
      | tell   | Tell one or more workers something that is neither a question nor an answer. Name them in to, as look names them. Everyone in the room hears it, with your name and who you told, when you finish speaking; the longer it is, the longer it takes. | The workers you tell, one or more, each named as look names them.   | What you tell them. |
    And it gives the durations "speech" as 0.25 and "speech_words_per_minute" as 30 among the durations, and no duration "say" or "say_words_per_minute"
    And it lists the channel "voice" with the source "the speaker", the text 'asks, answers or tells <names>, "<text>"', and that it wakes
    And it lists each of the tools "ask", "answer" and "tell" with the channel "voice" it delivers through
    And no tool's description or parameters hold any of "Dal", "Mik", "Nar" or "Ren"

  Scenario Outline: A configuration with a speech duration the workshop cannot use is refused before any model call
    Given the configuration is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<named>"

    Examples:
      | change                                          | named                             |
      | the duration of "speech" is -1                  | durations.speech                  |
      | the duration of "speech_words_per_minute" is 0  | durations.speech_words_per_minute |
      | the durations give "say" as 0.25                | durations.say                     |
      | the durations give "say_words_per_minute" as 30 | durations.say_words_per_minute    |

  # The measures

  Scenario: The speech measures at the start of a run
    When the run ends
    Then the first metric sample gives "speech_before_first_take" as 0 for each of "ask.calls", "ask.words", "answer.calls", "answer.words", "tell.calls" and "tell.words"
    And it gives "speech_by_worker" as 0 for each of "<worker>.<kind>.calls" and "<worker>.<kind>.words", for each worker of "Dal", "Mik", "Nar" and "Ren" and each kind of "ask", "answer" and "tell"
    And it gives "addressed" as no key
    And it gives "questions_unanswered" as no key

  Scenario: Speech by kind, before the first take and by worker, who speaks to whom, and unanswered questions, from a record
    Given the workshop starts as its base configuration gives it
    And the record holds these calls:
      | worker | start | end  | tool   | arguments                                  | outcome        |
      | Ren    | 0     | 0.35 | tell   | Kel: Hello there all.                      | no_such_worker |
      | Dal    | 0     | 0.5  | look   |                                            | success        |
      | Dal    | 0.5   | 0.85 | ask    | Mik and Nar: Who builds tessa?             | success        |
      | Mik    | 1     | 1.35 | answer | Dal: I build it.                           | success        |
      | Nar    | 1     | 1.45 | tell   | Dal and Mik: I will build vorn after that. | success        |
      | Dal    | 1.35  | 2.35 | take   | arn                                        | success        |
      | Ren    | 2.15  | 2.5  | ask    | Dal: What about zeth?                      | success        |
    When the measures are computed
    # Each text has 3 words, Nar's 6 (0.25 + 6 / 30 = 0.45 minutes). The first take lands at 2.35, so Ren's ask (2.5) is after
    # it and Ren's refused tell counts nowhere but in refused_by_cause. Dal asked Mik and Nar: Mik answered Dal, Nar only told
    # Dal something; nobody answered Ren.
    Then "first_take_time" is 2.35
    And "speech_before_first_take" gives "ask.calls" 1, "ask.words" 3, "answer.calls" 1, "answer.words" 3, "tell.calls" 1 and "tell.words" 6
    And "speech_by_worker" gives "Dal.ask.calls" 1, "Dal.ask.words" 3, "Mik.answer.calls" 1, "Mik.answer.words" 3, "Nar.tell.calls" 1, "Nar.tell.words" 6, "Ren.ask.calls" 1 and "Ren.ask.words" 3, and 0 for every other key
    And "addressed" gives exactly "Dal.ask.Mik" 1, "Dal.ask.Nar" 1, "Mik.answer.Dal" 1, "Nar.tell.Dal" 1, "Nar.tell.Mik" 1 and "Ren.ask.Dal" 1
    And "questions_unanswered" gives exactly "Dal.Nar" 1 and "Ren.Dal" 1
    And "refused_by_cause" gives exactly "tell.no_such_worker" 1
    And "time_by_activity" gives exactly "Dal.look" 0.5, "Dal.ask" 0.35, "Dal.take" 1, "Mik.answer" 0.35, "Nar.tell" 0.45, "Ren.tell" 0.35 and "Ren.ask" 0.35

  Scenario: What answers a question, from a record
    Given the workshop starts as its base configuration gives it
    And the record holds these calls:
      | worker | start | end  | tool   | arguments                   | outcome |
      | Mik    | 0     | 0.35 | answer | Dal: Yes, tessa first.      | success |
      | Ren    | 0     | 0.35 | answer | Dal: Not yet, sorry.        | success |
      | Dal    | 0.5   | 0.85 | ask    | Mik: Who has bex?           | success |
      | Dal    | 1     | 1.35 | ask    | Mik and Ren: Is ulm next?   | success |
      | Nar    | 1.5   | 1.85 | answer | Dal: Ren has it.            | success |
      | Mik    | 2     | 2.35 | answer | Dal and Nar: I have bex.    | success |
      | Ren    | 2     | 2.35 | tell   | Dal: Busy right now.        | success |
      | Dal    | 3     | 3.35 | ask    | Nar and Nar: Need any help? | success |
      | Ren    | 3     | 3.35 | answer | Dal and Ren: Yes it is.     | to_self |
    When the measures are computed
    # Every text has 3 words. Mik's answer at 2.35, to Dal and Nar, answers both of Dal's questions to Mik (0.85 and 1.35); its
    # answer at 0.35 came before them. Ren's answer at 0.35 came before Dal's question to Ren, its tell is no answer, and its
    # answer at 3.35 was refused. Nar answered Dal without being asked, and nobody asked Nar before 3.35, named twice there.
    # No take: every applied speech counts as before the first take.
    Then "questions_unanswered" gives exactly "Dal.Ren" 1 and "Dal.Nar" 1
    And "addressed" gives exactly "Mik.answer.Dal" 2, "Mik.answer.Nar" 1, "Ren.answer.Dal" 1, "Dal.ask.Mik" 2, "Dal.ask.Ren" 1, "Dal.ask.Nar" 1, "Nar.answer.Dal" 1 and "Ren.tell.Dal" 1
    And "speech_by_worker" gives "Dal.ask.calls" 3, "Dal.ask.words" 9, "Mik.answer.calls" 2, "Mik.answer.words" 6, "Nar.answer.calls" 1, "Nar.answer.words" 3, "Ren.answer.calls" 1, "Ren.answer.words" 3, "Ren.tell.calls" 1 and "Ren.tell.words" 3, and 0 for every other key
    And "speech_before_first_take" gives "ask.calls" 3, "ask.words" 9, "answer.calls" 4, "answer.words" 12, "tell.calls" 1 and "tell.words" 3
    And "refused_by_cause" gives exactly "answer.to_self" 1
