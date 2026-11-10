@FR-STIMULUS-01
Feature: Stimuli reach an agent through a declared channel

  Background:
    Given a test world with 3 slots, all empty
    And the sensor "look" returns which slots are empty and which are held
    And the channel "bell" delivers the stimulus "The bell rings." from the source "town bell"

  Scenario: An activation starts with a stimulus from the agent's rhythm
    Given agent "a" runs on a scripted model that ends its first turn without a tool call
    When the run ends
    Then the first message of agent "a"'s activation is a stimulus from the channel "rhythm"

  Scenario: A stimulus that arrives while the agent works reaches it at its next model turn
    Given agent "a" runs on a scripted model whose turns are: a call to "look" after 200 milliseconds; the text "Done." with no tool call
    And the bell rings 100 milliseconds after agent "a" wakes
    When the run ends
    Then agent "a"'s second model turn received "The bell rings." from "town bell"
    And its first model turn did not

  Scenario: A stimulus that arrives while the agent rests reaches it when it wakes
    Given agent "a" makes 2 activations, each ending its first turn without a tool call, and waits 300 milliseconds between them
    And the bell rings while agent "a" rests
    When the run ends
    Then agent "a"'s second activation received "The bell rings." from "town bell" when it woke

  Scenario: Nothing else reaches the agent
    Given agent "a" runs on a scripted model that calls "look", then ends without a tool call
    When the run ends
    Then agent "a"'s session holds only its system prompt, its stimuli, its model turns and its tool results
