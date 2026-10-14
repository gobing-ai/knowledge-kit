---
schema_version: 1
name: "Fix voice2-dag AC1: retry sibling never fires after primary exit-0 without expectFile"
status: cancelled
template: issue
created_at: 2026-10-14T06:15:17.989Z
updated_at: "2026-10-14T18:07:07.670Z"

feature_id: G11
---

## 0280. Fix voice2-dag AC1: retry sibling never fires after primary exit-0 without expectFile

### Background

Filed after voice2 recovery AC1 failed during 0279's gate (run `dev-runall-0274-0279-3d2a`). The original report suspected a scheduler race because the primary ran but the retry binary did not. Task 0238 and this regression belong to feature G11 (voice2 DAG), not the completed F6 workflow feature.

**Update 2026-10-14 — root cause identified (A22 session review).** The task's earlier investigation recorded a global quota disable of the configured `claude` executor and the dispatch error `Executor 'claude' is disabled`. Commit `114d24adfd0c7575c3b1cfe1357db4126b3fd9b0` already changed the recovery fixtures to use a `codex` PATH stub. Historical quota timestamps and the original batch log are prior investigation evidence, not independently reproduced by this refinement.

**Refine corrections (2026-10-14)**

- Retry scheduling defect → current recovery AC1 dispatches `pi` then `codex` and produces the expected plan → remove the scheduler-race allegation; the fixture correction is already shipped.
- Bare-binary compatibility gap → Spur's accepted executor-availability design explicitly guards named profiles before canonical-binary fallback and requires disabled pins to fail without fallback → remove the proposed contract change.
- Wrong feature suggestion F6 → task 0238 is linked to active G11 → link 0280 to G11 and refresh its task roster.
- No unresolved implementation issue remains → cancel 0280 rather than invent requirements or prepare duplicate work.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-14T18:06:49.836Z

- Closed: use existing feature G11 because it owns the voice2 DAG and task 0238's recovery siblings. No new feature is needed.
- Closed: retain executor-first disabled-profile refusal; the accepted upstream contract already decides it.
- Closed: cancel this task. The observed fixture failure is already addressed, and the proposed contract defect is invalid.

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. [x] Verify the existing fixture fix and accepted executor contract; no implementation remains.
2. [x] Link to G11, cancel 0280, and refresh the feature task roster.
3. [x] Complete scoped task/feature validation with no findings.

### Root Cause

The test selected `agent_retry: 'claude'`, colliding with an operator-configured executor profile disabled by the quota guard. Executor-first resolution rejected that profile before reaching the PATH stub. This was environment-dependent test dispatch, not dropped DAG scheduling.

Verified current evidence:

- `apps/cli/tests/voice2-dag.test.ts:829` explains profile precedence; `:831` selects `codex`; `:834`–`:852` observes actual primary/retry invocations and output artifacts.
- Commit `114d24adfd0c7575c3b1cfe1357db4126b3fd9b0` contains the existing fixture fix.
- Upstream `/Users/robin/xprojects/spur-new/docs/design/executor-availability.md:48`–`:57` requires profile guards before binary fallback and nonzero failure without fallback for explicit disabled pins (ADR-111).
- Upstream `/Users/robin/xprojects/spur-new/packages/config/src/index.ts:687`–`:694` explicitly forbids falling through to a same-named bare binary; `packages/app/src/services/agent-service.ts:2299`–`:2308` enforces the dispatch guard.

The compatibility promise does not override configured profile precedence or permit bypassing an intentional disable.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

Refinement verification on 2026-10-14:

- `NODE_ENV=test bun test apps/cli/tests/voice2-dag.test.ts --test-name-pattern 'agent.run recovery siblings'`: **6 pass, 0 fail, 36 filtered out**, 57 assertions. Includes AC1–AC4 and the two structural recovery checks; AC1 observes `pi` then `codex`, completed run, and the recovered expected file.
- Command exit was **1 due to per-file coverage thresholds** for the deliberately filtered suite; this is behavioral evidence, not a full-suite quality-gate PASS. Coverage policy was unchanged.
- No production code changed. Full lint/build/test gates were not run for this cancelled-task corpus update.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G11: `docs/features/G11_kk-daily-ai-voice2-dag-daily-workflow-from-the-store-cut-over.md`.
- Original recovery task: `docs/tasks/0238_kk-daily-ai-voice2-every-agent-run-node-exits-0-without-writ.md`.
- Existing fix: commit `114d24adfd0c7575c3b1cfe1357db4126b3fd9b0`.
- Regression coverage: `apps/cli/tests/voice2-dag.test.ts:821`.
- Upstream contract: `/Users/robin/xprojects/spur-new/docs/design/executor-availability.md:48`, accepted under upstream ADR-111.
- Upstream disabled-pin regression: `/Users/robin/xprojects/spur-new/packages/app/tests/services/agent-service.test.ts:4202` (inspected, not executed).

### History

- 2026-10-14T18:06:53.175Z todo → cancelled (system)

