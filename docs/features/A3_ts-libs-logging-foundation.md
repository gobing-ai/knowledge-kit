---
schema_version: 1
id: "A3"
name: "ts-libs logging foundation"
status: done
priority: P2
tags: []
created_at: "2026-08-17T05:01:33.104Z"
updated_at: "2026-08-17T21:18:02.904Z"
---

# A3: ts-libs logging foundation

## Goal
Consolidate knowledge-kit's output/logging foundation on the shared ts-libs stack, mirroring
spur-new:

- Constrain `@gobing-ai/ts-{utils,infra,runtime,db}` at `^0.4.35` in a root Bun workspace
  `catalog:`. Depend where consumed: `ts-utils` + `ts-infra` now; `ts-runtime` and `ts-db`
  stay catalog-only until a runtime or persistence requirement exists.
- Make ts-utils `echo`/`echoError` the universal terminal-output seam (adapted by
  `apps/cli/src/output.ts`); make ts-infra's LogTape logger (`initializeLogger` once per
  diagnostic-emitting process, `getLogger` at call sites) the shared diagnostics library.
- Migrate the 15 production `console.*` call sites measured by the rule pattern
  (`karakeep-local` 7, `web-search` 6, `plugins/kk/scripts/render-md.ts` 2); add the missing
  `package.json` to `karakeep-local`.
- Dissolve `@gobing-ai/utils`: migrate its logger consumers and delete its unconsumed `add`,
  `z`, and `ZodType` exports without a compatibility package.
- Extend the `output-boundaries` Spur rule include scope to `plugins/**/src/**` +
  `plugins/kk/scripts/**` so `recommended-pre-check` enforces the invariant; verify RED→GREEN
  (current baseline → 0).

Evaluated 2026-08-17: urgency 3, necessity 3, recommendation proceed (reshaped) — see
`.spur/run/idea-eval-report.md` (run_id 6b400150-0fb5-4d03-9f2d-c6195a935cd8).
## Scope
- In: root catalog; ts-utils output adapter; ts-infra diagnostics bootstrap; production call-site
  migration; `karakeep-local` workspace manifest; `@gobing-ai/utils` removal; rule RED→GREEN.
- Out: `ts-runtime` spawn/filesystem adoption; `ts-db` or persistence; custom/file logging sinks;
  a replacement logging workspace; test/fixture console restrictions.
## Acceptance Criteria
```gherkin
Feature: ts-libs logging foundation

  @core
  Scenario: R1 — ts-libs packages are constrained in the root catalog and depended on only where consumed
    Given the root Bun workspace package.json declares a catalog
    When the catalog and workspace manifests are inspected
    Then @gobing-ai/ts-utils, ts-infra, ts-runtime, and ts-db all use the catalog constraint ^0.4.35
    And only workspaces that directly consume ts-utils or ts-infra declare catalog dependencies on them
    And ts-runtime and ts-db have no dependent workspace in feature A3

  @core
  Scenario: R2 — A single terminal-output seam is backed by ts-utils echo and echoError
    Given a new apps/cli/src/output.ts module
    When production code writes user-facing terminal output or errors
    Then the CLI adapter and direct consumers delegate to ts-utils echo and echoError
    And stdout and stderr routing, message text, final newlines, and exit codes remain unchanged

  @core
  Scenario: R3 — Structured logging is initialized once per diagnostic-emitting process
    Given ts-infra exposes initializeLogger and getLogger over LogTape
    When the CLI or a plugin process emits structured diagnostics
    Then that process calls initializeLogger exactly once before dispatch
    And each diagnostic-emitting plugin obtains a plugin-scoped logger through getLogger
    And no plugin installs a custom logging sink

  @core
  Scenario: R4 — All production console call sites migrate to the seams
    Given the output-boundaries rule pattern currently finds 15 production console call sites across karakeep-local, web-search, and plugins/kk/scripts/render-md.ts
    When the migration lands
    Then zero production source files under apps, packages, and plugins call console dot methods or process stdout/stderr write directly
    And the existing observable behavior is preserved

  @core
  Scenario: R5 — karakeep-local gains the package.json it is missing
    Given plugins/ingestions/karakeep-local currently ships only plugin.json, src, and tests
    When its manifest is added
    Then package.json follows the sibling plugin convention for name and dependencies
    And the plugin still builds and runs as before

  @core
  Scenario: R6 — The @gobing-ai/utils package dissolves without a compatibility layer
    Given @gobing-ai/utils exports a logger plus unconsumed add, z, and ZodType exports
    When all source and manifest consumers migrate
    Then packages/utils and its workspace package are removed
    And no source or package manifest references @gobing-ai/utils
    And no replacement compatibility package or speculative re-export is introduced

  @core
  Scenario: R7 — The output-boundaries rule enforces the invariant RED then GREEN
    Given the output-boundaries Spur rule includes only apps and packages source today
    When its include scope is extended to plugins/**/src/** and plugins/kk/scripts/**
    Then recommended-pre-check reports the existing console violations before migration
    And reports zero violations after migration

  @edge
  Scenario: R8 — Warning paths stay non-fatal after migration
    Given karakeep-local emits recoverable warnings for corrupt or unparsable source files
    When ingestion encounters such a file after the seam migration
    Then the warning surfaces through echoError or a plugin-scoped warning logger without aborting the run
    And genuinely fatal conditions still exit non-zero

  @edge
  Scenario: R9 — Rule scope extension flags production only
    Given the extended output-boundaries include scope
    When test files and fixtures under plugins contain console usage
    Then the pre-check does not flag them as violations
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0066 | Enforce plugin output boundaries and migrate raw console call sites | done |
| 0065 | Establish the ts-libs catalog and CLI output foundation | done |
| 0067 | Complete the ts-libs cutover and remove @gobing-ai/utils | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-08-17T05:52:05.881Z moved K → A3 (system)
- 2026-08-17T21:18:02.646Z backlog → active (system)
- 2026-08-17T21:18:02.776Z active → verifying (system)
- 2026-08-17T21:18:02.904Z verifying → done (system)
