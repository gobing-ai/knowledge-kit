---
schema_version: 1
id: "G21"
name: "kk-itc refactor: collected topics, plugin-owned publishing and reliable recovery"
status: active
priority: P2
tags: []
created_at: "2026-10-15T21:56:49.422Z"
updated_at: "2026-10-16T01:30:46.812Z"
---

# G21: kk-itc refactor: collected topics, plugin-owned publishing and reliable recovery

## Goal

Make kk-itc reliable and extensible through optional evidence-backed topic selection, structured semantic choices, topic channel presets, plugin-owned publishing contracts, and recoverable per-target outcomes while preserving existing authoring and publication safety.

## Scope

In scope:
- Top-level dependency DAG with a bounded child authoring FSM, explicit interactive continuation and verified child completion.
- Canonical config defaults and {works_dir}/kk-itc/{topic-name}/[YYYYMMDD]/ workspace allocation with immutable effective options.
- Optional versioned SEO handoff artifacts, independently deployable from G9.
- Review and refactor kk-itc, stage helpers, workflow-run entry, publish/adapt skills, and Board artifact consumers together.
- Optional topic discovery from kk-collect/store, with explicit refresh, candidate evidence and topic-scoped selection lifecycle.
- Catalog decisions for topic, outline and preset suggestions with bounded choices, source/default provenance and deterministic validation.
- Plugin-declared publication profiles per content operation, existing browserSession/probe binding and kk bot recovery guidance.
- Topic channel presets, frozen validated plans, per-target payloads and existing executor fan-out/retry/concurrency infrastructure.
- Strict runtime artifacts, outcome reconciliation, conservative resume, shell-safe inputs, compatibility tests and documentation.

Out of scope:
- Implementing G9 draft analysis, automatic SEO crawling or automatic editorial changes in this refactor.
- New workflow engine, router service, package, plugin kind, or rewriting unrelated workflows.
- Implicit live publication, automatic login/logout, unrequested collection, or paid image generation.
- New publish channels, changing remote site implementations without a verified gap, or exactly-once remote delivery claims.
- Product implementation during this idea pipeline; execution follows the handoff.

## Acceptance Criteria

```gherkin
Feature: Reliable extensible IT content workflow

  @core
  Scenario: R1 — Existing authoring inputs keep their observable behavior
    # covers: I1, I8
    Given an existing direct topic or input file with default publication settings
    When kk-itc runs
    Then it produces the existing draft and Board artifact paths without collection, image spending or publication

  @core
  Scenario: R2 — Collected evidence can supply a selected topic
    # covers: I2
    Given explicit collected-topic mode with a nonempty store pool from kk-collect
    When topic discovery runs
    Then ranked candidates cite item IDs and source URLs and the selected candidate becomes the brief with a topic-scoped selection record

  @core
  Scenario: R3 — Empty or unavailable collections stop topic selection safely
    # covers: I2, I8
    Given collected-topic mode with an empty pool or a failed explicitly requested collection refresh
    When topic discovery runs
    Then it reports no usable topic and writes no draft or publication and releases any selection owned by this run

  @core
  Scenario: R4 — Semantic choices remain within validated candidates
    # covers: I3, I8
    Given topic, outline or preset choices with a fixed candidate set
    When a catalog decision returns a missing, malformed or out-of-set result
    Then the workflow records source and fallback reason and uses the declared safe default or requires operator selection without enabling publication or spending

  @core
  Scenario: R5 — Publish plugins describe operation-specific capabilities
    # covers: I5, I6
    Given a discovered publish plugin declaring supported format, locale, draft modes, requirements and metadata bindings
    When the publication planner resolves its operation
    Then it uses those declarations without a channel table or channel-specific workflow edits and rejects an incompatible requested operation

  @core
  Scenario: R6 — Topic presets resolve an inspectable frozen plan
    # covers: I7
    Given a topic profile selecting a channel preset and an explicit target override
    When the publication plan is resolved
    Then explicit targets replace preset targets and the frozen plan records its origin, operations, variants and draft mode while invalid presets fail before sends

  @core
  Scenario: R7 — Session recovery stays with bots and channel probes
    # covers: I4, I5
    Given a browser publication target with a cached bot and an expired or challenged session
    When publication readiness is checked
    Then the plugin probe refuses the send and reports operator-directed kk bot recovery without treating cached state as authenticated or automating login

  @core
  Scenario: R8 — Publication dispatch isolates targets and reuses fan-out
    # covers: I5, I6
    Given compatible file and script targets sharing an adapted variant with different mode metadata
    When the frozen plan is dispatched
    Then each target receives its own validated payload through executor fan-out and shared browser profiles are serialized without leaking another target metadata

  @core
  Scenario: R9 — Runtime outcomes require valid current artifacts
    # covers: I1, I8
    Given a runtime judge or report artifact that is absent, malformed or belongs to different inputs
    When the workflow evaluates completion
    Then it refuses success and preserves diagnostic evidence while explicit dry-run behavior remains isolated

  @core
  Scenario: R10 — Recovery preserves success and refuses uncertain repeats
    # covers: I6, I8
    Given a plan with one confirmed success, one repeat-safe failure and one uncertain remote outcome
    When publication recovery runs
    Then it retains the successful receipt, retries only the safe failure within the budget and requires reconciliation for the uncertain target

  @core
  Scenario: R11 — Reports reconcile every expected target
    # covers: I1, I8
    Given a frozen plan whose result aggregate omits, duplicates or adds a target or contains stale evidence
    When the run report is produced
    Then it reports a contract failure with expected and observed targets and never claims complete publication

  @core
  Scenario: R12 — Entry surfaces and artifacts remain consistent
    # covers: I1, I8
    Given the installed workflow runner, CLI stage entry and Board ITC reader
    When compatibility checks exercise new options and paths containing shell metacharacters
    Then values remain data, existing aliases and artifacts stay usable, and command documentation describes the implemented surface

  @core
  Scenario: R13 — DAG branches require verified predecessor completion
    # covers: I9
    Given a DAG with optional branches and a paused or failed authoring child
    When dependent work is scheduled
    Then publishing waits for validated child completion, optional skips still allow a run report, and cancellation stops the owned child

  @core
  Scenario: R14 — ITC workspace follows configured topic and optional date
    # covers: I10, I11
    Given works_dir configured as .works and an ITC topic named reliable-workflows
    When workspace allocation runs
    Then the default path is .works/kk-itc/reliable-workflows and an explicit valid date adds YYYYMMDD while a full directory override wins

  @core
  Scenario: R15 — Invalid ITC configuration stops before mutation
    # covers: I10, I11
    Given an existing config with malformed YAML, an unreadable file or a wrong-typed ITC setting
    When ITC configuration resolves
    Then it reports the key or file error without writing workspaces or exposing secret values

  @core
  Scenario: R16 — SEO handoff remains independent of an unfinished provider
    # covers: I12
    Given SEO handoff mode and a reviewed draft without a shipped draft-capable SEO adapter
    When the SEO branch runs
    Then it exports versioned content-bound evidence and records not-assessed while authoring continues and only confirmed public URLs enter the later URL-audit handoff

  @core
  Scenario: R17 — Interactive authoring resumes the recorded child
    # covers: I9
    Given a parent DAG paused at its authoring barrier and a child paused for outline or revision input
    When the workflow entry resumes authoring
    Then it continues the same child ID through repeated pauses and resumes the parent only after validating the child draft receipt without rerunning confirmed sends

  @core
  Scenario: R18 — Resume retains the original effective configuration
    # covers: I10, I11
    Given a persisted run with frozen workspace, date, locale, preset and mode whose ambient config later changes
    When the workflow resumes
    Then it uses the original resolved values and digests or refuses mismatched evidence without silently changing directories or publication intent

```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0298 | Plan ITC publication from discovered plugin capabilities | done |
| 0299 | Select evidence-backed ITC topics from the collection store | done |
| 0300 | Resolve topic channel presets with explicit target overrides | done |
| 0301 | Persist bounded ITC semantic decisions and safe fallbacks | done |
| 0302 | Dispatch ITC targets with isolated payloads and recoverable receipts | done |
| 0303 | Keep ITC entry and Board contracts compatible across the refactor | done |
<!-- END AUTO-GENERATED -->

## Notes

2026-10-15 planning revision: operator feedback supersedes the initial pure-FSM recommendation. ADR-040 amendment and docs/design/kk-itc-refactor.md now specify a DAG plus bounded authoring child, canonical KK config/workspace defaults, and an optional versioned SEO handoff. Existing R1–R12 identities remain unchanged; R13–R18 capture the added constraints. Tasks 0301/0302/0303 carry these new scenarios. The earlier run handoff is historical and its planning digests become stale after this revision; use the current task contracts and revision readiness report. No implementation starts in this revision.

## History

- 2026-10-16T01:30:46.812Z backlog → active (system)

