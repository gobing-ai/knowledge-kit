---
schema_version: 1
name: "kk-daily-ai-voice ADR-115 group 3: publish/report shells (publish-prep, surfdash, show-notes, podcast, publish, run-report)"
status: todo
template: issue
created_at: 2026-09-14T23:36:56.423Z
updated_at: "2026-09-15T01:13:49.540Z"
feature_id: F8
parent_wbs: "0132"

---

## 0135. kk-daily-ai-voice ADR-115 group 3: publish/report shells (publish-prep, surfdash, show-notes, podcast, publish, run-report)

### Background

Sub-task of **0132** (parent). Group 3 of 4 from the kk-daily-ai-voice decomposition.

See 0133 for the full context: `plugins/kk/workflows/kk-daily-ai-voice.yaml` is the live 06:00
scheduled pipeline with 21 error-level ADR-115 composition findings, split into four ordered groups.

| Action | Measure |
| --- | --- |
| `publish-prep:onEnter:0` | 15 logical commands |
| `publish-surfdash:onEnter:0` | 14 logical commands |
| `show-notes:onEnter:0` | 14 logical commands |
| `publish-podcast:onEnter:0` | 17 logical commands |
| `publish:onEnter:0` | 19 logical commands |
| `run-report:onEnter:0` | 18 logical commands |

Scope: the publish/report half (prep → surfdash → show notes → podcast → fan-out publish → run
report). These actions are the ones that actually reach the network and the four publishing
plugins, so they carry the highest blast radius in the group set: port them one action per review
pass, keep the `kk executor run <plugin>` argv byte-identical, and treat any credential or endpoint
resolution as out of scope.

**Before starting:** Requirements/AC for this task are authored by its own `refine` pass — the group
inventory above is the scope, not a frozen requirement set. Do not inherit the superseded
per-workflow-script shape from the parent's seeding text (see 0132's Design amendment and Q&A entry).

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
