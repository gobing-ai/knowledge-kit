---
schema_version: 1
id: "F6"
name: "Daily AI news workflow and plugins"
status: done
priority: P2
tags: []
created_at: "2026-08-22T04:15:30.932Z"
updated_at: "2026-08-22T05:12:45.471Z"
---

# F6: Daily AI news workflow and plugins

## Goal
Deliver an automated daily AI news voice broadcast pipeline in `knowledge-kit` by introducing:
1. `plugins/ingestions/aihot-ingest` (`kind: ingestion`): fetches curated AI news from `aihot.virxact.com` (snapshot and incremental changes) into standard `Doc[]`.
2. `plugins/generations/dailynews-gen` (`kind: generator`): compiles ingested `Doc[]` into a structured spoken broadcast `Content` (VoiceScript YAML with intro, news story items, and outro).
3. `plugins/kk/workflows/kk-daily-ai-voice.yaml`: an end-to-end Spur product workflow orchestrating `aihot-ingest` → `dailynews-gen` → `voice-gen`, validating real-world audio generation dogfooding and platform extensibility.
## Scope
- In:
  - Ingestion plugin `plugins/ingestions/aihot-ingest`:
    - `plugin.json` declaring `kind: ingestion` and entry `./src/index.ts`
    - Executor `--in <config.json>` / `--out <docs.json>`; config fields `limit` (default 10), `cursor`, `stateFile`; equivalent direct-entry flags for development
    - `AihotClient` with `deps.fetch` injection seam for 100% offline unit testing
    - Support for snapshot (`/api/v1/selected/snapshot`) and incremental changes (`/api/v1/selected/changes`)
    - Doc mapping to `Doc[]` with source attribution, summary, and metadata
  - Generator plugin `plugins/generations/dailynews-gen`:
    - `plugin.json` declaring `kind: generator` and entry `./src/index.ts`
    - Executor `--in <docs.json>` / `--out <content.json>` with language/title/profile environment configuration; equivalent direct-entry flags for development
    - Transforms `Doc[]` into validated broadcast VoiceScript YAML carried by markdown `Content` (intro, stories with `gap_ms`, outro)
  - Product workflow `plugins/kk/workflows/kk-daily-ai-voice.yaml`:
    - Orchestrates `prepare` -> `fetch` (`aihot-ingest`) -> `script` (`dailynews-gen`) -> `review` (optional HITL) -> `wrap-docs` -> `generate` (`voice-gen`) -> `done`
  - Design specifications:
    - `docs/design/aihot-ingest.md`
    - `docs/design/dailynews-gen.md`
    - `docs/design/kk-daily-ai-voice.md`
  - Verification:
    - Comprehensive unit tests with >=90% coverage for both plugins
    - Workflow validation and offline integration execution
- Out:
  - Custom TTS engine implementations (delegates to `voice-gen`)
  - Direct database dependencies or server daemons
  - Modifying `voice-gen` core contracts
## Acceptance Criteria
```gherkin
Feature: Daily AI news workflow and plugins

  @core
  Scenario: R1 — aihot-ingest plugin follows Ingestion Plugin Specification
    Given plugins/ingestions/aihot-ingest/plugin.json exists
    When the plugin manifest is parsed
    Then kind is ingestion and entry is ./src/index.ts
    And running aihot-ingest with executor-compatible --in and --out produces valid Doc[] JSON matching DocListSchema

  @core
  Scenario: R2 — aihot-ingest supports snapshot and incremental changes API
    Given an aihot client with injected fetch seam
    When aihot-ingest is called without cursor
    Then it queries the snapshot endpoint /api/v1/selected/snapshot
    And when called with cursor or state-file, it queries /api/v1/selected/changes and atomically updates the state file

  @core
  Scenario: R3 — dailynews-gen plugin follows Generator Plugin Specification
    Given plugins/generations/dailynews-gen/plugin.json exists
    When the plugin manifest is parsed
    Then kind is generator and entry is ./src/index.ts
    And running dailynews-gen with --in Doc[] and --out Content produces Content matching ContentSchema

  @core
  Scenario: R4 — dailynews-gen transforms Doc[] into structured broadcast VoiceScript
    Given a non-empty Doc[] JSON input
    When dailynews-gen processes the documents
    Then the output Content has format markdown containing VoiceScript YAML
    And the body contains valid VoiceScript YAML with intro, news story segments, gap_ms timings, and outro

  @core
  Scenario: R5 — kk-daily-ai-voice workflow chains ingestion, script generation, and voice-gen
    Given plugins/kk/workflows/kk-daily-ai-voice.yaml exists
    When the workflow runs with work_dir
    Then it executes aihot-ingest to fetch news Doc[]
    And it executes dailynews-gen to produce the broadcast VoiceScript
    And it executes voice-gen to generate the final audio WAV and optional MP3
    And the workflow passes spur workflow validate

  @edge
  Scenario: R6 — Empty news items handled gracefully
    Given an empty Doc[] input or zero news items returned from API
    When dailynews-gen or aihot-ingest runs
    Then aihot-ingest writes an empty Doc[] array
    And dailynews-gen outputs a short fallback notice VoiceScript without crashing

  @edge
  Scenario: R7 — Offline test coverage and boundaries
    Given unit tests for aihot-ingest, dailynews-gen, and kk-daily-ai-voice
    When bun test runs
    Then all tests pass with zero globalThis.fetch mutations and >=90% line and function coverage
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0074 | Ship kk-daily-ai-voice workflow and end-to-end dogfooding | done |
| 0073 | Ship dailynews-gen generator plugin | done |
| 0072 | Ship aihot-ingest ingestion plugin | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-22T04:22:15.069Z backlog → active (system)
- 2026-08-22T04:22:15.210Z active → verifying (system)
- 2026-08-22T04:22:15.339Z verifying → done (system)
