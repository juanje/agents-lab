@FR-MESSAGE-01
Feature: Structured messages between participants

  Background:
    Given a test scenario with the agents "ana" and "ben" and the component "desk", each with a mailbox
    And the configuration's calendar starts at "day 1 Monday 09:00" with one segment of scale 600, so one world minute is 100 milliseconds of the run
    And the mail's "delivery_minutes" is [1, 1], its "send_minutes" 3, its "check_minutes" 2 and its "read_minutes" 1, with no time per field or word
    And the mail's notice source is "mail client" and its notice is "New mail from {from}: {subject}"
    And "desk" takes the acts "book", which requires the fields "date" and "rooms", and "ask", which requires none

  Scenario: A message is sent when its call ends, delivered after its delay, and announced
    Given "ana"'s scripted turns call "send_mail" to "ben" with the act "ask", the subject "Friday" and the text "Free on Friday?", then end
    When the run ends
    Then the message was sent 300 milliseconds into the run, within 30, at the world time "day 1 Monday 09:03"
    And the "send_mail" action was given the world's time "day 1 Monday 09:03"
    And it landed in "ben"'s mailbox 400 milliseconds into the run, within 30, at "day 1 Monday 09:04"
    And "ben" received "mail client: New mail from ana: Friday" through the channel "mail_notice"

  Scenario: An agent lists and reads its mail, and a read message is no longer unread
    Given "ana"'s scripted turns call "send_mail" to "ben" with the act "ask", the subject "Friday" and the text "Free on Friday?", then end
    And "ben"'s scripted turns wait 700 milliseconds, then call "check_mail", then "read_mail" with the first message's id, then "check_mail" with "unread_only", then end
    When the run ends
    Then the first "check_mail" result lists one message, from "ana", with the subject "Friday", received at "day 1 Monday 09:04"
    And the "read_mail" result is "From: ana. Act: ask. Free on Friday?"
    And the second "check_mail" result lists no message

  Scenario: Fields are given one by one when a message is read
    Given "ana"'s scripted turns call "send_mail" to "ben" with the act "offer" and the fields date "day 5" and price 900, then end
    And "ben"'s scripted turns wait 700 milliseconds, then call "read_mail" with the first message's id, then end
    When the run ends
    Then the "read_mail" result is "From: ana. Act: offer. date: day 5. price: 900."
    And the message's subject was "offer"

  Scenario: The delay comes from the seed and the sender
    Given the mail's "delivery_minutes" is [1, 5]
    And "ana"'s scripted turns call "send_mail" to "ben" with the act "ask", then end
    When two replicas run with the seed 42, the second with another agent "cy" who has a mailbox
    Then the message's delay was the same in both, between 1 and 5 world minutes

  Scenario Outline: A message its recipient cannot take is refused as it starts, takes no time and is not sent
    Given "ana"'s scripted turns call "send_mail" <message>, then end
    When the run ends
    Then the "send_mail" call failed with the outcome "<outcome>" and took no time
    And its result <result>
    And no message was sent

    Examples:
      | message                                                       | outcome            | result                     |
      | to "desk" with the act "order"                                | act_not_taken      | lists the acts "book, ask" |
      | to "desk" with the act "book" and the field date "day 26"     | missing_field      | names the field "rooms"    |
      | to "zoe" with the act "ask"                                   | unknown_recipient  | names "zoe"                |

  Scenario: Reading a message that is not in the reader's mailbox fails
    Given "ben"'s scripted turns call "read_mail" with the id "m-99", then end
    When the run ends
    Then the "read_mail" call failed with the outcome "no_such_mail"

  Scenario: A component reads its mail and answers through the medium
    Given "desk"'s cycle answers each unread "ask" with the act "answer" and the field free "yes", marking it read
    And "ana"'s scripted turns call "send_mail" to "desk" with the act "ask", then wait 1000 milliseconds, then call "check_mail", then end
    When the run ends
    Then "desk"'s answer was sent to "ana" after "ana"'s message landed, and landed one world minute later
    And "ana" received "mail client: New mail from desk: answer" through the channel "mail_notice"
    And the "check_mail" result lists one message, from "desk", with the subject "answer"

  Scenario: Messages at the start are unread and send no notice
    Given the configuration puts a message in "ana"'s mailbox from "the board", with the act "inform", the subject "Partner session" and the text "A partner society runs session 3.", received at "day 1 Monday 07:30"
    And "ana"'s scripted turns call "check_mail", then end
    When the run ends
    Then the "check_mail" result lists one message, from "the board", with the subject "Partner session", received at "day 1 Monday 07:30"
    And "ana" received no stimulus through the channel "mail_notice"

  Scenario: A message still in transit when the run ends is never delivered
    Given the mail's "delivery_minutes" is [60, 60]
    And the run's time limit is 2 seconds
    And "ana"'s scripted turns call "send_mail" to "ben" with the act "ask", then end
    When the run ends
    Then the run's log has the message's "message_sent" line and no "message_delivered" line for it
    And "ben" received no stimulus through the channel "mail_notice"

  Scenario: Without a notice, mail arrives silently
    Given the mail declares no notice
    And "ana"'s scripted turns call "send_mail" to "ben" with the act "ask", then end
    When the run ends
    Then the message landed in "ben"'s mailbox
    And no channel "mail_notice" is declared, and "ben" received no stimulus from the mail

  Scenario: Durations grow with fields and words when the configuration says so
    Given the mail's "send_minutes_per_field" is 0.5 and its "send_words_per_minute" is 10
    And "ana"'s scripted turns call "send_mail" to "ben" with the act "offer", the fields date "day 5" and price 900, and a text of 20 words, then end
    When the run ends
    Then the "send_mail" call took 6 world minutes: 3, plus 0.5 for each of 2 fields, plus 2 for 20 words, which is 600 milliseconds of the run, within 30

  Scenario: The log keeps each message and its delivery
    Given "ana"'s scripted turns call "send_mail" to "ben" with the act "ask", the subject "Friday" and the text "Free on Friday?", then end
    When the run ends
    Then the run's log has a "message_sent" line with the message's id, "ana", "ben", "ask", its fields, "Friday", "Free on Friday?", and the run time and world time it was sent
    And a "message_delivered" line with the same id and the run time and world time it landed

  Scenario: The inventory gives the mail
    When the inventory is made
    Then it gives the mailboxes of "ana", "ben" and "desk", "desk"'s acts "book" (date, rooms) and "ask" (none), "delivery_minutes" [1, 1], the durations, and the notice's source and text

  Scenario Outline: Mail that cannot be followed is refused before any model call
    Given the configuration's mail is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<key>"

    Examples:
      | change                                                         | key                    |
      | the configuration has no calendar                              | mail                   |
      | its "delivery_minutes" is [5, 1]                               | mail.delivery_minutes  |
      | its "delivery_minutes" is [-1, 1]                              | mail.delivery_minutes  |
      | its "send_minutes" is -1                                       | mail.send_minutes      |
      | it declares acts for "zoe", who has no mailbox                 | mail.acts.zoe          |
      | "desk"'s act "book" requires the field list "date"             | mail.acts.desk.book    |
      | a message at the start goes to "zoe"                           | mail.initial[0].to     |
      | a message at the start to "desk" has the act "order"           | mail.initial[0].act    |
      | a message at the start is received at "day 1 Monday 10:00"     | mail.initial[0].received |
      | it has a notice and no notice source                           | mail.notice_source     |
