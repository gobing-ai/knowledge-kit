---
schema_version: 1
id: "L1"
name: "Redesign kk-daily-ai-voice workflow: kk-owned concurrent collect, explicit content QC seam, plugin-owned publish mechanics"
status: done
priority: P2
tags: []
created_at: "2026-09-06T14:18:07.904Z"
updated_at: "2026-09-07T20:56:02.235Z"
---

# L1: Redesign kk-daily-ai-voice workflow: kk-owned concurrent collect, explicit content QC seam, plugin-owned publish mechanics

## Goal

Restructure the daily AI voice workflow so the YAML contains only orchestration: source collection becomes one kk-owned concurrent fan-in, content selection becomes an explicit annotate → quality-controller seam with auditable thresholds, publish mechanics move into their publish plugins, and failure routing matches reality (empty-result terminal, partial-publish route, per-stage failure edges).

## Scope

**In scope:**

- `kk executor fan-in` extension: concurrent ingestion source-runner mode (one merged Doc[] out; existing `--in` merge mode retained).
- Content annotate stage: MECE category taxonomy (v1) + MECE scoring dimensions (quality/importance/urgency/impact, 0–5, documented rubric), deterministic, in episode-plan-gen.
- Visible quality-controller filter node: category allowlist + score thresholds as workflow vars; empty result routes to a first-class terminal.
- podcast-pub absorbs show-notes rendering and episode assembly (publish-prep).
- surfdash-pub absorbs locale scaffold + sync mechanics; LLM translation hops remain thin workflow agent.run steps.
- Workflow YAML: collapse collect states, add per-stage failure edges, add `done-no-content` terminal, keep HITL review gate.

**Out of scope:**

- Engine parallelism (ts-dual-workflow-engine `type: parallel` stays inert; ADR-007 R4 unchanged).
- Moving LLM translation into plugins (plugins stay deterministic executors).
- New ingestion sources (karakeep-local, web-search stay unwired — wiring them is a separate feature).
- aihot upstream archive-selection fix (reported separately; plan gates already defend).
- D1 quota / paid-plan decision (operator infrastructure concern).

## Acceptance Criteria

```gherkin
Feature: Redesign kk-daily-ai-voice workflow

@core
Scenario: R1 — Concurrent source collection via kk-owned fan-in
  Given the daily pipeline is invoked with multiple ingestion sources configured
  When the collect step runs `kk executor fan-in` in source-runner mode
  Then all ingestion plugins are spawned concurrently (total wall time ≈ slowest source, not the sum)
  And the output is one merged Doc[] containing every successful source's docs
  And a failed or timed-out source degrades to a warning entry in the output metadata without aborting the others

@core
Scenario: R2 — Workflow collect states collapse into one state
  Given the redesigned kk-daily-ai-voice.yaml
  When the workflow definition is inspected
  Then the fetch / ingest-last30days / ingest-horizon / blend-facts states are replaced by a single collect state calling kk executor fan-in
  And `spur workflow validate` passes

@core
Scenario: R3 — Every blended candidate is annotated with category and dimension scores
  Given a blended Doc[] from collect
  When the annotate stage runs
  Then every doc carries metadata.category from the MECE v1 taxonomy (ai-news | ai-technical | ai-research | ai-industry | non-ai)
  And every doc carries metadata.scores with quality, importance, urgency, impact each in 0–5
  And annotation is deterministic (same input → same output, no LLM)

@core
Scenario: R4 — Quality-controller filters candidates by category allowlist and score thresholds
  Given annotated candidates and workflow vars for category allowlist and per-dimension minimum scores
  When the quality-controller stage runs
  Then only docs in the allowlisted categories meeting every threshold survive
  And surviving docs retain sourceUri and metadata.urls unchanged
  And the rejected set with rejection reasons is written to a run artifact for audit

@core
Scenario: R5 — Empty candidate set terminates as done-no-content, not failed
  Given a run where the quality-controller admits zero candidates
  When the quality-controller stage completes
  Then the workflow terminates in a dedicated done-no-content terminal state
  And no article, script, audio, or publish artifact is produced
  And the run result names the empty-filter reason

@core
Scenario: R6 — podcast-pub owns show-notes rendering and episode assembly
  Given the merged publish Content (article + audio + cover)
  When podcast-pub publish runs
  Then show notes are rendered inside the plugin (no inline bun -e show-notes state in the workflow)
  And episode assembly (audio attachment, cover, duration) happens inside the plugin
  And the workflow contains no surfdash- or podcast-specific path arithmetic

@core
Scenario: R7 — surfdash-pub owns locale scaffold and sync mechanics
  Given a published zh post path returned by surfdash-pub
  When locale processing runs
  Then scaffold of en/ja drafts and final CMS sync are plugin operations, not workflow shell
  And LLM translation remains a thin agent.run step editing files at plugin-returned paths
  And the workflow contains no `sd translate` or publish-orchestrator invocations

@core
Scenario: R8 — Every non-terminal state has an explicit failure edge
  Given the redesigned workflow
  When `spur workflow validate` runs and the transition table is inspected
  Then every non-terminal state has a declared transition to failed (or a named degraded state)
  And partial publish fan-out (≥1 target ok, ≥1 failed) routes to a named state preserving the partial result.json instead of a bare abort

@edge
Scenario: R9 — Redesigned pipeline reproduces the r6 dogfood outcome end-to-end
  Given the dogfood corpus from 2026-09-06 (blended sources with archive pollution)
  When the redesigned pipeline runs with publish enabled
  Then the plan contains only fresh AI-news candidates
  And surfdash zh/en/ja posts and the podcast episode publish successfully
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-06T14:36:44.439Z backlog → active (system)
- 2026-09-06T17:42:21.056Z moved K → L1 (system)
- 2026-09-07T20:56:02.035Z active → verifying (system)
- 2026-09-07T20:56:02.235Z verifying → done (system)
