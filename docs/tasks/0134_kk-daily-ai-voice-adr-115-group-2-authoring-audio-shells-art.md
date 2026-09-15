---
schema_version: 1
name: "kk-daily-ai-voice ADR-115 group 2: authoring/audio shells (article, cover, script, wrap-docs, generate, quality-control)"
status: todo
template: issue
created_at: 2026-09-14T23:36:56.195Z
updated_at: "2026-09-15T01:13:49.370Z"
feature_id: F8
parent_wbs: "0132"

---

## 0134. kk-daily-ai-voice ADR-115 group 2: authoring/audio shells (article, cover, script, wrap-docs, generate, quality-control)

### Background

Sub-task of **0132** (parent). Group 2 of 4 from the kk-daily-ai-voice decomposition.

See 0133 for the full context: `plugins/kk/workflows/kk-daily-ai-voice.yaml` is the live 06:00
scheduled pipeline with 21 error-level ADR-115 composition findings, split into four ordered groups.

| Action | Measure |
| --- | --- |
| `article:onEnter:0` | 28 logical commands (largest in the file) |
| `cover:onEnter:0` | `agent.run` input 1086 chars |
| `cover:onEnter:1` | 15 logical commands |
| `script:onEnter:0` | 12 logical commands |
| `wrap-docs:onEnter:0` | 935 chars (over the 800-char shell cap) |
| `generate:onEnter:0` | 11 logical commands |
| `quality-control:onEnter:0` | 13 logical commands |

Scope: the authoring/audio half (article → cover → script → wrap → generate → quality control).
`cover:onEnter:0` is an `agent.run` prompt (needs the bounded-prompt treatment task 0131 applied to
`kk-solo-podcast`, i.e. point at the owning skill's template instead of restating a contract), and
`wrap-docs` already resolves the `wrap-voicescript-doc.ts` sidecar the shared runner knows how to
delegate to.

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
