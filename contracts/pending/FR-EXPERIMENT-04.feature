@FR-EXPERIMENT-04
Feature: Materials are files, referenced and fingerprinted

  Background:
    Given the test scenario "slots" is in the scenario library, with agents "a" and "b"
    And the scripted model "scripted/one", whose agents end every turn without a tool call
    And an experiment file "e-test" for the scenario "slots", with the model "scripted/one", 1 replica, 1 activation per agent, and the condition "baseline", with no change
    And the file "materials/wake.md", next to the experiment file, holds "Morning comes."

  Scenario: A configuration value can come from a material
    Given the condition "baseline" sets "rhythm.text" to the material "materials/wake.md"
    When "lab run" runs the experiment file
    Then agent "a"'s rhythm stimulus has the content "Morning comes."

  Scenario: The setup line gives each material's path and the hash of its content
    Given the condition "baseline" sets "rhythm.text" to the material "materials/wake.md"
    When "lab run" runs the experiment file
    Then the run's setup line lists "materials/wake.md" with the hash of "Morning comes."

  Scenario: A changed material gives a different hash
    Given the condition "baseline" sets "rhythm.text" to the material "materials/wake.md"
    And "lab run" ran the experiment file into one directory
    And the file "materials/wake.md" now holds "Night falls."
    When "lab run" runs the experiment file into another directory
    Then the two runs' setup lines give different hashes for "materials/wake.md"

  Scenario: The inventory lists each material with its path and hash
    Given the condition "baseline" sets "rhythm.text" to the material "materials/wake.md"
    When "lab inventory" runs on the experiment file
    Then it lists the material "materials/wake.md" with the hash of "Morning comes."

  Scenario: A held-out material reaches the scenario but not the inventory or the setup line
    Given the file "materials/keys.toml", next to the experiment file, holds "secret = 42"
    And the condition "baseline" sets "slots.keys" to the held-out material "materials/keys.toml"
    When "lab inventory" runs on the experiment file
    And "lab run" runs the experiment file
    Then the scenario was given "secret = 42" as "slots.keys"
    And the inventory lists "materials/keys.toml" by its path only
    And neither the inventory nor the run's setup line holds "secret = 42"

  Scenario: A material whose file does not exist fails before any model call
    Given the condition "baseline" sets "rhythm.text" to the material "materials/missing.md"
    When "lab run" runs the experiment file
    Then it fails with an error that names "materials/missing.md"
    And no model was called
