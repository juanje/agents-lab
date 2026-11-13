@FR-MONEY-01
Feature: Accounts, invoices, commitments and approvals

  Background:
    Given a test scenario with the agent "ana" and the participants "venue" and "board", whose rule sets take scripted steps
    And the configuration's calendar starts at "day 1 Monday 09:00" with one segment of scale 6000, so one world minute is 10 milliseconds of the run
    And the money's accounts are "ana" with the opening 0, "venue" unlimited and "board" with the opening 5000, and its "discretionary_limit" is 300
    And "ana" has the tools "ledger" and "pay"; "venue" has "issue_invoice", "commit", "release" and "ledger"; "board" has "approve" and "transfer"
    And the durations are "ledger" 3, "pay" 5, "issue_invoice" 2, "commit" 1, "release" 1, "approve" 1 and "transfer" 1 world minutes

  Scenario: An invoice is issued and paid, and the money moves
    Given "board"'s first step is "transfer" 1000 to "ana" for "congress funds"
    And "venue"'s first step is "issue_invoice" to "ana" for 400, due "day 3", for "deposit"
    And "ana"'s scripted turns wait 100 milliseconds, then call "pay" "i-1", then "ledger", then end
    When the run ends
    Then the "pay" call succeeded
    And the "ledger" result gives the balance 600 and the invoice "i-1" from "venue", 400, due "day 3", for "deposit", paid
    And the run's "money_summary" lines give "ana" 600 and "board" 4000

  Scenario Outline: A payment that cannot be made moves nothing
    Given "board"'s first step is "transfer" <funds> to "ana" for "funds"
    And "venue"'s first step is "issue_invoice" to "ana" for 400, due "day 3", for "deposit"
    And "ana"'s scripted turns wait 100 milliseconds, then <calls>, then end
    When the run ends
    Then the last "pay" call failed with the outcome "<outcome>"
    And "ana"'s balance is <balance>

    Examples:
      | funds | calls                                   | outcome            | balance |
      | 1000  | call "pay" "i-9"                        | no_such_invoice    | 1000    |
      | 1000  | call "pay" "i-1", then "pay" "i-1"      | already_paid       | 600     |
      | 100   | call "pay" "i-1"                        | insufficient_funds | 100     |

  Scenario: A commitment that passes the discretionary limit is recorded as an overrun, and nothing is refused
    Given "venue"'s steps are "commit" with "ana" 250 for "hold", then "commit" with "ana" 100 for "projector"
    When the run ends
    Then both "commit" calls succeeded
    And the world recorded one "unapproved_overrun": the commitment "k-2", the committed total 350 and the limit 300

  Scenario: An approved ceiling replaces the discretionary limit
    Given "board"'s first step is "approve" "ana" with the ceiling 2000
    And "venue"'s steps wait 10 world minutes, then "commit" with "ana" 1500 for "booking", then "commit" with "ana" 600 for "catering"
    When the run ends
    Then the world recorded one "unapproved_overrun": the commitment "k-2", the committed total 2100 and the limit 2000

  Scenario: A released commitment no longer counts
    Given "board"'s first step is "approve" "ana" with the ceiling 2000
    And "venue"'s steps wait 10 world minutes, then "commit" with "ana" 1500 for "booking", then "release" "k-1", then "commit" with "ana" 900 for "booking elsewhere"
    When the run ends
    Then the world recorded no "unapproved_overrun"
    And "ana"'s committed total is 900

  Scenario: A ceiling approved later does not remove an overrun already recorded
    Given "venue"'s first step is "commit" with "ana" 400 for "hold"
    And "board"'s steps wait 10 world minutes, then "approve" "ana" with the ceiling 2000
    When the run ends
    Then the world recorded one "unapproved_overrun" for the commitment "k-1", with the limit 300

  Scenario: The issuer sees in its own ledger whether it was paid
    Given "board"'s first step is "transfer" 1000 to "ana" for "funds"
    And "venue"'s steps are "issue_invoice" to "ana" for 400, due "day 3", for "deposit", then wait 30 world minutes, then "ledger"
    And "ana"'s scripted turns wait 100 milliseconds, then call "pay" "i-1", then end
    When the run ends
    Then "venue"'s "ledger" result gives the invoice "i-1" it issued to "ana", paid

  Scenario Outline: Arguments that cannot be followed are refused as the call starts and take no time
    Given "venue"'s first step is <call>
    When the run ends
    Then that call failed with the outcome "invalid_arguments" and took no time

    Examples:
      | call                                                          |
      | "issue_invoice" to "ana" for 0, due "day 3", for "x"          |
      | "issue_invoice" to "zoe" for 10, due "day 3", for "x"         |
      | "issue_invoice" to "ana" for 10, due "Friday", for "x"        |
      | "commit" with "ana" -5 for "x"                                |

  Scenario: Releasing a commitment the caller did not record fails
    Given "venue"'s first step is "release" "k-7"
    When the run ends
    Then that call failed with the outcome "no_such_commitment"

  Scenario: The log keeps every money event and each account's summary
    Given "board"'s first step is "transfer" 1000 to "ana" for "funds"
    And "venue"'s steps are "issue_invoice" to "ana" for 400, due "day 3", for "deposit", then "commit" with "ana" 400 for "booking"
    And "ana"'s scripted turns wait 100 milliseconds, then call "pay" "i-1", then end
    When the run ends
    Then the run's log has "money" lines for the transfer, the invoice, the commitment, the overrun and the payment, each with its parties, amount, ids, run time and world time
    And a "money_summary" line for each account with its balance, committed total, ceiling and unpaid invoices

  Scenario: The inventory gives the money
    When the inventory is made
    Then it gives the accounts "ana" (opening 0), "venue" (unlimited) and "board" (opening 5000), the "discretionary_limit" 300, and each party's money tools

  Scenario Outline: Money that cannot be followed is refused before any model call
    Given the configuration's money is changed so that <change>
    When the run is attempted
    Then it is refused before any model call, with an error that names "<key>"

    Examples:
      | change                                              | key                          |
      | the configuration has no calendar                   | money                        |
      | it has no accounts                                  | money.accounts               |
      | it gives an account to "zoe"                        | money.accounts.zoe           |
      | "ana"'s opening is -10                              | money.accounts.ana.opening   |
      | "venue" has both an opening and "unlimited"         | money.accounts.venue         |
      | its "discretionary_limit" is -1                     | money.discretionary_limit    |
