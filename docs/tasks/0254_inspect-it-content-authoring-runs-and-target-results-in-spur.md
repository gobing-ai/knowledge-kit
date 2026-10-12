---
schema_version: 1
name: Inspect IT Content authoring runs and target results in Spur Board
status: done
template: feature-impl
created_at: 2026-10-11T23:22:42.779Z
updated_at: "2026-10-12T17:10:34.080Z"
feature_id: G8
priority: P2
tags:
  - board
  - workflows
estimate_hours: 6

dependencies: ["0252"]
ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0254-verdict.json
---

## 0254. Inspect IT Content authoring runs and target results in Spur Board

### Background

Feature G8; accepted design docs/design/workflow-board-modules.md and ADR-035. Implements: R3 — Summary separates execution status from result outcome; R6 — IT Content results show authoring and review evidence; R7 — Progress preserves state visits and retries; R9 — Configuration distinguishes current defaults and recorded run values; R10 — No runs and unavailable artifacts have explicit states; R11 — Overwritten workspaces never impersonate historical outputs; R13 — Refreshing and connection failures preserve a truthful view.

Ownership: apps/board/src/itc/** (new), apps/cli/src/board ITC projection/capture, plugins/kk/workflows/kk-itc.yaml, plugins/kk/scripts/kk-workflow-stages.ts prepare-itc callers, .spur/config.yaml and corresponding fixtures/docs.

Verified source premises: docs/design/workflow-board-modules.md section 9; installed @gobing-ai/spur 0.4.2 public ABI and observed run APIs; existing CLI/stage preparation symbols and artifact writers inspected during this ready audit.

Rubric: E6 D1 L3 C1 R1 = 12; retain this cohesive deliverable with steps in Plan. Dependencies are the persisted frontmatter WBS edges; their explicit handoff is frozen in Design.

**Refine corrections (2026-10-11)**
- Add __runId only if needed → kk-itc currently declares no run identity → explicitly declare __runId and __definitionDigest for capture.
- Preparation safety not tied to shared callers → prepareWorkspace is shared with solo and has early revise-count behavior → capture only successful ITC preparation and preserve solo/XOR/force semantics.
- External roots described broadly → common reader accepts only an explicitly captured canonical child workspace → reuse 0252 containment and producer proof without an ITC bypass.
- Acceptance checkbox titles lacked requirement/test binding → freeze executable feature-title scenarios and real prep/reader test paths.
- Implicit foundation contract → frontmatter depends on 0252 → consume its types/capture/reader intact and hand only ITC entry/projection fixtures to 0255.

**Consumed from 0252 (2026-10-12).** The reader/capture contract is shipped and frozen — consume it,
do not clone it. Three constraints the 0252 verify pass surfaced for this task:

1. **External child workspaces.** `captureRun`'s guard requires a `.works`/`works` segment and
   refuses roots (`apps/cli/src/board/capture.ts:309`); an ITC caller-supplied workspace outside any
   works root is therefore refused today. §9 allows it "only when a trusted capture record bound that
   exact directory" — implement that binding explicitly rather than relaxing the structural guard,
   and keep the XOR/force validation ahead of the capture call.
2. **`readCaptureRecord` validates the record SHAPE** (string ids, absolute `workspacePath`, a
   `settings` object) and returns null otherwise, so a malformed record answers 422 rather than 500 —
   any new record field must be added to that validation.
3. **Progress rows carry `timing` + `operatorWait`** and the module reuses `dedupeDiagnostics`; the
   judge/revision evidence you project should state missing counters as `unavailable` rather than
   zero, per `overallAvailability` (`apps/cli/src/board/collect.ts:220`) — available only when EVERY
   artifact is available.

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The installed host advertises React 19.2.1 / ReactDOM 19.2.1 / React Router 7.11.0 and the facade specifiers a contribution may externalize | installed `@gobing-ai/spur` `web/board-runtime.json` | Read `node_modules/@gobing-ai/spur/web/board-runtime.json:4-11`; the seven named facade assets exist on disk | HIGH |
| The reader's status vocabulary is 400 bad identity/query, 403 foreign origin or project, 404 unknown capture/artifact, 405 mutating method, 416 unsatisfiable range, 422 malformed stored evidence, 503 Board authority unavailable | the shipped reader in this repo | `apps/cli/src/board/reader.ts:207,217,296,414,488` — read the branch that sets each status; the second review reproduced the 422 cases against a real server | HIGH |
| `kk-itc.yaml` does NOT declare `__runId` today, so §9's capture cannot bind an ITC run until it does | the workflow definition | `grep -c '__runId' plugins/kk/workflows/kk-itc.yaml` returns 0 (checked 2026-10-12); §9 requires the declaration with `__definitionDigest` | HIGH |
| A caller-supplied ITC workspace outside any works root is refused by the capture guard, so an external child workspace needs the §9 trusted-record binding rather than a relaxed guard | the shipped capture guard | `apps/cli/src/board/capture.ts:309` (structural refusal) plus the handoff note in this task's Background | HIGH |
| `readCaptureRecord` validates the record SHAPE and returns null on a missing string field, non-absolute `workspacePath` or absent `settings`, so any new record field must be added to that validation | the shipped capture module | `apps/cli/src/board/capture.ts:191` (read); the reader answers 422 via `authorize` rather than 500 | HIGH |

### Requirements

- [x] R1. Ship the IT Content native module with four tabs, run-bound authoring previews and truthful summary/recorded-config presentation.
- [x] R2. Show outline alternatives/selection, draft, judge feedback/revision evidence, optional images, per-target outcomes and final report when present.
- [x] R3. Reuse recorded state visits/retries/pause diagnostics and capture sanitized run settings while keeping all authoring/review/publishing actions read-only in the Board.
- [x] R4. Support trusted captured external ITC workspaces with narrow canonical allowlists and explicit missing/legacy/superseded states; preserve current prepare validation and force semantics.
- [x] R5. Reuse Settings → Workflows for definition browsing, YAML/copy and static graphs; link /board/settings/workflows and expose only captured run settings in the module. No duplicate current-definition endpoint.

Non-goals: no execution/edit/publish controls, extra workflow-definition UI/API, raw store reads, arbitrary file access, upstream Spur edits or paid/live workflow runs. Preserve existing unrelated behavior.

### Acceptance Criteria

```gherkin
Feature: G8 task 0254

  Scenario: AC1 — Summary separates execution status from result outcome (req: R1)
    # Test lens: apps/cli/tests/board/itc.test.ts; apps/board/tests/itc.test.ts; apps/cli/tests/kk-itc-workflow.test.ts; apps/cli/tests/itc-stages.test.ts
    Given a completed run with partial publishing and a failed run with available outputs
    When the operator opens Summary for each run
    Then the view shows run identity, start time, elapsed time, execution status, known result outcome, counts, freshness and diagnostics without calling partial results fully successful

  Scenario: AC2 — IT Content results show authoring and review evidence (req: R2)
    # Test lens: apps/cli/tests/board/itc.test.ts; apps/board/tests/itc.test.ts; apps/cli/tests/kk-itc-workflow.test.ts; apps/cli/tests/itc-stages.test.ts
    Given an IT Content run with outline alternatives, selected outline, draft, judge result and channel files
    When the operator opens Results
    Then the view exposes available outline and draft previews, revision and judge evidence, per-target outcomes and the final report

  Scenario: AC3 — Progress preserves state visits and retries (req: R3)
    # Test lens: apps/cli/tests/board/itc.test.ts; apps/board/tests/itc.test.ts; apps/cli/tests/kk-itc-workflow.test.ts; apps/cli/tests/itc-stages.test.ts
    Given a collection or IT Content run with a repeated state, a failed action and an operator pause
    When the operator opens Execution progress
    Then the view shows recorded state visits and attempts, timings, pause or failure diagnostics and pending or skipped work without triggering an execution action

  Scenario: AC4 — Configuration distinguishes current defaults and recorded run values (req: R3; R5)
    # Test lens: apps/cli/tests/board/itc.test.ts; apps/board/tests/itc.test.ts; apps/cli/tests/kk-itc-workflow.test.ts; apps/cli/tests/itc-stages.test.ts
    Given a workflow changed after a run and a newer run with captured sanitized effective configuration
    When the operator opens Workflow Config Summary for both runs
    Then the view shows sanitized recorded run values and captured schedule overrides with provenance, marks uncaptured historical values unknown, and links to Settings Workflows for the current definition and defaults without duplicating its viewer

  Scenario: AC5 — No runs and unavailable artifacts have explicit states (req: R1; R4)
    # Test lens: apps/cli/tests/board/itc.test.ts; apps/board/tests/itc.test.ts; apps/cli/tests/kk-itc-workflow.test.ts; apps/cli/tests/itc-stages.test.ts
    Given a workflow with no runs or a selected run with missing, malformed, oversized or unfinished outputs
    When the operator opens its module
    Then the view distinguishes no runs, pending, unavailable, invalid and truncated evidence and keeps other tabs usable

  Scenario: AC6 — Overwritten workspaces never impersonate historical outputs (req: R4)
    # Test lens: apps/cli/tests/board/itc.test.ts; apps/board/tests/itc.test.ts; apps/cli/tests/kk-itc-workflow.test.ts; apps/cli/tests/itc-stages.test.ts
    Given two run IDs share one workspace and the later run owns its artifacts
    When the operator selects the earlier run
    Then the view retains its recorded progress and sanitized config but marks artifact content superseded or unverifiable rather than displaying later outputs as earlier results

  Scenario: AC7 — Refreshing and connection failures preserve a truthful view (req: R1)
    # Test lens: apps/cli/tests/board/itc.test.ts; apps/board/tests/itc.test.ts; apps/cli/tests/kk-itc-workflow.test.ts; apps/cli/tests/itc-stages.test.ts
    Given a selected active run and then a reader or Spur API outage
    When the automatic refresh occurs
    Then the view labels stale data with its last successful update, keeps available progress separate from artifact failures, preserves selection and offers manual refresh without overlapping requests
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-11T23:52:26.040Z

Closed ready-audit decisions (2026-10-11): use section 9 frozen APIs and artifact-only projections; existing Settings owns definitions; no current-definition endpoint. Capture revocation failure stops before overwriting results; optional capture failure after revocation only warns. Missing historical/config/producer/topology evidence stays unknown. Future audio sections are optional. Dependency contracts and named observing tests are fixed in Design. No open product decision remains.

### Design

Reuse the existing native/reader foundation and state-machine progress path. Bind the caller-provided canonical ITC workspace to declared run identity during successful preparation; declare __runId and __definitionDigest for capture. Broad filesystem roots are refused. Preserve prepareWorkspace XOR input validation, overwrite protection, revise-count initialization and existing failure handling. Apply the same atomic owner marker and immutable sanitized config record as Collect; same-directory historical outputs are not claimed. Show outline options/selection, draft and judge feedback as safe bounded text projections; optional cover and inline images remain optional. Read per-target Result JSON and final report without initiating the existing publisher. Unknown config from old runs stays unknown. No new authoring method, prompts, pause responder or publishing action.

Execution budget: one task pipeline pass, at most two focused correction passes; preserve failing evidence and request replanning if the concrete integration contract differs. New production diff required; a planning-only result cannot satisfy this task. Persist fixtures/test evidence with the task and implementation; .spur/run scratch is volatile. No drive-by refactors or GitHub workflow changes.

Settings → Workflows owns current definitions, dropdown, YAML/copy and static graphs. Link /board/settings/workflows; its current dropdown has no workflow-selection URL contract. Config Summary owns only sanitized recorded run values, capture provenance and explicit unknowns. Do not create a current-definition reader endpoint or duplicate viewer. Run-specific progress remains in the module.

Consume 0252's common UI/types, captureRun, HTTP identity checks, containment/producer policy and build hook; do not fork them. Produce apps/board/src/itc/index.tsx, apps/cli/src/board/itc.ts and ITC fixtures for 0255. Declare __runId and __definitionDigest in kk-itc; bind capture after successful prepareItc before authoring. Freeze the common command/response names in section 9; no new API beyond this workflow projection.

prepareWorkspace is shared with solo-podcast: preserve current early revise-count initialization, XOR input refusal, brief overwrite/force handling, and all solo behavior. Do not report prep counters/briefs as produced result artifacts. Captured canonical external child directories use the common policy, never arbitrary home/config roots. Project outline options/approved outline, draft, sanitized judge verdict/feedback, revision counts derived from recorded revise/auto-revise visits (never mutable counter files), optional 4-illustrations assets, 4-publish/result.<target>.json and 5-report/report.json only when their selected-run producer evidence authorizes them. Target names come from the run-bound manifest/validated files, never a browser-supplied path.

Audit baseline: git worktree list shows this main checkout only; spur task list --status wip is empty. Prior authorized uncommitted G8/discovery changes are retained. Recheck these facts at implementation startup; they do not authorize reverting another contributor. Execution budget remains one pipeline pass plus at most two focused correction passes. Persist durable fixtures in the named test areas and verification evidence through Spur; scratch under .spur/run is not the sole handoff.

### Plan

1. (R1/R3) Read 0252 contracts and existing prepareItc/prepareWorkspace callers; add the ITC native entry using shared tabs/progress and declare run/digest vars.
2. (R3/R4) Capture only successful ITC preparation before authoring; preserve XOR/force/revise-count/solo behavior and test captured external child workspace containment with real preparations.
3. (R2/R4) Add producer-bound fixed mappings for outlines/draft/judge/revisions/optional illustrations/per-target results/report; test partial failures, legacy unknowns and overwritten directories.
4. (R1/R3/R5) Connect safe previews, state visits/retries and recorded config to the shared UI with the existing Settings link; enable only the built ITC entry and hand fixtures/projection to 0255.
5. (R1-R5) Run section 9 ITC reader/browser tests and existing ITC/stage regressions, lint, full unit suite, workspace build and rule presets; update actual shipped CLI/config docs.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/board/capture.ts:11` |
| `apps/cli/src/board/capture.ts:142` |
| `apps/cli/src/board/capture.ts:291` |
| `apps/cli/src/board/capture.ts:306` |
| `apps/cli/src/board/capture.ts:369` |
| `apps/cli/src/board/capture.ts:371` |
| `apps/cli/src/board/manifest.ts:273` |
| `apps/cli/src/board/manifest.ts:360` |
| `apps/cli/src/board/reader.ts:358` |
| `apps/cli/src/board/reader.ts:365` |
| `apps/cli/src/board/reader.ts:367` |
| `apps/cli/src/board/reader.ts:375` |
| `apps/cli/src/board/reader.ts:384` |
| `apps/cli/src/board/reader.ts:399` |
| `apps/cli/src/board/reader.ts:414` |
| `apps/cli/src/board/reader.ts:422` |
| `apps/cli/src/board/reader.ts:438` |
| `apps/cli/src/board/reader.ts:6` |
| `apps/cli/src/commands/board.ts:143` |
| `apps/cli/src/commands/board.ts:30` |
| `apps/cli/src/commands/board.ts:7` |
| `apps/cli/src/commands/board.ts:99` |
| `apps/cli/src/commands/daily.ts:105` |
| `apps/cli/src/commands/daily.ts:107` |
| `apps/cli/src/commands/daily.ts:110` |
| `apps/cli/tests/board/manifest.test.ts:13` |
| `apps/cli/tests/board/manifest.test.ts:39` |
| `apps/cli/tests/board/manifest.test.ts:44` |
| `apps/cli/tests/commands/board.test.ts:54` |
| `docs/04_DESIGN.md:346` |
| `docs/04_DESIGN.md:401` |
| `docs/features/G8_workflow-visibility-in-spur-board-collect-daily-ai-voice-it-content.md:33` |
| `docs/features/G8_workflow-visibility-in-spur-board-collect-daily-ai-voice-it-content.md:9` |
| `docs/tasks/0253_inspect-daily-voice-dag-runs-and-multimedia-results-in-spur-.md:156` |
| `docs/tasks/0253_inspect-daily-voice-dag-runs-and-multimedia-results-in-spur-.md:18` |
| `docs/tasks/0253_inspect-daily-voice-dag-runs-and-multimedia-results-in-spur-.md:210` |
| `docs/tasks/0253_inspect-daily-voice-dag-runs-and-multimedia-results-in-spur-.md:236` |
| `docs/tasks/0253_inspect-daily-voice-dag-runs-and-multimedia-results-in-spur-.md:253` |
| `docs/tasks/0253_inspect-daily-voice-dag-runs-and-multimedia-results-in-spur-.md:4` |
| `docs/tasks/0253_inspect-daily-voice-dag-runs-and-multimedia-results-in-spur-.md:65` |
| `docs/tasks/0253_inspect-daily-voice-dag-runs-and-multimedia-results-in-spur-.md:7` |
| `plugins/kk/workflows/kk-itc.yaml:31` |
| `plugins/kk/workflows/kk-itc.yaml:55` |
| `scripts/build-board.ts:46` |
| `apps/board/src/itc/index.css:1` |
| `apps/board/src/itc/index.tsx:1` |
| `apps/board/src/itc/view.ts:1` |
| `apps/board/tests/itc/view.test.ts:1` |
| `apps/cli/src/board/itc.ts:1` |
| `apps/cli/tests/board/itc.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Four-tab IT Content entry with shared run selection and polling over the selected run's captured record: apps/board/src/itc/index.tsx:87-233 renders the four BOARD_TABS, the run selector and the no-runs state; the truthful summary projection is apps/cli/src/board/itc.ts:307-420 and its facts are apps/board/src/itc/view.ts:202-262. Fresh this session: apps/cli/tests/board/itc.test.ts:352 and apps/board/tests/itc/view.test.ts:102 pass in the focused run (102 pass / 0 fail across 7 suites). |
| R2 | MET | Outline options a/b/c + selected outline + draft + judge verdict/feedback + revision evidence + cover image + per-target outcomes + final report are all projected: fixed manifest apps/cli/src/board/manifest.ts:278-354, projection apps/cli/src/board/itc.ts:220-260,340-400 and plan-derived target specs apps/cli/src/board/itc.ts:259-305. Fresh tests: apps/cli/tests/board/itc.test.ts:352 asserts judge verdict+feedback, selected-outline text, draft text, cover available and report available; apps/cli/tests/board/itc.test.ts:299 asserts both publisher result shapes. My own probe this session (under $TMPDIR) drove the fan-out targets[] aggregate (t1 ok, t2 failed) and the browser single-object Result (b1 ok) through the real projection: both shapes parse. |
| R3 | MET | Recorded state visits/attempts/timing/operator-wait render through the shared progress path apps/board/src/itc/index.tsx:421-451; revision counts come from recorded draft-revise/draft-autorevise VISITS, never the mutable counter files, apps/cli/src/board/itc.ts:200-215; only captured sanitized settings are exposed apps/cli/src/board/reader.ts:449-463; the module exposes only GET reads plus Refresh/Load-more buttons (no authoring/review/publish action) apps/board/src/itc/index.tsx:87-460. Fresh tests: apps/cli/tests/board/itc.test.ts:205 and apps/board/tests/itc/view.test.ts:102. |
| R4 | MET | Trusted-capture of an external canonical child workspace: apps/cli/src/board/capture.ts:291-310 refuses the filesystem root, home, the project root, the trusted root itself, a prefix lookalike and out-of-root traversal; apps/cli/src/commands/board.ts:102 binds the ITC work-dir to the configured works root. Tests apps/cli/tests/board/itc.test.ts:423 (canonical child accepted; root, / and project refused) and apps/cli/tests/board/itc.test.ts:457 (the config tree is never a works root); prepare XOR/force/revise-count semantics preserved at apps/cli/tests/board/itc.test.ts:472. My own probe this session (8 cases, under $TMPDIR) reproduced REFUSE for /, home, the project root, the trusted root itself, the dir-evil lookalike and a .. traversal, ACCEPT only the canonical child, and no escaped marker write. Explicit missing/unknown/superseded states: apps/cli/src/board/itc.ts:330-345,410-418. |
| R5 | MET | Config tab shows only captured sanitized settings plus the uncaptured keys and links to Settings Workflows: apps/board/src/itc/index.tsx:432-462 and apps/board/src/itc/index.tsx:238; the captured values are served by apps/cli/src/board/reader.ts:449-463, asserted in apps/cli/tests/board/itc.test.ts:352 (settings judge/auto/max_revisions and unavailableKeys contains research). No current-definition endpoint is added: the reader route surface stays health/results/config/artifacts with no definition route. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Summary separates execution status from result outcome (req: R1) | MET | test | apps/board/tests/itc/view.test.ts:102 keeps Execution status apart from Result outcome and labels every unknown; a partial publish (1 ok, 1 failed) never reads as fully successful (Publish targets availability missing); distinct facts are apps/board/src/itc/view.ts:202-262. |
| AC2 — IT Content results show authoring and review evidence (req: R2) | MET | test | apps/cli/tests/board/itc.test.ts:352 (reader route serves both publisher shapes, judge verdict+feedback, selected outline, draft, cover, report); apps/cli/tests/board/itc.test.ts:299 (pure projection reads both shapes); my own probe this session confirmed the fan-out targets[] aggregate and the browser single-object Result both project. |
| AC3 — Progress preserves state visits and retries (req: R3) | MET | test | apps/cli/tests/board/itc.test.ts:205 counts recorded revise/auto-revise visits and never invents a zero without progress; the shared progress rows render visits/attempts/timing with no execution action, apps/board/src/itc/index.tsx:421-451. |
| AC4 — Configuration distinguishes current defaults and recorded run values (req: R3; R5) | MET | test | apps/cli/tests/board/itc.test.ts:352 serves captured settings {judge,auto,max_revisions} and unavailableKeys including research; apps/board/src/itc/index.tsx:460 links Settings Workflows; captured-only values are apps/cli/src/board/reader.ts:449-463. |
| AC5 — No runs and unavailable artifacts have explicit states (req: R1; R4) | MET | test | apps/cli/tests/board/itc.test.ts:379 (a failed publisher artifact is unavailable and the target unknown) and apps/cli/tests/board/itc.test.ts:330 (an unrecorded producer/report is explicit null, never zero); apps/board/tests/itc/view.test.ts:89 (an absent summary bag is all-unknown); the no-runs state is apps/board/src/itc/index.tsx:227-241. |
| AC6 — Overwritten workspaces never impersonate historical outputs (req: R4) | MET | test | apps/cli/tests/board/itc.test.ts:408: a later owner of the same workspace makes the earlier run's artifacts superseded with the board.artifact.superseded diagnostic; ownership is re-verified after the bounded reads, apps/cli/src/board/reader.ts:418-424. |
| AC7 — Refreshing and connection failures preserve a truthful view (req: R1) | MET | test | apps/board/tests/shared/refresh.test.ts:15 (a tick while a request is pending is ignored — no overlapping requests), apps/board/tests/shared/refresh.test.ts:28 (last success kept while failing, backoff capped), apps/board/tests/shared/refresh.test.ts:38 (never presents stale data as fresh); selection preserved via apps/board/tests/shared/run-selection.test.ts:41; per-source busy refs and the independent progress fetch are apps/board/src/itc/index.tsx:103-167. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature G8; ADR-035 (including ready-audit ownership amendment).
- docs/design/workflow-board-modules.md section 9: frozen names, types, capture timing, ownership and test handoff.
- docs/plans/2026-10-11-G8-ready-refinement.md: durable checklist/corrections report.
- Installed Spur 0.4.2: board/index.d.ts and web/board-runtime.json; public HTTP list/detail/progress contracts verified against the running project Board. Sibling Spur source was read only for contract inspection, never a runtime/package dependency.
- Existing project worktree only; no active wip tasks at audit. Prior authorized changes remain in the shared checkout.

### History

- 2026-10-12T07:26:58.242Z todo → testing (system)
- 2026-10-12T07:27:00.769Z testing → done (system)

