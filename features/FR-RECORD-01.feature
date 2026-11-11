@FR-RECORD-01
Feature: Everything an agent does is recorded

  Background:
    Given a test world with 3 slots, all empty
    And the sensor "look" takes no time and returns which slots are empty and which are held
    And the effector "take" takes 100 milliseconds, puts the agent in a slot when it lands, and fails with "slot_taken" when the slot is held when it lands
    And the target of "take", in the agent's last sensing, is the slot it names

  Scenario: Each run writes one new log file named with its run id
    Given agent "a" runs on a scripted model that ends its first turn without a tool call
    When the run ends
    Then the run wrote one log file, named with its run id
    And every line of it is a JSON object

  Scenario: An activation and its stimulus are recorded
    Given agent "a" runs on a scripted model that ends its first turn without a tool call
    When the run ends
    Then the log has an activation line for agent "a", with when it woke and when it ended
    And a stimulus line for agent "a" from the channel "rhythm", with its source, its content and when it was delivered

  Scenario: A model turn is recorded
    Given agent "a" runs on a scripted model whose first turn is the text "Nothing to do." with no tool call, after 50 milliseconds
    When the run ends
    Then the log has a model turn line for agent "a" with the text "Nothing to do.", the model that answered, its wait for a model slot, a latency of at least 50 milliseconds, its tokens and its cost

  Scenario: A sensor call is recorded with its result
    Given agent "b" holds slot 2
    And agent "a" runs on a scripted model that calls "look", then ends without a tool call
    When the run ends
    Then the log has a tool call line for agent "a"'s "look" call, with the call as the model made it, when it started and ended, the outcome "success" and its result

  Scenario: An effector call is recorded with what the agent knew
    Given agent "a" runs on a scripted model that calls "look", then calls "take" with slot 1, then ends without a tool call
    And agent "b" runs on a scripted model whose "take" of slot 1 lands while agent "a"'s "take" is under way
    When the run ends
    Then the log's tool call line for agent "a"'s "take" call gives the outcome "slot_taken", the target as sensed "free", and 1 change since its last sensing

  Scenario: A run never writes to an existing file
    Given a previous run wrote its log
    And agent "a" runs on a scripted model that ends its first turn without a tool call
    When the run ends
    Then there are two log files
    And the first one is unchanged

  Scenario: A run that stops on an error says so in its last line
    Given an effector that throws an error when it runs
    And agent "a" runs on a scripted model that calls that effector, then ends without a tool call
    When the run stops on that error
    Then the last line of the run's log says the run stopped and gives the error

  Scenario: A session that fails to open stops the run and closes the sessions already open
    Given agent "a" runs on a scripted model that ends its first turn without a tool call
    And agent "b" runs on a model whose session fails to open
    When the run stops on that error
    Then the last line of the run's log says the run stopped and names agent "b"
    And agent "a"'s session is closed

  Scenario: An effector call made without an earlier sensing says so
    Given agent "a" runs on a scripted model that calls "take" with slot 1, then ends without a tool call
    When the run ends
    Then the log's tool call line for agent "a"'s "take" call gives the target as sensed "not_sensed" and no count of changes since sensing

  Scenario: A call the harness rejects for its arguments is recorded as invalid_arguments
    Given agent "a" runs on a scripted model that calls "take" with slot "one", then ends without a tool call
    When the run ends
    Then the log's tool call line for agent "a"'s "take" call gives the outcome "invalid_arguments"

  Scenario: A call left unrun when the time limit cuts its turn is recorded as cut_off
    Given agent "a" runs on a scripted model whose first turn calls "look" and then "take" with slot 1
    And the sensor "look" takes 300 milliseconds
    And the run's time limit is 100 milliseconds
    When the run ends
    Then the log's tool call line for agent "a"'s "take" call gives the outcome "cut_off"

  Scenario: An effector call records which agents applied the changes since its agent's last sensing
    Given agent "a" runs on a scripted model that calls "look", then calls "take" with slot 1, then ends without a tool call
    And agent "b" runs on a scripted model whose "take" of slot 1 lands while agent "a"'s "take" is under way
    When the run ends
    Then the log's tool call line for agent "a"'s "take" call gives 1 change since its last sensing, applied by agent "b"

  Scenario: An effector call records the text its agent received
    Given the effector "take" declares the text "Someone already holds that slot." for "slot_taken"
    And agent "b" holds slot 1
    And agent "a" runs on a scripted model that calls "take" with slot 1, then ends without a tool call
    When the run ends
    Then the log's tool call line for agent "a"'s "take" call gives the outcome "slot_taken" and the text "Someone already holds that slot."

  Scenario: A model turn records the reasoning its provider returned
    Given agent "a" runs on a scripted model whose first turn has the reasoning "The slot may be taken; I should look first." and calls "look", then ends without a tool call
    When the run ends
    Then the log's first model turn line for agent "a" gives the reasoning "The slot may be taken; I should look first."
