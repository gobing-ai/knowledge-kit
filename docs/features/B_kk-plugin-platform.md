---
schema_version: 1
id: "B"
name: Plugin platform
status: done
priority: P2
tags: []
created_at: "2026-07-23T17:53:09.865Z"
updated_at: "2026-08-08T00:05:13.162Z"
---

# B: kk plugin platform

## Goal
Plugin platform: type + discovery layer for knowledge-kit plugins — manifest/registry, typed lifecycle contracts (Ingestion, ContentGenerator, Publish), sequential fan-in/fan-out steps, LLM-as-judge agent skills (B7), spur workflow integration, and CLI surface (B4) for the plugin seam. Skills implement plugins; spur orchestrates. No bespoke kk-run DAG runtime (YAGNI, ADR-006); fan-out runs sequentially inside kk (ADR-007 R4). LLM-as-judge is delivered as agent skills + `agent.run`, not a plugin kind (ADR-007 amdt 2026-08-07).
## Scope
- In: B1 manifest+registry; B2 typed contracts; B3 spur workflow integration; B4 CLI surface; B5 end-to-end pipeline acceptance (composition proof); B6 sequential fan-in/fan-out steps; B7 LLM-as-judge agent skills (fat skill `kk-judge` + thin wrappers; `agent.run` gate).
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

  # Child B4 (CLI surface) — rolled up for DD-09 (tasks 0020-0021; re-parent on completion)
  Scenario: List shows discovered plugins
    Given a plugins root with plugins of multiple kinds
    When knowledge-kit plugins list runs
    Then plugins print grouped by kind and --json emits machine-readable output

  Scenario: Doctor surfaces discovery diagnostics
    Given a plugins root with a malformed manifest and a duplicate name
    When knowledge-kit plugins doctor runs
    Then each diagnostic names the path and reason and the exit code is non-zero

  Scenario: Plugins root is consistent with invoke
    Given a non-default plugins directory
    When plugins list and doctor run with --plugins-root
    Then they resolve the same registry as invoke with --plugins-root

  Scenario: Surface is documented in the same commit
    Given the new subcommands
    When the implementing commit lands
    Then docs/04_DESIGN.md section 1 documents them in that commit

  # Child B5 (end-to-end pipeline acceptance) — rolled up for DD-09 (tasks 0026-0027; re-parent on completion)
  @core
  Scenario: R1 — Vertical run publishes Surfdash from Karakeep-local
    Given C2 Karakeep-local, D2 generator stand-in, and E3 Surfdash plugins are installable
    And the B3 ingest-generate-publish workflow template is configured for those plugins
    When the workflow runs end to end
    Then a Karakeep-local item becomes a published Surfdash post
    And each step fails loud on contract or process errors

  @edge
  Scenario: R2 — Acceptance is platform composition, not a new plugin kind
    Given the platform composes plugins via spur workflow
    When the vertical is defined
    Then it is expressed as a workflow over B3 invoke + C2/D2/E3
    And no fourth plugin kind is introduced
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0003 | kk-core data contracts: Doc, Content, Result Zod schemas + per-kind contract | done |
| 0004 | Plugin manifest schema + registry discovery by kind | done |
| 0005 | kk invoke entrypoint + spur workflow pipeline template | done |
| 0028 | Close out feature B verification | done |
<!-- END AUTO-GENERATED -->

## Notes
Planned 2026-07-24 (/sp:dev-plan B): decomposed into 3 tasks by deliverable boundary — 0003 (B2 contracts) → 0004 (B1 registry) → 0005 (B3 kk invoke + workflow). Seam resolved: skill-first plugin.json{kind,entry} + Zod data contracts + `kk invoke` (ADR-006 amendment). Build order B2→B1→B3.

- 2026-07-30: B4 (tasks 0020/0021) and B5 (tasks 0026/0027) enriched and rolled up into the AC above (DD-09 subset pattern); child tasks re-parent here on completion, as B1–B3 did.
- 2026-08-03 (0035): B6/B7 homes created for the 0033/0034 designs (map-J realignment). B5's edge scenario "no fourth plugin kind is introduced" was written for the E2E composition; 0034's judge-kind decision adds a fourth kind by explicit decision — the ADR-007 amendment (0036) records the supersession. B6/B7 are new backlog scope outside the 0028 verification window (B1–B5).
- 2026-08-07 (0037): ADR-007 amdt 2026-08-07 **supersedes** the 2026-08-02 fourth-kind amendment. LLM-as-judge repositioned from a plugin kind to **agent skills + `agent.run`**. Plugin taxonomy reverts to three kinds (`ingestion`, `generator`, `publish`) — the runtime never gained a fourth. B7 now homes the fat skill `kk-judge` + thin wrappers (tech-accuracy, brand-tone, compliance); the `agent.run` step emits a verdict file gated by a `shell`/`jq` guard. B5's edge scenario "no fourth plugin kind is introduced" is now the steady state, not a future constraint.
## History
- 2026-07-30T22:23:26.221Z backlog → active (system)
- 2026-08-02T23:27:15.965Z active → verifying (system)
- 2026-08-03T03:04:32.218Z verifying → done (system)
