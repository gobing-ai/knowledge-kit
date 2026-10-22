---
schema_version: 1
id: "G15"
name: "Daily AI Voice v3: split generate and publish, preset-driven channel matrix"
status: backlog
priority: P2
tags: []
created_at: "2026-10-22T18:40:58.202Z"
updated_at: "2026-10-22T19:09:35.729Z"
---

# G15: Daily AI Voice v3: split generate and publish, preset-driven channel matrix

## Goal

Replace the monolithic `kk-daily-ai-voice2` DAG with two workflows joined by a frozen `bundle.json`: `kk-daily-ai-voice3` (generate: topic → QC/translate → drafts → audio/images → bundle) and `kk-daily-publish3` (publish: plan → check → send per window → classify → report). The channel matrix moves into a publish preset selected from `~/.config/kk/config.yaml`, every target can run `off | dummy | draft | live`, and publishing follows three windows (D4). Design: `docs/design/kk-daily-ai-voice3.md` (operator decisions D1–D4, 2026-10-22). voice2 stays production until shadow cut-over.

## Scope

**In scope**

- `kk publish plan|check|send` generalized from the kk-itc machinery (`itc-publish.ts`, `itc-plan.ts`), preset targets with `operation`, `variant`, `tier`, `window`, `mode`, `required`.
- Dispatcher-level `dummy` mode: synthetic receipt `{ ok: true, effect: "none", dummy: true }`, no plugin spawn.
- `kk-daily-publish3.yaml` with three windows: `after-generate` (drafts + owned T0), `cn-peak` (09:00 Asia/Shanghai, no-draft domestic live), `overseas-rss` (07:00 PDT behind the podcast RSS gate, with `diagnose` on a miss).
- `kk-daily-ai-voice3.yaml` generate workflow emitting `bundle.json`; zh variants for every channel (D3).
- Session-preflight probes derived from enabled targets; `publish-classify --fold-tail` split.
- Stable approval/monitoring surface: `publish-plan.json` approval/status, receipt schema, `publish-events.jsonl`, `bundle.runs[]`.
- Schedule templates for the cn-peak and overseas windows (rendered by `kk schedule render`; installing them stays an operator action).

**Out of scope**

- The approval / monitoring console itself.
- New channel plugins (LinkedIn, Facebook, Instagram, shipinhao 图文, threads images) — tracked separately; the preset lists them as `off`.
- Per-locale publishing (revisit when non-zh audio exists).
- Modifying `kk-daily-ai-voice2.yaml` beyond keeping it green.

## Acceptance Criteria

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
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0321 | Generalize itc plan/check/send into kk publish plan\|check\|send with window, mode and approval rows | backlog |
| 0322 | Add dispatcher-level dummy publish mode with synthetic no-effect receipts | backlog |
| 0323 | Add kk-daily-publish3 workflow, daily-ai-voice preset, RSS gate, diagnose node and window schedules | backlog |
| 0324 | Add kk-daily-ai-voice3 generate workflow that freezes bundle.json | backlog |
| 0325 | Derive session-preflight probes from the enabled publish targets | backlog |
| 0326 | Split publish-classify --fold-tail into classify, mark-published and report nodes | backlog |
| 0327 | Move daily channel copy shaping out of daily-stages.ts into a generate-side social-write stage | backlog |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-22T18:59:28.584Z moved Q → G15 (system)

