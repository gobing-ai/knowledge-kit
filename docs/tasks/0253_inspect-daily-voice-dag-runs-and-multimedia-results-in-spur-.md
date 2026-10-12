---
schema_version: 1
name: Inspect daily voice DAG runs and multimedia results in Spur Board
status: todo
template: feature-impl
created_at: 2026-10-11T23:22:42.778Z
updated_at: "2026-10-12T04:36:17.893Z"
feature_id: G8
priority: P2
tags:
  - board
  - workflows
estimate_hours: 8

dependencies: ["0252"]
ac_altitude: task-local
ac_numbering: task-local
---

## 0253. Inspect daily voice DAG runs and multimedia results in Spur Board

### Background

Feature G8; accepted design docs/design/workflow-board-modules.md and ADR-035. Implements: R3 — Summary separates execution status from result outcome; R5 — Daily voice results show content audio and channel outcomes; R8 — Daily progress preserves DAG branches and nested evidence; R9 — Configuration distinguishes current defaults and recorded run values; R10 — No runs and unavailable artifacts have explicit states; R11 — Overwritten workspaces never impersonate historical outputs; R13 — Refreshing and connection failures preserve a truthful view.

Ownership: apps/board/src/daily-voice/** (new), apps/board/src shared UI only where behavior repeats, apps/cli/src/board daily projection/capture, plugins/kk/workflows/kk-daily-ai-voice2.yaml, apps/cli/src/commands/daily.ts, .spur/config.yaml, browser/package outputs and corresponding fixtures/docs.

Verified source premises: docs/design/workflow-board-modules.md section 9; installed @gobing-ai/spur 0.4.2 public ABI and observed run APIs; existing CLI/stage preparation symbols and artifact writers inspected during this ready audit.

Rubric: E8 D1 L3 C1 R1 = 14; retain this cohesive deliverable with steps in Plan. Dependencies are the persisted frontmatter WBS edges; their explicit handoff is frozen in Design.

**Refine corrections (2026-10-11)**
- DAG fallback left as an implementation-time choice → live installed 0.4.2 progress emits state-oriented rows and orphan-action-row diagnostics → freeze public run-detail node/attempt fallback.
- Daily preparation location/default workspace only loosely identified → prepareAction resolves configured works root which may be outside the checkout → capture that exact child directory at the existing prepare seam.
- Run capture settings and definition unspecified → engine injects __definitionDigest and existing __runId → forward the frozen typed capture inputs and digest-check topology.
- Same-day supersession only checked by owner marker → current producer can still see earlier cached files → require selected-run producer success before displaying artifacts.
- Section audio treated as existing → ADR-034 is accepted design, not required shipped output → show recorded final audio now and sections only if actually described by outputs.
- Acceptance checkbox titles lacked requirement/test binding → executable feature-title scenarios are available → bind every local R item and name its observing test file.
- Dependency referenced a volatile sidecar → frontmatter already depends on 0252 → freeze the exact shared contracts consumed and daily projection handed to 0255.

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The installed host advertises the facade specifiers `react`, `react/jsx-runtime`, `react/jsx-dev-runtime` (plus `react-dom`, `react-dom/client`, `react-router`, `react-router/dom`) at React 19.2.1 / ReactDOM 19.2.1 / React Router 7.11.0, and a module may externalize only what that manifest names | installed `@gobing-ai/spur` `web/board-runtime.json` | Read `node_modules/@gobing-ai/spur/web/board-runtime.json:4-11`; all seven `web/_astro/board-facade-*.js` files the manifest names exist on disk | HIGH |
| The runs API is `/api/runs` (accepting `workflow`, `limit`, `cursor`, `status`, `since`), `/api/runs/:runId`, `/api/runs/:runId/progress` and `/api/runs/by-wbs/:wbs`; an action row carries `resultSummary` | installed `@gobing-ai/spur` bundle route registrations | Read the four `app.get` handlers and the `resultSummary` projection in `node_modules/@gobing-ai/spur/spur.js` (0.4.2) | HIGH |
| `/api/runs/:runId/progress` answers 404 `RUN_NOT_FOUND` as soon as the projection carries an `orphan-row` diagnostic, so a DAG run can lose the whole projection and an unknown run is indistinguishable from an orphan-row run | installed bundle progress handler | Read the guard (`projection.diagnostics.some(d => d.code === 'orphan-row')` → 404) and the diagnostic push in `projectWorkflowProgress` (`spur.js`, 0.4.2); consequence recorded in `docs/tasks/0253_*.md` Background | HIGH |
| A media artifact's bytes are fetched AFTER the reader's owner re-check, so a future image/audio descriptor must move the fetch inside `observe` or re-verify ownership after it | the shipped reader in this repo | `apps/cli/src/board/reader.ts:431,475,603` (read; this constraint is in this task's Background as a handoff) | HIGH |
| The daily pipeline's default works root is `~/.config/kk/works`, outside the project, while the capture guard accepts only a `.works`/`works`-rooted path | `apps/cli/src/commands/daily.ts:97,113` and the capture guard | Read both: `return join(homedir(), '.config/kk/works')` and the structural guard at `apps/cli/src/board/capture.ts:309` | HIGH |

### Requirements

- [ ] R1. Ship the Daily AI Voice native module with all four tabs and the shared stable run-selection behavior.
- [ ] R2. Project available article, cover, script, audio, quality/safety report and per-channel draft/live/skipped/failure outcomes with previews and range-capable playback/download.
- [ ] R3. Display recorded DAG dependencies/node attempts/retry siblings without an invented sequential stage, skipped state or percentage; expose nested safety linkage only when recorded.
- [ ] R4. Capture sanitized effective daily settings before output generation and reject superseded same-day artifacts while preserving recorded config/progress; keep publishing and scheduling unchanged.
- [ ] R5. Reuse Settings → Workflows for definition browsing, YAML/copy and static graphs; link /board/settings/workflows and expose only captured run settings in the module. No duplicate current-definition endpoint.

Non-goals: no execution/edit/publish controls, extra workflow-definition UI/API, raw store reads, arbitrary file access, upstream Spur edits or paid/live workflow runs. Preserve existing unrelated behavior.

### Acceptance Criteria

```gherkin
Feature: G8 task 0253

  Scenario: AC1 — Summary separates execution status from result outcome (req: R1)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given a completed run with partial publishing and a failed run with available outputs
    When the operator opens Summary for each run
    Then the view shows run identity, start time, elapsed time, execution status, known result outcome, counts, freshness and diagnostics without calling partial results fully successful

  Scenario: AC2 — Daily voice results show content audio and channel outcomes (req: R2)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given a daily voice run with an article, cover, script, audio and mixed channel result files
    When the operator opens Results
    Then the view previews available article and cover, plays and downloads audio, links available script and report, and distinguishes per-channel draft, live, skipped and failed outcomes

  Scenario: AC3 — Daily progress preserves DAG branches and nested evidence (req: R3)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given a daily voice DAG run with concurrent nodes, skipped branches, retry siblings and nested safety work
    When the operator opens Execution progress
    Then the view shows dependency relationships and actual node states, separates retries, and links nested evidence when a child run identity is recorded without claiming a single current stage or invented percentage

  Scenario: AC4 — Configuration distinguishes current defaults and recorded run values (req: R4; R5)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given a workflow changed after a run and a newer run with captured sanitized effective configuration
    When the operator opens Workflow Config Summary for both runs
    Then the view shows sanitized recorded run values and captured schedule overrides with provenance, marks uncaptured historical values unknown, and links to Settings Workflows for the current definition and defaults without duplicating its viewer

  Scenario: AC5 — No runs and unavailable artifacts have explicit states (req: R1; R2)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given a workflow with no runs or a selected run with missing, malformed, oversized or unfinished outputs
    When the operator opens its module
    Then the view distinguishes no runs, pending, unavailable, invalid and truncated evidence and keeps other tabs usable

  Scenario: AC6 — Overwritten workspaces never impersonate historical outputs (req: R4)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given two run IDs share one workspace and the later run owns its artifacts
    When the operator selects the earlier run
    Then the view retains its recorded progress and sanitized config but marks artifact content superseded or unverifiable rather than displaying later outputs as earlier results

  Scenario: AC7 — Refreshing and connection failures preserve a truthful view (req: R1)
    # Test lens: apps/cli/tests/board/daily-voice.test.ts; apps/board/tests/daily-voice.test.ts; apps/cli/tests/voice2-dag.test.ts; apps/cli/tests/commands/daily.test.ts
    Given a selected active run and then a reader or Spur API outage
    When the automatic refresh occurs
    Then the view labels stale data with its last successful update, keeps available progress separate from artifact failures, preserves selection and offers manual refresh without overlapping requests
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-11T23:52:23.287Z

Closed ready-audit decisions (2026-10-11): use section 9 frozen APIs and artifact-only projections; existing Settings owns definitions; no current-definition endpoint. Capture revocation failure stops before overwriting results; optional capture failure after revocation only warns. Missing historical/config/producer/topology evidence stays unknown. Future audio sections are optional. Dependency contracts and named observing tests are fixed in Design. No open product decision remains.

### Design

Reuse the Collect slice foundation. The installed live DAG projection is state-oriented and incomplete; use supported run-detail action rows for node attempts and digest-verified captured topology for edges, with a deterministic regression fixture. Link Settings for the current static graph; unknown historical node/dependency evidence stays unknown. Do not modify Spur or implement an engine. Daily preparation creates the run binding after resolving work_dir and before any output producer; data applies to the selected __runId, not date/latest anchors. Same-date older content becomes superseded; captured config remains readable. Media streams only from the run-owned allowlist and supports byte ranges; previews do not load entire audio into memory. Parse existing Content/Result/report shapes and preserve semantic channel outcomes independently of engine status. Captured settings use section 9's numeric/boolean/enum allowlists; current configuration belongs in Settings. No raw commands, free-text profile identifiers or provider secrets. Existing production DAG dependencies, safety behavior, caches and publish defaults remain intact.

Execution budget: one task pipeline pass, at most two focused correction passes; preserve failing evidence and request replanning if the concrete integration contract differs. New production diff required; a planning-only result cannot satisfy this task. Persist fixtures/test evidence with the task and implementation; .spur/run scratch is volatile. No drive-by refactors or GitHub workflow changes.

Settings → Workflows owns current definitions, dropdown, YAML/copy and static graphs. Link /board/settings/workflows; its current dropdown has no workflow-selection URL contract. Config Summary owns only sanitized recorded run values, capture provenance and explicit unknowns. Do not create a current-definition reader endpoint or duplicate viewer. Run-specific progress remains in the module.

Consume 0252's shared UI/types, identity-checked HTTP reader, captureRun, artifact policy and build hook; do not re-own them. Produce apps/board/src/daily-voice/index.tsx and apps/cli/src/board/daily-voice.ts, daily fixtures and the enabled built contribution for 0255. Follow section 9 names and capture options. No new server or definition/config viewer.

The live installed 0.4.2 DAG progress probe returned state-oriented rows with orphan-action-row diagnostics. Use public run-detail actions keyed by node plus action ID for actual node attempts, and captured digest-verified topology for run dependency edges. No evidence means unknown; keep retry siblings distinct and child safety links only when recorded. Missing captured topology links Settings for current structure without calling it historical. Capture at daily.ts:prepareAction, preserving voice1 and direct callers with no Board run flags. Use the explicit captured workspace even when outside the project, never derive it from latest anchors/date/mtime. Require successful selected-run producers before exposing cached or new media. Future ADR-034 section audio is optional until actual output descriptors exist.

Audit baseline: git worktree list shows this main checkout only; spur task list --status wip is empty. Prior authorized uncommitted G8/discovery changes are retained. Recheck these facts at implementation startup; they do not authorize reverting another contributor. Execution budget remains one pipeline pass plus at most two focused correction passes. Persist durable fixtures in the named test areas and verification evidence through Spur; scratch under .spur/run is not the sole handoff.

### Plan

1. (R1) Read 0252 contracts and fixtures; confirm installed list/detail API shapes and the saved live DAG limitation. Add the daily-voice native entry using shared run-selection/polling and four tabs.
2. (R4) Thread explicit run/digest/allowlisted values into daily.ts:prepareAction and freeze exact workspace ownership before result producers; test configured external child roots, no-Board direct callers and unchanged voice1 behavior.
3. (R2) Map current article/cover/script/final audio, report, quality/safety and per-target outputs to fixed producer nodes; require selected-run success for cached files, and show absent future section audio explicitly.
4. (R3) Project DAG actions/retry siblings with captured dependency edges and unknown historical gaps; show nested child linkage only when recorded. Add deterministic retry/no-content/partial-channel fixtures.
5. (R1/R5) Use captured config plus /board/settings/workflows link, enable only the built daily entry and hand its projection/fixtures to 0255. Test shared run links and stale/reader-outage behavior.
6. (R1-R5) Run section 9 daily tests and existing daily/voice2 regressions, then lint, full unit suite, workspace build and rule presets; update the actual shipped surface docs.

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
