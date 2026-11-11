@FR-EXPERIMENT-01
Feature: An experiment file names its scenario, conditions, models and replicas

  Background:
    Given a valid experiment file "e-test" for the test scenario "slots", with the model "scripted/one", 2 replicas, the base seed 7, a time limit of 1000 milliseconds, 3 activations per agent, a parallelism limit of 2, a model turn timeout of 500 milliseconds, and the conditions "baseline", with no change, and "five-slots", which sets "slots.count" to 5

  Scenario: A valid experiment file is read
    When the engine reads it
    Then it gives the id "e-test", the scenario "slots", 2 conditions, 1 model and 2 replicas with the base seed 7
    And its limits are a time limit of 1000 milliseconds, 3 activations per agent, a parallelism limit of 2 and a model turn timeout of 500 milliseconds

  Scenario: A condition is a change over the scenario's base configuration
    When the engine reads it
    Then its condition "five-slots" sets "slots.count" to 5
    And its condition "baseline" changes nothing

  Scenario Outline: A file without a required field is refused, naming it
    Given the file has no <field>
    When the engine reads it
    Then reading fails with an error that names "<field>"

    Examples:
      | field      |
      | id         |
      | scenario   |
      | models     |
      | replicas   |
      | seed       |
      | limits     |
      | conditions |

  Scenario Outline: A field of the wrong kind is refused, naming the field and what was expected
    Given the file sets "<field>" to <value>
    When the engine reads it
    Then reading fails with an error that names "<field>" and "<expected>"

    Examples:
      | field    | value        | expected                     |
      | replicas | the text "2" | a whole number of at least 1 |
      | replicas | 0            | a whole number of at least 1 |
      | seed     | 4294967296   | a whole number from 0 to 4294967295 |
      | seed     | -1           | a whole number from 0 to 4294967295 |
      | seed     | 1.5          | a whole number from 0 to 4294967295 |
      | models   | an empty list | at least one model           |

  Scenario: A key the schema does not know is refused, naming it
    Given the file sets "replica" to 2
    When the engine reads it
    Then reading fails with an error that names "replica"
