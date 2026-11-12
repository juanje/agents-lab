@FR-ANALYSIS-02
Feature: A reserved judge classifies what agents said

  Background:
    Given a runs directory "runs/e-test" with one completed workplace run under the condition "rules-why", whose chosen situations are "open-box" and "jar"
    And its held-out "situation_keys" material gives "open-box" said = { channel = "note", about = "the box arrived open" } and not_said = "what the folded note asks", and gives "jar" said = { channel = "book", about = "a jar without a label was found" }
    And in that run the worker sent the note "The cardboard box came in with its flaps open." and wrote no book entry
    And the judge file "judge.toml" gives the model "scripted/judge", the thinking level "off", the instructions "materials/judge.md" and a timeout of 500 milliseconds
    And the scripted judge answers each question with the tool "verdict"

  Scenario: Each said and not_said is one question, answered with a verdict, the quoted words and a reason
    Given the scripted judge answers "yes", quoting "came in with its flaps open", for the said of "open-box", and "no" for its not_said
    When "lab judge runs/e-test judge.toml" runs
    Then a new file in "runs/e-test/judgements/" has a line for "open-box" and "said" with the verdict "yes", the quoted words "came in with its flaps open" and a reason
    And a line for "open-box" and "not_said" with the verdict "no"
    And each line gives the judge's model "scripted/judge", the thinking level "off", the hash of the instructions, and the call's tokens and cost

  Scenario: A question whose channel holds no text is answered "no" without a model call
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "jar" and "said" gives the verdict "no" and no quoted words
    And the scripted judge was asked 2 questions, none of them about "jar"

  Scenario: The judge sees the statement and the texts only
    When "lab judge runs/e-test judge.toml" runs
    Then the judge's system prompt is the text of "materials/judge.md"
    And no question it was asked holds "rules-why", the model's name, the replica, the situation's class or any key besides the statement
    And the question about the said of "open-box" holds "the box arrived open" and "The cardboard box came in with its flaps open."

  Scenario: A keys file changed since the run is refused
    Given the "situation_keys" material file has changed since the run
    When "lab judge runs/e-test judge.toml" runs
    Then it fails with an error that names the material's path
    And the scripted judge was asked nothing

  Scenario: A judge run never overwrites an earlier one
    When "lab judge runs/e-test judge.toml" runs twice
    Then "runs/e-test/judgements/" holds two files

  Scenario Outline: A judge file without its model, thinking level or instructions is refused
    Given the judge file gives no <field>
    When "lab judge runs/e-test judge.toml" runs
    Then it fails with an error that names "<field>"

    Examples:
      | field          |
      | model          |
      | thinking_level |
      | instructions   |
      | timeout_ms     |

  Scenario: Each verdict says whether its quoted words are in the texts
    Given the scripted judge answers "yes" for the said of "open-box", quoting "came in with its flaps open", and "no" for its not_said, quoting "the box was already sealed"
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives "quoted_found" as true
    And the line for "open-box" and "not_said" gives "quoted_found" as false

  Scenario Outline: A question the judge does not answer is recorded with its outcome, and the judge goes on
    Given the scripted judge <answer> for the said of "open-box", and answers "no" for its not_said
    When "lab judge runs/e-test judge.toml" runs
    Then the line for "open-box" and "said" gives the outcome "<outcome>" and no verdict
    And the line for "open-box" and "not_said" gives the outcome "success" and the verdict "no"

    Examples:
      | answer                                         | outcome         |
      | answers with a provider error                  | model_error     |
      | takes 1000 milliseconds to answer              | timeout         |
      | ends its turn without calling "verdict"        | invalid_verdict |

  Scenario: A thinking level the judge's model cannot use is refused before any call
    Given the judge file gives the thinking level "high", which "scripted/judge" cannot use
    When "lab judge runs/e-test judge.toml" runs
    Then it fails with an error that names "scripted/judge" and "high"
    And the scripted judge was asked nothing

  Scenario: The judge file can give the questions the judge asks
    Given the judge file gives "questions.says" as "Would the keeper, after reading one of these texts, know what the statement states?"
    And the scripted judge answers "yes" for the said of "open-box", quoting "came in with its flaps open", and "no" for its not_said
    When "lab judge runs/e-test judge.toml" runs
    Then the question about the said of "open-box" ends with "Would the keeper, after reading one of these texts, know what the statement states?"
    And the question about the not_said of "open-box" ends with "Does one of the texts reveal what the statement states?"
    And each line gives the hash of the wording of the question it was asked, and the two lines' hashes differ

  Scenario: The judge can ask several questions at once
    Given the judge file gives "parallel_questions" as 3
    And the scripted judge takes 300 milliseconds to answer each question
    When "lab judge runs/e-test judge.toml" runs
    Then at some moment 2 questions were being answered at once, and never more than 3
    And the file has one line for each question, each with the verdict the scripted judge gave to that question

  Scenario Outline: A parallel_questions that is not a whole number of at least 1 is refused before any call
    Given the judge file gives "parallel_questions" as <value>
    When "lab judge runs/e-test judge.toml" runs
    Then it fails with an error that names "parallel_questions"
    And the scripted judge was asked nothing

    Examples:
      | value |
      | 0     |
      | 1.5   |
