@FR-PHONE-01
Feature: Calls

  Background:
    Given a test scenario with the agents "ana" and "ben" and the participant "desk", each with a mailbox and a line
    And the configuration's calendar starts at "day 1 Friday 17:00" with one segment of scale 600, so one world minute is 100 milliseconds of the run
    And the phone's "ring_minutes" is 5 and its "call_minutes" 4, with no time per word, and its ring is "{from} calls ({call}): {act}. {fields}{text}"
    And "desk" takes the acts "book", which requires the fields "date" and "rooms", and "ask", which requires none
    And "desk" decides by the rule set "operator", has the tools "answer_call" and "call", and the channel "phone"
    And "operator", woken by a ring for the act "ask", answers it at once with "answer_call", the act "answer" and the field free "yes"

  Scenario: A call a participant answers connects, and the caller gets the answer when it ends
    Given "ana"'s scripted turns call "call" to "desk" with the act "ask", then end
    When the run ends
    Then "desk" received the ring "ana calls (c-1): ask. " through the channel "phone", whose source is "ana", at the run's start, within 30 milliseconds
    And "ana"'s "call" succeeded 400 milliseconds into the run, within 30, with the result "Answer from desk. Act: answer. free: yes."
    And "desk"'s "answer_call" succeeded at the same moment

  Scenario: A call nobody answers ends as no_answer when the ring runs out
    Given "operator" is changed to answer nothing
    And "ana"'s scripted turns call "call" to "desk" with the act "ask", then end
    When the run ends
    Then "ana"'s "call" failed with the outcome "no_answer" 500 milliseconds into the run, within 30

  Scenario: A callee already on a call is busy
    Given "ben"'s scripted turns call "call" to "desk" with the act "ask", then end
    And "ana"'s scripted turns wait 100 milliseconds, then call "call" to "desk" with the act "ask", then end
    When the run ends
    Then "ana"'s "call" failed with the outcome "busy" 200 milliseconds into the run, within 30, one world minute after it started
    And "desk" received one ring only

  Scenario: A callee outside its hours gets no ring
    Given the configuration's calendar starts at "day 1 Friday 18:30"
    And the calendar declares the hours "office" on Monday to Friday from "09:00" to "18:00", and "desk" keeps the hours "office"
    And "ana"'s scripted turns call "call" to "desk" with the act "ask", then end
    When the run ends
    Then "ana"'s "call" failed with the outcome "no_answer"
    And "desk" received no ring

  Scenario: An agent receives a call and answers it
    Given "operator" is changed to call "ana" at the run's start with the act "ask" and the text "Still on for Friday?"
    And "ana"'s scripted turns, woken by the ring, call "answer_call" for "c-1" with the act "yes", then end
    When the run ends
    Then "ana" received the ring "desk calls (c-1): ask. Still on for Friday?" through the channel "phone"
    And "desk"'s "call" succeeded with the result "Answer from ana. Act: yes."

  Scenario: An answer that comes after the ring has run out finds no call
    Given "operator" is changed to call "ana" at the run's start with the act "ask"
    And "ana"'s scripted turns wait 700 milliseconds, then call "answer_call" for "c-1" with the act "yes", then end
    When the run ends
    Then "desk"'s "call" failed with the outcome "no_answer"
    And "ana"'s "answer_call" failed with the outcome "no_such_call" and took no time

  Scenario Outline: A call its callee cannot take is refused as it starts and takes no time
    Given "ana"'s scripted turns call "call" <call>, then end
    When the run ends
    Then the "call" failed with the outcome "<outcome>" and took no time, and no phone rang

    Examples:
      | call                                                     | outcome           |
      | to "desk" with the act "order"                           | act_not_taken     |
      | to "desk" with the act "book" and the field date "day 26"| missing_field     |
      | to "zoe" with the act "ask"                              | unknown_recipient |

  Scenario: Words lengthen a call when the configuration says so
    Given the phone's "call_words_per_minute" is 10
    And "ana"'s scripted turns call "call" to "desk" with the act "ask" and a text of 20 words, then end
    When the run ends
    Then "ana"'s "call" succeeded 600 milliseconds into the run, within 30: 4 world minutes, plus 2 for 20 words

  Scenario: A call the run's time limit cuts off connects nothing
    Given the run's time limit is 200 milliseconds
    And "ana"'s scripted turns call "call" to "desk" with the act "ask", then end
    When the run ends
    Then the call's line has the outcome "cut_off", and both "ana"'s "call" and "desk"'s "answer_call" are recorded "cut_off"

  Scenario: The log keeps each call
    Given "ana"'s scripted turns call "call" to "desk" with the act "ask", then end
    When the run ends
    Then the run's log has a "call" line with the id "c-1", "ana", "desk", "ask", the answer's act "answer" and field free "yes", the outcome "answered", and the run time and world time it rang, was answered and ended

  Scenario: The inventory gives the phone
    When the inventory is made
    Then it gives the lines of "ana", "ben" and "desk", "ring_minutes" 5, "call_minutes" 4, no time per word, and the ring's text

  Scenario Outline: A phone that cannot be followed is refused before any model call
    Given the configuration's phone is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<key>"

    Examples:
      | change                                                       | key                        |
      | the configuration has no calendar                            | phone                      |
      | it gives a line to "zoe", who is no agent or participant     | phone.lines                |
      | its "ring_minutes" is 0                                      | phone.ring_minutes         |
      | its "call_minutes" is -1                                     | phone.call_minutes         |
      | its "call_words_per_minute" is -1                            | phone.call_words_per_minute|
      | its ring names "{price}"                                     | phone.ring                 |
      | "desk" keeps the channel "phone" without the tool "answer_call" | participants.desk.tools |
