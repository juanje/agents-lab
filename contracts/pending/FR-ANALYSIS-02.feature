@FR-ANALYSIS-02
Feature: A reserved judge classifies what agents said

  Background:
    Given a runs directory "runs/e-test" with one completed workplace run under the condition "rules-why", whose chosen situations are "open-box" and "jar"
    And its held-out "situation_keys" material gives "open-box" said = { channel = "note", about = "the box arrived open" } and not_said = "what the folded note asks", and gives "jar" said = { channel = "book", about = "a jar without a label was found" }
    And in that run the worker sent the note "The cardboard box came in with its flaps open." and wrote no book entry
    And the judge file "judge.toml" gives the model "scripted/judge", the thinking level "off" and the instructions "materials/judge.md"
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
