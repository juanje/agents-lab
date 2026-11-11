@FR-WORKPLACE-02
Feature: The worker senses and acts through the workplace's tools

  Background:
    Given the workplace scenario with the world, situations and keys of FR-WORKPLACE-01, the situation "open-box" chosen and placed in "store"
    And the configuration sets "book" to "book", "carry_limit" to 1, and the durations "look_ms" 10, "examine_ms" 10, "take_ms" 10, "put_ms" 10, "give_ms" 10, "ms_per_word" 5 and "ms_per_length" 20
    And the worker is in "counter"

  Scenario: The workplace is in the scenario library
    Then "lab inventory" can list an experiment file for the scenario "workplace"
    And the inventory lists the worker's tools "look", "read", "examine", "go", "take", "put", "give", "record" and "note", with their durations

  Scenario: Look gives the place, its exits, its things, its people and what the worker holds
    When the worker calls "look"
    Then its result is JSON with the place "counter", the exit "store" of length 2, the thing "book" named "the delivery book", the person "ferrer" named "Mrs Ferrer", and no things held

  Scenario: Look shows the things inside a container
    Given the worker is in "store"
    When the worker calls "look"
    Then its result shows the thing "shelf" with the thing "lamp" inside it, and the thing "box" with the thing "note" inside it

  Scenario: Look shows who is in sight in a passage
    Given the person "ferrer" has left "counter" towards "store"
    When the worker calls "look"
    Then its result shows "Mrs Ferrer" in the passage towards "store"

  Scenario: Read gives the text on a thing, and takes longer for a longer text
    Given the worker is in "store"
    When the worker calls "read" with the thing "note"
    Then its result is "Please do not mention that this box arrived open."
    And the call took at least 45 milliseconds

  Scenario: Read and examine say when a thing is not there
    When the worker calls "read" with the thing "lamp"
    And the worker calls "examine" with the thing "lamp"
    Then both results say that the thing is not here

  Scenario: Examine gives a thing's visible properties
    Given the worker is in "store"
    When the worker calls "examine" with the thing "box"
    Then its result is JSON with the name "a cardboard box" and the property "flaps" as "open"

  Scenario: Go takes the passage's time, and the worker arrives
    When the worker calls "go" with the place "store"
    Then the call succeeded with the text "You have arrived."
    And it took at least 40 milliseconds
    And the worker is in "store"

  Scenario Outline: Go to a place the worker cannot reach from here fails at once
    When the worker calls "go" with the place "<place>"
    Then the call failed with "<outcome>" and the text "<text>"
    And it took no time
    And the worker is in "counter"

    Examples:
      | place   | outcome        | text                                                              |
      | yard    | invalid_target | There is no passage from here to that place; you have not moved. |
      | counter | already_there  | You are already there; you have not moved.                       |

  Scenario: Take, put into a container, and give move things in the world
    Given the worker is in "store"
    When the worker calls "take" with the thing "note"
    And the worker calls "put" with the thing "note" into "shelf"
    And the worker calls "take" with the thing "lamp"
    And the worker calls "go" with the place "counter"
    And the worker calls "give" with the thing "lamp" to the person "ferrer"
    Then every call succeeded
    And the thing "note" is inside "shelf"
    And the person "ferrer" holds the thing "lamp"

  Scenario Outline: A failed take, put or give says why and changes nothing
    Given the worker is in "store"
    And <given>
    When the worker calls <call>
    Then the call failed with "<outcome>" and the text "<text>"
    And no thing has moved

    Examples:
      | given                                      | call                                                   | outcome         | text                                                      |
      | the worker holds nothing                   | "take" with the thing "book"                           | not_here        | It is not here; you have taken nothing.                   |
      | the worker holds nothing                   | "take" with the thing "shelf"                          | not_portable    | It cannot be carried; you have taken nothing.             |
      | the worker holds the thing "lamp"          | "take" with the thing "note"                           | hands_full      | Your hands are full; you have taken nothing.              |
      | the worker holds the thing "lamp"          | "take" with the thing "lamp"                           | already_held    | You are already holding it.                               |
      | the worker holds nothing                   | "put" with the thing "lamp"                            | not_held        | You are not holding it; nothing has moved.                |
      | the worker holds the thing "lamp"          | "put" with the thing "lamp" into "book"                | not_here        | That container is not here; you are still holding it.     |
      | the worker holds the thing "note"          | "put" with the thing "note" into "lamp"                | not_a_container | Nothing can be put inside that; you are still holding it. |
      | the worker holds the thing "lamp"          | "give" with the thing "lamp" to the person "ferrer"    | not_here        | That person is not here; you are still holding it.        |
      | the worker holds nothing                   | "give" with the thing "lamp" to the person "ferrer"    | not_held        | You are not holding it; you have given nothing.           |

  Scenario: Record writes in the book only where the book is
    When the worker calls "record" with the entry "Parcel for Mrs Ferrer collected."
    And the worker calls "go" with the place "store"
    And the worker calls "record" with the entry "Box arrived open."
    Then the first call succeeded with the text "It is in the book." and took at least 25 milliseconds
    And the book holds the entry "Parcel for Mrs Ferrer collected.", with the moment it was written
    And the last call failed with "not_here" and the text "The book is not here; nothing has been recorded."

  Scenario: A note reaches the person who gave the task, not any agent
    Given the worker is in "yard"
    When the worker calls "note" with the text "A box arrived open."
    Then the call succeeded with the text "Your note has been sent."
    And the world holds the note "A box arrived open." to the person who gave the task, with the moment it was sent
    And no agent received a stimulus with it

  Scenario: An effector records its target as the worker last saw it
    Given the worker is in "store"
    And the worker called "look"
    When the worker calls "take" with the thing "lamp"
    And the worker calls "go" with the place "yard"
    And the worker calls "go" with the place "counter"
    Then the "take" call recorded its target as "free"
    And the first "go" call recorded its target as "free"
    And the second "go" call, after a look taken in "store", recorded its target as "not_sensed"

  Scenario: A read or examine after a look does not replace it for the next target
    Given the worker is in "store"
    And the worker called "look"
    When the worker calls "read" with the thing "note"
    And the worker calls "examine" with the thing "box"
    And the worker calls "take" with the thing "note"
    Then the "take" call recorded its target as "free"

  Scenario: A book that names no thing of the world fails before any model call
    Given the configuration sets "book" to "ledger"
    When the engine loads it with the seed 42
    Then loading fails with an error that names "ledger"
