---
schema_version: 1
name: Keep ITC entry and Board contracts compatible across the refactor
status: todo
template: feature-impl
created_at: 2026-10-15T21:59:21.907Z
updated_at: "2026-10-15T22:33:16.229Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: G21
priority: P2
tags:
  - kk-itc
  - G21
estimate_hours: 10

dependencies: ["0298", "0299", "0300", "0301", "0302"]
---

## 0303. Keep ITC entry and Board contracts compatible across the refactor

### Background

Current kk-itc has shipped authoring and fan-out but centralizes channel policy, duplicates browser routing and permits weak artifact evidence. This slice delivers: Exercise installed run-anywhere and default topic/file paths against fake transports and a manifest-only new publisher. Preserve legacy aliases and Board artifact paths with additive schema support. Remove unsafe operator-text shell interpolation and test metacharacters. Synchronize authority/derived docs and correct shipped stage/bot/DAG drift.

Implements feature G21 scenarios: R1 — Existing authoring inputs keep their observable behavior; R12 — Entry surfaces and artifacts remain consistent.

Owned surface: plugins/kk/commands/workflow-run.md; apps/cli stage/Board ITC; apps/board/src/itc; packaging assets; integration tests; docs/00-05 and AGENTS.md.

Verified premises: apps/cli/src/commands/stage.ts:40; apps/cli/tests/kk-itc-publish-tail.test.ts:1; docs/00_ADR.md:1210. Full contract: docs/design/kk-itc-refactor.md. Preserve existing Content → Result, direct entry execution and plugin-owned validation. No new service or live account is needed.

Rubric: E10 D1 L3 C1 R1 = 16; independent behavior/risk boundary with implementation and tests together. 

Ordering: after Plan ITC publication from discovered plugin capabilities, Select evidence-backed ITC topics from the collection store, Resolve topic channel presets with explicit target overrides, Persist bounded ITC semantic decisions and safe fallbacks, Dispatch ITC targets with isolated payloads and recoverable receipts. Shared workflow/stage surfaces are sequenced, not concurrently edited.

2026-10-15 operator feedback amendment: Own canonical ITC configuration/workspace resolution and cross-surface compatibility. Resolve KK_CONFIG or ~/.config/kk/config.yaml with explicit launch > existing env > workflows.kk-itc > applicable global defaults > compiled defaults; refuse malformed existing config before mutation. Reuse current helpers and expand documented home prefixes without shell evaluation. Freeze non-secret options/digest; resolve relative works_dir against the config directory and --dir against launch cwd. Compose {works_dir}/kk-itc/{topic-name}/[YYYYMMDD]/ with dated=false unless requested, a validated explicit run date overriding computed date, and a stable date/timezone on resume. Preserve existing ASCII slugs and safely support Unicode topics. Keep Board trust root and workspace ownership consistent; never erase remote receipts on force. Test configured root, env/full-dir overrides, dates, invalid config, Unicode/metacharacters, collisions, changed ambient config and installed launch paths. Synchronize settings/config docs and DAG+FSM/SEO handoff readers. Existing live/spend intent remains explicit.

Also implements G21 R14 — ITC workspace follows configured topic and optional date.

Also implements G21 R15 — Invalid ITC configuration stops before mutation.

Also implements G21 R18 — Resume retains the original effective configuration.

### Requirements

- [ ] R1. Existing authoring inputs keep their observable behavior; it produces the existing draft and Board artifact paths without collection, image spending or publication.
- [ ] R2. Entry surfaces and artifacts remain consistent; values remain data, existing aliases and artifacts stay usable, and command documentation describes the implemented surface.
- [ ] R3. ITC workspace follows configured topic and optional date; the default path is .works/kk-itc/reliable-workflows and an explicit valid date adds YYYYMMDD while a full directory override wins.
- [ ] R4. Invalid ITC configuration stops before mutation; it reports the key or file error without writing workspaces or exposing secret values.
- [ ] R5. Resume retains the original effective configuration; it uses the original resolved values and digests or refuses mismatched evidence without silently changing directories or publication intent.

### Acceptance Criteria

```gherkin
Feature: Keep ITC entry and Board contracts compatible across the refactor

  Scenario: AC1 — Existing authoring inputs keep their observable behavior (req: R1)
    Given an existing direct topic or input file with default publication settings
    When kk-itc runs
    Then it produces the existing draft and Board artifact paths without collection, image spending or publication

  Scenario: AC2 — Entry surfaces and artifacts remain consistent (req: R2)
    Given the installed workflow runner, CLI stage entry and Board ITC reader
    When compatibility checks exercise new options and paths containing shell metacharacters
    Then values remain data, existing aliases and artifacts stay usable, and command documentation describes the implemented surface
  Scenario: AC3 — ITC workspace follows configured topic and optional date (req: R3)
    Given works_dir configured as .works and an ITC topic named reliable-workflows
    When workspace allocation runs
    Then the default path is .works/kk-itc/reliable-workflows and an explicit valid date adds YYYYMMDD while a full directory override wins

  Scenario: AC4 — Invalid ITC configuration stops before mutation (req: R4)
    Given an existing config with malformed YAML, an unreadable file or a wrong-typed ITC setting
    When ITC configuration resolves
    Then it reports the key or file error without writing workspaces or exposing secret values

  Scenario: AC5 — Resume retains the original effective configuration (req: R5)
    Given a persisted run with frozen workspace, date, locale, preset and mode whose ambient config later changes
    When the workflow resumes
    Then it uses the original resolved values and digests or refuses mismatched evidence without silently changing directories or publication intent

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Exercise installed run-anywhere and default topic/file paths against fake transports and a manifest-only new publisher. Preserve legacy aliases and Board artifact paths with additive schema support. Remove unsafe operator-text shell interpolation and test metacharacters. Synchronize authority/derived docs and correct shipped stage/bot/DAG drift.

Decision: follow ADR-040 and docs/design/kk-itc-refactor.md; use a top-level DAG with bounded authoring FSM and reuse native discovery, store, decision, bot and executor seams. Rejected: expanding TARGET_PROFILES or introducing a router service, because both perpetuate duplicated ownership. Scope: plugins/kk/commands/workflow-run.md; apps/cli stage/Board ITC; apps/board/src/itc; packaging assets; integration tests; docs/00-05 and AGENTS.md.

Invariants: optional ingestion; draft-first operation; explicit live and image intent; no automated login; no data loss; exact target identity; legacy direct invocation stays valid. Material premises verified at apps/cli/src/commands/stage.ts:40; apps/cli/tests/kk-itc-publish-tail.test.ts:1; docs/00_ADR.md:1210.

Execution budget: 10 engineering hours; one task pipeline attempt with at most one bounded repair per failing behavior before reporting unresolved evidence. Implementation must produce a meaningful source diff and behavioral tests. Persist diagnostics in the task run directory and durable verification evidence; resume from partial work rather than replaying remote effects.

Test seam: Bun tests with fake transports/store pools, catalog stubs and temporary plugin assets; never real publication, login, or paid generation. Each task updates its surface docs in the same change; final task handles integration consistency.

Current design amendment:
Own canonical ITC configuration/workspace resolution and cross-surface compatibility. Resolve KK_CONFIG or ~/.config/kk/config.yaml with explicit launch > existing env > workflows.kk-itc > applicable global defaults > compiled defaults; refuse malformed existing config before mutation. Reuse current helpers and expand documented home prefixes without shell evaluation. Freeze non-secret options/digest; resolve relative works_dir against the config directory and --dir against launch cwd. Compose {works_dir}/kk-itc/{topic-name}/[YYYYMMDD]/ with dated=false unless requested, a validated explicit run date overriding computed date, and a stable date/timezone on resume. Preserve existing ASCII slugs and safely support Unicode topics. Keep Board trust root and workspace ownership consistent; never erase remote receipts on force. Test configured root, env/full-dir overrides, dates, invalid config, Unicode/metacharacters, collisions, changed ambient config and installed launch paths. Synchronize settings/config docs and DAG+FSM/SEO handoff readers. Existing live/spend intent remains explicit.

### Plan

1. Read the owned code, all callers, feature scenarios and design; confirm dependency outputs before edits.
2. Implement the selected behavior at its existing ownership seam, preserving validation, errors and compatibility.
3. Add behavior tests for each mapped scenario and its malformed/degraded boundary; assert side effects are absent on refusal.
4. Run changed-scope checks while iterating, then the project lint/test/build/rule checks through the task pipeline.
5. Update relevant surface documentation, preserve evidence and complete independent review/verification before task closure.
6. Apply the 2026-10-15 design amendment and exercise its added scenarios; use only the current revision contracts.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
