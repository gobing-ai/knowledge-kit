---
schema_version: 1
name: Surface a degraded decision-label pass at collect time, not as an empty pool later
status: wip
template: issue
created_at: 2026-10-12T21:58:38.445Z
updated_at: "2026-10-12T23:46:19.745Z"
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

**Threshold decision (R2).** Escalate when the fallback share of a pass's consults exceeds `0.5` — a
MAJORITY of consults answered `source: default` (spur's `no-backend` degradation). The 2026-10-12
incident measured `fallback: 22/26` (0.85) and `33/45` (0.73), both far past that rail, while a
healthy pass sits near zero, so one-half is the smallest defensible line that catches the incident
without a false positive on a single refused answer. The escalation is a **warning, not a gate**: the
pass still prints `verdict: PASS` and gains an explicit `degraded: true` field plus a stderr warning.
The alternative (a non-`PASS` verdict) was rejected: `kk-collect`'s `label → release` guard matches
`verdict: PASS`, so a non-PASS verdict would route a degraded pass to `release-failed` and, with the
`label` state's `onError: continue`, discard the labels it did write — a collect run that fails on a
sick backend also loses the day's pool. The reason is recorded in the guard comment.

| Change | Anchor | Rationale |
| --- | --- | --- |
| Degraded threshold constant `DEGRADED_FALLBACK_SHARE = 0.5`, its reason and the PASS tradeoff | `apps/cli/src/commands/store.ts:1014` | The one named rail; the incident's 22/26 and 33/45 sit far above it, a healthy pass far below. |
| `degraded` boolean computed from the pass's fallback share | `apps/cli/src/commands/store.ts:1058` | `fallback / consults > DEGRADED_FALLBACK_SHARE`; `consults === 0` stays healthy. |
| Greppable stderr warning `kk.store.label.degraded: fallback: N/M consults (P%)` | `apps/cli/src/commands/store.ts:1062` | The boundary `kk-collect`'s launchd.log/the ledger reads; carries the fallback count and the consults denominator in the incident's own shape. |
| `degraded` added to the stdout verdict JSON | `apps/cli/src/commands/store.ts:1076` | Explicit on the boundary kk-collect reads; the guard still reads only `verdict`/`confidence`. |
| `label → release` guard comment recording the threshold, its reason and the degraded-pass meaning | `plugins/kk/workflows/kk-collect.yaml:268` | R2 — the operator reads why a degraded-but-PASS run keeps the lock and its labels. |
| `degraded` on the verdict-line test helper (defaults false) | `apps/cli/tests/store-label.test.ts:313` | Keeps every existing healthy verdict assertion byte-identical. |
| Degraded-and-healthy regression test asserting the escalation and R3 | `apps/cli/tests/store-label.test.ts:591` | Drives a dead backend (8/8 fallback → `degraded` + stderr), asserts china-politics still defaults to `3`, and a healthy pass is unaffected. |
| Design-doc record of the warning and the `degraded` field | `docs/design/kk-collect-and-daily-voice2.md:179` | Keeps the G31 confidence-surface inventory truthful about the label verdict line. |
| `degradedAnswers()` helper — a dead backend answering the catalog fallback | `apps/cli/tests/store-label.test.ts:172` | The incident shape: `source: default`, `reason: no-backend`, china-politics `3`. |

**Pre-change discrimination (R4/AC3).** With the pre-change `store.ts` restored (`git show
HEAD:apps/cli/src/commands/store.ts > apps/cli/src/commands/store.ts`), `bun test
apps/cli/tests/store-label.test.ts -t "mostly fell back"` fails: `Expected -1 / Received +0` on the
`"degraded": true` field (and the `kk.store.label.degraded:` stderr assertion never holds). The
current tree restores the change and the case passes.

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-12T23:46:19.745Z todo → wip (system)

