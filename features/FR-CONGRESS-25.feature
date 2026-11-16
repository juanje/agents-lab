@FR-CONGRESS-25
Feature: Venues and caterers say what a permit is and where it comes from

  Background:
    Given the congress scenario with the venues "v1" (catering "in_house", its in-house caterer "c9", which serves "gluten_free" with limit 5), "v2" (catering "outside_fee", "outside_fee_per_head" 5) and "v3" (catering "outside_free"), and the caterer "c1"

  Scenario Outline: A venue's quote says its catering rule in words
    When the organiser asks "<venue>" for a quote for "day 26"
    Then the quote's "catering" is "<sentence>"
    And the venue's terms document says "Catering: <sentence>"

    Examples:
      | venue | sentence                                                                                                                                                                                                   |
      | v3    | outside_free: any caterer may serve here; no permit is needed.                                                                                                                                              |
      | v2    | outside_fee: outside caterers may serve here for a fee of 5 per head. Ask for the extra outside_catering; when you accept it, we give a permit number your caterer needs on its order.                      |
      | v1    | in_house: our own caterer serves all meals. For a diet it cannot serve in full, ask for the extra outside_catering naming the diet; when you accept it, we give a permit number for an outside caterer, for that diet only. |

  Scenario: An in-house venue asked for outside catering without a diet says why
    When the organiser sends "v1" the act "request_extra" with the item "outside_catering" and the attendance 40
    Then "v1" answers "not_available" for "outside_catering" with the reason "name a diet our caterer cannot serve in full"

  Scenario Outline: A caterer's refusal for a permit says what it needs
    Given <given>
    When the organiser sends "c1" the act "order" with the date "day 26", the venue "<venue>", <permit> and the counts "<counts>"
    Then "c1" answers "order_refused" with the reason "<reason>" and <fields>

    Examples:
      | given                                                                       | venue | permit                         | counts           | reason                | fields                                                                                                          |
      | no permit was given                                                         | v2    | no permit                      | standard: 40     | venue_requires_permit | the venue "v2" and needs "the permit number v2 gives when you accept its extra outside_catering"               |
      | "v2" gave the organiser the permit "v2-permit-1" for outside catering       | v2    | the permit "outside_catering"  | standard: 40     | permit_unknown        | the venue "v2", the permit "outside_catering" and needs "a permit number v2 gave you; v2 did not give this one" |
      | "v1" gave the organiser the permit "v1-permit-1" for 8 "gluten_free" meals  | v1    | the permit "v1-permit-1"       | gluten_free: 9   | permit_exceeded       | the diet "gluten_free", the attendance 8 and needs "only gluten_free meals, at most 8"                         |

  Scenario: A valid order is still confirmed
    Given "v2" gave the organiser the permit "v2-permit-1" for outside catering
    When the organiser sends "c1" the act "order" with the date "day 26", the venue "v2", the permit "v2-permit-1" and the counts "standard: 40"
    Then "c1" answers "order_confirmed"

  Scenario: An order with no venue is refused
    When the organiser sends "c1" the act "order" with the date "day 26" and the counts "standard: 40"
    Then "c1" answers "order_refused" with the reason "venue_required"
    And "c1" holds no order for "day 26"

  # Approved addition (2026-11-16): the directory says an order names its venue and may carry a permit.

  Scenario: The directory lists the caterer's order with its venue and permit
    Given the "knowledge" text is "{directory}"
    When the run ends
    Then the organiser's system prompt says "A caterer takes ask_quote (attendance, diets), order (counts, date, venue, permit), final_numbers (counts), cancel_order."

  Scenario: An order sent with no venue fails at once
    Given the organiser's scripted turns call "send_mail" to "c1" with the act "order", the date "day 26" and the counts "standard: 40", then end
    When the run ends
    Then the "send_mail" call failed with the outcome "missing_field" and took no time, naming "venue", and "c1" received nothing
