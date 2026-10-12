---
schema_version: 1
name: Surface a degraded decision-label pass at collect time, not as an empty pool later
status: todo
template: issue
created_at: 2026-10-12T21:58:38.445Z
updated_at: "2026-10-12T21:58:59.204Z"
feature_id: G8

ac_altitude: task-local
---

## 0268. Surface a degraded decision-label pass at collect time, not as an empty pool later

### Background

`kk store label` records a degraded verdict as `{source: 'default', reason: 'no-backend', confidence: null}` and the pass still prints `verdict: PASS`, so a completely broken decision backend is indistinguishable from a healthy pass at the collect boundary. On 2026-10-12 the two launchd `kk-collect` ticks (04:00, 10:00) reported `PASS` with `fallback: 22/26` and `33/45` consults, because the launchd job environment has no `TYPESAFE_API_KEY`. Every `typesafe`-routed decision then landed on its fail-closed default (`kk-item-china-politics` = 3), the `ai-news` extract profile's `lte: 1` gate excluded the whole day, and the daily run closed as `no-content` ~90 minutes later with no link back to the label pass.

The credential half is fixed for kk-collect's rendered artifacts (the plist/crontab now bind `TYPESAFE_API_KEY`). This task is the observability half: the failure has to surface where it happens, not as an empty pool downstream.

### Requirements

- [ ] R1. Make the label pass's degradation rate visible at collect time — at minimum a warning line carrying the fallback count and the consulted decisions, so `launchd.log`/the ledger shows a sick backend without opening the store.
- [ ] R2. Decide the threshold that should escalate (a warning today; consider a non-`PASS` verdict or an explicit `degraded` field above a share of consults), and record the reason in the workflow's guard comment.
- [ ] R3. Do not change the fail-closed default values themselves: a degraded china-politics label staying at 3 is the deliberate moderation rail — the gap is that nothing says the rail fired.
- [ ] R4. Cover the degraded pass with a test that asserts the escalation, and confirm a healthy pass is unaffected.

### Acceptance Criteria

- [ ] AC1 — A label pass whose consults mostly fell back reports the fallback rate on the boundary that kk-collect reads. (req: R1, R2)
- [ ] AC2 — The default values of the degraded labels are unchanged. (req: R3)
- [ ] AC3 — The test exercises both a degraded and a healthy pass and fails against the pre-change code. (req: R4)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
