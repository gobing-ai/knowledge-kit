```gherkin
Feature: Daily AI Voice v3 replacement corrections

  @core
  Scenario: R12 — Fresh voice3 runs select current items and freeze complete validated bundles
    Given the voice3 migration audit identified F01, F02, F06, F15, F16, F21, F23
    When repair voice3 generation closure, pool routing and complete episode bundles
    Then the task requirements and failure cases have repeatable local evidence
    And no production publication or scheduler activation is performed by verification

  @core
  Scenario: R13 — Draft and dummy launches never publish live on any selected operation
    Given the voice3 migration audit identified F03, C01
    When enforce operation-specific draft and live boundaries for matrix publishing
    Then the task requirements and failure cases have repeatable local evidence
    And no production publication or scheduler activation is performed by verification

  @core
  Scenario: R14 — Every real publish variant carries current platform-aware safety evidence
    Given the voice3 migration audit identified F04, F05
    When carry reviewed variant safety and platform exclusions through the voice3 bundle
    Then the task requirements and failure cases have repeatable local evidence
    And no production publication or scheduler activation is performed by verification

  @core
  Scenario: R15 — Window sends bind receipts and RSS proof to one bundle revision
    Given the voice3 migration audit identified F11, F12, F13, F17, F19
    When bind matrix receipts, links and rss proof to the current bundle revision
    Then the task requirements and failure cases have repeatable local evidence
    And no production publication or scheduler activation is performed by verification

  @core
  Scenario: R16 — Receipt outcomes drive safe retries settlement and mixed dummy tails
    Given the voice3 migration audit identified F07, F14, F18, F20
    When make publish3 outcomes, retries and store settlement receipt-aware
    Then the task requirements and failure cases have repeatable local evidence
    And no production publication or scheduler activation is performed by verification

  @core
  Scenario: R17 — Rendered migration schedules resolve the correct bundle and approval model
    Given the voice3 migration audit identified F08, F09, F10, C01, C02, C03, C04, C05
    When prepare correct voice3 migration schedules and an explicit safe channel preset
    Then the task requirements and failure cases have repeatable local evidence
    And no production publication or scheduler activation is performed by verification

  @core
  Scenario: R18 — Offline migration rehearsal proves the complete voice3 replacement contract
    Given the voice3 migration audit identified F22, C01, C02, C03, C04, C05
    When prove voice3 replacement with a fresh offline multi-window migration rehearsal
    Then the task requirements and failure cases have repeatable local evidence
    And no production publication or scheduler activation is performed by verification

```