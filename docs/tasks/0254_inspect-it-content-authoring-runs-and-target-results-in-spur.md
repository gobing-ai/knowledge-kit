---
schema_version: 1
name: Inspect IT Content authoring runs and target results in Spur Board
status: todo
template: feature-impl
created_at: 2026-10-11T23:22:42.779Z
updated_at: "2026-10-12T04:36:18.208Z"
feature_id: G8
priority: P2
tags:
  - board
  - workflows
estimate_hours: 6

dependencies: ["0252"]
ac_altitude: task-local
ac_numbering: task-local
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

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The installed host advertises React 19.2.1 / ReactDOM 19.2.1 / React Router 7.11.0 and the facade specifiers a contribution may externalize | installed `@gobing-ai/spur` `web/board-runtime.json` | Read `node_modules/@gobing-ai/spur/web/board-runtime.json:4-11`; the seven named facade assets exist on disk | HIGH |
| The reader's status vocabulary is 400 bad identity/query, 403 foreign origin or project, 404 unknown capture/artifact, 405 mutating method, 416 unsatisfiable range, 422 malformed stored evidence, 503 Board authority unavailable | the shipped reader in this repo | `apps/cli/src/board/reader.ts:207,217,296,414,488` — read the branch that sets each status; the second review reproduced the 422 cases against a real server | HIGH |
| `kk-itc.yaml` does NOT declare `__runId` today, so §9's capture cannot bind an ITC run until it does | the workflow definition | `grep -c '__runId' plugins/kk/workflows/kk-itc.yaml` returns 0 (checked 2026-10-12); §9 requires the declaration with `__definitionDigest` | HIGH |
| A caller-supplied ITC workspace outside any works root is refused by the capture guard, so an external child workspace needs the §9 trusted-record binding rather than a relaxed guard | the shipped capture guard | `apps/cli/src/board/capture.ts:309` (structural refusal) plus the handoff note in this task's Background | HIGH |
| `readCaptureRecord` validates the record SHAPE and returns null on a missing string field, non-absolute `workspacePath` or absent `settings`, so any new record field must be added to that validation | the shipped capture module | `apps/cli/src/board/capture.ts:191` (read); the reader answers 422 via `authorize` rather than 500 | HIGH |

### Requirements

- [ ] R1. Ship the IT Content native module with four tabs, run-bound authoring previews and truthful summary/recorded-config presentation.
- [ ] R2. Show outline alternatives/selection, draft, judge feedback/revision evidence, optional images, per-target outcomes and final report when present.
- [ ] R3. Reuse recorded state visits/retries/pause diagnostics and capture sanitized run settings while keeping all authoring/review/publishing actions read-only in the Board.
- [ ] R4. Support trusted captured external ITC workspaces with narrow canonical allowlists and explicit missing/legacy/superseded states; preserve current prepare validation and force semantics.
- [ ] R5. Reuse Settings → Workflows for definition browsing, YAML/copy and static graphs; link /board/settings/workflows and expose only captured run settings in the module. No duplicate current-definition endpoint.

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
