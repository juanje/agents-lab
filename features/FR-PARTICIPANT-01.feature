@FR-PARTICIPANT-01
Feature: Participants that perceive and act only through their tools

  Background:
    Given a test scenario with the agent "ana" and the participant "desk", both with a mailbox
    And the configuration's calendar starts at "day 1 Friday 17:00" with one segment of scale 600, so one world minute is 100 milliseconds of the run
    And the mail's "delivery_minutes" is [1, 1], its "send_minutes" 3, its "check_minutes" 2 and its "read_minutes" 1, with a notice from "mail client"
    And "desk" decides by the rule set "echo", has the tools "check_mail", "read_mail" and "send_mail", the channel "mail_notice", and "reply_minutes" [10, 10]
    And "echo", woken by a mail notice, calls "check_mail", then "read_mail" for each unread message, then answers each with "send_mail" back to its sender, with the act "answer", then waits for the next stimulus

  Scenario: A participant decided by rules acts through its tools, with no model turn
    Given "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then wait 2500 milliseconds, then call "check_mail", then end
    When the run ends
    Then "desk"'s notice reached it at "day 1 Friday 17:14", ten world minutes after the message landed at 17:04
    And the run's log has "desk"'s "check_mail", "read_mail" and "send_mail" calls as tool calls under its name, each with its duration and outcome
    And "desk" made no model turn
    And "ana"'s "check_mail" result lists one message, from "desk", with the subject "answer", received at "day 1 Friday 17:21"

  Scenario: Rules are given only the participant's stimuli and its own calls' results
    Given "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then end
    When the run ends
    Then every input "echo" was given was either the stimulus "mail client: New mail from ana: ask" or the result of one of "desk"'s own calls
    And "echo" was never given the world's state

  Scenario: A stimulus outside the participant's hours waits for them
    Given the configuration's calendar starts at "day 1 Friday 17:50" with one segment of scale 36000, so one world hour is 100 milliseconds of the run
    And the calendar declares the hours "office" on Monday to Friday from "09:00" to "18:00", and "desk" keeps the hours "office"
    And "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then end
    When the run ends
    Then "ana"'s message landed on "day 1 Friday", before 18:00
    And "desk"'s notice reached it on "day 4 Monday" between "09:00" and "09:30"
    And "desk" made no call before "day 4 Monday 09:00"

  Scenario: The reply delay comes from the seed and the participant
    Given "desk"'s "reply_minutes" is [5, 60]
    And "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then end
    When two replicas run with the seed 42, the second with another participant "door" that decides by "echo"
    Then "desk"'s reply delay was the same in both, between 5 and 60 world minutes

  Scenario: The same participant can be decided by a model, by configuration alone
    Given "desk" decides by a scripted model instead, with the system prompt "You run the front desk.", and its scripted turns call "check_mail", then end
    And "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then end
    When the run ends
    Then "desk"'s session was offered exactly the tools "check_mail", "read_mail" and "send_mail"
    And "desk" received "mail client: New mail from ana: ask" through the channel "mail_notice" at "day 1 Friday 17:14"
    And "desk"'s "check_mail" call is in the run's log under its name, after a model turn

  Scenario: A rule set that calls a tool its participant does not declare stops the run
    Given "echo" is changed to call "look" when woken
    And "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then end
    When the run ends
    Then the run stopped with an error that names "desk" and "look"
    And the run's log ends with a line that says it stopped and gives the error

  Scenario: A call still running when the run's time limit passes is cut off
    Given the run's time limit is 1500 milliseconds
    And "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then end
    When the run ends
    Then "desk"'s "check_mail" call, started at 1400 milliseconds, is recorded "cut_off" and applied nothing

  Scenario: Each participant's outcome is recorded when the run ends
    Given "echo" gives as its outcome the number of messages it answered
    And "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then wait 2500 milliseconds, then end
    When the run ends
    Then the run's log has a "participant_outcome" line for "desk" with answered 1

  Scenario: The inventory gives each participant
    When the inventory is made
    Then it gives "desk": decided by the rules "echo", its tools "check_mail", "read_mail" and "send_mail", the channel "mail_notice", no hours, and "reply_minutes" [10, 10]

  Scenario Outline: A participant that cannot be followed is refused before any model call
    Given "desk"'s configuration is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<key>"

    Examples:
      | change                                              | key                          |
      | it declares the tool "fly"                          | participants.desk.tools      |
      | it declares the channel "radio"                     | participants.desk.channels   |
      | it keeps the hours "night", which the calendar lacks| participants.desk.hours      |
      | its "reply_minutes" is [30, 10]                     | participants.desk.reply_minutes |
      | it decides by "dice"                                | participants.desk.decides    |
      | it decides by the rule set "mirror", not provided   | participants.desk.rules      |
      | it decides by a model and gives no model            | participants.desk.model      |
      | its name is "ana", an agent's                       | participants.ana             |

  # Approved addition (2026-11-13), settled after the build.

  Scenario: A rule set's wait wakes it at its end
    Given "echo" is changed to wait 30 world minutes after it has answered
    And "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then end
    When the run ends
    Then "echo" was woken again by the end of its wait at "day 1 Friday 17:50", within one world minute, 30 world minutes after its answer was sent at 17:20

  Scenario: A stimulus that reaches a participant during its wait wakes it early
    Given "echo" is changed to wait 30 world minutes after it has answered, and "desk"'s "reply_minutes" is [0, 0]
    And "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then wait 1300 milliseconds, then call "send_mail" to "desk" with the act "ask" again, then end
    When the run ends
    Then "echo" was woken by the second message's notice at "day 1 Friday 17:20", within one world minute, before its wait ended

  Scenario: A stimulus reaches a participant only through a channel it declares
    Given "desk" declares no channel
    And "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then end
    When the run ends
    Then the message landed in "desk"'s mailbox
    And "echo" was never woken

  Scenario: An error from a tool during a participant's call names the participant
    Given the tool "check_mail" is changed to throw "disk full" when "desk" calls it
    And "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then end
    When the run ends
    Then the run stopped with an error that names the participant "desk" and gives "disk full"

  Scenario: Reply delays need a calendar
    Given the configuration has no calendar and no mail, and "desk" has "reply_minutes" [1, 2]
    When the run is attempted
    Then it is refused before any model call, with an error that names "participants.desk.reply_minutes"
