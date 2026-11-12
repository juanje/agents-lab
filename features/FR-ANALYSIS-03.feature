@FR-ANALYSIS-03
Feature: The judge's quotes are matched as text, its questions can be repeated, and provider errors retried

  Background:
    Given a runs directory "runs/e-test" with one completed workplace run under the condition "rules-why", whose chosen situations are "open-box" and "jar"
    And its held-out "situation_keys" material gives "open-box" said = { channel = "note", about = "the box arrived open" } and not_said = "what the folded note asks", and gives "jar" said = { channel = "book", about = "a jar without a label was found" }
    And in that run the worker sent the notes "The cardboard box came in with its flaps open; I didn’t close it." and "Label reads “Mr G. Ha... , 1 Church St...”, the rest is smudged."
    And the judge file "judge.toml" gives the model "scripted/judge", the thinking level "off", the instructions "materials/judge.md" and a timeout of 500 milliseconds
    And the scripted judge answers each question with the tool "verdict"

  Scenario Outline: A quote that differs from a text only in quotes, spaces or case is found
    Given the scripted judge answers "yes" for the said of "open-box", quoting <quoted>
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives "quoted_found" as true

    Examples:
      | quoted                                              |
      | "I didn't close it"                                 |
      | "the cardboard box came in"                         |
      | "came in with  its\nflaps open"                     |
      | "Label reads \"Mr G. Ha... , 1 Church St...\""      |

  Scenario Outline: A quote whose fragments are joined by an ellipsis is found when one text holds them in order
    Given the scripted judge answers "yes" for the said of "open-box", quoting <quoted>
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives "quoted_found" as <found>

    Examples:
      | quoted                                                  | found |
      | "The cardboard box ... flaps open"                      | true  |
      | "The cardboard box … flaps open"                        | true  |
      | "...came in with its flaps open..."                     | true  |
      | "Mr G. Ha … the rest is smudged"                        | true  |
      | "flaps open ... The cardboard box"                      | false |
      | "flaps open ... the rest is smudged"                    | false |

  Scenario Outline: A quote with a word changed, added or dropped is not found
    Given the scripted judge answers "yes" for the said of "open-box", quoting <quoted>
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives "quoted_found" as false

    Examples:
      | quoted                                   |
      | "The cardboard box came with its flaps open" |
      | "The cardboard box came in with its flaps wide open" |
      | "I did not close it"                     |

  Scenario: A quote that is only an ellipsis has no quoted_found
    Given the scripted judge answers "yes" for the said of "open-box", quoting "…"
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives no "quoted_found"

  Scenario: Without repeats, each question is asked once, and its line gives its one answer
    Given the scripted judge answers "yes" for the said of "open-box", quoting "came in with its flaps open", and "no" for its not_said
    When "lab judge runs/e-test judge.toml" runs
    Then the scripted judge was asked 2 questions
    And the line for "open-box" and "said" gives "repeats" as 1, one answer with the verdict "yes", the verdict "yes", and the agreement 1 agreeing of 1 valid

  Scenario: Each question is asked as many times as repeats says, and its verdict is the majority
    Given the judge file gives "repeats" as 3
    And the scripted judge answers the said of "open-box" with "yes" quoting "flaps open", then "no" quoting "", then "yes" quoting "came in with its flaps open"
    And it answers the not_said of "open-box" "no" each time
    When "lab judge runs/e-test judge.toml" runs
    Then the scripted judge was asked 6 questions, each with nothing of the others
    And the line for "open-box" and "said" gives the outcome "success", the verdict "yes", the quoted words "flaps open", and the agreement 2 agreeing of 3 valid
    And it gives its 3 answers in the order asked, each with its outcome, verdict, quoted words, reason, "quoted_found", tokens and cost
    And its tokens and cost are the sums of its answers'
    And the line for "open-box" and "not_said" gives the verdict "no" and the agreement 3 agreeing of 3 valid

  Scenario: The majority is over the valid answers
    Given the judge file gives "repeats" as 3
    And the scripted judge answers the said of "open-box" with a provider error "400 bad request", then "no", then "no"
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives the outcome "success", the verdict "no" and the agreement 2 agreeing of 2 valid
    And its first answer gives the outcome "model_error" and the message "400 bad request"

  Scenario: Valid answers that split evenly are a tie, with no verdict
    Given the judge file gives "repeats" as 3
    And the scripted judge answers the said of "open-box" with "yes" quoting "flaps open", then takes 1000 milliseconds to answer, then "no"
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives the outcome "tie", no verdict, no quoted words, and the agreement 1 agreeing of 2 valid
    And its answers give the outcomes "success", "timeout" and "success"

  Scenario: A question with no valid answer has the outcome of its first answer
    Given the judge file gives "repeats" as 3
    And the scripted judge answers the said of "open-box" by ending its turn without calling "verdict", then with a provider error "400 bad request", then by ending its turn without calling "verdict"
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives the outcome "invalid_verdict", no verdict and no agreement
    And its answers give the outcomes "invalid_verdict", "model_error" and "invalid_verdict"

  Scenario: A question with no texts is answered without a call, however many repeats
    Given the judge file gives "repeats" as 3
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "jar" and "said" gives the verdict "no", no answers and no agreement
    And no question the scripted judge was asked is about "jar"

  Scenario: Repeats share the parallel_questions slots
    Given the judge file gives "repeats" as 3 and "parallel_questions" as 2
    And the scripted judge takes 300 milliseconds to answer each question
    When "lab judge runs/e-test judge.toml" runs
    Then at some moment 2 calls were being answered at once, and never more than 2
    And the scripted judge was asked 6 questions

  Scenario Outline: A repeats that is not an odd whole number of at least 1 is refused before any call
    Given the judge file gives "repeats" as <value>
    When "lab judge runs/e-test judge.toml" runs
    Then it fails with an error that names "repeats"
    And the scripted judge was asked nothing

    Examples:
      | value |
      | 0     |
      | -1    |
      | 2     |
      | 1.5   |
      | "3"   |

  Scenario: A provider error with a 5xx status is retried, and the retries are in the answer
    Given the judge file gives "retries" as 2 and "retry_wait_ms" as 50
    And the scripted judge answers the said of "open-box" with a provider error "502 Bad Gateway", then a provider error "OpenAI API error (503): unavailable", then "yes" quoting "flaps open"
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives the outcome "success" and the verdict "yes"
    And its answer gives 2 retries: attempt 1 with the wait 50 and the message "502 Bad Gateway", and attempt 2 with the wait 100 and the message "OpenAI API error (503): unavailable"
    And the third call was asked at least 150 milliseconds after the first

  Scenario: A rate limit is retried as a 5xx is
    Given the judge file gives "retries" as 1 and "retry_wait_ms" as 50
    And the scripted judge answers the said of "open-box" with a provider error "OpenAI API error (429): rate limit reached", then "yes" quoting "flaps open"
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives the outcome "success" and its answer gives 1 retry

  Scenario: When the retries are spent the answer is a model error
    Given the judge file gives "retries" as 1 and "retry_wait_ms" as 50
    And the scripted judge answers the said of "open-box" with a provider error "502 Bad Gateway" every time
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives the outcome "model_error", the message "502 Bad Gateway" and no verdict
    And the scripted judge was asked the said of "open-box" 2 times

  Scenario Outline: Other failures are not retried
    Given the judge file gives "retries" as 2 and "retry_wait_ms" as 50
    And the scripted judge <answer> for the said of "open-box", and answers "no" for its not_said
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives the outcome "<outcome>" and its answer gives no retries
    And the scripted judge was asked the said of "open-box" once

    Examples:
      | answer                                           | outcome         |
      | answers with a provider error "400 bad request"  | model_error     |
      | takes 1000 milliseconds to answer                | timeout         |
      | ends its turn without calling "verdict"          | invalid_verdict |

  Scenario: Without retries, a 5xx is a model error at once
    Given the scripted judge answers the said of "open-box" with a provider error "502 Bad Gateway", then "yes"
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives the outcome "model_error" and no verdict
    And the scripted judge was asked the said of "open-box" once

  Scenario Outline: A retries or retry_wait_ms out of its range is refused before any call
    Given the judge file gives "<field>" as <value>
    When "lab judge runs/e-test judge.toml" runs
    Then it fails with an error that names "<field>"
    And the scripted judge was asked nothing

    Examples:
      | field         | value |
      | retries       | -1    |
      | retries       | 1.5   |
      | retry_wait_ms | 0     |
      | retry_wait_ms | 2.5   |
