---
schema_version: 1
name: "Fix sticky no-content: QC candidates cache ignores changed floor vars"
status: cancelled
template: standard
created_at: 2026-10-26T01:00:06.595Z
updated_at: "2026-11-03T18:03:06.479Z"

feature_id: G11
---

## 0336. Fix sticky no-content: QC candidates cache ignores changed floor vars

### Background

The October 25 filing described a no-content refusal that persisted after changing the pool or episode floor. That historical defect is now covered by completed task 0338 (G11); it is not remaining implementation work.

**Refine corrections (2026-11-03)**
- Existence-only QC cache → current `dailyQcContent` hashes plan bytes, QC categories, all thresholds, item minimum, episode floor and driver at `plugins/kk/scripts/daily-stages.ts:140` → already-fixed by 0338; drop the duplicate fix.
- Existence-only plan cache → current `dailyPlan` hashes source bytes and plan arguments at `plugins/kk/scripts/daily-stages.ts:1600` → already-fixed by 0338; drop the duplicate fix.
- Unconditional recovery after any changed input → authored descendants require a fail-closed refusal at `plugins/kk/scripts/daily-stages.ts:1615` and `plugins/kk/scripts/daily-stages.ts:165` → preserve this protection; do not add force deletion.
- Unlinked backlog item → G11 owns voice2 planning and task 0338 → link for historical traceability and cancel 0336 as superseded. No valid issue remains. The original title is retained as historical identification.
- October 25 counts and manual workaround → original run artifacts were not revalidated in this refinement → treat as historical filing, not current evidence or a supported recovery procedure.

Verification on 2026-11-03: `bun test apps/cli/tests/daily-cache-recovery.test.ts` exited 0: 3 pass, 0 fail, 27 assertions. The stage subprocess tests cover unchanged cache reuse, changed pool, floor-refusal recovery, malformed sidecars and protection of authored descendants. Repeatable artifact: `.works/tmp/test-daily-recovery/cache/summary.json`.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

No remaining acceptance work: the original changed-pool/floor behavior is covered by 0338 AC3 and `apps/cli/tests/daily-cache-recovery.test.ts:47`. This task is cancelled as superseded, not independently completed.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-03T18:03:05.447Z

Closed: cancel this duplicate rather than delegate it. Feature G11 is the owner because this is the daily voice2 plan/QC seam, also owned by completed 0338. Reopen only for a new reproducible cache defect with different inputs and evidence; the original historical refusal is not sufficient.

### Design

No implementation: superseded by 0338. Existing SHA-256 stage cache sidecars are the chosen mechanism. Keep the legacy candidates-only compatibility path and the refusal to recompute over authored descendants. Do not add a force/fresh flag, relax safety/floor checks or delete existing episode artifacts.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Root Cause

Historical defect resolved by 0338. Current implementation and executable evidence are recorded in Background; this section no longer asserts an active existence-only cache defect.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-03T18:03:06.479Z backlog → cancelled (system)

