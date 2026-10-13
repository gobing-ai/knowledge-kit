---
schema_version: 1
id: "G8"
name: "Workflow visibility in Spur Board: Collect, Daily AI Voice, IT Content"
status: active
priority: P2
tags: []
created_at: "2026-10-11T23:18:58.413Z"
updated_at: "2026-10-12T07:47:23.641Z"
---

# G8: Workflow visibility in Spur Board: Collect, Daily AI Voice, IT Content

## Goal

Give operators one native Spur Board module per key Knowledge Kit workflow, with trustworthy run-bound summaries, outputs, execution progress, and configuration context.

## Scope

**In scope**
- Native modules for kk-collect, kk-daily-ai-voice2 and kk-itc, using the installed Spur contribution contract.
- Four consistent tabs, shared paged run history and deep-linkable run/tab selection, accessible loading/empty/error states and freshness indicators.
- Workflow-specific result previews, media/downloads, channel outcomes, retries and diagnostics; state-machine and DAG progress.
- Read-only local artifact/config reader, strict run provenance, sanitized effective config captured for future runs, explicit unknown/superseded legacy evidence.
- Reuse Settings → Workflows for the definition dropdown, metadata, YAML/copy and static graph; modules show recorded run settings with a link to that tab.
- Canonical repository workflows under plugins/kk/workflows, with .spur/workflows as a relative directory symlink preserving legacy callers and project discovery.
- Build/package integration, declared bootstrap.modules entries, operator setup instructions and installed-Board browser verification.

**Out of scope**
- Start, retry, cancel, edit, publishing, or operator-answer actions from these modules; scheduling changes.
- New workflow engine, plugin kind, result database, upstream Spur modifications, remote/multi-user deployment, or private Spur React context imports.
- Arbitrary file browsing, raw shell commands/prompts/secrets, retrospective invention of missing historical configuration, and extra tabs without concrete content.
- In: the `kk board` capture/serve surface and the three native Board modules (Collect,
  Daily AI Voice, IT Content) — G8 owns this family; the workflow children only invoke it.

## Acceptance Criteria

```gherkin
Feature: Workflow visibility in Spur Board

  @core
  Scenario: R1 — Three workflow modules load through the installed Board
    # covers: I1, I2, I3, I4
    Given the three compiled workflow contributions and a compatible installed Spur Board
    When the operator opens each registered module
    Then Collect, Daily AI Voice and IT Content render in the host navigation at distinct routes without rebuilding Spur

  @core
  Scenario: R2 — Run selection stays consistent across all four tabs
    # covers: I5, I6, I7, I8, I9
    Given two runs of a workflow with different outputs
    When the operator selects the older run and changes tabs
    Then Summary, Results, Execution progress and Workflow Config Summary all retain that run ID and the URL preserves run and tab selection

  @core
  Scenario: R3 — Summary separates execution status from result outcome
    # covers: I2, I3, I4, I5
    Given a completed run with partial publishing and a failed run with available outputs
    When the operator opens Summary for each run
    Then the view shows run identity, start time, elapsed time, execution status, known result outcome, counts, freshness and diagnostics without calling partial results fully successful

  @core
  Scenario: R4 — Collect results show ingestion and labeling evidence
    # covers: I2, I6
    Given a collection run with source counts, inserted and updated counts, facts and label results
    When the operator opens Results
    Then the view shows available source and label counts, confidence and fallback information, facts preview and downloads without inventing absent counts

  @core
  Scenario: R5 — Daily voice results show content audio and channel outcomes
    # covers: I3, I6
    Given a daily voice run with an article, cover, script, audio and mixed channel result files
    When the operator opens Results
    Then the view previews available article and cover, plays and downloads audio, links available script and report, and distinguishes per-channel draft, live, skipped and failed outcomes

  @core
  Scenario: R6 — IT Content results show authoring and review evidence
    # covers: I4, I6
    Given an IT Content run with outline alternatives, selected outline, draft, judge result and channel files
    When the operator opens Results
    Then the view exposes available outline and draft previews, revision and judge evidence, per-target outcomes and the final report

  @core
  Scenario: R7 — Progress preserves state visits and retries
    # covers: I2, I4, I7
    Given a collection or IT Content run with a repeated state, a failed action and an operator pause
    When the operator opens Execution progress
    Then the view shows recorded state visits and attempts, timings, pause or failure diagnostics and pending or skipped work without triggering an execution action

  @core
  Scenario: R8 — Daily progress preserves DAG branches and nested evidence
    # covers: I3, I7
    Given a daily voice DAG run with concurrent nodes, skipped branches, retry siblings and nested safety work
    When the operator opens Execution progress
    Then the view shows dependency relationships and actual node states, separates retries, and links nested evidence when a child run identity is recorded without claiming a single current stage or invented percentage

  @core
  Scenario: R9 — Configuration distinguishes current defaults and recorded run values
    # covers: I8
    Given a workflow changed after a run and a newer run with captured sanitized effective configuration
    When the operator opens Workflow Config Summary for both runs
    Then the view shows sanitized recorded run values and captured schedule overrides with provenance, marks uncaptured historical values unknown, and links to Settings Workflows for the current definition and defaults without duplicating its viewer

  @core
  Scenario: R10 — No runs and unavailable artifacts have explicit states
    # covers: I5, I6, I9
    Given a workflow with no runs or a selected run with missing, malformed, oversized or unfinished outputs
    When the operator opens its module
    Then the view distinguishes no runs, pending, unavailable, invalid and truncated evidence and keeps other tabs usable

  @core
  Scenario: R11 — Overwritten workspaces never impersonate historical outputs
    # covers: I6, I8, I9
    Given two run IDs share one workspace and the later run owns its artifacts
    When the operator selects the earlier run
    Then the view retains its recorded progress and sanitized config but marks artifact content superseded or unverifiable rather than displaying later outputs as earlier results

  @core
  Scenario: R12 — Artifact access is limited to the selected project and run
    # covers: I1, I6, I8, I9
    Given a running local reader and requests for another project, workflow, unlisted artifact, traversal path or escaping symlink
    When the requests reach the reader
    Then access is refused and only allowlisted run-bound files and sanitized config are readable from the configured Board origin

  @core
  Scenario: R13 — Refreshing and connection failures preserve a truthful view
    # covers: I5, I7, I9
    Given a selected active run and then a reader or Spur API outage
    When the automatic refresh occurs
    Then the view labels stale data with its last successful update, keeps available progress separate from artifact failures, preserves selection and offers manual refresh without overlapping requests

  @core
  Scenario: R14 — Modules remain accessible and distributable
    # covers: I1, I2, I3, I4, I9
    Given a packed Knowledge Kit install with the three modules and documented setup
    When the operator navigates using a keyboard at a narrow viewport and opens a saved run URL
    Then tabs and controls are labeled and usable, module assets and reader resolve outside the source checkout, and a broken contribution leaves built-in Board navigation usable

  @core
  Scenario: R15 — Workflow definitions remain in Settings Workflows
    Given repository workflows have one canonical home under plugins/kk/workflows and .spur/workflows is its relative symlink
    When the operator follows the module configuration link to /board/settings/workflows
    Then the existing dropdown lists kk-collect, kk-daily-ai-voice2 and kk-itc once each, existing YAML and static graph controls remain authoritative, and .spur/workflows/feature-verification.yaml resolves to the canonical file
    And the modules provide no duplicate definition browser, YAML viewer, static graph or current-definition reader endpoint
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0252 | Inspect collection runs through a native Board module and local reader | done |
| 0253 | Inspect daily voice DAG runs and multimedia results in Spur Board | done |
| 0254 | Inspect IT Content authoring runs and target results in Spur Board | done |
| 0255 | Verify three workflow modules from an installed package and harden operator setup | todo |
<!-- END AUTO-GENERATED -->

## Notes

- 2026-10-12 (0255): the installed-package acceptance is executable —
  `apps/board/tests/installed-board.test.ts` packs the CLI (`bun pm pack`, honoring `prepack`),
  installs the tarball into a throwaway project, starts the installed `spur` Board against the
  installed `dist/board/<entry>` trees, and drives the three module routes + Settings → Workflows
  with real Chromium; `scripts/tests/board-package.test.ts` asserts the tarball ships all three entry
  trees (assets + CSS) and externalizes only the host React facades.
- `.spur/config.yaml` declares the three `bootstrap.modules` with `enabled: false`, so a checkout that
  has not built `apps/cli/dist/board` still starts (an enabled declaration is a hard `spur serve`
  failure); the operator flips the flag after `bun run build`.
- Two demonstrated defects fixed: the module pollers now load on first mount instead of after one
  interval, and the module route constants use the host's real `/board/modules/<id>` page route so the
  address bar keeps run/tab selection and the module links resolve (the bundles are served from the
  bare `/modules/<id>/index.js` prefix).

## History

- 2026-10-12T02:15:55.614Z backlog → active (system)

