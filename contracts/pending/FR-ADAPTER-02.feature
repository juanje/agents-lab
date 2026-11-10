@FR-ADAPTER-02
Feature: Each agent is one Pi session for the whole run

  Background:
    Given a test world with 3 slots, all empty
    And the sensor "look" returns which slots are empty and which are held
    And the effector "take" puts the agent in a slot, only if that slot is empty, and otherwise fails with "slot_taken"
    And the scenario's system prompt is "You live in a row of slots."

  Scenario: All of an agent's model turns run in one Pi session
    Given agent "a" makes 2 activations: in the first its model calls "look", then ends; in the second it ends its first turn without a tool call
    When the run ends
    Then all of agent "a"'s model turns ran in the same Pi session

  Scenario: The session's system prompt is the scenario's and nothing else
    Given agent "a" runs on a scripted model that ends its first turn without a tool call
    When the run ends
    Then the system prompt agent "a"'s model received is exactly "You live in a row of slots."

  Scenario: The session offers no built-in tools
    Given agent "a" runs on a scripted model that ends its first turn without a tool call
    When the run ends
    Then agent "a"'s model was offered none of Pi's built-in tools

  Scenario: The prompt never names the model
    Given agent "a" runs on a scripted model whose id is "scripted-model-x"
    And its model ends its first turn without a tool call
    When the run ends
    Then nothing agent "a"'s model received mentions "scripted-model-x"

  Scenario: Nothing of the person's Pi setup reaches the session
    Given the person's Pi directory holds a skill, an extension, a prompt template, an AGENTS.md and settings that choose another model
    And agent "a" runs on a scripted model that ends its first turn without a tool call
    When the run ends
    Then agent "a"'s model received nothing from the person's Pi directory
    And agent "a"'s turns ran on its scripted model
    And the person's Pi directory is unchanged

  Scenario: A provider error ends the activation
    Given agent "a" runs on a scripted model whose first turn is a provider error "overloaded"
    When the run ends
    Then agent "a"'s first model turn has the outcome "model_error" with the message "overloaded"
    And agent "a"'s activation ended after it
    And the run did not stop

  Scenario: A model turn longer than the timeout is aborted
    Given the timeout for a model turn is 200 milliseconds
    And agent "a" runs on a scripted model whose first turn is a call to "take" with slot 1, after 1000 milliseconds
    When the run ends
    Then agent "a"'s first model turn has the outcome "timeout"
    And every slot is empty

  Scenario: Model turns wait for a free slot under the parallelism limit
    Given the parallelism limit is 1
    And agents "a" and "b" each run on a scripted model that ends its first turn without a tool call, after 100 milliseconds
    And both agents wait 0 milliseconds before their first activation
    When the run ends
    Then agent "a"'s and agent "b"'s model turns did not overlap in time
    And one of them waited at least 100 milliseconds for a model slot
