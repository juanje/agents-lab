@FR-RECORD-02
Feature: A run records what it ran

  Background:
    Given the test scenario "slots" is in the scenario library, with agents "a" and "b"
    And the scripted model "scripted/one", whose agents end every turn without a tool call
    And an experiment file "e-test" for the scenario "slots", with the model "scripted/one", 1 replica, the base seed 7, 1 activation per agent, and the condition "five-slots", which sets "slots.count" to 5

  Scenario: The first line of a run's log says what the run ran
    When "lab run" runs the experiment file
    Then the first line of the run's log gives its run id, the experiment "e-test", the condition "five-slots" and the resolved configuration, with "slots.count" as 5
    And it gives replica 1, the replica's seed, the model "scripted/one" and the sampling settings its sessions use

  Scenario: The first line gives the code's commit and whether it had uncommitted changes
    When "lab run" runs the experiment file
    Then the first line of the run's log gives the commit of the code that ran
    And it says whether that code's working tree had changes not committed

  Scenario: The first line holds the inventory of the run's condition
    When "lab run" runs the experiment file
    Then the first line of the run's log holds, as data, the inventory "lab inventory" prints for the condition "five-slots"
