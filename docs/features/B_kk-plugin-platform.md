---
schema_version: 1
id: "B"
name: Plugin platform
status: backlog
priority: P2
tags: []
created_at: "2026-07-23T17:53:09.865Z"
updated_at: "2026-07-29T19:06:07.322Z"
---

# B: kk plugin platform

## Goal
Plugin platform: type + discovery layer for knowledge-kit plugins — manifest/registry, three typed lifecycle contracts (Ingestion, ContentGenerator, Publish), spur workflow integration, and CLI surface (B4) for the plugin seam. Skills implement plugins; spur orchestrates. No bespoke kk-run DAG runtime (YAGNI, ADR-006).
## Scope
- In: B1 manifest+registry; B2 typed contracts; B3 spur workflow integration; B4 CLI surface; B5 end-to-end pipeline acceptance (composition proof).
- Out: dynamic DAG runtime; plugin hot-reload; domain plugin bodies (C/D/E children).
## Acceptance Criteria
```gherkin
Feature: kk plugin platform

  @core
  Scenario: R1 — An installed plugin is discovered and invoked end to end
    Given a plugin installed under the plugins directory with a valid manifest
    When the registry discovers it and kk invoke runs it with schema-valid input
    Then the plugin produces schema-valid output for its kind

  @core
  Scenario: R2 — The three kinds compose into an ingest-generate-publish pipeline
    Given one discovered plugin of each kind wired into a spur workflow
    When the workflow runs end to end
    Then a Doc flows through generation into Content and through publishing into a Result

  @edge
  Scenario: R3 — Orchestration stays in spur workflow, not a kk runtime
    Given the platform composes plugins via spur workflow
    When a pipeline is defined
    Then it is expressed as a spur workflow template rather than a kk-owned DAG runtime

  # Child B2 (typed lifecycle contracts) — rolled up so task 0003 AC ⊆ B (DD-09)
  @core
  Scenario: R1 — Doc, Content, and Result schemas validate well-formed payloads
    Given the @gobing-ai/kk-core package exports Zod schemas for Doc, Content, and Result
    When a well-formed payload for each type is parsed
    Then parsing succeeds and returns a typed value

  @core
  Scenario: R2 — Schemas reject a malformed payload with a field-level error
    Given the Doc, Content, and Result Zod schemas
    When a payload missing a required field is parsed
    Then parsing fails with an error naming the offending field

  @core
  Scenario: R3 — Each plugin kind declares its input and output contract
    Given the three plugin kinds ingestion, generator, and publish
    When the contract for a kind is resolved
    Then ingestion declares output Doc list, generator declares input Doc list and output Content, and publish declares input Content and output Result

  @edge
  Scenario: R4 — Inferred TypeScript types are exported for consumers
    Given the kk-core package
    When a consumer imports the inferred Doc, Content, and Result types
    Then the types are available without redefining the shapes

  # Child B1 (plugin manifest + registry) — rolled up for DD-09 / task 0004
  @core
  Scenario: R1 — A manifest declares a valid kind and entry
    Given a plugin directory containing a plugin.json
    When the manifest is validated against the manifest schema
    Then a kind of ingestion, generator, or publish is required
    And an entry naming the skill or command that runs the plugin is required

  @core
  Scenario: R2 — The registry discovers installed plugins grouped by kind
    Given several plugin directories each with a valid plugin.json
    When the registry runs discovery
    Then every valid plugin is registered under its declared kind
    And plugins can be listed by kind

  @core
  Scenario: R3 — A malformed manifest is skipped without aborting the scan
    Given one plugin directory whose plugin.json is missing a required field
    When the registry runs discovery
    Then the malformed plugin is reported as skipped with its path and reason
    And the remaining valid plugins are still registered

  @edge
  Scenario: R4 — Duplicate plugin names surface a diagnostic
    Given two plugin directories declaring the same plugin name
    When the registry runs discovery
    Then a duplicate-name diagnostic is reported
# Child B3 (spur workflow integration) — rolled up for DD-09 / task 0005
  @core
  Scenario: R1 — kk invoke runs a discovered plugin with file IO
    Given a discovered plugin and an input file
    When "kk invoke <plugin> --in <input> --out <output>" runs
    Then the plugin's declared entry is executed
    And the output file is written

  @core
  Scenario: R2 — kk invoke validates IO against the kind's contract
    Given a discovered plugin of a given kind
    When kk invoke runs with an input file that violates the kind's input schema
    Then invocation fails before the entry runs
    And the error names the schema violation

  @core
  Scenario: R3 — A spur workflow chains ingestion, generator, and publish
    Given a spur workflow template referencing one plugin of each kind
    When the workflow runs
    Then each step invokes its plugin via kk invoke
    And each step's output file feeds the next step's input

  @core
  Scenario: R4 — kk invoke fails loud when a plugin entry errors
    Given a discovered plugin whose entry exits non-zero
    When kk invoke runs it
    Then kk invoke exits non-zero and surfaces the entry's error
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0003 | kk-core data contracts: Doc, Content, Result Zod schemas + per-kind contract | done |
| 0004 | Plugin manifest schema + registry discovery by kind | done |
| 0005 | kk invoke entrypoint + spur workflow pipeline template | done |
<!-- END AUTO-GENERATED -->

## Notes
Planned 2026-07-24 (/sp:dev-plan B): decomposed into 3 tasks by deliverable boundary — 0003 (B2 contracts) → 0004 (B1 registry) → 0005 (B3 kk invoke + workflow). Seam resolved: skill-first plugin.json{kind,entry} + Zod data contracts + `kk invoke` (ADR-006 amendment). Build order B2→B1→B3.
## History
