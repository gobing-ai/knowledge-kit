---
schema_version: 1
name: Inspect collection runs through a native Board module and local reader
status: todo
template: feature-impl
created_at: 2026-10-11T23:22:42.773Z
updated_at: "2026-10-12T04:41:30.501Z"
feature_id: G8
priority: P2
tags:
  - board
  - workflows
estimate_hours: 12

ac_altitude: task-local
ac_numbering: task-local
---

## 0252. Inspect collection runs through a native Board module and local reader

### Background

Feature G8; accepted design docs/design/workflow-board-modules.md and ADR-035. Implements: R2 — Run selection stays consistent across all four tabs; R3 — Summary separates execution status from result outcome; R4 — Collect results show ingestion and labeling evidence; R7 — Progress preserves state visits and retries; R9 — Configuration distinguishes current defaults and recorded run values; R10 — No runs and unavailable artifacts have explicit states; R11 — Overwritten workspaces never impersonate historical outputs; R12 — Artifact access is limited to the selected project and run; R13 — Refreshing and connection failures preserve a truthful view.

Ownership: apps/board/** (new), apps/cli/src/board/** (new), apps/cli/src/commands/board.ts (new), apps/cli/src/cli.ts, plugins/kk/workflows/kk-collect.yaml, plugins/kk/scripts/kk-workflow-stages.ts, package.json, apps/cli/package.json, scripts/bundle-plugins.ts, .spur/config.yaml and corresponding tests/docs.

Verified source premises: docs/design/workflow-board-modules.md section 9; installed @gobing-ai/spur 0.4.2 public ABI and observed run APIs; existing CLI/stage preparation symbols and artifact writers inspected during this ready audit.

Rubric: E12 D1 L3 C1 R1 = 18; retain this cohesive deliverable with steps in Plan. No predecessor.


Also implements R15 — Workflow definitions remain in Settings Workflows.

**Refine corrections (2026-10-11)**
- Unverified file-line premises → inspected collectPrepare, lock state, store stdout and CLI registration → replace speculative anchors with current symbol references.
- Current/store projections left open → store-result.json is inserted/updated/unchanged and label-result.txt is aggregate evidence → artifacts-only reader; absent per-label detail stays unavailable.
- New workspace owner treated as sufficient → old files remain until producers finish → revoke old owner and require exact successful producer evidence before serving content.
- Browser identity check alone → reader also needs execution authority → validate project/run via supported Board HTTP APIs in the reader.
- Capture CLI/type names unspecified → frozen section 9 contract → use captureRun and declared run/digest vars without inventing APIs.
- Browser packaging assumed existing staging → CLI prepack only builds CLI/plugins → invoke the shared Bun browser build explicitly from root build and prepack.
- Foundation AC claimed all three modules → daily/ITC implementations depend on this task → final three-module proof belongs solely to 0255; keep Collect foundation observable here.
- Workflow relocation described as future work → symlink and catalog/browser proof already exist → preserve that topology and verify it, do not repeat the move.

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The contribution ABI is `apiVersion: 1`, the entry exports `webModule`, and the component renders inside the host's own React tree without `createRoot` | installed `@gobing-ai/spur` declaration-only `./board` export | Read `node_modules/@gobing-ai/spur/board/index.d.ts:21,24,27,38` (0.4.2) | HIGH |
| The host advertises `react`, `react/jsx-runtime` and `react/jsx-dev-runtime` (plus `react-dom`, `react-dom/client`, `react-router`, `react-router/dom`) at React 19.2.1 / ReactDOM 19.2.1 / React Router 7.11.0 | installed `web/board-runtime.json` | Read `node_modules/@gobing-ai/spur/web/board-runtime.json:4-11`; all seven named `web/_astro/board-facade-*.js` assets exist on disk | HIGH |
| A module declaration is a `.strict()` discriminated `react`/`iframe` union with `id` matching `^[a-z][a-z0-9-]*$`; a duplicate id or a reserved-identity collision is refused at config load, and the host derives the route as `/modules/<id>` | installed bundle `boardModuleDeclarationSchema`, `validateBoardModuleDeclarations`, `BOARD_MODULE_ROUTE_PREFIX` and `web/board-runtime.json` `reservedModules` | Read the emitted zod shapes, the collision check and the route constant in `node_modules/@gobing-ai/spur/spur.js` (0.4.2) | HIGH |
| `bootstrap.modules` is validated by the RUNTIME schema only — the shipped `schemas/spur-config.schema.json` `bootstrap` block lists just logging/telemetry/database/scheduler | installed `schemas/spur-config.schema.json:20` and the bundle's `bootstrapSectionSchema` | Read both in `node_modules/@gobing-ai/spur` (0.4.2); the consequence (enable a module only after its assets exist) is in docs/04_DESIGN.md | HIGH |
| The runs API is `/api/runs` (with `workflow`, `limit`, `cursor`, `status`, `since`), `/api/runs/:runId`, `/api/runs/:runId/progress` and `/api/runs/by-wbs/:wbs`, and the progress route answers 404 `RUN_NOT_FOUND` once the projection carries an `orphan-row` diagnostic | installed bundle route registrations and `projectWorkflowProgress` | Read the `app.get` handlers and the orphan-row guard in `node_modules/@gobing-ai/spur/spur.js` (0.4.2) | HIGH |
| §9's literal read protocol (`O_NOFOLLOW`, a held descriptor, `fstat` on the descriptor) is not implementable here: `no-direct-fs-io` is an error over `apps/**/src/**` and the `@gobing-ai/ts-runtime` `FileSystem` seam exposes no open/fd primitive | `.spur/rules/strict/runtime-boundaries.yaml` and the installed `FileSystem` declaration | Read both; the reader therefore implements the behavioural guarantee (re-resolve, pre/post-read stat, post-read owner re-verification with `404 board.artifact.owner-changed`) and the residual is recorded in `.spur/memory/runs/g8-0252-465e601c.md` as an open operator decision | HIGH |

### Requirements

- [ ] R1. Ship a native Collect module with the four tabs, stable run/tab deep links, paged run selection and truthful summary/refresh states.
- [ ] R2. Implement the minimal read-only local reader and exact project/run/artifact access checks, recorded run config projection, sanitized run capture and same-folder supersession behavior.
- [ ] R3. Expose run-bound artifact-backed source/ingestion/aggregate-label/facts results and recorded state progress without triggering any pipeline operation.
- [ ] R4. Build and distribute the first native entry with host React externalized; preserve all existing CLI/workflow behavior and include fixtures, setup notes and surface docs.
- [ ] R5. Reuse Settings → Workflows for definition browsing, YAML/copy and static graphs; link /board/settings/workflows and expose only captured run settings in the module. No duplicate current-definition endpoint.

Non-goals: no execution/edit/publish controls, extra workflow-definition UI/API, raw store reads, arbitrary file access, upstream Spur edits or paid/live workflow runs. Preserve existing unrelated behavior.

### Acceptance Criteria

```gherkin
Feature: G8 task 0252

  Scenario: AC1 — Run selection stays consistent across all four tabs (req: R1; R4)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given two runs of a workflow with different outputs
    When the operator selects the older run and changes tabs
    Then Summary, Results, Execution progress and Workflow Config Summary all retain that run ID and the URL preserves run and tab selection

  Scenario: AC2 — Summary separates execution status from result outcome (req: R1)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a completed run with partial publishing and a failed run with available outputs
    When the operator opens Summary for each run
    Then the view shows run identity, start time, elapsed time, execution status, known result outcome, counts, freshness and diagnostics without calling partial results fully successful

  Scenario: AC3 — Collect results show ingestion and labeling evidence (req: R3)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a collection run with source counts, inserted and updated counts, facts and label results
    When the operator opens Results
    Then the view shows available source and label counts, confidence and fallback information, facts preview and downloads without inventing absent counts

  Scenario: AC4 — Progress preserves state visits and retries (req: R3)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a collection or IT Content run with a repeated state, a failed action and an operator pause
    When the operator opens Execution progress
    Then the view shows recorded state visits and attempts, timings, pause or failure diagnostics and pending or skipped work without triggering an execution action

  Scenario: AC5 — Configuration distinguishes current defaults and recorded run values (req: R2; R5)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a workflow changed after a run and a newer run with captured sanitized effective configuration
    When the operator opens Workflow Config Summary for both runs
    Then the view shows sanitized recorded run values and captured schedule overrides with provenance, marks uncaptured historical values unknown, and links to Settings Workflows for the current definition and defaults without duplicating its viewer

  Scenario: AC6 — No runs and unavailable artifacts have explicit states (req: R1; R2)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a workflow with no runs or a selected run with missing, malformed, oversized or unfinished outputs
    When the operator opens its module
    Then the view distinguishes no runs, pending, unavailable, invalid and truncated evidence and keeps other tabs usable

  Scenario: AC7 — Overwritten workspaces never impersonate historical outputs (req: R2)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given two run IDs share one workspace and the later run owns its artifacts
    When the operator selects the earlier run
    Then the view retains its recorded progress and sanitized config but marks artifact content superseded or unverifiable rather than displaying later outputs as earlier results

  Scenario: AC8 — Artifact access is limited to the selected project and run (req: R2)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a running local reader and requests for another project, workflow, unlisted artifact, traversal path or escaping symlink
    When the requests reach the reader
    Then access is refused and only allowlisted run-bound files and sanitized config are readable from the configured Board origin

  Scenario: AC9 — Refreshing and connection failures preserve a truthful view (req: R1)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given a selected active run and then a reader or Spur API outage
    When the automatic refresh occurs
    Then the view labels stale data with its last successful update, keeps available progress separate from artifact failures, preserves selection and offers manual refresh without overlapping requests

  Scenario: AC10 — Workflow definitions remain in Settings Workflows (req: R5)
    # Test lens: apps/cli/tests/board/{capture,reader,collect}.test.ts; apps/board/tests/{run-selection,refresh,collect}.test.ts; scripts/tests/board-package.test.ts
    Given repository workflows have one canonical home under plugins/kk/workflows and .spur/workflows is its relative symlink
    When the operator follows the module configuration link to /board/settings/workflows
    Then the existing dropdown lists kk-collect, kk-daily-ai-voice2 and kk-itc once each, existing YAML and static graph controls remain authoritative, and .spur/workflows/feature-verification.yaml resolves to the canonical file
    And the modules provide no duplicate definition browser, YAML viewer, static graph or current-definition reader endpoint
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-11T23:52:20.593Z

Closed ready-audit decisions (2026-10-11): use section 9 frozen APIs and artifact-only projections; existing Settings owns definitions; no current-definition endpoint. Capture revocation failure stops before overwriting results; optional capture failure after revocation only warns. Missing historical/config/producer/topology evidence stays unknown. Future audio sections are optional. Dependency contracts and named observing tests are fixed in Design. No open product decision remains.

### Design

Use ADR-035 and docs/design/workflow-board-modules.md sections 2-6. One shared browser workspace and one KK reader are justified by three concrete callers; no generic plugin framework or new server framework. Resolve same-origin /api/project identity before accepting local reader data. Reuse Spur /api/runs list/detail/progress; treat their payloads as versioned trust boundaries. Bind future collect runs before outputs through the existing collect preparation path and a KK-owned capture helper/command; append-only per-run metadata plus atomic workspace ownership marker, no copied media. Old/legacy output with no ownership proof remains unavailable. Reader binds 127.0.0.1, accepts only the configured exact Board Origin/Host, allowlisted GET/HEAD/OPTIONS, bounded/safe previews and canonical artifact access; no store migration or write on read. Source counts/inserted/updated/label confidence come from existing artifacts; no store/DAO reads are introduced. Collect progress reuses state visit/attempt evidence. Browser build uses Bun and the public type-only contribution ABI, scopes CSS, and creates no React root. Command registration follows existing CLI patterns; compiled files and package manifests follow existing distribution path. The first installed native/reader/identity smoke proof happens before expanding the UI. After old-owner revocation, optional capture failure warns and withholds Board data; failed revocation stops before result overwrites. A broken reader leaves Spur progress usable.

Execution budget: one task pipeline pass, at most two focused correction passes; preserve failing evidence and request replanning if the concrete integration contract differs. New production diff required; a planning-only result cannot satisfy this task. Persist fixtures/test evidence with the task and implementation; .spur/run scratch is volatile. No drive-by refactors or GitHub workflow changes.

Settings → Workflows owns current definitions, dropdown, YAML/copy and static graphs. Link /board/settings/workflows; its current dropdown has no workflow-selection URL contract. Config Summary owns only sanitized recorded run values, capture provenance and explicit unknowns. Do not create a current-definition reader endpoint or duplicate viewer. Run-specific progress remains in the module.

Consume docs/design/workflow-board-modules.md section 9 as the frozen cross-task contract. No predecessor; hand 0253/0254 the shared Board UI, type-only @gobing-ai/kk-board/contracts export, captureRun, fixed workflow reader dispatch and build hook; hand 0255 the installed Collect smoke/package fixture. Keep settings definition inspection solely in /board/settings/workflows. Existing workflow relocation is baseline, not implementation work.

Use the installed same-origin run APIs with their observed runs/count/nextCursor/hasMore envelope. Reader identity/producer verification uses the configured Board origin with bounded requests; it never accepts a browser assertion as authorization. Capture after successful Collect lock acquisition, never from a skipped lock contender. Revoke old owner before producer writes; failure to revoke stops before overwrites, while optional new-capture failure after revocation warns and continues with content withheld. Test stale files under a new owner, producer action keys, same-run retries and ownership changes during ranges. No optional store read path.

Build only existing entries (Collect now); later entry owners extend that fixed list. The shared Bun build emits checkout and CLI distribution assets, and both root build and CLI prepack invoke it explicitly. Do not register absent future entries.

Audit baseline: git worktree list shows this main checkout only; spur task list --status wip is empty. Prior authorized uncommitted G8/discovery changes are retained. Recheck these facts at implementation startup; they do not authorize reverting another contributor. Execution budget remains one pipeline pass plus at most two focused correction passes. Persist durable fixtures in the named test areas and verification evidence through Spur; scratch under .spur/run is not the sole handoff.

### Plan

1. (R1/R4) Verify Bun/.prototools, installed Spur 0.4.2 public ABI/runtime manifest and saved API shapes; preserve prior changes and no-wip baseline. Add browser package/type-only contracts and a hook-bearing Collect entry.
2. (R4) Add scripts/build-board.ts and explicit root/prepack invocation; emit only existing contribution entries with host React externalized and prove a separately built Collect entry mounts.
3. (R2) Implement the section 9 capture/reader commands and immutable record/owner marker; use public Board identity/run/progress evidence and fixed artifact manifests. Add real-file/HTTP boundary tests.
4. (R2/R3) Declare run/digest binding and integrate capture strictly after successful collect lock acquisition before collection results; test lock contenders, revocation refusal, optional capture failure and old files under a new owner.
5. (R1/R3/R5) Implement Collect results, exact producer-key authorization, state progress, paged stable run/tab links, bounded previews and captured settings with the existing Settings link. Exercise no-run/failed/partial/stale fixtures.
6. (R1-R5) Run named reader/capture/Collect/browser/package tests, lint, full unit suite, workspace build and rule presets; document shipped CLI/setup surface and leave a concrete contracts/fixtures handoff to 0253/0254/0255.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G8; ADR-035 (including ready-audit ownership amendment).
- docs/design/workflow-board-modules.md section 9: frozen names, types, capture timing, ownership and test handoff.
- docs/plans/2026-10-11-G8-ready-refinement.md: durable checklist/corrections report.
- Installed Spur 0.4.2: board/index.d.ts and web/board-runtime.json; public HTTP list/detail/progress contracts verified against the running project Board. Sibling Spur source was read only for contract inspection, never a runtime/package dependency.
- Existing project worktree only; no active wip tasks at audit. Prior authorized changes remain in the shared checkout.

### History
