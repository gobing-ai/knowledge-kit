```gherkin
Feature: Daily AI Voice v3: split generate and publish, preset-driven channel matrix

  Scenario: R1 — The channel matrix comes from a config-selected publish preset
    Given config.yaml selects publish preset "daily-ai-voice" for kk-daily-publish3
    When kk publish plan runs against a bundle
    Then publish-plan.json lists one row per preset target with plugin, operation, variant, window, mode and approval
    And launch vars channels / live_channels can only narrow or promote targets the preset already lists

  Scenario: R2 — Dummy mode exercises the full publish path without spawning plugins
    Given every target in the preset has mode "dummy"
    When kk-daily-publish3 runs all three windows against a converted voice2 work dir
    Then every target writes a receipt with ok true, effect "none" and dummy true
    And no publish plugin process is spawned and no network publish happens

  Scenario: R3 — Windows select disjoint target sets and never resend
    Given a bundle with receipts from the after-generate window
    When publish3 runs with window "cn-peak"
    Then only cn-peak targets are sent
    And a target whose receipt has an uncertain live effect is never resent

  Scenario: R4 — The overseas window is gated on the podcast RSS feed
    Given the podcast RSS feed lacks the gated episode
    When publish3 runs with window "overseas-rss"
    Then all overseas targets are cancelled
    And diagnose writes incident.json and incident.md classifying the miss
    And the only automatic repair is resending T0 targets whose receipt effect is "none"

  Scenario: R5 — Live publishing remains launch-only
    Given a preset target with mode "draft"
    When publish3 runs without live_channels
    Then no target publishes live

  Scenario: R6 — voice3 generate freezes a bundle publish3 can consume
    Given a day with planned content
    When kk-daily-ai-voice3 completes
    Then bundle.json records parentRunId, artifact paths with digests and the zh variants for every channel
    And with auto_publish true it runs the after-generate window nested

  Scenario: R7 — kk-itc publish behaviour is unchanged by the shared send core
    Given a kk-itc work dir planned from an existing itc preset
    When the itc send stages run on the shared send core
    Then payloads and receipts are keyed by plugin exactly as before

  Scenario: R8 — A dummy receipt never blocks a later real send of the same target
    Given a target with a dummy receipt
    When the preset flips that target to mode "draft" and publish3 runs again
    Then the target is dispatched once

  Scenario: R9 — Receipt-based classification feeds the existing tail stages unchanged
    Given after-generate receipts for surfdash and podcast
    When publish3 classifies the window
    Then the legacy 31-publish result files exist for the existing tail stages
    And dummy receipts are never counted as published

  Scenario: R10 — voice2 publish payloads are unchanged by the builder extraction
    Given a recorded voice2 work dir
    When the voice2 publish stages run on the extracted builders
    Then their payload files are byte-identical to before

  Scenario: R11 — Channel enablement no longer lives in the generate workflow
    Given kk-daily-ai-voice3.yaml
    When its nodes are inspected
    Then no node names a publish plugin and only pool-gate carries the pool-count guard


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
