---
schema_version: 1
name: kk news status reports bundle null for a news run whose bundle sits at the run root
status: todo
template: issue
created_at: 2026-11-24T22:43:08.788Z
updated_at: "2026-11-24T22:43:17.638Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
---

## 0435. kk news status reports bundle null for a news run whose bundle sits at the run root

### Background

During the 2026-11-24 dogfood `kk news status --work-dir .works/kk-news-generate/20261124` reported
`"bundle": null` for a run whose bundle was frozen and had already published from it:

```
{"workDir":"…/20261124","type":"news","generate":{"status":"no-content",…},"bundle":null,
 "windows":{"after-generate":{"status":"partial","published":1,"targets":6}}, …}
```

`apps/cli/src/commands/content.ts` reads the summary from a hard-coded path
`join(workDir, '4-publish', 'bundle.json')`, while `resolveBundlePath`
(`apps/cli/src/publish-matrix.ts`) prefers the run root because
`generate-bundle --stage freeze` writes a news bundle there (0382) and resolves every variant path
relative to that directory. The two disagree, so the status surface says a run has no bundle exactly
when the news freeze wrote one — an operator reading status to decide whether anything shipped is told
"nothing".

The same read therefore also cannot show `frozen`, `runId` or `variants` for a news run.

### Requirements

- [ ] R1. `kk news status` must read the bundle through `resolveBundlePath` (run root first, `4-publish/` fallback) instead of the hard-coded `4-publish/bundle.json`.
- [ ] R2. A news run whose root bundle is frozen must report `bundle.frozen`, `bundle.runId` and its variant count in `status`.
- [ ] R3. An article run (bundle under `4-publish/`) keeps reporting exactly what it reports today.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a frozen news bundle is visible in status (req: R1, R2)
Given a run dir with a frozen `bundle.json` at its root and no `4-publish/bundle.json`
When `kk news status --work-dir <dir>` runs
Then `bundle.runId` is the frozen run id and `bundle.variants` is non-null

Scenario: AC2 — the article layout is unchanged (req: R3)
Given a run dir whose bundle lives at `4-publish/bundle.json`
Then status reports the same summary as before this change
```

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

- Status read: `apps/cli/src/commands/content.ts` (`join(workDir, '4-publish', 'bundle.json')`)
- Bundle resolution: `apps/cli/src/publish-matrix.ts` → `resolveBundlePath` (0382 comment)
- Observed: `.works/kk-news-generate/20261124/bundle.json` exists while `kk news status` printed `"bundle": null`

### History
