---
schema_version: 1
name: Fix the dead surfdash link in kk-daily-ai-voice show-notes (reads the not-yet-written merged publish result)
status: todo
template: issue
created_at: 2026-09-15T07:20:16.383Z
updated_at: "2026-09-15T07:20:16.565Z"
feature_id: F8

---

## 0137. Fix the dead surfdash link in kk-daily-ai-voice show-notes (reads the not-yet-written merged publish result)

### Background

Pre-existing defect found by the 0133 verification pass (not introduced by the ADR-115 port: the
pre-port body at `git show 8a5ead69:plugins/kk/workflows/kk-daily-ai-voice.yaml` reads the same file).

`show-notes` resolves the article URL for the podcast show notes from

```
RESULT="${work_dir}/3-publish/${run_date}_17_publish_result.json"
POST_PATH=$(jq -r '[(.targets // [])[] | select(.target == "surfdash-pub" and .ok == true) | .metadata.postPath // empty] | first // ""' "$RESULT")
```

but `_17_publish_result.json` is written by the **later** `publish` state (the classify step), which
runs after `show-notes` in the state order (`publish-surfdash → show-notes → publish-podcast →
publish`). At `show-notes` time the file does not exist, so the jq lookup yields nothing and
`PODCAST_PUB_ARTICLE_POST_PATH` is always empty — the state description promises "article URL from
the surfdash result postPath — surfdash failure degrades to legacy full-body layout", so the feature
is silently dead, not degraded.

The surfdash outcome that *is* available at that point is
`3-publish/${run_date}_14_publish-surfdash_result.json` (written by the preceding state; the
`publish` state reads both 14 and 16 files, and the runner's `daily-show-notes` uses the same
`firstPostPath` helper the port preserved).

Fix: point the lookup at `_14_publish-surfdash_result.json` in the runner's `dailyShowNotes`
verb, keep the empty-string fallback (surfdash failure still degrades to the legacy layout), and pin
it with a runner test (surfdash file present → postPath passed through to `PODCAST_PUB_ARTICLE_POST_PATH`).

### Requirements

<!-- R-numbered expectations for the fix. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

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
