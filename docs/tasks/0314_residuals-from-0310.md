---
schema_version: 1
name: Residuals from 0310
status: backlog
template: standard
created_at: 2026-10-18T00:48:53.259Z
updated_at: "2026-10-18T00:48:53.314Z"

---

## 0314. Residuals from 0310

### Background

Source task: 0310 (feature G21) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:17e82d92 — docs/tasks/0310_kk-itc-resume-seam-for-failed-dag-publish-runs.md § Solution (last paragraph): R6's second conjunct is unmet: the harness gap is recorded in-task but **no corpus residual task exists** for engine-side DAG fresh starts. `docs/tasks/` holds only 0310, 0311 (different subject: probe env), 0312/0313 (the G81 0308/0309 residuals); the record itself hands the filing downstream — "Not filed as a corpus task here (lifecycle action, left to close/review)".
- review-finding:f6815433 — apps/cli/src/itc-publish.ts:412: The task's Q&A claims "Re-entry cannot double-publish, `itc-send-targets` skips a target whose prior receipt has `status: succeeded`". The skip covers `succeeded` only (`apps/cli/src/itc-publish.ts:422-427`), so a target whose receipt is `uncertain` (effect `unknown` — the one status that means "may already be live") **is re-dispatched** by the tail's non-retry `fanout-send` (`plugins/kk/workflows/kk-itc-publish-tail.yaml:39-48`) before `fanout-recovery`'s conservative `--retry` (`apps/cli/src/itc-publish.ts:412-419` skips `effect !== 'none'`). A live target with a lost response can therefore publish twice on re-entry. No new code — the main DAG has the identical dispatch rule — but the seam is now the documented one-command path into it, so the Q&A sentence is broader than the guarantee.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
