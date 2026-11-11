@FR-SPACE-03
Feature: A space of places connected by passages

  Background:
    Given a space with the places "hall", "store" and "yard", a passage of length 2 between "hall" and "store", and a passage of length 5 between "hall" and "yard"
    And entity "a" is in "hall" and entity "b" is in "store"

  Scenario: The space says where an entity is
    Then entity "a" is in "hall"
    And entity "z" is nowhere in the space

  Scenario: A place's exits are the places one passage away, with each passage's length
    Then "hall" has the exits "store", of length 2, and "yard", of length 5
    And "store" has the exit "hall", of length 2

  Scenario: A place holds any number of entities
    Given entity "c" is in "hall"
    Then the entities in "hall" are "a" and "c"
    And "yard" holds no entities

  Scenario: An entity that leaves a place is in the passage until it arrives
    When entity "a" leaves "hall" towards "yard"
    Then entity "a" is in the passage between "hall" and "yard"
    And neither "hall" nor "yard" holds entity "a"
    When entity "a" arrives
    Then entity "a" is in "yard"

  Scenario: A passage can be crossed both ways
    When entity "a" leaves "hall" towards "store"
    And entity "a" arrives
    And entity "a" leaves "store" towards "hall"
    And entity "a" arrives
    Then entity "a" is in "hall"
    And the entities in "store" are "b"

  Scenario: From a place, an entity sees that place and the passages that leave it
    Given entity "c" is in "hall"
    And entity "d" is in "yard"
    And entity "e" has left "yard" towards "hall"
    Then entity "a" has in sight "c" and "e"
    And entity "a" does not have in sight "b" or "d"

  Scenario: From a passage, an entity sees the passage and the two places it joins
    Given entity "d" is in "yard"
    And entity "e" has left "yard" towards "hall"
    And entity "f" has left "hall" towards "yard"
    Then entity "e" has in sight "a", "d" and "f"
    And entity "e" does not have in sight "b"

  Scenario: No one sees through walls
    Given entity "d" is in "yard"
    Then entity "b" does not have in sight "d"
    And entity "d" does not have in sight "b"

  Scenario: Leaving towards a place that is not one passage away is refused
    When entity "b" leaves "store" towards "yard"
    Then it is refused with an error that names the place "yard"
    And entity "b" is in "store"

  Scenario Outline: Leaving with an unknown entity or towards an unknown place, or arriving without crossing, is refused
    When <action>
    Then it is refused with an error that names <named>
    And entity "a" is in "hall"

    Examples:
      | action                                     | named              |
      | entity "z" leaves "store" towards "hall"   | entity "z"         |
      | entity "a" leaves "hall" towards "garden"  | the place "garden" |
      | entity "a" arrives                         | entity "a"         |

  Scenario Outline: A layout with an unknown place or a passage without length is refused
    When a space is built with the places "hall" and "store" and <passage>
    Then it is refused with an error that names <named>

    Examples:
      | passage                                              | named              |
      | a passage of length 2 between "hall" and "garden"    | the place "garden" |
      | a passage of length 0 between "hall" and "store"     | the length 0       |

  Scenario: Moving through a passage takes the time per unit of length multiplied by its length
    Given a test place world with the same layout, where the effector "go" moves the calling agent to a place, taking 100 milliseconds per unit of length
    And agent "a" is in "hall" and runs on a scripted model that calls "go" to "yard", then ends without a tool call
    When the run ends
    Then agent "a"'s "go" call ended at least 500 milliseconds after it started
    And agent "a" is in "yard"

  Scenario: An agent on its way is in the passage, where others see it
    Given a test place world with the same layout, where the effector "go" moves the calling agent to a place, taking 100 milliseconds per unit of length
    And agent "b" is in "hall" and runs on a scripted model that ends without a tool call
    And agent "a" is in "hall" and runs on a scripted model that calls "go" to "yard", then ends without a tool call
    When the run ends
    Then 250 milliseconds after agent "a"'s "go" call started, agent "a" was in the passage between "hall" and "yard", neither "hall" nor "yard" held it, and agent "b" had it in sight
