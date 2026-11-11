@FR-NEIGHBOURHOOD-01
Feature: A neighbourhood from a seed

  Background:
    Given the neighbourhood scenario with a grid 6 cells wide and 6 cells high and 10 residents of two kinds

  Scenario: The residents start on distinct cells, half of each kind
    When the engine loads it with the seed 42
    Then the grid holds 10 residents on 10 distinct cells
    And 5 of them are of one kind and 5 of the other

  Scenario: The same seed gives the same neighbourhood
    When the engine loads it twice with the seed 42
    Then the residents start on the same cells, with the same kinds, both times

  Scenario: The system prompt describes the resident, and a rule comes only from the condition
    Given a condition "preference" that adds the text "You would move only if fewer than a third of your neighbours are of your kind."
    When the engine loads it with the seed 42 and the condition "preference"
    Then each resident's system prompt names its kind
    And it ends with "You would move only if fewer than a third of your neighbours are of your kind."
    And without the condition, the system prompt holds no preference or rule

  Scenario: The rhythm channel's source and text come from the configuration
    Given the configuration sets the rhythm channel's source to "your own pace" and its text to "Time passes."
    When the engine loads it with the seed 42
    Then each resident's stimuli on the channel "rhythm" have the source "your own pace" and the content "Time passes."
