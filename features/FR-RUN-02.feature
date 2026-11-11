@FR-RUN-02
Feature: Summaries across replicas

  Background:
    Given a runs directory "runs/e-test" whose index lists these runs, each with its log:
      | condition  | model        | replica | status    | last sample of "held" | last sample of "slot of"   |
      | baseline   | scripted/one | 1       | completed | 1                     | a: 1                       |
      | baseline   | scripted/one | 2       | completed | 3                     | a: 2, b: 1                 |
      | baseline   | scripted/one | 3       | completed | 2                     | a: 1, b: 1                 |
      | baseline   | scripted/one | 4       | stopped   |                       |                            |
      | five-slots | scripted/one | 1       | completed | 4                     | a: 3, b: 1                 |
      | five-slots | scripted/one | 2       | completed | null                  | b: 2                       |

  Scenario: Each condition and model gets its counts, every value and its quartiles
    When "lab summarize runs/e-test" runs
    Then it prints the row for "baseline", "scripted/one" and "held" with 3 completed and 1 stopped, the values 1, 3, 2 in replica order, and the minimum 1, lower quartile 1.5, median 2, upper quartile 2.5 and maximum 3
    And it prints the row for "five-slots", "scripted/one" and "held" with 2 completed, the value 4 and 1 null

  Scenario: A metric with one value per agent gives one row per agent
    When "lab summarize runs/e-test" runs
    Then it prints a row for "baseline", "scripted/one", "slot of" and agent "a" with the values 1, 2, 1
    And a row for agent "b" with the values 1, 1, from replicas 2 and 3

  Scenario: The summary can be written as JSON
    When "lab summarize runs/e-test --json" runs
    Then it prints JSON with the same rows, counts, values and quartiles

  Scenario: A directory without an index is refused
    When "lab summarize runs/missing" runs
    Then it fails with an error that names "runs/missing"
